const test = require('node:test');
const assert = require('node:assert/strict');

const { summarizeMlSubprocessFailure } = require('./data');

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
