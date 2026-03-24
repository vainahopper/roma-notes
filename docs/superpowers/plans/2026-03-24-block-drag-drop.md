# Block Drag & Drop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to drag selected blocks to reorder and re-indent them, Notion-style.

**Architecture:** All drag logic lives in a single `useEffect` in `BlockEditor.tsx` (like the existing block-selection effect). BlockItem gets a small `⠿` drag handle element that's only visible when the block is selected AND hovered. Two new DOM elements (ghost + drop indicator) are appended to the editor container. On drop, existing tree helpers (`_removeBlock`, `_insertAfter`, `_findBlock`, `_filterRoots`, `_findParentBlockId`) are reused.

**Tech Stack:** React 19, TypeScript, pure DOM events (no drag library)

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/renderer/components/BlockEditor.tsx` | Drag state refs, mousedown/move/up handlers (new `useEffect`), ghost + drop-indicator divs in JSX, drop-apply logic, pass `hasBlockSelection` prop to BlockItem |
| `src/renderer/components/BlockItem.tsx` | Render `⠿` handle in `.block-bullet-area`, accept `hasBlockSelection` + `onDragHandleMouseDown` props |
| `src/renderer/components/BlockItem.css` | `.block-drag-handle` styles (visibility, cursor, position) + `.dragging-source` opacity |
| `src/renderer/components/BlockEditor.css` | `.block-drag-ghost`, `.block-drop-indicator` styles |

---

### Task 1: Add drag handle to BlockItem

**Files:**
- Modify: `src/renderer/components/BlockItem.tsx:13-33` (Props interface) and `:644-684` (JSX bullet area)
- Modify: `src/renderer/components/BlockItem.css` (add handle styles)

- [ ] **Step 1: Add new props to BlockItem**

In `BlockItem.tsx`, add two props to the `Props` interface:

```typescript
// Add to Props interface after onNavigateToBlock
hasBlockSelection?: boolean
onDragHandleMouseDown?: (e: React.MouseEvent, blockId: string) => void
```

Add them to the destructured props in the function signature.

- [ ] **Step 2: Render the drag handle in the bullet area**

In `BlockItem.tsx`, inside the `.block-bullet-area` div (around line 661), add the drag handle BEFORE the existing bullet span. The handle replaces the bullet visually when conditions are met (selected + hovered), via CSS:

```tsx
{/* Drag handle — visible only when block is selected + hovered (CSS controls visibility) */}
{hasBlockSelection && (
  <span
    className="block-drag-handle"
    onMouseDown={(e) => onDragHandleMouseDown?.(e, block.id)}
    title="Drag to move"
  >⠿</span>
)}
```

Place this right after the opening `<div className="block-bullet-area">` tag and before the `{isTodo ? ...` conditional.

- [ ] **Step 3: Add CSS for the drag handle**

In `BlockItem.css`, add after the `.block-bullet-area` section (after line 93):

```css
/* ─── Drag handle (selected blocks only) ─────────────────── */

.block-drag-handle {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: var(--accent);
  cursor: grab;
  opacity: 0;
  transition: opacity 0.12s;
  z-index: 2;
  border-radius: 3px;
  letter-spacing: 1px;
}

.block-item.block-selected .block-row:hover .block-drag-handle {
  opacity: 0.7;
}

.block-drag-handle:hover {
  opacity: 1 !important;
  background: var(--accent-dim);
}

.block-drag-handle:active {
  cursor: grabbing;
}

/* Hide bullet when handle is visible */
.block-item.block-selected .block-row:hover .block-bullet-dot {
  opacity: 0;
}

/* ─── Dragging source (reduced opacity) ──────────────────── */

.block-item.block-dragging-source {
  opacity: 0.25;
  pointer-events: none;
}
```

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/BlockItem.tsx src/renderer/components/BlockItem.css
git commit -m "feat: add drag handle to BlockItem (visible on selected+hover)"
```

---

### Task 2: Add ghost element and drop indicator to BlockEditor

**Files:**
- Modify: `src/renderer/components/BlockEditor.tsx:1064-1098` (JSX return)
- Modify: `src/renderer/components/BlockEditor.css`

- [ ] **Step 1: Add ghost and drop-indicator elements in the JSX**

In `BlockEditor.tsx`, inside the `<div className="block-editor" ...>`, add these two elements right before the closing `</div>` (before line 1098):

```tsx
{/* Drag-and-drop visual elements */}
<div className="block-drag-ghost" ref={dragGhostRef} />
<div className="block-drop-indicator" ref={dropIndicatorRef} />
```

Add the refs at the top of the component (near line 163, after `editorRef`):

```typescript
const dragGhostRef = useRef<HTMLDivElement>(null)
const dropIndicatorRef = useRef<HTMLDivElement>(null)
```

- [ ] **Step 2: Add CSS for ghost and drop indicator**

In `BlockEditor.css`, append:

```css
/* ─── Block drag-and-drop ──────────────────────────────────── */

.block-drag-ghost {
  position: fixed;
  pointer-events: none;
  z-index: 1000;
  background: var(--accent-dim);
  border: 1px solid rgba(99,102,241,0.4);
  border-radius: 6px;
  padding: 4px 12px;
  font-size: 13px;
  color: var(--text-primary);
  backdrop-filter: blur(8px);
  display: none;
  white-space: nowrap;
  max-width: 350px;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.5;
}

.block-drag-ghost .drag-count-badge {
  display: inline-block;
  background: var(--accent);
  color: white;
  border-radius: 10px;
  padding: 0 6px;
  font-size: 11px;
  font-weight: 600;
  margin-right: 6px;
}

.block-drop-indicator {
  position: absolute;
  height: 2px;
  background: var(--accent);
  border-radius: 2px;
  pointer-events: none;
  display: none;
  z-index: 100;
  right: 0;
}

.block-drop-indicator::before {
  content: '';
  position: absolute;
  left: -4px;
  top: -3px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent);
}
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/BlockEditor.tsx src/renderer/components/BlockEditor.css
git commit -m "feat: add ghost and drop-indicator DOM elements for block drag"
```

---

### Task 3: Implement drag state and event handlers in BlockEditor

**Files:**
- Modify: `src/renderer/components/BlockEditor.tsx` — add drag refs, new `useEffect`, and drop-apply function

- [ ] **Step 1: Add drag state refs**

In `BlockEditor.tsx`, after the existing block selection refs (around line 192, after `isDraggingRef`), add:

```typescript
// ─── Block drag-and-drop state ─────────────────────────────────────────────
const blockDragActiveRef = useRef(false)
const blockDragSourceIdsRef = useRef<Set<string>>(new Set())
const blockDragStartXRef = useRef(0)
const blockDragDropTargetRef = useRef<{
  refBlockId: string
  position: 'before' | 'after'
  targetDepth: number
} | null>(null)
```

- [ ] **Step 2: Add the `_insertBlocksAtDepth` helper**

After the existing module-level helpers (around line 126, after `_findParentBlockId`), add:

```typescript
/**
 * Insert blocks at a target position and depth in the tree.
 * - position 'before'/'after' the reference block
 * - targetDepth determines nesting: same depth = sibling, deeper = child of ref or ancestor
 */
function _insertBlocksAtTarget(
  tree: Block[],
  refBlockId: string,
  position: 'before' | 'after',
  targetDepth: number,
  blocksToInsert: Block[]
): Block[] {
  const depthMap = _buildDepthMap(tree, 0)
  const refDepth = depthMap.get(refBlockId) ?? 0

  // Case 1: Insert as child of the reference block (targetDepth > refDepth, position=after)
  if (targetDepth > refDepth && position === 'after') {
    return tree.map(function addAsChild(b): Block {
      if (b.id === refBlockId) {
        return { ...b, children: [...b.children, ...blocksToInsert] }
      }
      return { ...b, children: b.children.map(addAsChild) }
    })
  }

  // Case 2: Same depth or shallower — insert as sibling of the ref block (or an ancestor)
  // Find the ancestor at the target depth
  let insertRefId = refBlockId
  let currentDepth = refDepth
  while (currentDepth > targetDepth) {
    const parentId = _findParentBlockId(insertRefId, tree)
    if (!parentId) break
    insertRefId = parentId
    currentDepth--
  }

  // Insert before or after the resolved reference
  if (position === 'before') {
    let result = tree
    for (let i = blocksToInsert.length - 1; i >= 0; i--) {
      result = _insertBefore(insertRefId, blocksToInsert[i], result)
    }
    return result
  } else {
    let result = tree
    // Insert in reverse order after the ref so they end up in correct order
    for (let i = blocksToInsert.length - 1; i >= 0; i--) {
      result = _insertAfter(insertRefId, blocksToInsert[i], result)
    }
    return result
  }
}

/** Insert a block before the given ID (mirror of _insertAfter). */
function _insertBefore(id: string, newBlock: Block, list: Block[]): Block[] {
  const result: Block[] = []
  for (const b of list) {
    if (b.id === id) result.push(newBlock)
    result.push({ ...b, children: _insertBefore(id, newBlock, b.children) })
  }
  return result
}
```

- [ ] **Step 3: Add the drag-handle callback and pass it to BlockItem**

In `BlockEditor.tsx`, add a callback (after the existing event handlers, around line 770):

```typescript
// ─── Block drag handle callback ──────────────────────────────────────────
const handleDragHandleMouseDown = useCallback((e: React.MouseEvent, blockId: string) => {
  e.preventDefault()
  e.stopPropagation()

  // Only start drag if the block is actually selected
  if (!selectedBlockIdsRef.current.has(blockId)) return

  blockDragActiveRef.current = true
  blockDragStartXRef.current = e.clientX

  // Collect all IDs being dragged (selected roots + their children)
  blockDragSourceIdsRef.current.clear()
  const rawIds = Array.from(selectedBlockIdsRef.current)
  const rootIds = _filterRoots(rawIds, blocksRef.current)
  for (const rid of rootIds) {
    const block = _findBlock(rid, blocksRef.current)
    if (block) {
      const addIds = (b: Block) => { blockDragSourceIdsRef.current.add(b.id); b.children.forEach(addIds) }
      addIds(block)
    }
  }

  // Show ghost
  const ghost = dragGhostRef.current
  if (ghost) {
    const firstRoot = _findBlock(rootIds[0], blocksRef.current)
    const count = rootIds.length
    ghost.innerHTML = (count > 1 ? `<span class="drag-count-badge">${count}</span>` : '') +
      (firstRoot?.content || '(empty)')
    ghost.style.display = 'block'
    ghost.style.left = (e.clientX + 12) + 'px'
    ghost.style.top = (e.clientY - 14) + 'px'
  }

  // Mark source blocks visually
  const container = editorRef.current
  if (container) {
    blockDragSourceIdsRef.current.forEach(id => {
      container.querySelector(`[data-block-id="${id}"]`)?.classList.add('block-dragging-source')
    })
  }
}, [])
```

Then update the `BlockItem` render in the JSX (around line 1075) to pass the new props:

```tsx
<BlockItem
  key={block.id}
  block={block}
  depth={0}
  allPages={allPages}
  requestFocusId={focusIdRef.current}
  onConsumeFocus={consumeFocusId}
  onChange={handleChange}
  onToggleCheck={handleToggleCheck}
  onToggleTodo={handleToggleTodo}
  onEnter={handleEnter}
  onBackspace={handleBackspace}
  onTab={handleTab}
  onArrowUp={handleArrowUp}
  onArrowDown={handleArrowDown}
  onNavigate={onNavigate}
  onOpenSidebar={onOpenSidebar}
  onPasteBlocks={handlePasteBlocks}
  onZoom={onZoom}
  onNavigateToBlock={onNavigateToBlock}
  hasBlockSelection={selectedBlockIdsRef.current.size > 0}
  onDragHandleMouseDown={handleDragHandleMouseDown}
/>
```

- [ ] **Step 4: Add the drag `useEffect` for mousemove/mouseup/escape**

In `BlockEditor.tsx`, add a new `useEffect` right after the existing block-selection `useEffect` (after line 340):

```typescript
// ─── Block drag-and-drop: mousemove, mouseup, escape ──────────────────────
useEffect(() => {
  const INDENT_PX = 30 // matches .block-children margin-left(24) + padding-left(6)

  const onMouseMove = (e: MouseEvent) => {
    if (!blockDragActiveRef.current) return

    // Update ghost position
    const ghost = dragGhostRef.current
    if (ghost) {
      ghost.style.left = (e.clientX + 12) + 'px'
      ghost.style.top = (e.clientY - 14) + 'px'
    }

    const container = editorRef.current
    if (!container) return

    // Find closest non-dragged block row
    const allRows = Array.from(container.querySelectorAll<HTMLElement>('[data-block-id] > .block-row'))
    let closest: HTMLElement | null = null
    let closestDist = Infinity
    let position: 'before' | 'after' = 'after'

    for (const row of allRows) {
      const blockEl = row.parentElement!
      const blockId = blockEl.getAttribute('data-block-id')
      if (!blockId || blockDragSourceIdsRef.current.has(blockId)) continue

      const rect = row.getBoundingClientRect()
      const midY = rect.top + rect.height / 2
      const dist = Math.abs(e.clientY - midY)
      if (dist < closestDist) {
        closestDist = dist
        closest = blockEl as HTMLElement
        position = e.clientY < midY ? 'before' : 'after'
      }
    }

    const indicator = dropIndicatorRef.current
    if (!indicator) return

    if (closest && closestDist < 50) {
      const refId = closest.getAttribute('data-block-id')!
      const refDepthMap = _buildDepthMap(blocksRef.current, 0)
      const refDepth = refDepthMap.get(refId) ?? 0

      // Horizontal movement determines indent shift
      const deltaX = e.clientX - blockDragStartXRef.current
      const indentShift = Math.round(deltaX / INDENT_PX)
      const targetDepth = Math.max(0, Math.min(refDepth + 1, refDepth + indentShift))

      // Position the drop indicator
      const row = closest.querySelector(':scope > .block-row') as HTMLElement
      const rowRect = row.getBoundingClientRect()
      const containerRect = container.getBoundingClientRect()

      const leftOffset = targetDepth * INDENT_PX
      indicator.style.display = 'block'
      indicator.style.left = leftOffset + 'px'
      indicator.style.top = (position === 'before'
        ? rowRect.top - containerRect.top - 1
        : rowRect.bottom - containerRect.top - 1
      ) + 'px'
      indicator.style.right = '0'

      blockDragDropTargetRef.current = { refBlockId: refId, position, targetDepth }
    } else {
      indicator.style.display = 'none'
      blockDragDropTargetRef.current = null
    }
  }

  const onMouseUp = () => {
    if (!blockDragActiveRef.current) return
    blockDragActiveRef.current = false

    // Hide ghost and indicator
    if (dragGhostRef.current) dragGhostRef.current.style.display = 'none'
    if (dropIndicatorRef.current) dropIndicatorRef.current.style.display = 'none'

    // Remove dragging-source class
    const container = editorRef.current
    if (container) {
      blockDragSourceIdsRef.current.forEach(id => {
        container.querySelector(`[data-block-id="${id}"]`)?.classList.remove('block-dragging-source')
      })
    }

    // Apply drop if we have a target
    const target = blockDragDropTargetRef.current
    if (target) {
      const rawIds = Array.from(selectedBlockIdsRef.current)
      const rootIds = _filterRoots(rawIds, blocksRef.current)
      const rootBlocks = rootIds
        .map(id => _findBlock(id, blocksRef.current))
        .filter(Boolean) as Block[]

      if (rootBlocks.length > 0) {
        // Push undo
        undoStackRef.current.push(JSON.parse(JSON.stringify(blocksRef.current)))
        redoStackRef.current = []
        if (undoStackRef.current.length > 100) undoStackRef.current.shift()

        // Deep clone the blocks to move
        const cloned = JSON.parse(JSON.stringify(rootBlocks)) as Block[]

        // Remove from tree
        let newTree = blocksRef.current
        for (const id of rootIds) newTree = _removeBlock(id, newTree)

        // Insert at target
        newTree = _insertBlocksAtTarget(
          newTree,
          target.refBlockId,
          target.position,
          target.targetDepth,
          cloned
        )

        onChangeRef.current(newTree)
      }
    }

    blockDragSourceIdsRef.current.clear()
    blockDragDropTargetRef.current = null
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && blockDragActiveRef.current) {
      e.preventDefault()
      blockDragActiveRef.current = false

      // Hide ghost and indicator
      if (dragGhostRef.current) dragGhostRef.current.style.display = 'none'
      if (dropIndicatorRef.current) dropIndicatorRef.current.style.display = 'none'

      // Remove dragging-source class
      const container = editorRef.current
      if (container) {
        blockDragSourceIdsRef.current.forEach(id => {
          container.querySelector(`[data-block-id="${id}"]`)?.classList.remove('block-dragging-source')
        })
      }

      blockDragSourceIdsRef.current.clear()
      blockDragDropTargetRef.current = null
    }
  }

  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
  document.addEventListener('keydown', onKeyDown)
  return () => {
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
    document.removeEventListener('keydown', onKeyDown)
  }
}, [])
```

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/BlockEditor.tsx
git commit -m "feat: implement block drag-and-drop logic (move + indent)"
```

---

### Task 4: Wire BlockItem props through recursive children

**Files:**
- Modify: `src/renderer/components/BlockItem.tsx:643-end` (recursive children rendering)

- [ ] **Step 1: Pass `hasBlockSelection` and `onDragHandleMouseDown` to child BlockItems**

In the recursive children rendering section of BlockItem (the part where child `<BlockItem>` components are rendered), ensure the two new props are forwarded. Find the section that maps `block.children` to child `<BlockItem>` elements and add:

```tsx
hasBlockSelection={hasBlockSelection}
onDragHandleMouseDown={onDragHandleMouseDown}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/components/BlockItem.tsx
git commit -m "feat: forward drag handle props through recursive BlockItem children"
```

---

### Task 5: Manual testing and edge-case fixes

**Files:**
- Potentially any of the 4 files above

- [ ] **Step 1: Start dev server and test basic flow**

Run: `npm run dev`

Test sequence:
1. Click on a block's bullet area to select it (existing behavior)
2. Shift-click or drag to select 2-3 blocks
3. Hover over a selected block — verify the ⠿ handle appears
4. Drag from the handle — verify ghost follows cursor, drop indicator appears
5. Drop between two blocks — verify blocks move
6. Drag right/left during drop — verify indentation changes
7. Press Escape during drag — verify it cancels
8. Press Cmd+Z after drop — verify undo works

- [ ] **Step 2: Fix any issues found during testing**

Common things to watch for:
- Drop indicator position offset (adjust `containerRect` calculations)
- Handle z-index conflicts with tooltip
- `INDENT_PX` value mismatch (verify 30px matches actual CSS)
- Selection clearing after drop (should preserve)

- [ ] **Step 3: Final commit with any fixes**

```bash
git add -A
git commit -m "fix: block drag-and-drop edge cases and polish"
```

---

### Task 6: Bump version and deploy

**Files:**
- `package.json` (version bump)

- [ ] **Step 1: Bump version**

```bash
npm version patch --no-git-tag-version
```

- [ ] **Step 2: Build and deploy**

```bash
npm run deploy:all
```

- [ ] **Step 3: Commit version bump**

```bash
git add package.json package-lock.json
git commit -m "chore: bump version for block drag-and-drop release"
```
