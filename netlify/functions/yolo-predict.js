const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { response, getBody, authenticatedUser } = require('./_auth');
const { requirePermission } = require('./_security');

const VENV_PYTHON = process.platform === 'win32'
  ? path.join(__dirname, '..', '..', '.venv', 'Scripts', 'python.exe')
  : path.join(__dirname, '..', '..', '.venv', 'bin', 'python');

const PYTHON = process.env.PYTHON_BIN ||
  (fs.existsSync(VENV_PYTHON) ? VENV_PYTHON : (process.platform === 'win32' ? 'python' : 'python3'));
const DEFAULT_CLASSIFIER_MODEL = path.join(__dirname, '..', '..', 'ml', 'model', 'railway_surface_classifier.pt');
const DEFAULT_DETECTOR_MODEL = path.join(__dirname, '..', '..', 'ml', 'model', 'railway_defect_yolo.pt');
const RAILWAY_MODEL = path.resolve(
  process.env.YOLO_MODEL_PATH ||
  (fs.existsSync(DEFAULT_CLASSIFIER_MODEL) ? DEFAULT_CLASSIFIER_MODEL : DEFAULT_DETECTOR_MODEL)
);
const DEMO_MODEL = path.resolve(path.join(__dirname, '..', '..', 'yolo11n.pt'));
const ALLOW_DEMO_MODEL = String(process.env.ALLOW_DEMO_YOLO || 'false').toLowerCase() === 'true';
const SCRIPT = path.join(__dirname, '..', '..', 'ml', 'yolo', 'worker.py');

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_BASE64_CHARS = Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 1024;
const PREDICTION_TIMEOUT_MS = 45_000;

// Keep one Python process alive and reuse the already-loaded YOLO model.
// This removes the biggest recurring source of lag: starting Python and
// loading yolo11n.pt for every click.
let worker = null;
let workerStarting = null;
let workerBuffer = '';
const pending = new Map();

function modelInfo() {
  const hasRailwayModel = fs.existsSync(RAILWAY_MODEL);
  const isDemoModel = !hasRailwayModel && ALLOW_DEMO_MODEL && fs.existsSync(DEMO_MODEL);
  return {
    isDemoModel,
    hasRailwayModel,
    model: hasRailwayModel ? RAILWAY_MODEL : (isDemoModel ? DEMO_MODEL : null)
  };
}

function rejectPending(error) {
  for (const [, item] of pending) {
    clearTimeout(item.timer);
    item.reject(error);
  }
  pending.clear();
}

function stopWorker(reason = 'YOLO worker stopped.') {
  const current = worker;
  worker = null;
  workerStarting = null;
  workerBuffer = '';

  if (current && !current.killed) {
    try { current.kill(); } catch (_) {}
  }

  rejectPending(new Error(reason));
}

function handleWorkerLine(line) {
  if (!line) return;

  let message;
  try {
    message = JSON.parse(line);
  } catch (_) {
    console.warn('Ignoring non-JSON YOLO worker output:', line.slice(0, 300));
    return;
  }

  // Startup readiness is intentionally not put in pending.
  if (message.ready) return;

  const item = pending.get(message.id);
  if (!item) return;

  pending.delete(message.id);
  clearTimeout(item.timer);

  if (!message.ok) {
    item.reject(new Error(message.error || 'YOLO prediction failed.'));
    return;
  }

  delete message.id;
  delete message.ok;
  item.resolve(message);
}

function startWorker() {
  if (worker && !worker.killed) return Promise.resolve(worker);
  if (workerStarting) return workerStarting;

  const { model, hasRailwayModel, isDemoModel } = modelInfo();

  if (!hasRailwayModel && !isDemoModel) {
    return Promise.reject(new Error(
      'Railway visual inspection is not available yet. Add the trained railway model at ml/model/railway_defect_yolo.pt. The bundled yolo11n.pt is a general object model and is intentionally blocked from railway-defect prediction.'
    ));
  }
  if (!fs.existsSync(SCRIPT)) {
    return Promise.reject(new Error('YOLO worker script is missing.'));
  }

  workerStarting = new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(
      PYTHON,
      [SCRIPT, '--model', model, '--warmup'],
      {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      }
    );

    worker = child;
    workerBuffer = '';

    const fail = (error) => {
      if (!settled) {
        settled = true;
        worker = null;
        workerStarting = null;
        try { child.kill(); } catch (_) {}
        reject(error);
      }
    };

    child.stdout.on('data', chunk => {
      workerBuffer += chunk.toString('utf8');
      const lines = workerBuffer.split(/\r?\n/);
      workerBuffer = lines.pop() || '';

      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.ready && !settled) {
            settled = true;
            workerStarting = null;
            resolve(child);
          }
          handleWorkerLine(line);
        } catch (_) {
          console.warn('Ignoring non-JSON YOLO worker output:', line.slice(0, 300));
        }
      }
    });

    child.stderr.on('data', chunk => {
      const text = chunk.toString().trim();
      if (text) console.log(text);
    });

    child.on('error', error => {
      fail(error);
      stopWorker(`YOLO worker could not start: ${error.message}`);
    });

    child.on('exit', (code, signal) => {
      const error = new Error(
        `YOLO worker stopped unexpectedly (code ${code}, signal ${signal || 'none'}).`
      );

      if (!settled) fail(error);
      if (worker === child) {
        worker = null;
        workerStarting = null;
        workerBuffer = '';
        rejectPending(error);
      }
    });
  });

  return workerStarting;
}

