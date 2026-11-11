# Reference Panel Full Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make editing a block in the references panel behave exactly like the real page editor (create bullets, indent, slash menu, autocomplete, undo) by lazy-mounting the real `BlockEditor` scoped to the referenced block's subtree.

**Architecture:** A new `ReferenceBlockEditor` holds a local `subtree` seeded from the matched block's node, renders a real `<BlockEditor blocks={subtree}>`, and on change splices the edited subtree back into the source page (pure `spliceSubtreeIntoPage`) and saves debounced. `BacklinkBlock` in `LinkedReferences` renders the rendered preview until clicked, then mounts one `ReferenceBlockEditor` (only one across the panel at a time), unmounting on blur. `BlockEditor` gains one prop, `initialFocusBlockId`, to focus the matched block on mount.

**Tech Stack:** React 19, TypeScript, Vite. Tests are plain Node scripts (`node scripts/test-*.js`) using `assert`/throw, per repo convention (they duplicate the pure logic in isolation — see `scripts/test-merge.js`).

**Spec:** `docs/superpowers/specs/2026-09-09-reference-panel-full-editing-design.md`

---

## File Structure

- `src/renderer/utils/helpers.ts` — **modify**: add pure `spliceSubtreeIntoPage(pageBlocks, matchBlockId, editedSubtree)` next to the other block-tree helpers.
- `scripts/test-reference-splice.js` — **create**: unit tests for the splice logic (duplicated in isolation, repo style).
- `package.json` — **modify**: add the new test script to the `test` chain.
- `src/renderer/components/BlockEditor.tsx` — **modify**: add optional `initialFocusBlockId?: string` prop; seed `focusIdRef` once on mount.
- `src/renderer/components/ReferenceBlockEditor.tsx` — **create**: the scoped editor wrapper (~90 lines).
- `src/renderer/components/ReferenceBlockEditor.css` — **create**: minimal container styling.
- `src/renderer/components/LinkedReferences.tsx` — **modify**: `BacklinkBlock` lazy-mounts `ReferenceBlockEditor` on click; delete the bespoke `<textarea>` mini-editor; change the `onEditBlock` prop to `onSaveRefSubtree`.
- `src/renderer/components/PageView.tsx` — **modify**: replace `handleEditBacklinkBlock` with `handleSaveRefSubtree`; update all `LinkedReferences` usages.
- `src/renderer/components/DailyNotesView.tsx` — **modify**: same swap in `DayEntry`.

---

## Task 1: Pure `spliceSubtreeIntoPage` helper + tests

**Files:**
- Modify: `src/renderer/utils/helpers.ts` (add after `findBlocksWithLink`, around line 177)
- Create: `scripts/test-reference-splice.js`
- Modify: `package.json:9`

- [ ] **Step 1: Write the failing test**

Create `scripts/test-reference-splice.js`:

