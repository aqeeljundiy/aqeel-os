#!/bin/bash
# Removes aqeelOS Code from this Mac: stops it, removes it from log-in and deletes its folder.
# Your projects (its data folder) are kept in ~/Documents/aqeelOS Code data, unless you run it with --delete-data.
DEST="$HOME/Applications/aqeelOS Code"; PLIST="$HOME/Library/LaunchAgents/com.aqeelos.code.plist"
launchctl unload "$PLIST" 2>/dev/null; rm -f "$PLIST"
[ "$1" != "--delete-data" ] && [ -d "$DEST/data" ] && mv "$DEST/data" "$HOME/Documents/aqeelOS Code data" && echo "Your data is kept in ~/Documents/aqeelOS Code data"
rm -rf "$DEST"; echo "aqeelOS Code is removed. You can unpair this computer in aqeelOS (Code)."
