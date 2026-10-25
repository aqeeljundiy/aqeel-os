#!/bin/bash
# aqeelOS Code for Mac: copies the app to ~/Applications, makes it start (in the background) when you log in, starts
# it now and opens Code in aqeelOS. Double-click it (first time: right-click › Open). Run again to update or repair.
set -e
SRC="$(cd "$(dirname "$0")" && pwd)"; DEST="$HOME/Applications/aqeelOS Code"
echo "Installing aqeelOS Code..."
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
major(){ node -v 2>/dev/null | sed 's/^v//' | cut -d. -f1; }
if [ "$(major || echo 0)" -lt 22 ] 2>/dev/null || ! command -v node >/dev/null; then
 if command -v brew >/dev/null; then echo "Installing Node.js..."; brew install node; fi
 if ! command -v node >/dev/null || [ "$(major)" -lt 22 ]; then echo "Please install Node.js 22 or newer from https://nodejs.org, then run this again."; open https://nodejs.org; exit 1; fi
fi
PLIST="$HOME/Library/LaunchAgents/com.aqeelos.code.plist"
launchctl unload "$PLIST" 2>/dev/null || true
mkdir -p "$DEST"
rsync -a --exclude 'Install aqeelOS Code.command' "$SRC/" "$DEST/"
cd "$DEST" && echo "Getting its parts (a minute the first time)..." && npm install --no-audit --no-fund --loglevel=error >/dev/null
NODE="$(command -v node)"
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
 <key>Label</key><string>com.aqeelos.code</string>
 <key>ProgramArguments</key><array><string>$NODE</string><string>$DEST/server.mjs</string></array>
 <key>WorkingDirectory</key><string>$DEST</string>
 <key>EnvironmentVariables</key><dict><key>HUB_PORT</key><string>4321</string><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$HOME/.local/bin</string></dict>
 <key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
 <key>StandardOutPath</key><string>/tmp/aqeelos-code.log</string><key>StandardErrorPath</key><string>/tmp/aqeelos-code.log</string>
</dict></plist>
PL
launchctl load "$PLIST"
for t in claude codex; do command -v $t >/dev/null || echo "Optional: install $t to code with it."; done
BASE="$(node -e "console.log(require('$DEST/aqeelos.json').aqeelos.base)")"
sleep 3; open "$BASE/#/code/code"
echo "Done. aqeelOS Code runs in the background and opens inside aqeelOS."
