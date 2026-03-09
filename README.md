# Roma Notes

A Roam Research-inspired note-taking app for macOS (Apple Silicon).

## Install

Double-click `release/Roma Notes-1.0.0-arm64.dmg` and drag to Applications.

If macOS blocks it (unsigned app), go to **System Settings → Privacy & Security** and click "Open Anyway".

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `⌘K` | Search pages and blocks |
| `⌘D` | Go to today's daily note |
| `⌘N` | New page |
| `Enter` | New block |
| `Tab` | Indent block |
| `Shift+Tab` | Outdent block |
| `⌘+Click` on [[link]] | Open in right sidebar |
| `Ctrl+E` | Encrypt current block |
| `Esc` | Close any modal |

## Syntax (Roam-compatible)

| Syntax | Result |
|--------|--------|
| `[[Page Name]]` | Wikilink to page |
| `#Tag` | Hashtag |
| `#[[Multi Word Tag]]` | Multi-word hashtag |
| `{{[[TODO]]}}` | Open todo |
| `{{[[DONE]]}}` | Completed todo |
| `**bold**` | Bold text |
| `__italic__` | Italic text |
| `^^highlight^^` | Highlighted text |
| `` `code` `` | Inline code |
| `[text](url)` | External link |
| `Key:: Value` | Attribute |
| `{{encrypt:...}}` | Encrypted block |

## Import from Roam

1. In Roam Research: Export → Markdown → Download ZIP
2. In Roma Notes: Click "Import from Roam" in the bottom of the sidebar
3. Select the ZIP file

## Data Location

All notes are stored at:
`~/Library/Application Support/RomaNotes/pages/`

Each page is a JSON file — easy to back up.

## Development

```bash
npm install
npm run dev      # hot-reload dev mode
npm run dist     # build DMG
```
