#!/usr/bin/env bash
# ── NoteWell ─────────────────────────────────────────────────────────────
# Double-click this file (macOS) or run ./START-mac-linux.command (Linux).
# It serves NoteWell on this machine and opens it. Nothing is uploaded.
cd "$(dirname "$0")"
PORT="${PORT:-8787}"

open_url () {
  sleep 1
  if command -v open >/dev/null 2>&1; then open "http://localhost:$PORT"
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "http://localhost:$PORT"
  fi
}

echo ""
echo "  Starting NoteWell…"
echo ""

if command -v node >/dev/null 2>&1; then
  open_url &
  exec node server/server.js
elif command -v python3 >/dev/null 2>&1; then
  echo "  (Node isn't installed — using Python. Accounts/sync need Node,"
  echo "   everything else works.)"
  echo ""
  echo "  On this computer   http://localhost:$PORT"
  for ip in $(ipconfig getifaddr en0 2>/dev/null; hostname -I 2>/dev/null); do
    echo "  On your iPad       http://$ip:$PORT"
  done
  echo ""
  open_url &
  exec python3 -m http.server "$PORT" --bind 0.0.0.0
else
  echo "  Please install Node (nodejs.org) or Python 3, then run this again."
  read -r -p "  Press return to close."
fi
