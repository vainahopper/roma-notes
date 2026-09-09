# Reference Panel — Full Roam-style Editing

**Date:** 2026-09-09
**Status:** Approved (design)

## Problem

In the linked/unlinked references panel (and the daily-notes backlinks), each
referenced block is edited through a bespoke `<textarea>` reimplemented by hand
in `LinkedReferences.tsx`. It only supports: click-to-edit text, Enter to save,
Esc to cancel, Cmd+Enter to toggle TODO. It does **not** support creating new
bullets, indent/outdent, Backspace-merge, slash commands, `[[ ]]` / `(( ))`
autocomplete, live markdown, or undo. Parent blocks shown in the breadcrumb are
not editable at all. The interaction feels inconsistent with the real page
editor.

All of that behaviour already exists in `BlockEditor` / `BlockItem`. The
reference panel simply does not use it.

## Goal

Editing a reference should behave exactly like editing on the real page:
create bullets, indent, slash menu, autocomplete, markdown, undo/redo — because
it will be the same `BlockEditor` component, scoped to the referenced block's
subtree.

Matches Roam: breadcrumb parent blocks stay navigation-only.

## Approach

Lazy-mount the real `BlockEditor`, scoped per reference match.

- Preview stays as the rendered `BlockContent` (fast).
- On click into a reference's content, that match swaps to a real
  `<BlockEditor>` scoped to `[match.block]` (the block + its children), focused.
- On blur (focus leaves the editor), it flushes its save and unmounts back to
  the preview.
- Only one `BlockEditor` is mounted at a time across the whole panel — this
  keeps the TODO/DONE aggregation pages performant and avoids stacking the
  ~6 document-level listeners each `BlockEditor` registers (drag, multi-select,
  copy, undo IPC).

Rejected alternatives:
- **Always-mounted `BlockEditor` per match** — hundreds of instances on the
  TODO page, each with global `document` listeners. Not viable.
- **Extract a `useBlockTree` hook** — cleanest long-term, but a large risky
  refactor of a 1400-line file with entangled undo/batching/DnD. Out of scope.

## Components

### 1. `BlockEditor` — new prop `initialFocusBlockId?: string`

Only change to the large file. On first render, seed
`focusIdRef.current = initialFocusBlockId` so that block enters edit mode with
the cursor at the end (reuses the existing `requestFocusId` / `onConsumeFocus`
path in `BlockItem`). No other behaviour changes.

### 2. `ReferenceBlockEditor` (new, ~80 lines)

Props: `targetPage: Page`, `matchBlockId: string`, `allPages`, `onNavigate`,
`onOpenSidebar`, `onNavigateToBlock`, `onSaved?()`.

- Local state `subtree`, seeded from the matched block's node in
  `targetPage.blocks` (found by id): `subtree = [matchNode]`.
- Renders `<BlockEditor blocks={subtree} initialFocusBlockId={matchBlockId}
  onChange={handleChange} onBlur={handleBlur} .../>`.
- `handleChange(next)` → `setSubtree(next)` + debounced (500 ms) splice-save.
- **Splice-back** (`spliceSubtreeIntoPage`, pure, tested):
  - `next[0]` — the edited matched block. `BlockEditor`'s existing guards mean
    it can never be deleted (`handleBackspace` no-ops when it is the only block)
    or outdented past root (`handleTab` shift no-ops when `parent === blocks`),
    so `next[0].id === matchBlockId` holds in practice.
  - Replace the node with id `matchBlockId` in `targetPage.blocks` with
    `next[0]`.
  - Insert `next[1..]` (new bullets created via Enter / Shift+Tab at root of the
    scoped editor) as the immediately-following siblings of that node.
  - Fallback: if `next[0].id !== matchBlockId` (should not happen), replace the
    matched node's position with the entire `next` array.
- **Anti-flicker freeze:** ignore incoming `targetPage` prop changes while a
  save timer is pending (same pattern as `DayEntry` in `DailyNotesView.tsx`).
- `handleBlur`: clear + run the pending save immediately, then call `onSaved()`.
  Parent unmounts the editor → preview re-renders from fresh store data.

### 3. `LinkedReferences` — `BacklinkBlock` lazy-mounts

- Default: current rendered preview (`BlockContent`).
- On click on the content area: render `<ReferenceBlockEditor>` with
  `matchBlockId` = this block, instead of the hand-rolled `<textarea>`.
- `onSaved` / blur: unmount, back to preview.
- Delete the bespoke mini-editor: `editing`, `editValue`, `handleKeyDown`,
  `handleBlur`, `handleContentClick`, `autoResize`, the focus effects, the
  `<textarea>` branch.
- Keep: the TODO checkbox, the child-expand toggle, the bullet-click navigation,
  the breadcrumb parents (navigation-only), `handleSliderChange`.

### Wiring

`PageView` and `DailyNotesView` currently pass `onEditBlock(pageId, blockId,
content)` to `LinkedReferences`. Replace with
`onSaveRefSubtree(pageId, matchBlockId, editedSubtree)` — a new handler in both
containers that runs `spliceSubtreeIntoPage` and calls `savePage`. Keep
`onToggleBlock` / `onToggleTodoMarker` unchanged. `allPages` is already passed.

Panels affected: Linked References, Unlinked References, daily-notes backlinks,
and the TODO / DONE aggregation lists (all render through the same
`LinkedReferences` → `BacklinkBlock`).

## Data flow

```
click on a reference
  → BacklinkBlock mounts ReferenceBlockEditor (subtree = [matchNode])
  → BlockEditor(blocks=subtree, initialFocusBlockId=matchBlockId)
  → user edits → onChange(next)
      → setSubtree(next)  +  debounce 500 ms:
          spliceSubtreeIntoPage(targetPage.blocks, matchBlockId, next)
          → savePage(targetPage)  → pagesVersion++  (ignored locally while a
            save is pending — anti-flicker freeze)
  → blur → flush save + onSaved() → parent unmounts → rendered preview
```

## What you get inside a reference

Create bullets (Enter), indent / outdent (Tab / Shift+Tab), Backspace-merge,
slash `/` menu, `[[ ]]` and `(( ))` autocomplete, live markdown, undo / redo —
identical to the real page, because it is the same `BlockEditor`.

## Out of scope (matches Roam)

- Breadcrumb parent blocks (`›`) stay navigation-only.
- TODO checkbox and child-expand toggle behave as today.
- No cross-reference multi-block selection / drag between different reference
  matches (each scoped editor is independent).

## Error handling

- Matched block id not found in `targetPage.blocks` (page changed underneath):
  `ReferenceBlockEditor` renders nothing and logs; `BacklinkBlock` falls back to
  preview.
- `savePage` failure: surfaced the same way as the existing `onEditBlock` path
  (no new handling).
- Concurrent iCloud update to `targetPage` while editing: the freeze defers it;
  on blur the local save wins (latest `updatedAt`), consistent with the app's
  existing conflict rule.

## Testing

New `scripts/test-reference-splice.js` (repo style), covering
`spliceSubtreeIntoPage`:
- edited subtree root reinserted in place, children preserved
- new sibling blocks (`next[1..]`) inserted after the matched node, in order
- nested matched block (deep in the tree) spliced at the right position
- root id unchanged → happy path
- fallback path when `next[0].id !== matchBlockId`
- matched id absent → returns input unchanged

Manual: edit a linked reference, press Enter to add a bullet, Tab to indent,
`/todo`, `[[`, undo; confirm the source page reflects all of it and the cursor
never jumps on save.