async function runPrediction(imagePath, confidence = 0.25) {
  const child = await startWorker();
  if (!child.stdin.writable) throw new Error('YOLO worker input is unavailable.');

  const id = crypto.randomUUID();

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!pending.has(id)) return;
      pending.delete(id);
      reject(new Error('YOLO prediction timed out. The worker will be restarted automatically.'));
      // A stuck native inference must not poison every later request.
      if (worker === child) stopWorker('YOLO worker timed out and was restarted.');
    }, PREDICTION_TIMEOUT_MS);

    pending.set(id, { resolve, reject, timer });

    try {
      child.stdin.write(JSON.stringify({
        id,
        image_path: imagePath,
        confidence
      }) + '\n');
    } catch (error) {
      clearTimeout(timer);
      pending.delete(id);
      reject(error);
    }
  });
}

function decodeBase64Image(value) {
  const image = String(value || '').trim();
  if (!image) throw Object.assign(new Error('Please select an inspection image.'), { statusCode: 400 });

  const comma = image.indexOf(',');
  const encoded = image.startsWith('data:') && comma >= 0
    ? image.slice(comma + 1)
    : image;

  if (!encoded || encoded.length > MAX_BASE64_CHARS) {
    throw Object.assign(new Error('Image is too large. Maximum supported size is 8 MB.'), { statusCode: 413 });
  }

  let raw;
  try {
    raw = Buffer.from(encoded, 'base64');
  } catch (_) {
    throw Object.assign(new Error('The inspection image could not be decoded.'), { statusCode: 400 });
  }

  if (!raw.length) {
    throw Object.assign(new Error('The inspection image could not be decoded.'), { statusCode: 400 });
  }
  if (raw.length > MAX_IMAGE_BYTES) {
    throw Object.assign(new Error('Image is too large. Maximum supported size is 8 MB.'), { statusCode: 413 });
  }

  // Basic file-signature validation. It prevents random text from reaching
  // the Python image loader and gives the user a useful error.
  const isJpeg = raw.length >= 3 && raw[0] === 0xff && raw[1] === 0xd8 && raw[2] === 0xff;
  const isPng = raw.length >= 8 &&
    raw[0] === 0x89 && raw[1] === 0x50 && raw[2] === 0x4e && raw[3] === 0x47;
  const isWebp = raw.length >= 12 &&
    raw.toString('ascii', 0, 4) === 'RIFF' &&
    raw.toString('ascii', 8, 12) === 'WEBP';

  if (!isJpeg && !isPng && !isWebp) {
    throw Object.assign(new Error('Unsupported or invalid image. Use JPG, PNG or WebP.'), { statusCode: 400 });
  }

  return raw;
}

exports.handler = async (event) => {
  let tempDir;
  let tempImage;

  try {
    if (event.httpMethod !== 'POST') return response(405, { message: 'Method not allowed.' });

    const user = await authenticatedUser(event);
    if (!user) return response(401, { message: 'Your session has expired. Please log in again.' });
    requirePermission(user, 'inspections:write');

    const { isDemoModel, hasRailwayModel, model } = modelInfo();
    if (!hasRailwayModel && !isDemoModel) {
      return response(503, {
        message: 'Railway visual inspection requires ml/model/railway_defect_yolo.pt. The generic yolo11n.pt model is intentionally blocked because it is not trained for railway defects.'
      });
    }

    const body = getBody(event);
    const raw = decodeBase64Image(body.image_base64);

    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'railkavach-yolo-'));

    // IMPORTANT: Ultralytics detects input type from the filename extension.
    // Never write the temporary image without an extension, otherwise YOLO
    // treats it as an unsupported path and reports "No images or videos found".
    const isJpeg = raw.length >= 3 && raw[0] === 0xff && raw[1] === 0xd8 && raw[2] === 0xff;
    const isPng = raw.length >= 8 && raw[0] === 0x89 && raw[1] === 0x50 && raw[2] === 0x4e && raw[3] === 0x47;
    const isWebp = raw.length >= 12 && raw.toString('ascii', 0, 4) === 'RIFF' && raw.toString('ascii', 8, 12) === 'WEBP';
    const extension = isJpeg ? '.jpg' : isPng ? '.png' : isWebp ? '.webp' : '.jpg';
    tempImage = path.join(tempDir, `inspection-image${extension}`);

    await fs.promises.writeFile(tempImage, raw);

    const confidence = Number.isFinite(Number(body.confidence))
      ? Math.max(0.05, Math.min(0.95, Number(body.confidence)))
      : 0.25;

    const result = await runPrediction(tempImage, confidence);

    // Ensure visual_risk_level has safe semantics:
    // If detections list is empty, risk must never be LOW; it must be INCONCLUSIVE.
    // If detections exist but confidence is low (< 0.50), it must require review.
    const detections = Array.isArray(result?.detections) ? result.detections : [];
    let visualRisk = String(result?.visual_risk_level || '').toUpperCase().trim();
    if (!detections.length) {
      visualRisk = 'INCONCLUSIVE';
    } else if (visualRisk === 'LOW' || !visualRisk) {
      const hasStrong = detections.some(d => Number(d.confidence) >= 0.50);
      visualRisk = hasStrong ? 'MEDIUM' : 'REVIEW_REQUIRED';
    }

    return response(200, {
      ...result,
      visual_risk_level: visualRisk,
      review_required: visualRisk === 'INCONCLUSIVE' || visualRisk === 'REVIEW_REQUIRED',
      demo_model: isDemoModel
    });
  } catch (error) {
    console.error('YOLO prediction failed:', error);
    return response(Number(error?.statusCode) || 500, {
      message: error.message || 'YOLO image prediction failed.'
    });
  } finally {
    if (tempImage) await fs.promises.rm(tempImage, { force: true }).catch(() => {});
    if (tempDir) await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
};


process.once('exit', () => {
  if (worker && !worker.killed) {
    try { worker.kill(); } catch (_) {}
  }
});
