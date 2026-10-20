#!/bin/bash
# Double-click in Finder to start code by aqeel and open it in its own app window.
# First time only: run  chmod +x "Start code by aqeel.command"  in Terminal.
cd "$(dirname "$0")" || exit 1
export HUB_PORT=4321
URL="http://127.0.0.1:$HUB_PORT/"

if ! curl -fsS --max-time 2 "${URL}manifest.webmanifest" >/dev/null 2>&1; then
  if ! command -v node >/dev/null 2>&1; then
    # Finder starts a login shell without Homebrew paths on some Macs
    for p in /opt/homebrew/bin /usr/local/bin; do [ -x "$p/node" ] && export PATH="$p:$PATH"; done
  fi
  command -v node >/dev/null 2>&1 || { echo "Node.js is not installed. Get it from https://nodejs.org and try again."; read -r; exit 1; }
  mkdir -p data
  nohup node server.mjs > data/server.log 2>&1 &
  for _ in $(seq 1 40); do curl -fsS --max-time 1 "${URL}manifest.webmanifest" >/dev/null 2>&1 && break; sleep 0.25; done
  curl -fsS --max-time 1 "${URL}manifest.webmanifest" >/dev/null 2>&1 || { echo "The server did not start. See data/server.log"; read -r; exit 1; }
fi

# Open as an app window: Chrome, then Edge, then the default browser.
if [ -d "/Applications/Google Chrome.app" ]; then open -na "Google Chrome" --args --app="$URL"
elif [ -d "/Applications/Microsoft Edge.app" ]; then open -na "Microsoft Edge" --args --app="$URL"
else open "$URL"; fi
osascript -e 'tell application "Terminal" to close (every window whose name contains "Start code by aqeel")' >/dev/null 2>&1 &
exit 0
