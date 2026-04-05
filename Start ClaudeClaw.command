#!/bin/bash
# ClaudeClaw launcher — double-click to start the bot (or drag to Dock).
# Keeps Terminal open so you can see logs. Press Ctrl+C to stop.

cd "$(dirname "$0")"

if [[ ! -d node_modules ]]; then
  echo "Installing dependencies..."
  npm install
fi

if [[ ! -f dist/index.js ]]; then
  echo "Building..."
  npm run build
fi

echo "Starting ClaudeClaw..."
npm start

echo ""
read -p "Press Enter to close this window."
