const { response, getBody, authenticatedUser, supabaseRequest } = require('./_auth');
const { requirePermission, validateText } = require('./_security');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { getPythonBin } = require('./_python');
const execFileAsync = promisify(execFile);

const ALLOWED_ASSET_STATUS = ['Active', 'Maintenance', 'Inactive'];
const ALLOWED_INVENTORY_STATUS = ['In Stock', 'Deployed', 'Maintenance', 'Disposed'];
const ALLOWED_INSPECTION_STATUS = ['Passed', 'Failed', 'Pending'];

function clean(value) {
  return String(value ?? '').trim();
}
function id(prefix) {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}
function esc(value) { return encodeURIComponent(String(value ?? '')); }
function isoDate(value) { return value ? new Date(value).toISOString() : new Date().toISOString(); }

async function requireUser(event) {
  const user = await authenticatedUser(event);
  if (!user) throw Object.assign(new Error('Not authenticated'), { statusCode: 401 });
  return user;
}

async function listAssets() {
  return await supabaseRequest('assets?select=*&order=created_at.desc');
}
async function listInventory() {
  return await supabaseRequest('inventory?select=*&order=created_at.desc');
}
async function listInspections() {
  return await supabaseRequest('inspections?select=*&order=inspected_at.desc');
}
async function listNotifications() {
  return await supabaseRequest('notifications?select=*&order=created_at.desc&limit=20');
}
async function listPortals() {
  return await supabaseRequest('portals?select=*&order=name.asc');
}
async function listAuditLogs() {
  return await supabaseRequest('audit_logs?select=*&order=created_at.desc&limit=100');
}
async function writeAuditLog(user, action, entityType, entityId, details = {}) {
  try {
    await supabaseRequest('audit_logs', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ actor_id: user?.id || null, actor_email: user?.email || null, action, entity_type: entityType, entity_id: entityId || null, details }) });
  } catch (error) { console.warn('Audit log write failed:', error.message); }
}
async function writeNotification(type, icon, text, entityId = null) {
  try {
    await supabaseRequest('notifications', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ type, icon, text, entity_id: entityId }) });
  } catch (error) { console.warn('Notification write failed:', error.message); }
}


const ML_MODEL_PATH = path.join(__dirname, '..', '..', 'ml', 'model', 'risk_model.pkl');
const ML_PREDICT_PATH = path.join(__dirname, '..', '..', 'ml', 'predict.py');

