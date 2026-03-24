# Roma Notes — CLAUDE.md

## What it is
Roam Research-inspired note-taking app for macOS + iPhone. Single codebase.
- **Mac**: Electron 40 + React 19 + Vite 7 + TypeScript. Apple Silicon only, no App Store — direct DMG.
- **iPhone**: Capacitor 8 wrapping the same React app in a native iOS WKWebView.

## Architecture
```
src/main/index.js         — Electron main: IPC, file I/O, menus, iCloud sync
src/main/preload.js       — Context bridge → window.api
src/main/touchid.swift    — Native Touch ID helper (compiled via swiftc)
src/renderer/             — Shared React app (Mac + iPhone)
  App.tsx                 — Root, routing + navigation history (back/forward)
  platform/               — Platform abstraction layer
    adapter.ts            — Interface (never call window.api directly)
    electron.ts           — Mac: wraps window.api
    capacitor.ts          — iPhone: IndexedDB + Face ID + iCloud plugin
    index.ts              — Auto-detects platform, exports `platform`
  components/             — One file + CSS per component
  stores/useStore.ts      — Global state (uses platform adapter)
  utils/                  — encryption.ts, roamImporter.ts, search.ts, helpers.ts
  styles/                 — app.css, globals.css, mobile.css (responsive)
  types/                  — electron.d.ts
src/shared/types.ts       — Shared TS types (Block, Page, ZoomFrame, …)
ios/                      — Xcode project (Capacitor auto-generated)
  App/App/
    AppDelegate.swift     — Loads cached web bundle if live update exists
    RomaCloudSyncPlugin.swift — Native plugin: iCloud sync + live web updates
    App.entitlements      — iCloud Documents capability
    Info.plist            — NSFaceIDUsageDescription added
scripts/
  deploy-ios-update.sh    — Copies dist/ to iCloud for live iPhone update
```

## CRITICAL: Always use the platform adapter
Never call `window.api.*` directly in renderer code. Always use `platform.*`:
```typescript
import { platform } from './platform'
platform.savePage(page)  // ✓
window.api.savePage(page) // ✗
```

## Data
- **Mac**: `~/Library/Application Support/RomaNotes/pages/*.json`
- **iPhone**: IndexedDB (local) + `~/Library/Mobile Documents/iCloud~com~codevainas~romanotes/Documents/pages/*.json`
- Each page = one JSON file

## Build Commands
```bash
npm run dev         # hot-reload dev (Mac only)
npm run build       # build renderer + electron
npm run dist        # build Mac DMG

npm run build:ios   # build + sync to Xcode (for first install or native changes)
npm run open:ios    # open Xcode
npm run deploy:ios  # build + push web assets to iCloud (live update iPhone)
npm run deploy:all  # update both Mac (DMG) and iPhone (iCloud)
```

## Deploying updates to the installed Mac app

⚠️ **ALWAYS bump the version before building.** The update detector compares
versions with `compareVersions(latest, current) > 0` — if they're equal, the
app sees no update and does nothing.

### Correct deploy sequence (every time, no exceptions):
```bash
# 1. Bump version first (auto-increments patch: e.g. 1.7.13 → 1.7.14)
npm version patch --no-git-tag-version

# 2. Then build + publish (both Mac + iPhone)
npm run deploy:all
```

`npm run dist` builds the DMG **and** writes
`~/Library/Application Support/RomaNotes/latest.json` pointing to it.
The running app checks that file on launch and every 10 min. When a new
version is detected it shows an update badge; the user can also trigger it
manually via **Roma Notes > Check for Updates…**.

`npm run deploy:ios` copies `dist/` to the iCloud container. The iPhone app
detects the new version 5 seconds after launch and applies it (reloads).

## Current version: 1.7.114

## iPhone setup (one-time)
1. In Xcode: select your Apple Developer Team (Signing & Capabilities)
2. Enable iCloud capability: check "CloudKit Documents", container `iCloud.com.codevainas.romanotes`
3. Connect iPhone via USB → Run in Xcode (first install only)
4. After first install, use `npm run deploy:ios` for all future updates

## Key features implemented (Mac + iPhone unless noted)
- Block-based editor (nested, indent/outdent)
- Wikilinks `[[page]]`, backlinks panel
- Daily notes (⌘D on Mac, sidebar button on iPhone)
- Search modal (⌘K on Mac, sidebar button on iPhone)
- Sidebar with page list + starred section (drawer on iPhone, fixed on Mac)
- Import from Roam ZIP export (Mac only)
- Block encryption (Ctrl+E, CryptoJS AES) + Touch ID (Mac) / Face ID (iPhone)
- Slash commands menu
- Block reference autocomplete
- Calendar modal, date picker inline
- Dark/light/system theme
- TODO page: aggregates all todo blocks across all pages
- Backlinks panel, unlinked references with "Link All"
- Navigation history: back/forward
- Block zoom (drill-down) with breadcrumb trail
- Sidebar panel: second page side-by-side (Mac only)
- Day-change detection: auto-navigate to today's daily note
- iCloud sync between Mac and iPhone (Pages JSON files)
- Live web asset updates for iPhone via iCloud (no cable after first install)

## iCloud Sync
- Mac mirrors every page save/delete to `~/Library/Mobile Documents/iCloud~com~codevainas~romanotes/Documents/pages/`
- iPhone reads/writes the same iCloud container via `RomaCloudSyncPlugin`
- Both sides pull on startup, every 60s, and on app focus/resume
- Conflict resolution: latest `updatedAt` timestamp wins

## Roam-compatible syntax
`[[wikilinks]]`, `#tags`, `#[[multi word]]`, `{{[[TODO]]}}` / `{{[[DONE]]}}`, `**bold**`, `__italic__`, `^^highlight^^`, `` `code` ``, `Key:: value`, `{{encrypt:BASE64}}`

## Design constraints
- macOS-native feel (Mac) / native iOS feel (iPhone), English UI
- No external DB — plain JSON files + iCloud sync
- Mac: unsigned (user opens via System Settings > Privacy)
- iPhone: Ad Hoc distribution via Apple Developer account
