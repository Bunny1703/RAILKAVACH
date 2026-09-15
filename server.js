require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const path = require('path');

const app = express();

// Production safety: cap JSON payloads and add security headers.
app.use(express.json({ limit: '12mb' }));
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  next();
});

// Lightweight local/dev rate limiter. Netlify deployments should also use platform/WAF rate limits.
const rateBuckets = new Map();
app.use('/api', (req, res, next) => {
  const now = Date.now();
  const key = `${req.ip}:${req.path}`;
  const bucket = rateBuckets.get(key) || { start: now, count: 0 };
  if (now - bucket.start > 60_000) { bucket.start = now; bucket.count = 0; }
  bucket.count += 1; rateBuckets.set(key, bucket);
  if (bucket.count > 120) return res.status(429).json({ message: 'Too many requests. Please try again shortly.' });
  next();
});

app.get('/api/health', (req, res) => res.status(200).json({ ok: true, service: 'RAILKAVACH', time: new Date().toISOString(), request_id: crypto.randomUUID() }));
app.get('/api/health/supabase', (req, res) => runFunction(path.join(fnDir, 'supabase-health.js'), req, res));
const PORT = process.env.PORT || 3000;
app.use(express.urlencoded({ extended: true }));

function toNetlifyEvent(req) {
  return {
    httpMethod: req.method,
    headers: req.headers,
    body: req.body && Object.keys(req.body).length ? JSON.stringify(req.body) : null,
    queryStringParameters: req.query,
    path: req.path,
    rawUrl: `${req.protocol}://${req.get('host')}${req.originalUrl}`
  };
}

async function runFunction(modulePath, req, res) {
  try {
    const fn = require(modulePath);
    const result = await fn.handler(toNetlifyEvent(req), {});
    res.status(result.statusCode || 200);
    if (result.headers) Object.entries(result.headers).forEach(([k, v]) => res.setHeader(k, v));
    if (result.body) return res.send(result.body);
    return res.end();
  } catch (error) {
    console.error(error);
    const status = Number(error?.statusCode) || 500;
    const message = error?.message || 'Server error.';
    return res.status(status).json({ message, code: error?.code || undefined });
  }
}

const fnDir = path.join(__dirname, 'netlify', 'functions');
app.post('/auth/login', (req, res) => runFunction(path.join(fnDir, 'login.js'), req, res));
app.post('/auth/register', (req, res) => runFunction(path.join(fnDir, 'register.js'), req, res));
app.post('/auth/google', (req, res) => runFunction(path.join(fnDir, 'google-auth.js'), req, res));
app.post('/auth/logout', (req, res) => runFunction(path.join(fnDir, 'logout.js'), req, res));
app.get('/api/me', (req, res) => runFunction(path.join(fnDir, 'me.js'), req, res));
app.get('/api/users', (req, res) => runFunction(path.join(fnDir, 'users.js'), req, res));
app.post('/api/users', (req, res) => runFunction(path.join(fnDir, 'users.js'), req, res));
app.patch('/api/users', (req, res) => runFunction(path.join(fnDir, 'users.js'), req, res));
app.get('/api/dashboard', (req, res) => runFunction(path.join(fnDir, 'data.js'), req, res));
app.get('/api/assets', (req, res) => runFunction(path.join(fnDir, 'data.js'), req, res));
app.post('/api/assets', (req, res) => runFunction(path.join(fnDir, 'data.js'), req, res));
app.patch('/api/assets', (req, res) => runFunction(path.join(fnDir, 'data.js'), req, res));
app.delete('/api/assets', (req, res) => runFunction(path.join(fnDir, 'data.js'), req, res));
app.get('/api/inventory', (req, res) => runFunction(path.join(fnDir, 'data.js'), req, res));
app.post('/api/inventory', (req, res) => runFunction(path.join(fnDir, 'data.js'), req, res));
app.patch('/api/inventory', (req, res) => runFunction(path.join(fnDir, 'data.js'), req, res));
app.delete('/api/inventory', (req, res) => runFunction(path.join(fnDir, 'data.js'), req, res));
app.get('/api/inspections', (req, res) => runFunction(path.join(fnDir, 'data.js'), req, res));
app.post('/api/inspections', (req, res) => runFunction(path.join(fnDir, 'data.js'), req, res));
app.post('/api/inspections/create', (req, res) => runFunction(path.join(fnDir, 'inspection-create.js'), req, res));
app.post('/api/yolo/predict', (req, res) => runFunction(path.join(fnDir, 'yolo-predict.js'), req, res));
app.patch('/api/inspections', (req, res) => runFunction(path.join(fnDir, 'data.js'), req, res));
app.get('/api/risk', (req, res) => runFunction(path.join(fnDir, 'data.js'), req, res));
app.get('/api/ml-status', (req, res) => runFunction(path.join(fnDir, 'data.js'), req, res));
app.get('/api/analytics', (req, res) => runFunction(path.join(fnDir, 'data.js'), req, res));
app.get('/api/notifications', (req, res) => runFunction(path.join(fnDir, 'data.js'), req, res));
app.get('/api/audit-logs', (req, res) => runFunction(path.join(fnDir, 'data.js'), req, res));
app.patch('/api/notifications', (req, res) => runFunction(path.join(fnDir, 'data.js'), req, res));
app.get('/api/portals', (req, res) => runFunction(path.join(fnDir, 'data.js'), req, res));
app.patch('/api/portals', (req, res) => runFunction(path.join(fnDir, 'data.js'), req, res));

app.use(express.static(path.join(__dirname)));
app.get('/', (req, res) => res.redirect('/login.html'));

app.listen(PORT, () => {
  console.log(`RAILKAVACH running at http://localhost:${PORT}`);
  console.log('Using Supabase-backed authentication. Set environment variables before logging in.');
});