```js
// Unit test for spliceSubtreeIntoPage. Run: node scripts/test-reference-splice.js
// Duplicates the pure logic from src/renderer/utils/helpers.ts in isolation
// (repo convention — see scripts/test-merge.js).

function spliceSubtreeIntoPage(pageBlocks, matchBlockId, editedSubtree) {
  if (!editedSubtree || editedSubtree.length === 0) return pageBlocks
  const rootMatches = editedSubtree[0] && editedSubtree[0].id === matchBlockId
  const replacement = rootMatches ? editedSubtree : editedSubtree
  let found = false
  function walk(list) {
    const out = []
    for (const b of list) {
      if (b.id === matchBlockId) {
        found = true
        for (const r of replacement) out.push(r)
      } else {
        out.push({ ...b, children: walk(b.children || []) })
      }
    }
    return out
  }
  const result = walk(pageBlocks)
  return found ? result : pageBlocks
}

let passed = 0, failed = 0
function test(name, fn) {
  try { fn(); passed++; console.log('ok  - ' + name) }
  catch (e) { failed++; console.log('FAIL - ' + name + '\n  ' + e.message) }
}
function eq(a, b) {
  const sa = JSON.stringify(a), sb = JSON.stringify(b)
  if (sa !== sb) throw new Error(`expected ${sb}\n  got      ${sa}`)
}
const blk = (id, content, children = []) => ({ id, content, children, checked: null })

test('root replaced in place, children preserved', () => {
  const page = [blk('A', 'a'), blk('M', 'm-old', [blk('C', 'c')]), blk('B', 'b')]
  const edited = [blk('M', 'm-new', [blk('C', 'c2')])]
  const out = spliceSubtreeIntoPage(page, 'M', edited)
  eq(out.map(b => b.id), ['A', 'M', 'B'])
  eq(out[1], blk('M', 'm-new', [blk('C', 'c2')]))
})

test('new sibling blocks inserted after the matched node in order', () => {
  const page = [blk('A', 'a'), blk('M', 'm'), blk('B', 'b')]
  const edited = [blk('M', 'm'), blk('N1', 'n1'), blk('N2', 'n2')]
  const out = spliceSubtreeIntoPage(page, 'M', edited)
  eq(out.map(b => b.id), ['A', 'M', 'N1', 'N2', 'B'])
})

test('nested matched block spliced at the right position', () => {
  const page = [blk('A', 'a', [blk('M', 'm'), blk('C', 'c')])]
  const edited = [blk('M', 'm2'), blk('N', 'n')]
  const out = spliceSubtreeIntoPage(page, 'M', edited)
  eq(out[0].children.map(b => b.id), ['M', 'N', 'C'])
})

test('fallback: edited[0] is not the matched id → replace position with whole array', () => {
  const page = [blk('M', 'm')]
  const edited = [blk('X', 'x'), blk('Y', 'y')]
  const out = spliceSubtreeIntoPage(page, 'M', edited)
  eq(out.map(b => b.id), ['X', 'Y'])
})

test('matched id absent → input returned unchanged', () => {
  const page = [blk('A', 'a')]
  const edited = [blk('M', 'm')]
  const out = spliceSubtreeIntoPage(page, 'M', edited)
  eq(out, page)
})

test('empty edited subtree → input returned unchanged', () => {
  const page = [blk('M', 'm')]
  eq(spliceSubtreeIntoPage(page, 'M', []), page)
})

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
```

- [ ] **Step 2: Run the test to verify it passes against the duplicated logic**

Run: `node scripts/test-reference-splice.js`
Expected: `6 passed, 0 failed`

(The duplicated function in the test IS the reference implementation for this
task — it passes immediately. Step 3 ports the identical logic into the app.)

- [ ] **Step 3: Add the real implementation to `helpers.ts`**

In `src/renderer/utils/helpers.ts`, after `findBlocksWithLink` (ends ~line 177), add:

```typescript
/**
 * Reinsert an edited block subtree (from the references panel's scoped editor)
 * back into a page's block tree.
 *
 * `editedSubtree[0]` is the edited matched block (id === matchBlockId in the
 * normal case — BlockEditor's guards prevent it being deleted or outdented past
 * root). `editedSubtree[1..]` are new sibling blocks the user created (Enter /
 * Shift+Tab) and are inserted immediately after the matched node.
 *
 * Fallback: if `editedSubtree[0].id !== matchBlockId`, the matched node's
 * position is replaced by the entire `editedSubtree`.
 * If the matched id is not found, the input is returned unchanged.
 */
export function spliceSubtreeIntoPage(
  pageBlocks: Block[],
  matchBlockId: string,
  editedSubtree: Block[],
): Block[] {
  if (!editedSubtree || editedSubtree.length === 0) return pageBlocks
  let found = false
  function walk(list: Block[]): Block[] {
    const out: Block[] = []
    for (const b of list) {
      if (b.id === matchBlockId) {
        found = true
        for (const r of editedSubtree) out.push(r)
      } else {
        out.push({ ...b, children: walk(b.children ?? []) })
      }
    }
    return out
  }
  const result = walk(pageBlocks)
  return found ? result : pageBlocks
}
```

Confirm `Block` is already imported in `helpers.ts` (it is — used by `BlockMatch`).

- [ ] **Step 4: Wire the test into the npm test chain**

In `package.json`, change line 9 from:

