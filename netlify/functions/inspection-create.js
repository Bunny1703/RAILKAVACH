const { response, getBody, authenticatedUser, supabaseRequest } = require('./_auth');
const { requirePermission, validateText } = require('./_security');

const STATUSES = new Set(['Passed', 'Failed', 'Pending']);
const clean = v => String(v ?? '').trim();
const enc = v => encodeURIComponent(String(v ?? ''));
const iso = v => v ? new Date(v).toISOString() : new Date().toISOString();

async function safeSideEffect(table, payload) {
  try { await supabaseRequest(table, { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(payload) }); }
  catch (error) { console.warn(`${table} side effect failed:`, error.message); }
}

function numberField(body, key, min, max, nullable = false) {
  if (body[key] === undefined || (nullable && (body[key] === null || body[key] === ''))) return nullable ? null : 0;
  const n = Number(body[key]);
  if (!Number.isFinite(n) || n < min || n > max) throw Object.assign(new Error(`Invalid ${key}.`), { statusCode: 400 });
  return n;
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') return response(405, { message: 'Method not allowed.' });
    const user = await authenticatedUser(event);
    if (!user) return response(401, { message: 'Your session has expired. Please log in again.' });
    requirePermission(user, 'inspections:write');

    const body = getBody(event);
    const assetId = clean(body.asset_id);
    const status = clean(body.status) || 'Pending';
    if (!assetId) return response(400, { message: 'Please select an asset.' });
    if (!STATUSES.has(status)) return response(400, { message: 'Please select a valid inspection status.' });

    const assetRows = await supabaseRequest(`assets?id=eq.${enc(assetId)}&select=id`);
    if (!assetRows?.length) return response(404, { message: `Asset ${assetId} was not found in Supabase.` });

    const yoloDetections = Array.isArray(body.yolo_detections) ? body.yolo_detections : null;
    const yoloConfidence = body.yolo_confidence == null ? null : Number(body.yolo_confidence);
    if (yoloConfidence !== null && (!Number.isFinite(yoloConfidence) || yoloConfidence < 0 || yoloConfidence > 100)) return response(400, { message: 'Invalid YOLO confidence.' });
    const yoloImageName = clean(body.yolo_image_name) || null;
    let yoloRiskLevel = clean(body.yolo_risk_level) || null;
    if (yoloDetections !== null) {
      if (yoloDetections.length === 0) {
        if (yoloRiskLevel === 'LOW' || !yoloRiskLevel) yoloRiskLevel = 'INCONCLUSIVE';
      } else {
        const hasStrong = yoloDetections.some(d => Number(d.confidence) >= 0.50);
        if (!hasStrong && (yoloRiskLevel === 'LOW' || !yoloRiskLevel)) yoloRiskLevel = 'REVIEW_REQUIRED';
      }
    }

    const measurements = {
      wear_level: numberField(body, 'wear_level', 0, 5),
      corrosion_level: numberField(body, 'corrosion_level', 0, 5),
      crack_level: numberField(body, 'crack_level', 0, 5),
      deformation_level: numberField(body, 'deformation_level', 0, 5),
      vibration_level: numberField(body, 'vibration_level', 0, 5),
      temperature_c: numberField(body, 'temperature_c', -50, 150, true),
      maintenance_count: numberField(body, 'maintenance_count', 0, 999),
      previous_failures: numberField(body, 'previous_failures', 0, 999)
    };

    const core = {
      asset_id: assetId,
      status,
      inspector_id: user.id,
      notes: validateText(body.notes, 'Notes', 2000) || null,
      inspected_at: iso(body.inspected_at),
      yolo_image_name: yoloImageName, yolo_detections: yoloDetections, yolo_confidence: yoloConfidence, yolo_risk_level: yoloRiskLevel
    };

    let created;
    let measurementsSaved = true;
    try {
      const rows = await supabaseRequest('inspections', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ ...core, ...measurements })
      });
      created = rows?.[0];
    } catch (fullError) {
      // If the database schema is older, save the core record first and then patch measurements.
      const msg = String(fullError.message || '');
      if (!/column .* does not exist|Could not find the .* column|schema cache/i.test(msg)) {
        // A bad/stale inspector FK should never prevent the inspection itself from being recorded.
        if (/foreign key|inspector_id|users/i.test(msg)) {
          const rows = await supabaseRequest('inspections', {
            method: 'POST', headers: { Prefer: 'return=representation' },
            body: JSON.stringify({ asset_id: assetId, status, notes: core.notes, inspected_at: core.inspected_at, ...measurements })
          });
          created = rows?.[0];
        } else {
          throw Object.assign(new Error(`Inspection save failed: ${msg}`), { statusCode: fullError.statusCode || 500 });
        }
      } else {
        measurementsSaved = false;
        const rows = await supabaseRequest('inspections', {
          method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(core)
        });
        created = rows?.[0];
        if (created?.id) {
          try {
            const patched = await supabaseRequest(`inspections?id=eq.${enc(created.id)}`, {
              method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(measurements)
            });
            if (patched?.[0]) { created = patched[0]; measurementsSaved = true; }
          } catch (_) { /* legacy schema: core record is still valid */ }
        }
      }
    }

    if (!created?.id) return response(500, { message: 'Supabase did not return the created inspection.' });
    await safeSideEffect('audit_logs', { actor_id: user.id, actor_email: user.email || null, action: 'CREATE', entity_type: 'inspection', entity_id: created.id, details: { asset_id: assetId, status, yolo: yoloDetections ? { count: yoloDetections.length, risk_level: yoloRiskLevel } : null } });
    if (status === 'Failed') await safeSideEffect('notifications', { type: 'danger', icon: 'fa-triangle-exclamation', text: `Inspection failed for ${assetId}`, entity_id: assetId });
    else if (status === 'Pending') await safeSideEffect('notifications', { type: 'warning', icon: 'fa-hourglass-half', text: `Inspection pending for ${assetId}`, entity_id: assetId });
    else await safeSideEffect('notifications', { type: 'green', icon: 'fa-clipboard-check', text: `Inspection passed for ${assetId}`, entity_id: assetId });
    return response(201, {
      inspection: created,
      structuredMeasurementsSaved: measurementsSaved,
      message: 'Inspection saved successfully.'
    });
  } catch (error) {
    console.error('Inspection create API error:', error);
    return response(error.statusCode || 500, { message: error.message || 'Could not save inspection.' });
  }
};
