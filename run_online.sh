#!/bin/bash
# MTG Card Kingdom Tracker - Online Public Runner
cd "$(dirname "$0")"

# 1. Start Python Flask server if not already running on port 5055
if ! lsof -i :5055 > /dev/null 2>&1; then
    echo "Starting local MTG Tracker server on port 5055..."
    python3 app.py > /dev/null 2>&1 &
    sleep 2
fi

echo "========================================================"
echo "🚀 MTG Tracker is running locally: http://localhost:5055"
echo "🌐 Starting Cloudflare Public Tunnel (HTTPS)..."
echo "========================================================"

# 2. Start Cloudflare Tunnel
/opt/homebrew/bin/cloudflared tunnel --url http://localhost:5055
