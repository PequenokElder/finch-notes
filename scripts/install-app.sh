#!/bin/sh
# Rebuild Finch and replace the copy in /Applications.
set -e
cd "$(dirname "$0")/.."
npm run package
osascript -e 'tell application "Finch" to quit' >/dev/null 2>&1 || true
sleep 1
rm -rf /Applications/Finch.app
cp -R release/Finch-darwin-*/Finch.app /Applications/
echo "Finch updated in /Applications."
