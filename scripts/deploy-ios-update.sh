#!/bin/bash
# Deploy web assets to iCloud for live iPhone updates.
# Usage: npm run deploy:ios (after npm run build)
#
# This syncs the built dist/ folder to the iCloud container so the
# iPhone app can detect and apply the update automatically.
#
# Key design decisions:
#   - rsync --delete removes files from previous builds (different content hashes).
#     Old accumulated files caused applyWebUpdate to time out on the device.
#   - version.json is written LAST (excluded from rsync, added manually).
#     The iPhone treats version.json as the "bundle is ready" signal.
#     Writing it last ensures all other files are in iCloud before detection triggers.
#   - A "files" manifest is embedded in version.json so the native plugin only
#     downloads and checks the files that actually exist in this build, ignoring
#     any leftover stale placeholders that may still exist on the device.

set -e

ICLOUD_CONTAINER="$HOME/Library/Mobile Documents/iCloud~com~codevainas~romanotes/Documents/web-bundle"
DIST_DIR="$(dirname "$0")/../dist"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VERSION=$(node -p "require('${SCRIPT_DIR}/../package.json').version")

echo "Deploying Roma Notes v${VERSION} to iCloud for iPhone..."

# Ensure iCloud container exists
mkdir -p "$ICLOUD_CONTAINER"

# Sync dist/ → iCloud, removing any files that are no longer in the build.
# Exclude version.json so it is written separately as the last step.
rsync -a --delete --exclude='version.json' "$DIST_DIR/" "$ICLOUD_CONTAINER/"

# Build a JSON array of all files in the bundle (relative paths, sorted).
# This lets applyWebUpdate download only the files it actually needs.
FILES_JSON=$(cd "$DIST_DIR" && find . -type f -not -name 'version.json' | sed 's|^\./||' | sort | python3 -c "
import json, sys
files = [line.strip() for line in sys.stdin if line.strip()]
print(json.dumps(files))
")

# Write version manifest LAST — the iPhone uses its presence to trigger the update.
cat > "$ICLOUD_CONTAINER/version.json" << EOF
{
  "version": "$VERSION",
  "deployedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "files": $FILES_JSON
}
EOF

echo "✔ Deployed v${VERSION} to iCloud"
echo "  → $ICLOUD_CONTAINER"
echo "  iCloud will sync to iPhone automatically."
