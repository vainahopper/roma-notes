#!/bin/bash
# Place the current dist/ build as TestWebBundle in the booted simulator.
# This simulates an iCloud live-update bundle for testing the update mechanism
# without a real iCloud connection.
#
# Usage (after `npm run build`):
#   bash scripts/test-ios-update.sh
#
# Then relaunch the app in the simulator — at 5s it will detect and apply the update.

set -e

BUNDLE_ID="com.codevainas.romanotes"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DIST_DIR="$SCRIPT_DIR/../dist"
VERSION=$(node -p "require('${SCRIPT_DIR}/../package.json').version")

# Find a booted simulator
SIMULATOR_UDID=$(xcrun simctl list devices booted --json 2>/dev/null | python3 -c "
import json, sys
data = json.load(sys.stdin)
for runtime, devs in data.get('devices', {}).items():
    for dev in devs:
        if dev.get('state') == 'Booted':
            print(dev['udid'])
            exit()
" 2>/dev/null)

if [ -z "$SIMULATOR_UDID" ]; then
    echo "❌ No booted simulator found. Boot one first:"
    echo "   xcrun simctl boot <UDID>"
    exit 1
fi

echo "Simulator: $SIMULATOR_UDID"

# Get the app's data container
APP_CONTAINER=$(xcrun simctl get_app_container "$SIMULATOR_UDID" "$BUNDLE_ID" data 2>/dev/null)

if [ -z "$APP_CONTAINER" ]; then
    echo "❌ App '$BUNDLE_ID' not installed on simulator."
    echo "   Build and run the app first from Xcode (Debug scheme, simulator target)."
    exit 1
fi

echo "App container: $APP_CONTAINER"

# Place dist/ as TestWebBundle
TEST_BUNDLE_DIR="$APP_CONTAINER/Library/Application Support/TestWebBundle"

rm -rf "$TEST_BUNDLE_DIR"
mkdir -p "$TEST_BUNDLE_DIR"
cp -R "$DIST_DIR/"* "$TEST_BUNDLE_DIR/"

# Write version manifest
cat > "$TEST_BUNDLE_DIR/version.json" << EOF
{
  "version": "$VERSION",
  "deployedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "testBundle": true
}
EOF

echo ""
echo "✔ Placed TestWebBundle v$VERSION at:"
echo "  $TEST_BUNDLE_DIR"
echo ""
echo "Contents:"
ls "$TEST_BUNDLE_DIR"
echo ""
echo "Next steps:"
echo "  1. Close (terminate) the app in the simulator if running"
echo "  2. Relaunch from Xcode or tap the app icon"
echo "  3. Wait ~5s — the app should detect and apply the update automatically"
echo ""
echo "Watch logs:"
echo "  xcrun simctl spawn $SIMULATOR_UDID log stream --predicate 'subsystem == \"com.apple.logging\" || process == \"RomaNotes\"' 2>/dev/null | grep -E 'RomaSync|Roma\]'"
