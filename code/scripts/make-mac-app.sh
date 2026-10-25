#!/bin/bash
# Builds "code by aqeel.app" in ~/Applications: a Dock/Launchpad app that starts the local server if needed
# and opens the app window. Run once on the Mac:  bash scripts/make-mac-app.sh
set -e
HERE="$(cd "$(dirname "$0")/.." && pwd)"
APP="$HOME/Applications/code by aqeel.app"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
 <key>CFBundleName</key><string>code by aqeel</string>
 <key>CFBundleDisplayName</key><string>code by aqeel</string>
 <key>CFBundleIdentifier</key><string>local.codebyaqeel.launcher</string>
 <key>CFBundleVersion</key><string>1.0</string>
 <key>CFBundlePackageType</key><string>APPL</string>
 <key>CFBundleExecutable</key><string>code-by-aqeel</string>
 <key>CFBundleIconFile</key><string>AppIcon</string>
 <key>LSUIElement</key><true/>
</dict></plist>
PLIST

# the launcher reuses the double-click script that lives next to the app's code
cat > "$APP/Contents/MacOS/code-by-aqeel" <<LAUNCH
#!/bin/bash
exec "$HERE/Start code by aqeel.command"
LAUNCH
chmod +x "$APP/Contents/MacOS/code-by-aqeel" "$HERE/Start code by aqeel.command"

# icon from the 512px PNG
ICONSET="$(mktemp -d)/AppIcon.iconset"; mkdir -p "$ICONSET"
for s in 16 32 128 256 512; do
 sips -z $s $s "$HERE/assets/icon-512.png" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
 d=$((s*2)); [ $d -le 512 ] && sips -z $d $d "$HERE/assets/icon-512.png" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"
touch "$APP"
echo "Created $APP. Open it from Launchpad or drag it to the Dock."