function numeric(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function assetAgeYears(asset) {
  if (!asset?.created_at) return 0;
  const age = (Date.now() - new Date(asset.created_at).getTime()) / (365.25 * 86400000);
  return Math.max(0, Number.isFinite(age) ? Number(age.toFixed(2)) : 0);
}

function daysSinceInspection(inspection) {
  if (!inspection) return 365;
  const stamp = new Date(inspection.inspected_at || inspection.created_at).getTime();
  if (!Number.isFinite(stamp)) return 365;
  return Math.max(0, Number(((Date.now() - stamp) / 86400000).toFixed(2)));
}

function mlFeatures(asset, latest) {
  return {
    asset_age_years: assetAgeYears(asset),
    wear_level: numeric(latest?.wear_level),
    corrosion_level: numeric(latest?.corrosion_level),
    crack_level: numeric(latest?.crack_level),
    deformation_level: numeric(latest?.deformation_level),
    vibration_level: numeric(latest?.vibration_level),
    temperature_c: latest?.temperature_c == null ? 35 : numeric(latest.temperature_c, 35),
    maintenance_count: numeric(latest?.maintenance_count),
    previous_failures: numeric(latest?.previous_failures),
    days_since_last_inspection: daysSinceInspection(latest)
  };
}

async function predictWithMl(features) {
  if (!fs.existsSync(ML_MODEL_PATH) || !fs.existsSync(ML_PREDICT_PATH)) {
    return { __mlUnavailable: true, reason: 'ML model files are missing on disk.' };
  }
  const python = getPythonBin();
  try {
    const { stdout, stderr } = await execFileAsync(python, [
      ML_PREDICT_PATH,
      '--model', ML_MODEL_PATH,
      '--json', JSON.stringify(features)
    ], { timeout: 12000, windowsHide: true, maxBuffer: 1024 * 1024 });

    const trimmed = String(stdout || '').trim();
    if (!trimmed) {
      throw new Error(`Empty prediction response from python process. Stderr: ${stderr || 'None'}`);
    }
    const parsed = JSON.parse(trimmed);
    if (!parsed?.risk_level) {
      throw new Error(`ML model output did not contain risk_level. Output: ${trimmed.slice(0, 200)}`);
    }
    const weights = { LOW: 10, MEDIUM: 35, HIGH: 65, CRITICAL: 90 };
    const score = Math.round(numeric(parsed.risk_score, weights[parsed.risk_level] || 50));
    return {
      ...parsed,
      score: Math.max(0, Math.min(100, score)),
      method: parsed.method || 'tree-ensemble-ml-with-safety-guardrail',
      ml_available: true,
      python_bin: python
    };
  } catch (error) {
    const detail = [error.message, error.stderr, error.stdout].filter(Boolean).join(' | ');
    console.warn('ML prediction unavailable; using baseline risk fallback:', detail);
    return {
      __mlUnavailable: true,
      reason: detail || 'Python ML prediction failed.',
      python_bin: python,
      error_detail: error.stderr || error.message
    };
  }
}

async function safeList(fn, label) {
  try {
    return await fn();
  } catch (error) {
    console.warn(`${label} load failed:`, error.message);
    return [];
  }
}

async function dashboard() {
  // Never let one optional table break the entire dashboard.
  // Assets remain available even if another table/migration is temporarily unavailable.
  const [assets, inventory, inspections, notifications, portals, auditLogs] = await Promise.all([
    safeList(listAssets, 'Assets'),
    safeList(listInventory, 'Inventory'),
    safeList(listInspections, 'Inspections'),
    safeList(listNotifications, 'Notifications'),
    safeList(listPortals, 'Portals'),
    safeList(listAuditLogs, 'Audit logs')
  ]);
  return { assets, inventory, inspections, notifications, portals, auditLogs };
}

function pathForPermission(value) {
  const text = String(value || '').replace(/\/+$/, '');
  const known = ['assets', 'inventory', 'inspections', 'notifications', 'audit-logs', 'users'];
  return known.find(name => text.endsWith('/' + name)) || text;
}

exports.handler = async (event) => {
  try {
    const user = await requireUser(event);
    const method = event.httpMethod;
    const isWrite = ['POST', 'PATCH', 'DELETE'].includes(method);
    if (isWrite && (pathForPermission(event.path || '').startsWith('assets') || pathForPermission(event.path || '').startsWith('inventory'))) {
      requirePermission(user, pathForPermission(event.path || '').startsWith('assets') ? 'assets:write' : 'inventory:write');
    }
    if (isWrite && pathForPermission(event.path || '').startsWith('inspections')) requirePermission(user, 'inspections:write');
    const path = event.path || '';
    const body = getBody(event);
    const q = event.queryStringParameters || {};

    if (method === 'GET' && path.endsWith('/dashboard')) {
      return response(200, await dashboard());
    }

    if (path.endsWith('/audit-logs')) {
      if (method !== 'GET') return response(405, { message: 'Method not allowed.' });
      const rows = await listAuditLogs();
      return response(200, { auditLogs: rows });
    }

    if (path.endsWith('/assets')) {
      if (method === 'GET') { const rows = await listAssets(); return response(200, { assets: q.id ? rows.filter(r => r.id === q.id) : rows }); }
      if (method === 'POST') {
        const type = clean(body.type), location = clean(body.location);
        const status = clean(body.status) || 'Active';
        if (!type || !location || !ALLOWED_ASSET_STATUS.includes(status)) return response(400, { message: 'Type, location and a valid status are required.' });
        const asset = {
          id: clean(body.id) || id('AST'), type, location, status,
          batch_number: clean(body.batch_number) || null,
          vendor: clean(body.vendor) || null,
          qr_data: body.qr_data || null,
          created_by: user.id
        };
        let rows;
        try {
          rows = await supabaseRequest('assets', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(asset) });
        } catch (error) {
          if (error.statusCode === 409 || /duplicate|unique/i.test(error.message || '')) {
            return response(409, { message: `Asset ID ${asset.id} already exists. Choose a different Asset ID.` });
          }
          throw error;
        }
        const created = rows?.[0];
        await writeNotification('green', 'fa-circle-plus', `New asset ${asset.id} registered`, asset.id);
        await writeAuditLog(user, 'CREATE', 'asset', asset.id, { type: asset.type, location: asset.location });
        return response(201, { asset: created });
      }
      if (method === 'PATCH') {
        const assetId = clean(q.id || body.id);
        if (!assetId) return response(400, { message: 'Asset id is required.' });
        const patch = {};
        ['type','location','batch_number','vendor'].forEach(k => { if (body[k] !== undefined) patch[k] = clean(body[k]) || null; });
        if (body.status !== undefined) {
          if (!ALLOWED_ASSET_STATUS.includes(body.status)) return response(400, { message: 'Invalid asset status.' });
          patch.status = body.status;
        }
        patch.updated_at = new Date().toISOString();
        const rows = await supabaseRequest(`assets?id=eq.${esc(assetId)}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch) });
        if (!rows?.[0]) return response(404, { message: 'Asset not found.' });
        await writeAuditLog(user, 'UPDATE', 'asset', assetId, patch);
        return response(200, { asset: rows[0] });
      }
      if (method === 'DELETE') {
        const assetId = clean(q.id || body.id);
        if (!assetId) return response(400, { message: 'Asset id is required.' });
        await supabaseRequest(`assets?id=eq.${esc(assetId)}`, { method: 'DELETE' });
        await writeNotification('warning', 'fa-trash', `Asset ${assetId} was deleted`, assetId);
        await writeAuditLog(user, 'DELETE', 'asset', assetId);
        return response(200, { success: true });
      }
    }

    if (path.endsWith('/inventory')) {
      if (method === 'GET') { const rows = await listInventory(); return response(200, { inventory: q.id ? rows.filter(r => r.id === q.id) : rows }); }
      if (method === 'POST') {
        const type = clean(body.type), batch = clean(body.batch), vendor = clean(body.vendor);
        const status = clean(body.status) || 'In Stock';
        if (!type || !batch || !vendor || !ALLOWED_INVENTORY_STATUS.includes(status)) return response(400, { message: 'Type, batch, vendor and a valid status are required.' });
        const item = {
          id: clean(body.id) || id('INV'), type, batch, vendor,
          warranty_months: Number(body.warranty_months || 0),
          supply_date: body.supply_date || null,
          status, asset_id: clean(body.asset_id) || null, created_by: user.id
        };
        const rows = await supabaseRequest('inventory', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(item) });
        await writeAuditLog(user, 'CREATE', 'inventory', item.id, { type: item.type, status: item.status });
        return response(201, { inventory: rows?.[0] });
      }
      if (method === 'PATCH') {
        const itemId = clean(q.id || body.id);
        if (!itemId) return response(400, { message: 'Inventory id is required.' });
        const patch = {};
        ['type','batch','vendor','supply_date','asset_id'].forEach(k => { if (body[k] !== undefined) patch[k] = clean(body[k]) || null; });
        if (body.warranty_months !== undefined) patch.warranty_months = Number(body.warranty_months || 0);
        if (body.status !== undefined) {
          if (!ALLOWED_INVENTORY_STATUS.includes(body.status)) return response(400, { message: 'Invalid inventory status.' });
          patch.status = body.status;
        }
        patch.updated_at = new Date().toISOString();
        const rows = await supabaseRequest(`inventory?id=eq.${esc(itemId)}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch) });
        if (!rows?.[0]) return response(404, { message: 'Inventory item not found.' });
        await writeAuditLog(user, 'UPDATE', 'inventory', itemId, patch);
        return response(200, { inventory: rows[0] });
      }
      if (method === 'DELETE') {
        const itemId = clean(q.id || body.id);
        if (!itemId) return response(400, { message: 'Inventory id is required.' });
        await supabaseRequest(`inventory?id=eq.${esc(itemId)}`, { method: 'DELETE' });
        await writeAuditLog(user, 'DELETE', 'inventory', itemId);
        return response(200, { success: true });
      }
    }

    if (path.endsWith('/inspections')) {
      if (method === 'GET') {
        const rows = await listInspections();
        let filtered = rows;
        if (q.id) filtered = filtered.filter(r => r.id === q.id);
        if (q.asset_id) filtered = filtered.filter(r => r.asset_id === q.asset_id);
        return response(200, { inspections: filtered });
      }
      if (method === 'POST') {
        const assetId = clean(body.asset_id), status = clean(body.status) || 'Pending';
        if (!assetId || !ALLOWED_INSPECTION_STATUS.includes(status)) return response(400, { message: 'Asset and valid inspection status are required.' });
        const assetRows = await supabaseRequest(`assets?id=eq.${esc(assetId)}&select=id`);
        if (!assetRows?.[0]) return response(404, { message: 'Asset not found.' });
        const measurement = (key, min, max, allowNull = false) => {
          if (body[key] === undefined || (allowNull && body[key] === null)) return allowNull ? null : 0;
          const value = Number(body[key]);
          if (!Number.isFinite(value) || value < min || value > max) throw Object.assign(new Error(`Invalid ${key}`), { statusCode: 400 });
          return value;
        };
        const record = {
          asset_id: assetId, status, inspector_id: user.id, notes: clean(body.notes) || null, inspected_at: isoDate(body.inspected_at),
          wear_level: measurement('wear_level', 0, 5), corrosion_level: measurement('corrosion_level', 0, 5),
          crack_level: measurement('crack_level', 0, 5), deformation_level: measurement('deformation_level', 0, 5),
          vibration_level: measurement('vibration_level', 0, 5), temperature_c: measurement('temperature_c', -50, 150, true),
          maintenance_count: measurement('maintenance_count', 0, 999), previous_failures: measurement('previous_failures', 0, 999),
          yolo_image_name: clean(body.yolo_image_name) || null,
          yolo_detections: Array.isArray(body.yolo_detections) ? body.yolo_detections : null,
          yolo_confidence: body.yolo_confidence == null ? null : Number(body.yolo_confidence),
          yolo_risk_level: (() => {
            const detections = Array.isArray(body.yolo_detections) ? body.yolo_detections : null;
            let r = clean(body.yolo_risk_level);
            if (detections !== null) {
              if (detections.length === 0) {
                if (r === 'LOW' || !r) r = 'INCONCLUSIVE';
              } else {
                const hasStrong = detections.some(d => Number(d.confidence) >= 0.50);
                if (!hasStrong && (r === 'LOW' || !r)) r = 'REVIEW_REQUIRED';
              }
            }
            return r || null;
          })()
        };
        // Save the core inspection first. This makes dynamic creation reliable even
        // when the optional ML measurement columns are temporarily unavailable.
        const coreRecord = {
          asset_id: assetId,
          status,
          inspector_id: user.id,
          notes: clean(body.notes) || null,
          inspected_at: isoDate(body.inspected_at)
        };
        let rows;
        let structuredMeasurementsSaved = false;
        try {
          rows = await supabaseRequest('inspections', {
            method: 'POST',
            headers: { Prefer: 'return=representation' },
            body: JSON.stringify(coreRecord)
          });
        } catch (error) {
          // Return the actual database error instead of hiding it behind a generic 500.
          console.error('Inspection core insert failed:', error);
          throw Object.assign(new Error(`Inspection could not be saved to Supabase: ${error.message}`), { statusCode: error.statusCode || 500 });
        }

        const created = rows?.[0];
        if (!created?.id) {
          throw Object.assign(new Error('Supabase did not return the new inspection record.'), { statusCode: 500 });
        }

        // Add structured ML fields separately. If these optional columns are missing,
        // the inspection itself remains saved and the response tells the UI why.
        try {
          const measurementRows = await supabaseRequest(`inspections?id=eq.${esc(created.id)}`, {
            method: 'PATCH',
            headers: { Prefer: 'return=representation' },
            body: JSON.stringify({
              wear_level: record.wear_level,
              corrosion_level: record.corrosion_level,
              crack_level: record.crack_level,
              deformation_level: record.deformation_level,
              vibration_level: record.vibration_level,
              temperature_c: record.temperature_c,
              maintenance_count: record.maintenance_count,
              previous_failures: record.previous_failures,
              yolo_image_name: record.yolo_image_name, yolo_detections: record.yolo_detections,
              yolo_confidence: record.yolo_confidence, yolo_risk_level: record.yolo_risk_level
            })
          });
          if (measurementRows?.[0]) {
            rows = measurementRows;
            structuredMeasurementsSaved = true;
          }
        } catch (error) {
          const message = String(error.message || '');
          if (!/column .* does not exist|Could not find the .* column|schema cache/i.test(message)) {
            console.warn('Inspection saved but measurement fields could not be stored:', message);
          }
        }
        return response(201, {
          inspection: rows?.[0],
          structuredMeasurementsSaved,
          message: structuredMeasurementsSaved
            ? 'Inspection saved successfully.'
            : 'Inspection saved. Run the structured inspection migration to store measurement fields.'
        });
      }
      if (method === 'DELETE') {
        const inspectionId = clean(q.id || body.id);
        if (!inspectionId) return response(400, { message: 'Inspection id is required.' });
        const rows = await supabaseRequest(`inspections?id=eq.${esc(inspectionId)}`, { method: 'DELETE', headers: { Prefer: 'return=representation' } });
        if (!rows?.length) return response(404, { message: 'Inspection not found.' });
        return response(200, { success: true, inspection: rows[0] });
      }
      if (method === 'PATCH') {
        const inspectionId = clean(q.id || body.id);
        if (!inspectionId) return response(400, { message: 'Inspection id is required.' });
        const patch = {};
        if (body.status !== undefined) {
          if (!ALLOWED_INSPECTION_STATUS.includes(body.status)) return response(400, { message: 'Invalid inspection status.' });
          patch.status = body.status;
        }
        if (body.notes !== undefined) patch.notes = clean(body.notes) || null;
        if (body.inspected_at !== undefined) patch.inspected_at = isoDate(body.inspected_at);
        const measurementPatch = [['wear_level',0,5],['corrosion_level',0,5],['crack_level',0,5],['deformation_level',0,5],['vibration_level',0,5],['maintenance_count',0,999],['previous_failures',0,999],['temperature_c',-50,150]];
        if (body.yolo_image_name !== undefined) patch.yolo_image_name = clean(body.yolo_image_name) || null;
        if (body.yolo_detections !== undefined) patch.yolo_detections = Array.isArray(body.yolo_detections) ? body.yolo_detections : null;
        if (body.yolo_confidence !== undefined) patch.yolo_confidence = body.yolo_confidence == null ? null : Number(body.yolo_confidence);
        if (body.yolo_risk_level !== undefined) {
          let r = clean(body.yolo_risk_level);
          const detections = Array.isArray(body.yolo_detections) ? body.yolo_detections : null;
          if (detections !== null) {
            if (detections.length === 0) {
              if (r === 'LOW' || !r) r = 'INCONCLUSIVE';
            } else {
              const hasStrong = detections.some(d => Number(d.confidence) >= 0.50);
              if (!hasStrong && (r === 'LOW' || !r)) r = 'REVIEW_REQUIRED';
            }
          }
          patch.yolo_risk_level = r || null;
        }
        for (const [key,min,max] of measurementPatch) {
          if (body[key] !== undefined) { const value = body[key] === null && key === 'temperature_c' ? null : Number(body[key]); if (value !== null && (!Number.isFinite(value) || value < min || value > max)) return response(400, { message: `Invalid ${key}.` }); patch[key] = value; }
        }
        let rows;
        let structuredMeasurementsSaved = true;
        try {
          rows = await supabaseRequest(`inspections?id=eq.${esc(inspectionId)}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch) });
        } catch (error) {
          const message = String(error.message || '');
          if (/column .* does not exist|Could not find the .* column|schema cache/i.test(message)) {
            structuredMeasurementsSaved = false;
            const legacyPatch = {};
            ['status', 'notes', 'inspected_at'].forEach(key => {
              if (patch[key] !== undefined) legacyPatch[key] = patch[key];
            });
            rows = await supabaseRequest(`inspections?id=eq.${esc(inspectionId)}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(legacyPatch) });
          } else {
            throw error;
          }
        }
        if (!rows?.[0]) return response(404, { message: 'Inspection not found.' });
        return response(200, {
          inspection: rows[0],
          structuredMeasurementsSaved,
          message: structuredMeasurementsSaved
            ? 'Inspection updated successfully.'
            : 'Inspection updated. Run the structured inspection migration to store measurement fields.'
        });
      }
    }

    if (path.endsWith('/ml-status')) {
      if (method !== 'GET') return response(405, { message: 'Method not allowed.' });
      const modelExists = fs.existsSync(ML_MODEL_PATH);
      const predictorExists = fs.existsSync(ML_PREDICT_PATH);
      const python = getPythonBin();
      let pythonOk = false;
      let pythonMessage = '';
      let testPrediction = null;
      try {
        await execFileAsync(python, ['-c', 'import joblib, sklearn, pandas, numpy; print(\"OK\")'], { timeout: 10000, windowsHide: true });
        pythonOk = true;
      } catch (error) {
        pythonMessage = (error.stderr || error.message || 'Python ML dependencies are unavailable.').trim();
      }

      if (pythonOk && modelExists && predictorExists) {
        try {
          const { stdout } = await execFileAsync(python, [
            ML_PREDICT_PATH,
            '--model', ML_MODEL_PATH,
            '--json', JSON.stringify({ wear_level: 1, crack_level: 0, corrosion_level: 0 })
          ], { timeout: 10000, windowsHide: true });
          testPrediction = JSON.parse(String(stdout).trim());
        } catch (predErr) {
          pythonOk = false;
          pythonMessage = `Predict test failed: ${(predErr.stderr || predErr.message || '').trim()}`;
        }
      }

      return response(200, {
        ml: {
          ready: Boolean(modelExists && predictorExists && pythonOk && testPrediction),
          model_exists: modelExists,
          predictor_exists: predictorExists,
          python_ok: pythonOk,
          python_bin: python,
          message: (pythonOk && testPrediction)
            ? 'Random Forest / Tree Ensemble ML is ready and validated.'
            : (pythonMessage || 'ML model or python dependencies need attention.'),
          test_method: testPrediction?.method || null
        }
      });
    }

    if (path.endsWith('/risk')) {
      if (method !== 'GET') return response(405, { message: 'Method not allowed.' });
      const assetId = clean(q.asset_id || q.id);
      if (!assetId) return response(400, { message: 'asset_id is required.' });
      const assetRows = await supabaseRequest(`assets?id=eq.${esc(assetId)}&select=*`);
      const asset = assetRows?.[0];
      if (!asset) return response(404, { message: 'Asset not found.' });
      const inspections = await supabaseRequest(`inspections?asset_id=eq.${esc(assetId)}&select=*&order=inspected_at.desc`);
      const rows = Array.isArray(inspections) ? inspections : [];
      const latest = rows[0] || null;
      const features = mlFeatures(asset, latest);
      const ml = latest ? await predictWithMl(features) : null;

      const failed = rows.filter(r => r.status === 'Failed').length;
      const pending = rows.filter(r => r.status === 'Pending').length;
      const passed = rows.filter(r => r.status === 'Passed').length;
      let score = 0;
      score += Math.min(failed * 30, 60);
      score += Math.min(pending * 10, 20);
      if (asset.status === 'Maintenance') score += 20;
      if (asset.status === 'Inactive') score += 35;
      if (!latest) score += 15;
      else {
        const days = daysSinceInspection(latest);
        if (days > 180) score += 20; else if (days > 90) score += 10;
        const levelFields = ['wear_level','corrosion_level','crack_level','deformation_level','vibration_level'];
        const measurementTotal = levelFields.reduce((sum, key) => sum + numeric(latest[key]), 0);
        score += Math.min(35, Math.round((measurementTotal / 25) * 35));
        if (numeric(latest.previous_failures) > 0) score += Math.min(10, numeric(latest.previous_failures) * 2);
        if (latest.temperature_c != null) {
          const temp = numeric(latest.temperature_c);
          if (temp < -10 || temp > 60) score += 5;
        }
      }
      score = Math.max(0, Math.min(100, Math.round(score)));
      const level = score >= 75 ? 'CRITICAL' : score >= 50 ? 'HIGH' : score >= 25 ? 'MEDIUM' : 'LOW';
      const isMlSuccessful = Boolean(ml && !ml.__mlUnavailable && ml.risk_level);
      const baseline = {
        score,
        level,
        method: 'baseline-rule-engine',
        confidence: null,
        fallback_used: Boolean(ml?.__mlUnavailable),
        ml_unavailable_reason: ml?.__mlUnavailable ? ml.reason : null
      };
      const selected = isMlSuccessful ? ml : baseline;
      return response(200, {
        risk: {
          asset_id: assetId,
          score: selected.score,
          level: selected.risk_level || selected.level,
          method: selected.method,
          confidence: selected.confidence ?? null,
          probabilities: selected.probabilities || null,
          latest_inspection: latest?.inspected_at || latest?.created_at || null,
          training_source: isMlSuccessful ? 'synthetic_demo' : null,
          ml_available: isMlSuccessful,
          fallback_used: !isMlSuccessful,
          ml_unavailable_reason: ml?.__mlUnavailable ? ml.reason : (!latest ? 'No inspection history for asset' : null),
          factors: {
            failed_inspections: failed,
            pending_inspections: pending,
            passed_inspections: passed,
            asset_status: asset.status,
            latest_inspection: latest?.inspected_at || latest?.created_at || null,
            measurements: latest ? {
              wear_level: numeric(latest.wear_level),
              corrosion_level: numeric(latest.corrosion_level),
              crack_level: numeric(latest.crack_level),
              deformation_level: numeric(latest.deformation_level),
              vibration_level: numeric(latest.vibration_level),
              temperature_c: latest.temperature_c ?? null,
              maintenance_count: numeric(latest.maintenance_count),
              previous_failures: numeric(latest.previous_failures)
            } : null,
            model_features: features
          }
        }
      });
    }

    if (path.endsWith('/analytics')) {
      if (method !== 'GET') return response(405, { message: 'Method not allowed.' });
      const assets = await safeList(listAssets, 'Assets');
      const inspections = await safeList(listInspections, 'Inspections');
      const inventory = await safeList(listInventory, 'Inventory');
      const riskResults = await Promise.all(assets.map(async asset => {
        try {
          const assetRows = [asset];
          const rows = inspections.filter(i => i.asset_id === asset.id).sort((a,b) => new Date(b.inspected_at || b.created_at || 0) - new Date(a.inspected_at || a.created_at || 0));
          const latest = rows[0] || null;
          const features = mlFeatures(assetRows[0], latest);
          const ml = latest ? await predictWithMl(features) : null;
          const failed = rows.filter(r => r.status === 'Failed').length;
          const pending = rows.filter(r => r.status === 'Pending').length;
          let score = 0;
          score += Math.min(failed * 30, 60);
          score += Math.min(pending * 10, 20);
          if (asset.status === 'Maintenance') score += 20;
          if (asset.status === 'Inactive') score += 35;
          if (!latest) score += 15;
          else {
            const days = daysSinceInspection(latest);
            if (days > 180) score += 20; else if (days > 90) score += 10;
            const total = ['wear_level','corrosion_level','crack_level','deformation_level','vibration_level'].reduce((sum,k)=>sum+numeric(latest[k]),0);
            score += Math.min(35, Math.round((total/25)*35));
            score += Math.min(10, numeric(latest.previous_failures)*2);
          }
          score = Math.max(0, Math.min(100, Math.round(score)));
          const baselineLevel = score >= 75 ? 'CRITICAL' : score >= 50 ? 'HIGH' : score >= 25 ? 'MEDIUM' : 'LOW';
          const isMlSuccessful = Boolean(ml && !ml.__mlUnavailable && ml.risk_level);
          const selected = isMlSuccessful
            ? { level: ml.risk_level, score: ml.score, method: ml.method || 'tree-ensemble-ml-with-safety-guardrail', confidence: ml.confidence ?? null, ml_available: true, fallback_used: false }
            : { level: baselineLevel, score, method: 'baseline-rule-engine', confidence: null, ml_available: false, fallback_used: Boolean(ml?.__mlUnavailable), ml_unavailable_reason: ml?.__mlUnavailable ? ml.reason : null };
          return { asset_id: asset.id, type: asset.type, location: asset.location, status: asset.status, latest_inspection: latest?.inspected_at || latest?.created_at || null, inspection_count: rows.length, ...selected };
        } catch (error) {
          return { asset_id: asset.id, type: asset.type, location: asset.location, status: asset.status, inspection_count: 0, level: 'UNKNOWN', score: null, method: 'unavailable', ml_available: false, error: error.message };
        }
      }));
      const riskCounts = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0, UNKNOWN: 0 };
      riskResults.forEach(r => { if (riskCounts[r.level] !== undefined) riskCounts[r.level]++; else riskCounts.UNKNOWN++; });
      const failed = inspections.filter(i => i.status === 'Failed').length;
      const pending = inspections.filter(i => i.status === 'Pending').length;
      const passed = inspections.filter(i => i.status === 'Passed').length;
      const mlCount = riskResults.filter(r => r.ml_available || r.method === 'tree-ensemble-ml-with-safety-guardrail' || r.method === 'random-forest-ml').length;
      const highRisk = riskResults.filter(r => ['HIGH', 'CRITICAL'].includes(r.level)).sort((a,b) => (b.score ?? -1) - (a.score ?? -1));
      return response(200, { analytics: { assets: assets.length, inventory: inventory.length, inspections: inspections.length, failed, pending, passed, risk_counts: riskCounts, ml_assessed: mlCount, high_risk_assets: highRisk, risks: riskResults } });
    }

    if (path.endsWith('/notifications')) {
      if (method === 'GET') return response(200, { notifications: await listNotifications() });
      if (method === 'PATCH') {
        const notificationId = clean(q.id || body.id);
        if (!notificationId) return response(400, { message: 'Notification id is required.' });
        const rows = await supabaseRequest(`notifications?id=eq.${esc(notificationId)}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ is_read: true }) });
        return response(200, { notification: rows?.[0] });
      }
    }

    if (path.endsWith('/portals')) {
      if (method === 'GET') return response(200, { portals: await listPortals() });
      if (method === 'PATCH') {
        const name = clean(q.name || body.name);
        if (!name) return response(400, { message: 'Portal name is required.' });
        const patch = {};
        ['status','api_version','last_error'].forEach(k => { if (body[k] !== undefined) patch[k] = body[k]; });
        if (body.data_points !== undefined) patch.data_points = Number(body.data_points || 0);
        if (body.uptime !== undefined) patch.uptime = body.uptime === null ? null : Number(body.uptime);
        if (body.last_sync !== undefined) patch.last_sync = body.last_sync;
        patch.updated_at = new Date().toISOString();
        const rows = await supabaseRequest(`portals?name=eq.${esc(name)}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch) });
        return response(200, { portal: rows?.[0] });
      }
    }

    return response(404, { message: 'Data endpoint not found.' });
  } catch (error) {
    console.error('Data API error:', error);
    return response(error.statusCode || 500, { message: error.message || 'Data request failed.' });
  }
};
