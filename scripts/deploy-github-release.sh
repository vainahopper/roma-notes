#!/bin/bash
# Deploy Roma Notes DMG to GitHub Releases for remote auto-update.
# Usage: npm run deploy:github
#
# Prerequisites (one-time):
#   Install gh CLI + gh auth login

set -e

# Find gh CLI (~/bin or PATH)
GH=$(command -v gh 2>/dev/null || echo "$HOME/bin/gh")
if [ ! -x "$GH" ]; then
  echo "ERROR: gh CLI not found. Install it and run 'gh auth login'."
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$SCRIPT_DIR/.."
RELEASE_DIR="$PROJECT_DIR/release"
VERSION=$(node -p "require('${PROJECT_DIR}/package.json').version")
DMG_SOURCE="$RELEASE_DIR/Roma Notes.dmg"
DMG_UPLOAD="$RELEASE_DIR/Roma-Notes.dmg"

REPO="vainahopper/roma-notes"
TAG="latest"

echo "═══ Deploying Roma Notes v${VERSION} to GitHub Releases ═══"

# Verify DMG exists
if [ ! -f "$DMG_SOURCE" ]; then
  echo "ERROR: DMG not found at: $DMG_SOURCE"
  echo "Run 'npm run dist' first."
  exit 1
fi

# Copy DMG with URL-safe name (no spaces)
cp "$DMG_SOURCE" "$DMG_UPLOAD"

# Generate remote latest.json with dmgUrl (not dmgPath)
DMG_URL="https://github.com/${REPO}/releases/download/${TAG}/Roma-Notes.dmg"
cat > "$RELEASE_DIR/latest.json" << EOF
{
  "version": "$VERSION",
  "notes": "Roma Notes ${VERSION}",
  "dmgUrl": "${DMG_URL}"
}
EOF

echo "latest.json:"
cat "$RELEASE_DIR/latest.json"
echo ""

# Delete existing 'latest' release + tag (force-update)
"$GH" release delete "$TAG" --repo "$REPO" --yes 2>/dev/null || true
"$GH" api -X DELETE "repos/${REPO}/git/refs/tags/${TAG}" 2>/dev/null || true

# Create new release with assets
"$GH" release create "$TAG" \
  --repo "$REPO" \
  --title "Roma Notes v${VERSION}" \
  --notes "Roma Notes v${VERSION}" \
  --latest \
  "$DMG_UPLOAD#Roma-Notes.dmg" \
  "$RELEASE_DIR/latest.json#latest.json"

# Clean up URL-safe copy
rm -f "$DMG_UPLOAD"

echo ""
echo "✓ Roma Notes v${VERSION} published to GitHub Releases"
echo "  https://github.com/${REPO}/releases/tag/${TAG}"
