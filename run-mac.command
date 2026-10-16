#!/bin/bash
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "ERROR: Node.js and npm are required. Install the Node.js LTS release from https://nodejs.org/en/download/ and reopen Terminal."
  read -r -p "Press Enter to close..."
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "ERROR: RAILKAVACH requires Node.js 18 or later. Installed: $(node -v)"
  read -r -p "Press Enter to close..."
  exit 1
fi

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example. Add your own credentials to .env for login/database features."
fi

if [ ! -d node_modules ] || [ ! -f node_modules/dotenv/package.json ]; then
  echo "Installing project dependencies..."
  npm install
fi

echo "Checking server syntax..."
npm run check

echo "Starting RAILKAVACH. Keep this window open."
echo "Open http://localhost:3000 in your browser."
npm run dev
