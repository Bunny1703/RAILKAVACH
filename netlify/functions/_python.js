const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..', '..');
const VENV_PYTHON = process.platform === 'win32'
  ? path.join(PROJECT_ROOT, '.venv', 'Scripts', 'python.exe')
  : path.join(PROJECT_ROOT, '.venv', 'bin', 'python');

function getPythonBin() {
  if (fs.existsSync(VENV_PYTHON)) return VENV_PYTHON;
  return process.env.PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3');
}

module.exports = { getPythonBin };