```json
    "test": "node scripts/test-merge.js && node scripts/test-icloud-sync.js",
```
to:
```json
    "test": "node scripts/test-merge.js && node scripts/test-icloud-sync.js && node scripts/test-reference-splice.js",
```

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: all three scripts pass, `6 passed, 0 failed` for the new one.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/utils/helpers.ts scripts/test-reference-splice.js package.json
git commit -m "feat(refs): add spliceSubtreeIntoPage helper + tests"
```

---

## Task 2: `initialFocusBlockId` prop on `BlockEditor`

**Files:**
- Modify: `src/renderer/components/BlockEditor.tsx` (Props interface ~233-245, component signature ~247, focusIdRef init ~248)

- [ ] **Step 1: Add the prop to the `Props` interface**

In `src/renderer/components/BlockEditor.tsx`, add to `interface Props` (after `onBlur?: () => void`):

```typescript
  /** When set, this block enters edit mode (cursor at end) on first mount. */
  initialFocusBlockId?: string
```

- [ ] **Step 2: Destructure it and seed `focusIdRef` once**

Change the component signature to include `initialFocusBlockId`, and change the `focusIdRef` initialiser:

```typescript
export function BlockEditor({ blocks, onChange, allPages, onNavigate, onOpenSidebar, scrollToBlockId, onClearScrollTarget, zoomedBlockId, onZoom, onNavigateToBlock, onBlur, initialFocusBlockId }: Props) {
  const focusIdRef = useRef<string | null>(initialFocusBlockId ?? null)
```

This is sufficient: `requestFocusId={focusIdRef.current}` is passed to the first
`BlockItem` render, and `BlockItem`'s `useLayoutEffect` on `requestFocusId`
calls `onConsumeFocus()` and enters edit mode with the cursor at end.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Verify existing behaviour unchanged**

Run: `npm test`
Expected: still all green (no test covers BlockEditor directly; this is a
no-op when the prop is omitted).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/BlockEditor.tsx
git commit -m "feat(editor): add initialFocusBlockId prop to BlockEditor"
```

---

## Task 3: `ReferenceBlockEditor` component

**Files:**
- Create: `src/renderer/components/ReferenceBlockEditor.tsx`
- Create: `src/renderer/components/ReferenceBlockEditor.css`

- [ ] **Step 1: Create the CSS**

`src/renderer/components/ReferenceBlockEditor.css`:

```css
.reference-block-editor {
  /* The scoped BlockEditor renders its own .block-editor inside. Keep it flush
     with the reference row — no extra indent, no min-height jump. */
  width: 100%;
}
.reference-block-editor .block-editor {
  padding: 0;
}
```

- [ ] **Step 2: Create the component**

`src/renderer/components/ReferenceBlockEditor.tsx`:

```tsx
import { useCallback, useMemo, useRef, useState } from 'react'
import type { Page, Block } from '../../shared/types'
import { BlockEditor } from './BlockEditor'
import { spliceSubtreeIntoPage } from '../utils/helpers'
import './ReferenceBlockEditor.css'

interface Props {
  /** The page that owns the referenced block. */
  targetPage: Page
  /** Id of the referenced (matched) block within targetPage. */
  matchBlockId: string
  allPages: Map<string, Page>
  onNavigate: (id: string, title?: string) => void
  onNavigateToBlock?: (pageId: string, pageTitle: string, blockId: string) => void
  /** Persist an edited subtree: parent runs splice + savePage. */
  onSaveRefSubtree: (pageId: string, matchBlockId: string, editedSubtree: Block[]) => void
  /** Called after the final save when focus leaves the editor. Parent unmounts. */
  onDone: () => void
}

function findNode(list: Block[], id: string): Block | null {
  for (const b of list) {
    if (b.id === id) return b
    const found = findNode(b.children ?? [], id)
    if (found) return found
  }
  return null
}

export function ReferenceBlockEditor({
  targetPage, matchBlockId, allPages, onNavigate, onNavigateToBlock, onSaveRefSubtree, onDone,
}: Props) {
  // Seed once from the current node. While editing we own this state; incoming
  // targetPage changes (e.g. pagesVersion bump after our own save) are ignored
  // as long as a save is pending — same anti-flicker pattern as DayEntry.
  const initialNode = useMemo(() => findNode(targetPage.blocks, matchBlockId), [])  // eslint-disable-line react-hooks/exhaustive-deps
  const [subtree, setSubtree] = useState<Block[]>(initialNode ? [initialNode] : [])
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const subtreeRef = useRef(subtree)
  subtreeRef.current = subtree

  const flushSave = useCallback(() => {
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null }
    onSaveRefSubtree(targetPage.id, matchBlockId, subtreeRef.current)
  }, [onSaveRefSubtree, targetPage.id, matchBlockId])

  const handleChange = useCallback((next: Block[]) => {
    setSubtree(next)
    subtreeRef.current = next
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null
      onSaveRefSubtree(targetPage.id, matchBlockId, subtreeRef.current)
    }, 500)
  }, [onSaveRefSubtree, targetPage.id, matchBlockId])

  const handleBlur = useCallback(() => {
    flushSave()
    onDone()
  }, [flushSave, onDone])

  if (!initialNode) return null

  return (
    <div className="reference-block-editor">
      <BlockEditor
        blocks={subtree}
        onChange={handleChange}
        allPages={allPages}
        onNavigate={onNavigate}
        onOpenSidebar={() => {}}
        onNavigateToBlock={onNavigateToBlock}
        onBlur={handleBlur}
        initialFocusBlockId={matchBlockId}
      />
    </div>
  )
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (unused-import errors here mean a typo — fix them).

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/ReferenceBlockEditor.tsx src/renderer/components/ReferenceBlockEditor.css
git commit -m "feat(refs): ReferenceBlockEditor — scoped real editor for a reference"
```

---

## Task 4: Lazy-mount in `LinkedReferences` / `BacklinkBlock`

**Files:**
- Modify: `src/renderer/components/LinkedReferences.tsx`

This task changes the `LinkedReferences` public prop `onEditBlock` →
`onSaveRefSubtree`, threads `targetPage` down, and replaces the bespoke
`<textarea>` editor in `BacklinkBlock` with a click-to-mount
`ReferenceBlockEditor`. Task 5 updates the two callers.

- [ ] **Step 1: Update imports and the `Props` interface**

In `src/renderer/components/LinkedReferences.tsx`:

```tsx
import React, { useState } from 'react'
import type { Page, Block } from '../../shared/types'
import { BlockContent } from './BlockContent'
import { ReferenceBlockEditor } from './ReferenceBlockEditor'
import type { BlockMatch } from '../utils/helpers'
import './LinkedReferences.css'
```

(Remove `useRef`, `useCallback` from the React import if now unused — the
typecheck will tell you.)

In `interface Props`, replace:

```tsx
  onEditBlock?: (pageId: string, blockId: string, content: string) => void
```
with:
```tsx
  onSaveRefSubtree?: (pageId: string, matchBlockId: string, editedSubtree: Block[]) => void
```

- [ ] **Step 2: Thread the rename through `LinkedReferences` and `BacklinkItem`**

In the `LinkedReferences` function signature and its `<BacklinkItem>` render,
rename `onEditBlock` → `onSaveRefSubtree`. Do the same in `BacklinkItem`'s
props type, signature, and its `<BacklinkMatch>` render, and in `BacklinkMatch`'s
props type, signature, and its `<BacklinkBlock>` render.

`BacklinkMatch` already receives `page` — pass it to `BacklinkBlock` as
`targetPage={page}` (it already passes `page={page}`; keep both — `page` is used
for navigation, `targetPage` for the editor). Actually `page` IS the target
page here, so no new prop drilling is needed beyond what exists.

- [ ] **Step 3: Rewrite `BacklinkBlock`'s editor branch**

In `BacklinkBlock`:

- Replace the props type entry `onEditBlock?: (...)` with
  `onSaveRefSubtree?: (pageId: string, matchBlockId: string, editedSubtree: Block[]) => void`.
- Delete this state and helpers: `editing`, `editValue`, `textareaRef`,
  `autoResize`, the two `React.useEffect` blocks that manage `editValue` /
  autoresize / focus, `handleBlur`, `handleKeyDown`.
- Keep: `expanded`/`setExpanded`, `hasChildren`, the `effectiveChecked` /
  `isTodo` / `displayContent` logic, `handleBulletClick`, `handleSliderChange`.
- Replace `handleContentClick` with:

```tsx
  const [editingHere, setEditingHere] = useState(false)
  const handleContentClick = () => {
    if (!onSaveRefSubtree) return
    setEditingHere(true)
  }
```

- Replace the `editing ? <textarea .../> : <div className="backlink-content" ...>`
  ternary with:

```tsx
        {editingHere && onSaveRefSubtree ? (
          <ReferenceBlockEditor
            targetPage={page}
            matchBlockId={block.id}
            allPages={allPages}
            onNavigate={onNavigate}
            onNavigateToBlock={onNavigateToBlock}
            onSaveRefSubtree={onSaveRefSubtree}
            onDone={() => setEditingHere(false)}
          />
        ) : (
          <div
            className={`backlink-content${isTodo && effectiveChecked ? ' done-text' : ''}${onSaveRefSubtree ? ' backlink-content-editable' : ''}`}
            onClick={handleContentClick}
            title={onSaveRefSubtree ? 'Click to edit' : undefined}
          >
            <BlockContent
              content={displayContent}
              checked={effectiveChecked}
              allPages={allPages}
              onNavigate={onNavigate}
              onOpenSidebar={() => {}}
              onSliderChange={onSaveRefSubtree ? handleSliderChange : undefined}
            />
          </div>
        )}
```

- `handleSliderChange` currently calls `onEditBlock?.(page.id, block.id, newContent)`.
  Change it to splice a single-block subtree:

```tsx
  const handleSliderChange = useCallback((newContent: string) => {
    onSaveRefSubtree?.(page.id, block.id, [{ ...block, content: newContent }])
  }, [onSaveRefSubtree, page.id, block])
```

- The recursive child render at the bottom of `BacklinkBlock` (`block.children.map`)
  passes `onEditBlock={onEditBlock}` — change to `onSaveRefSubtree={onSaveRefSubtree}`.

- [ ] **Step 4: Remove now-dead CSS references**

Leave `.backlink-edit-textarea` in `LinkedReferences.css` for now (harmless);
a follow-up cleanup task can remove it. Do NOT spend time on it here.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors ONLY in `PageView.tsx` and `DailyNotesView.tsx` (they still
pass `onEditBlock`). Those are fixed in Task 5. No errors within
`LinkedReferences.tsx` / `ReferenceBlockEditor.tsx`.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/LinkedReferences.tsx
git commit -m "feat(refs): lazy-mount ReferenceBlockEditor on click, drop hand-rolled textarea"
```

---

## Task 5: Wire `PageView` and `DailyNotesView`

**Files:**
- Modify: `src/renderer/components/PageView.tsx` (`handleEditBacklinkBlock` ~159-169, 5 `LinkedReferences` usages)
- Modify: `src/renderer/components/DailyNotesView.tsx` (`handleEditBlock` in `DayEntry` ~304, 1 `LinkedReferences` usage)

- [ ] **Step 1: Replace the handler in `PageView`**

In `src/renderer/components/PageView.tsx`, import `spliceSubtreeIntoPage`:

```tsx
import { isDatePage, parseDatePage, findBlocksWithLink, extractAttributes, spliceSubtreeIntoPage, type BlockMatch } from '../utils/helpers'
```

Replace `handleEditBacklinkBlock` with:

```tsx
  const handleSaveRefSubtree = useCallback((pageId: string, matchBlockId: string, editedSubtree: Block[]) => {
    const targetPage = allPages.get(pageId)
    if (!targetPage) return
    const newBlocks = spliceSubtreeIntoPage(targetPage.blocks, matchBlockId, editedSubtree)
    savePage({ ...targetPage, blocks: newBlocks, updatedAt: new Date().toISOString() })
  }, [allPages])
```

- [ ] **Step 2: Update all `LinkedReferences` usages in `PageView`**

Replace every `onEditBlock={handleEditBacklinkBlock}` with
`onSaveRefSubtree={handleSaveRefSubtree}` (5 occurrences: todoRefs, doneRefs,
backlinks, unlinkedRefs — grep to be sure).

- [ ] **Step 3: Replace the handler in `DailyNotesView`**

In `src/renderer/components/DailyNotesView.tsx`, add `spliceSubtreeIntoPage` to
the `helpers` import, then replace `DayEntry`'s `handleEditBlock` with:

```tsx
  const handleSaveRefSubtree = useCallback((pageId: string, matchBlockId: string, editedSubtree: Block[]) => {
    const target = allPages.get(pageId)
    if (!target) return
    savePage({ ...target, blocks: spliceSubtreeIntoPage(target.blocks, matchBlockId, editedSubtree), updatedAt: new Date().toISOString() })
  }, [allPages])
```

Update the `<LinkedReferences>` usage: `onEditBlock={handleEditBlock}` →
`onSaveRefSubtree={handleSaveRefSubtree}`.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 5: Full test suite**

Run: `npm test`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/PageView.tsx src/renderer/components/DailyNotesView.tsx
git commit -m "feat(refs): wire PageView + DailyNotesView to spliceSubtreeIntoPage"
```

---

## Task 6: Manual verification in the running app

**Files:** none (verification only)

- [ ] **Step 1: Start the dev server**

Use the `mcp__Claude_Browser__preview_start` tool with `{name: "dev"}` (create
`.claude/launch.json` with `npm run dev` / port 5173 if it does not exist).

- [ ] **Step 2: Create test data**

On a page "Alpha", add a block `hello [[Beta]] world` with a child `child one`.
Navigate to page "Beta". The "Linked References" panel shows the Alpha block.

- [ ] **Step 3: Verify each behaviour** (read console via `read_console_messages` after each)

  - Click the reference text → it becomes an editor with the cursor in it.
  - Type ` extra` → after ~1s the Alpha page block updates (check via navigating
    to Alpha, or the store). Cursor does NOT jump while typing.
  - Press Enter at end → a new empty bullet appears; type `sibling`. Blur.
    Navigate to Alpha: `sibling` is a sibling block after the referenced one.
  - Re-open the reference editor, press Tab on a bullet → it indents.
  - Type `/` → the slash menu appears. Escape.
  - Type `[[` → wikilink autocomplete appears. Escape.
  - Cmd/Ctrl+Z → undoes the last change within the scoped editor.
  - Click outside → editor unmounts, preview shows the updated content.

- [ ] **Step 4: Verify the TODO page still performs**

Create ~20 blocks with `{{[[TODO]]}}` across pages, open the "TODO" page.
Confirm the list renders promptly and only one editor mounts when you click a row
(check there is a single `.block-editor` in the DOM via `read_page`).

- [ ] **Step 5: Screenshot for the user**

`mcp__Claude_Browser__computer` `{action: "screenshot"}` of an open reference
editor with the slash menu visible; send with `SendUserFile`.

- [ ] **Step 6: Final commit (docs)**

Mark this plan's checkboxes done; commit:

```bash
git add docs/superpowers/plans/2026-09-09-reference-panel-full-editing.md
git commit -m "docs: mark reference-panel editing plan complete"
```

---

## Notes / gotchas

- **Do NOT** pass `zoomedBlockId` to the scoped `BlockEditor` — that renders only
  the block's *children*. We pass `blocks={[matchNode]}` so the matched block
  itself is editable at root.
- `BlockEditor` registers ~6 `document`-level listeners per instance. The
  lazy-mount (one editor at a time) is what keeps this acceptable — do not
  regress to always-mounted.
- The anti-flicker freeze (ignore incoming props while `saveTimerRef` pending)
  is load-bearing: without it, `pagesVersion++` after the debounced save
  remounts the editor and drops the cursor mid-typing.
- Encryption: encrypted blocks in references already render locked; editing one
  goes through the same `BlockItem` unlock flow as the real page. No extra work.
- Version bump + deploy is a separate step the user runs (`npm version patch
  --no-git-tag-version && npm run deploy:all`) — NOT part of this plan.
