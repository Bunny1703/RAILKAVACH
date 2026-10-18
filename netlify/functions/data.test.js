const test = require('node:test');
const assert = require('node:assert/strict');

const { summarizeMlSubprocessFailure, predictWithMl } = require('./data');

test('summarizes ML subprocess failures with exit code and captured output', () => {
  const result = summarizeMlSubprocessFailure(
    {
      code: 1,
      message: 'Command failed',
      stdout: Buffer.from('partial stdout\n'),
      stderr: Buffer.from('Traceback (most recent call last):\nValueError\n')
    },
    '/usr/bin/python',
    '/tmp/risk_model.pkl'
  );

  assert.equal(result.python_bin, '/usr/bin/python');
  assert.equal(result.model_path, '/tmp/risk_model.pkl');
  assert.equal(result.exit_code, 1);
  assert.equal(result.error_message, 'Command failed');
  assert.match(result.stdout, /partial stdout/);
  assert.match(result.stderr, /Traceback/);
});

test('captures timeout kills from the Python ML subprocess', () => {
  const result = summarizeMlSubprocessFailure(
    {
      code: null,
      signal: 'SIGTERM',
      killed: true,
      message: 'Command failed: python timed out',
      stdout: '',
      stderr: ''
    },
    '/opt/render/project/src/.venv/bin/python',
    '/opt/render/project/src/ml/model/risk_model.pkl'
  );

  assert.equal(result.signal, 'SIGTERM');
  assert.equal(result.killed, true);
  assert.equal(result.exit_code, null);
  assert.match(result.error_message, /timed out/);
});

test('uses the real Python ML predictor on Render when the venv is available', async () => {
  process.env.RENDER = 'true';
  const result = await predictWithMl({
    asset_age_years: 2,
    wear_level: 1,
    corrosion_level: 0,
    crack_level: 0,
    deformation_level: 0,
    vibration_level: 1,
    temperature_c: 30,
    maintenance_count: 0,
    previous_failures: 0,
    days_since_last_inspection: 5
  });

  assert.equal(result.ml_available, true);
  assert.equal(result.method, 'tree-ensemble-ml-with-safety-guardrail');
  assert.match(result.risk_level, /LOW|MEDIUM|HIGH|CRITICAL/);
  assert.equal(typeof result.score, 'number');
  delete process.env.RENDER;
});

test('runs the real Python ML predictor successfully with the bundled model', async () => {
  delete process.env.RENDER;
  const result = await predictWithMl({
    asset_age_years: 2,
    wear_level: 1,
    corrosion_level: 0,
    crack_level: 0,
    deformation_level: 0,
    vibration_level: 1,
    temperature_c: 30,
    maintenance_count: 0,
    previous_failures: 0,
    days_since_last_inspection: 5
  });

  assert.equal(result.ml_available, true);
  assert.equal(result.method, 'tree-ensemble-ml-with-safety-guardrail');
  assert.match(result.risk_level, /LOW|MEDIUM|HIGH|CRITICAL/);
  assert.equal(typeof result.score, 'number');
  assert.ok(result.python_bin);
});

test('reports a missing model file with a non-zero exit and stderr details', () => {
  const { spawnSync } = require('node:child_process');
  const { getPythonBin } = require('./_python');
  const python = getPythonBin();
  const result = spawnSync(python, [
    require('path').join(__dirname, '..', '..', 'ml', 'predict.py'),
    '--model', require('path').join(__dirname, '..', '..', 'ml', 'model', 'missing-risk-model.pkl'),
    '--json', JSON.stringify({ asset_age_years: 1, wear_level: 1 })
  ], { encoding: 'utf8' });

  assert.notEqual(result.status, 0);
  assert.match(String(result.stderr || ''), /Model file does not exist/);
  assert.match(String(result.stderr || ''), /resolved:/i);
});
