#!/usr/bin/env bash
set -e
echo "Installing PrivateGate..."
npm install --omit=dev
nohup node src/server.js > server.log 2>&1 &
echo "PrivateGate live at http://127.0.0.1:3470"
