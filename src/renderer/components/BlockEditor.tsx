import React, { useCallback, useRef, useEffect } from 'react'
import type { Block, Page } from '../../shared/types'
import { BlockItem } from './BlockItem'
import { generateId } from '../utils/helpers'
import { platform } from '../platform'
import './BlockEditor.css'

// ─── Indented paste helpers ──────────────────────────────────────────────────

/** Parse pasted text into an array of {content, depth} pairs. */
function parseIndentedOutline(text: string): { content: string; depth: number }[] {
  const nonEmptyLines = text.split('\n').filter(l => l.trim() !== '')
  if (nonEmptyLines.length === 0) return []

  const hasTabIndent = nonEmptyLines.some(l => /^\t/.test(l))

  let rawItems: { depth: number; remaining: string }[]
  if (hasTabIndent) {
    rawItems = nonEmptyLines.map(line => {
      const depth = (line.match(/^\t*/)?.[0] ?? '').length
      return { depth, remaining: line.slice(depth) }
    })
  } else {
    const spaceCounts = nonEmptyLines.map(l => l.match(/^( +)/)?.[1]?.length ?? 0).filter(n => n > 0)
    const indentSize = spaceCounts.length > 0 ? Math.min(...spaceCounts) : 2
    rawItems = nonEmptyLines.map(line => {
      const spaceCount = line.match(/^( *)/)?.[1]?.length ?? 0
      return { depth: Math.floor(spaceCount / indentSize), remaining: line.slice(spaceCount) }
    })
  }

  const minDepth = Math.min(...rawItems.map(r => r.depth))
  return rawItems.map(({ depth, remaining }) => ({
    content: remaining.replace(/^[-*•]\s+/, '').trimStart() || remaining.trim(),
    depth: depth - minDepth,
  }))
}

/** Build a Block tree from parsed {content, depth} lines. */
function buildBlockTree(lines: { content: string; depth: number }[], now: string): Block[] {
  const roots: Block[] = []
  const stack: { block: Block; depth: number }[] = []

  for (const line of lines) {
    const block: Block = { id: generateId(), content: line.content, children: [], checked: null, createdAt: now, updatedAt: now }
    while (stack.length > 0 && stack[stack.length - 1].depth >= line.depth) stack.pop()
    if (stack.length === 0) roots.push(block)
    else stack[stack.length - 1].block.children.push(block)
    stack.push({ block, depth: line.depth })
  }
  return roots
}

// ─── Module-level pure helpers (used inside effects to avoid stale closures) ──

function _findBlock(id: string, list: Block[]): Block | null {
  for (const b of list) {
    if (b.id === id) return b
    const found = _findBlock(id, b.children)
    if (found) return found
  }
  return null
}

function _removeBlock(id: string, list: Block[]): Block[] {
  return list
    .filter(b => b.id !== id)
    .map(b => ({ ...b, children: _removeBlock(id, b.children) }))
}

function _buildDepthMap(list: Block[], d: number, map = new Map<string, number>()): Map<string, number> {
  for (const b of list) { map.set(b.id, d); _buildDepthMap(b.children, d + 1, map) }
  return map
}

/**
 * Given a list of selected block IDs, return only the "roots" — blocks whose
 * parent is NOT also in the selection set.  This prevents double-counting when
 * both a parent and its children are selected (addSubtree already covers them).
 */
function _filterRoots(ids: string[], allBlocks: Block[]): string[] {
  if (ids.length <= 1) return ids
  const set = new Set(ids)
  const parentMap = new Map<string, string | null>()
  function buildParents(list: Block[], pid: string | null) {
    for (const b of list) { parentMap.set(b.id, pid); buildParents(b.children, b.id) }
  }
  buildParents(allBlocks, null)
  return ids.filter(id => {
    let p = parentMap.get(id) ?? null
    while (p !== null) { if (set.has(p)) return false; p = parentMap.get(p) ?? null }
    return true
  })
}

function _flatBlocks(list: Block[]): Block[] {
  const result: Block[] = []
  function traverse(bs: Block[]) { for (const b of bs) { result.push(b); traverse(b.children) } }
  traverse(list)
  return result
}

function _updateBlock(id: string, updater: (b: Block) => Block, list: Block[]): Block[] {
  return list.map(b => {
    if (b.id === id) return updater(b)
    return { ...b, children: _updateBlock(id, updater, b.children) }
  })
}

function _insertAfter(id: string, newBlock: Block, list: Block[]): Block[] {
  const result: Block[] = []
  for (const b of list) {
    result.push({ ...b, children: _insertAfter(id, newBlock, b.children) })
    if (b.id === id) result.push(newBlock)
  }
  return result
}

function _findParentBlockId(id: string, list: Block[]): string | null {
  for (const b of list) {
    if (b.children.some(c => c.id === id)) return b.id
    const found = _findParentBlockId(id, b.children)
    if (found) return found
  }
  return null
}

/** IDs of blocks whose direct content area intersects the DOM selection range. */
function _selectedBlockIds(container: HTMLElement, range: Range): string[] {
  const areas = Array.from(
    container.querySelectorAll<HTMLElement>('[data-block-id] > .block-row > .block-content-area')
  )
  const ids: string[] = []
  for (const el of areas) {
    const cr = document.createRange()
    cr.selectNodeContents(el)
    const noOverlap =
      range.compareBoundaryPoints(Range.END_TO_START, cr) < 0 ||
      range.compareBoundaryPoints(Range.START_TO_END, cr) > 0
    if (!noOverlap) {
      const id = el.closest('[data-block-id]')?.getAttribute('data-block-id')
      if (id) ids.push(id)
    }
  }
  return ids
}

interface Props {
  blocks: Block[]
  onChange: (blocks: Block[]) => void
  allPages: Map<string, Page>
  onNavigate: (id: string, title?: string) => void
  onOpenSidebar: (id: string) => void
  scrollToBlockId?: string | null
  onClearScrollTarget?: () => void
  zoomedBlockId?: string | null
  onZoom?: (id: string, content: string) => void
  onNavigateToBlock?: (pageId: string, pageTitle: string, blockId: string) => void
  onBlur?: () => void
}

export function BlockEditor({ blocks, onChange, allPages, onNavigate, onOpenSidebar, scrollToBlockId, onClearScrollTarget, zoomedBlockId, onZoom, onNavigateToBlock, onBlur }: Props) {
  const focusIdRef = useRef<string | null>(null)
  const editorRef = useRef<HTMLDivElement>(null)
  const emptyBlockIdRef = useRef(generateId())

  // Always-current refs so effects never have stale closures
  const blocksRef = useRef(blocks)
  blocksRef.current = blocks
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  // Undo / redo stacks
  const undoStackRef = useRef<Block[][]>([])
  const redoStackRef = useRef<Block[][]>([])

  // Text-change batching — capture state before first keystroke, commit after 1.5s silence
  const batchStartRef = useRef<Block[] | null>(null)
  const batchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Track which block the current batch belongs to — flush when the user moves to a different block
  const batchBlockIdRef = useRef<string | null>(null)

  // Stable refs to undo/redo functions so effects never go stale
  const handleUndoRef = useRef<() => void>(() => {})
  const handleRedoRef = useRef<() => void>(() => {})

  // ─── Roam-style block selection state ────────────────────────────────────────
  // Activated when the user drags the cursor past the bullet into the toggle area.
  const selectedBlockIdsRef = useRef<Set<string>>(new Set())
  const blockSelectModeRef = useRef(false)
  const blockSelectAnchorIdRef = useRef<string | null>(null)
  const isDraggingRef = useRef(false)

  // ─── Scroll to block ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (!scrollToBlockId) return
    const tryScroll = () => {
      const el = document.querySelector(`[data-block-id="${scrollToBlockId}"]`)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        el.classList.add('block-highlight')
        setTimeout(() => el.classList.remove('block-highlight'), 1500)
        onClearScrollTarget?.()
        return true
      }
      return false
    }
    if (!tryScroll()) {
      const timer = setTimeout(tryScroll, 150)
      return () => clearTimeout(timer)
    }
  }, [scrollToBlockId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Roam-style block selection: drag past bullet → highlight whole block row ──
  useEffect(() => {
    const container = editorRef.current
    if (!container) return

    /** Remove all block-selected highlights and reset mode. */
    const clearSel = () => {
      selectedBlockIdsRef.current.forEach(id => {
        container.querySelector(`[data-block-id="${id}"]`)?.classList.remove('block-selected')
      })
      selectedBlockIdsRef.current.clear()
      blockSelectModeRef.current = false
      blockSelectAnchorIdRef.current = null
      container.classList.remove('block-select-active') // re-enable text selection
    }

    /** Activate block selection on the given block element. */
    const activateBlockSelect = (blockEl: HTMLElement) => {
      blockSelectModeRef.current = true
      blockSelectAnchorIdRef.current = blockEl.getAttribute('data-block-id')
      window.getSelection()?.removeAllRanges()
      container.classList.add('block-select-active') // disable text selection via CSS
    }

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return
      isDraggingRef.current = true
      clearSel()

      // If the click already starts in the bullet/toggle zone, activate immediately
      // and preventDefault so the browser never starts a text selection.
      const blockEl = (e.target as Element).closest<HTMLElement>('[data-block-id]')
      if (blockEl && container.contains(blockEl)) {
        const contentArea = blockEl.querySelector<HTMLElement>(':scope > .block-row > .block-content-area')
        if (contentArea && e.clientX < contentArea.getBoundingClientRect().left) {
          e.preventDefault()
          activateBlockSelect(blockEl)
        }
      }
    }

    const onMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return
      if (e.buttons === 0) { isDraggingRef.current = false; return }

      const el = document.elementFromPoint(e.clientX, e.clientY)
      if (!el) return
      const blockEl = el.closest<HTMLElement>('[data-block-id]')
      if (!blockEl || !container.contains(blockEl)) return

      const contentArea = blockEl.querySelector<HTMLElement>(':scope > .block-row > .block-content-area')
      if (!contentArea) return

      const inBulletZone = e.clientX < contentArea.getBoundingClientRect().left

      // Activate when cursor crosses into bullet zone for the first time during a drag
      if (inBulletZone && !blockSelectModeRef.current) {
        activateBlockSelect(blockEl)
      }
      if (!blockSelectModeRef.current) return

      const anchorId = blockSelectAnchorIdRef.current!
      const allBlockEls = Array.from(container.querySelectorAll<HTMLElement>('[data-block-id]'))
      const anchorEl = container.querySelector<HTMLElement>(`[data-block-id="${anchorId}"]`)
      const anchorIdx = anchorEl ? allBlockEls.indexOf(anchorEl) : 0
      const currentIdx = allBlockEls.indexOf(blockEl)
      const [from, to] = anchorIdx <= currentIdx ? [anchorIdx, currentIdx] : [currentIdx, anchorIdx]

      // Clear old highlights, rebuild selection
      selectedBlockIdsRef.current.forEach(id => {
        container.querySelector(`[data-block-id="${id}"]`)?.classList.remove('block-selected')
      })
      selectedBlockIdsRef.current.clear()

      for (let i = from; i <= to; i++) {
        const bId = allBlockEls[i].getAttribute('data-block-id')
        if (bId) {
          selectedBlockIdsRef.current.add(bId)
          allBlockEls[i].classList.add('block-selected')
        }
      }
      window.getSelection()?.removeAllRanges()
    }

    const onMouseUp = () => {
      isDraggingRef.current = false

      // If a regular text drag ended spanning 2+ blocks, convert to block selection
      if (!blockSelectModeRef.current) {
        const sel = window.getSelection()
        if (sel && !sel.isCollapsed && sel.rangeCount > 0) {
          const anchor = sel.anchorNode
          if (anchor && container.contains(anchor)) {
            const range = sel.getRangeAt(0)
            const ids = _selectedBlockIds(container, range)
            if (ids.length >= 2) {
              sel.removeAllRanges()
              blockSelectModeRef.current = true
              blockSelectAnchorIdRef.current = ids[0]
              container.classList.add('block-select-active')
              ids.forEach(id => {
                selectedBlockIdsRef.current.add(id)
                container.querySelector(`[data-block-id="${id}"]`)?.classList.add('block-selected')
              })
            }
          }
        }
      }
    }

    // Escape clears block selection
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedBlockIdsRef.current.size > 0) clearSel()
    }

    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  // Used to trigger a re-render when arrow navigation changes focus (no onChange call)
  const [, setFocusTick] = React.useState(0)

  // ─── Block tree manipulation helpers ─────────────────────────────────────────

  function updateBlock(id: string, updater: (b: Block) => Block, list: Block[]): Block[] {
    return list.map(b => {
      if (b.id === id) return updater(b)
      return { ...b, children: updateBlock(id, updater, b.children) }
    })
  }

  function findBlock(id: string, list: Block[]): Block | null {
    for (const b of list) {
      if (b.id === id) return b
      const found = findBlock(id, b.children)
      if (found) return found
    }
    return null
  }

  function findIndexInParent(id: string, list: Block[]): { index: number; parent: Block[] } | null {
    for (let i = 0; i < list.length; i++) {
      if (list[i].id === id) return { index: i, parent: list }
      const found = findIndexInParent(id, list[i].children)
      if (found) return found
    }
    return null
  }

  function removeBlock(id: string, list: Block[]): Block[] {
    return list
      .filter(b => b.id !== id)
      .map(b => ({ ...b, children: removeBlock(id, b.children) }))
  }

  function insertAfter(id: string, newBlock: Block, list: Block[]): Block[] {
    const result: Block[] = []
    for (const b of list) {
      result.push({ ...b, children: insertAfter(id, newBlock, b.children) })
      if (b.id === id) result.push(newBlock)
    }
    return result
  }

  function insertBefore(id: string, newBlock: Block, list: Block[]): Block[] {
    const result: Block[] = []
    for (const b of list) {
      if (b.id === id) result.push(newBlock)
      result.push({ ...b, children: insertBefore(id, newBlock, b.children) })
    }
    return result
  }

  function flattenBlocks(list: Block[]): Block[] {
    const result: Block[] = []
    function traverse(bs: Block[]) {
      for (const b of bs) { result.push(b); traverse(b.children) }
    }
    traverse(list)
    return result
  }

  // ─── History helpers ──────────────────────────────────────────────────────────

  /** Flush any pending text batch and push a snapshot to the undo stack. */
  const flushAndPushHistory = useCallback((snapshot: Block[]) => {
    if (batchTimerRef.current) {
      clearTimeout(batchTimerRef.current)
      batchTimerRef.current = null
      if (batchStartRef.current) {
        undoStackRef.current.push(batchStartRef.current)
        if (undoStackRef.current.length > 100) undoStackRef.current.shift()
        batchStartRef.current = null
      }
    }
    undoStackRef.current.push(JSON.parse(JSON.stringify(snapshot)))
    redoStackRef.current = []
    if (undoStackRef.current.length > 100) undoStackRef.current.shift()
  }, []) // only accesses stable refs → empty deps is correct

  // ─── Event handlers ───────────────────────────────────────────────────────────

  const handleChange = useCallback((id: string, content: string) => {
    // If the user switched to a different block, flush the current batch immediately so
    // each block's typing session is its own undo step (prevents out-of-order undo).
    if (batchStartRef.current && batchBlockIdRef.current !== id) {
      if (batchTimerRef.current) { clearTimeout(batchTimerRef.current); batchTimerRef.current = null }
      undoStackRef.current.push(batchStartRef.current)
      if (undoStackRef.current.length > 100) undoStackRef.current.shift()
      redoStackRef.current = []
      batchStartRef.current = null
      batchBlockIdRef.current = null
    }

    // Capture state at start of a typing session for text-level undo (1.5 s debounce)
    if (!batchStartRef.current) {
      batchStartRef.current = JSON.parse(JSON.stringify(blocks))
      batchBlockIdRef.current = id
    }
    if (batchTimerRef.current) clearTimeout(batchTimerRef.current)
    batchTimerRef.current = setTimeout(() => {
      if (batchStartRef.current) {
        undoStackRef.current.push(batchStartRef.current)
        if (undoStackRef.current.length > 100) undoStackRef.current.shift()
        redoStackRef.current = []
        batchStartRef.current = null
      }
      batchTimerRef.current = null
    }, 1500)

    const now = new Date().toISOString()

    // When zoomed into a childless block the editor shows a phantom placeholder block
    // (emptyBlockIdRef) that does not exist in the tree.  On the very first keystroke,
    // materialise it as a real child of the zoomed block so all subsequent operations work.
    if (zoomedBlockId && !_findBlock(id, blocks)) {
      const newBlock: Block = { id, content, children: [], checked: null, createdAt: now, updatedAt: now }
      const newBlocks = _updateBlock(zoomedBlockId, b => ({ ...b, children: [...b.children, newBlock] }), blocks)
      onChange(newBlocks)
      return
    }

    const newBlocks = updateBlock(id, b => ({
      ...b,
      content,
      createdAt: b.createdAt ?? now,
      updatedAt: now,
    }), blocks)
    onChange(newBlocks)
  }, [blocks, onChange, zoomedBlockId])

  const handleUndo = useCallback(() => {
    // Flush any pending text batch first so it becomes undoable
    if (batchTimerRef.current) {
      clearTimeout(batchTimerRef.current)
      batchTimerRef.current = null
      if (batchStartRef.current) {
        undoStackRef.current.push(batchStartRef.current)
        if (undoStackRef.current.length > 100) undoStackRef.current.shift()
        batchStartRef.current = null
      }
    }
    if (undoStackRef.current.length === 0) return
    redoStackRef.current.push(JSON.parse(JSON.stringify(blocks)))
    const prev = undoStackRef.current.pop()!
    onChange(prev)
  }, [blocks, onChange])

  const handleRedo = useCallback(() => {
    if (redoStackRef.current.length === 0) return
    undoStackRef.current.push(JSON.parse(JSON.stringify(blocks)))
    if (undoStackRef.current.length > 100) undoStackRef.current.shift()
    const next = redoStackRef.current.pop()!
    onChange(next)
  }, [blocks, onChange])

  // Keep refs pointing at latest versions (for use inside effects)
  handleUndoRef.current = handleUndo
  handleRedoRef.current = handleRedo

  // Checkbox click: only toggles checked/unchecked (never removes the TODO)
  const handleToggleCheck = useCallback((id: string) => {
    const newBlocks = updateBlock(id, b => ({
      ...b,
      checked: b.checked === null ? false : !b.checked,
    }), blocks)
    onChange(newBlocks)
  }, [blocks, onChange])

  // Cmd+Enter / slash /todo: adds or removes the TODO entirely
  const handleToggleTodo = useCallback((id: string) => {
    const newBlocks = updateBlock(id, b => ({
      ...b,
      checked: b.checked === null ? false : null,
    }), blocks)
    onChange(newBlocks)
  }, [blocks, onChange])

  const handleEnter = useCallback((id: string, cursorPos: number, content: string) => {
    flushAndPushHistory(blocks)

    // Phantom placeholder block in zoom mode (not yet in tree) — materialise it and split.
    if (zoomedBlockId && !findBlock(id, blocks)) {
      const now = new Date().toISOString()
      const before = content.slice(0, cursorPos)
      const after = content.slice(cursorPos)
      const newId = generateId()
      const newBlock: Block = { id: newId, content: after, children: [], checked: null, createdAt: now, updatedAt: now }
      const thisBlock: Block = { id, content: before, children: [], checked: null, createdAt: now, updatedAt: now }
      const newBlocks = _updateBlock(zoomedBlockId, b => ({
        ...b,
        children: [...b.children, thisBlock, newBlock],
      }), blocks)
      focusIdRef.current = newId
      onChange(newBlocks)
      return
    }

    if (!content.trim()) {
      const result = findIndexInParent(id, blocks)
      if (!result) {
        // Still a phantom placeholder (empty, never typed into) — do nothing.
        return
      }
      const { index, parent } = result

      // Treat as root when either at actual page root, or at the top level inside a zoom scope.
      const zoomedBlockNode = zoomedBlockId ? findBlock(zoomedBlockId, blocks) : null
      const isAtRootLevel = parent === blocks || (zoomedBlockNode != null && zoomedBlockNode.children === parent)
      if (isAtRootLevel) {
        // Empty root-level block: create a new empty sibling after it (Roam behaviour)
        const newId = generateId()
        const now = new Date().toISOString()
        const newBlock: Block = { id: newId, content: '', children: [], checked: null, createdAt: now, updatedAt: now }
        focusIdRef.current = newId
        onChange(insertAfter(id, newBlock, blocks))
        return
      }

      let grandParentList: Block[] = blocks
      let parentBlockId: string | null = null
      function findGrandParent(list: Block[], parentList: Block[]): boolean {
        for (const b of list) {
          if (b.children === parent) { grandParentList = parentList; parentBlockId = b.id; return true }
          if (findGrandParent(b.children, list)) return true
        }
        return false
      }
      findGrandParent(blocks, blocks)

      if (parentBlockId) {
        const blockToMove = parent[index]
        const newParentChildren = parent.filter((_, i) => i !== index)
        let newBlocks = updateBlock(parentBlockId, pb => ({ ...pb, children: newParentChildren }), blocks)
        newBlocks = insertAfter(parentBlockId, blockToMove, newBlocks)
        focusIdRef.current = blockToMove.id
        onChange(newBlocks)
      }
      return
    }

    // Cursor at beginning → insert new empty block above, leave current unchanged
    if (cursorPos === 0) {
      const newId = generateId()
      const now = new Date().toISOString()
      const newBlock: Block = { id: newId, content: '', children: [], checked: null, createdAt: now, updatedAt: now }
      const newBlocks = insertBefore(id, newBlock, blocks)
      focusIdRef.current = newId
      onChange(newBlocks)
      return
    }

    const before = content.slice(0, cursorPos)
    const after = content.slice(cursorPos)
    const block = findBlock(id, blocks)
    if (!block) return

    let newBlocks = updateBlock(id, b => ({ ...b, content: before }), blocks)
    const newId = generateId()
    const now = new Date().toISOString()
    const newBlock: Block = { id: newId, content: after, children: [], checked: null, createdAt: now, updatedAt: now }

    // Block has children → new block always becomes first child (stays right below current line)
    // Block has no children → new block is a sibling inserted after
    if (block.children.length > 0) {
      newBlocks = updateBlock(id, b => ({ ...b, children: [newBlock, ...b.children] }), newBlocks)
    } else {
      newBlocks = insertAfter(id, newBlock, newBlocks)
    }

    focusIdRef.current = newId
    onChange(newBlocks)
  }, [blocks, onChange, flushAndPushHistory, zoomedBlockId])

  const handleBackspace = useCallback((id: string, isEmpty: boolean, isCollapsed?: boolean) => {
    if (!isEmpty) return
    flushAndPushHistory(blocks)

    // In zoom mode restrict navigation to the visible subtree so focus never
    // lands on a block that isn't rendered (e.g. the zoomed block itself).
    const scopeBlocks = zoomedBlockId ? (_findBlock(zoomedBlockId, blocks)?.children ?? blocks) : blocks
    const flat = flattenBlocks(scopeBlocks)
    const idx = flat.findIndex(b => b.id === id)

    if (idx === 0 && flat.length === 1) {
      const block = findBlock(id, blocks)
      if (block && block.checked !== null && block.checked !== undefined) {
        onChange(updateBlock(id, b => ({ ...b, checked: null }), blocks))
      }
      return
    }

    const prevBlock = flat[idx - 1]
    if (prevBlock) focusIdRef.current = prevBlock.id

    const block = findBlock(id, blocks)
    if (!block) return

    // Collapsed block with children: delete entire subtree as a unit
    if (isCollapsed && block.children.length > 0) {
      onChange(removeBlock(id, blocks))
      return
    }

    let newBlocks = removeBlock(id, blocks)
    if (block.children.length > 0) {
      if (prevBlock) {
        newBlocks = updateBlock(prevBlock.id, pb => ({
          ...pb,
          children: [...pb.children, ...block.children],
        }), newBlocks)
      } else {
        // Deleting the first root block — promote its children to root level so they
        // are not silently orphaned (lost) along with the deleted parent.
        newBlocks = [...block.children, ...newBlocks]
        focusIdRef.current = block.children[0].id
      }
    }
    onChange(newBlocks)
  }, [blocks, onChange, flushAndPushHistory, zoomedBlockId])

  const handleTab = useCallback((id: string, shift: boolean) => {
    flushAndPushHistory(blocks)

    const result = findIndexInParent(id, blocks)
    if (!result) return
    const { index, parent } = result

    if (shift) {
      if (parent === blocks) return
      // In zoom mode, also prevent outdenting first-level children of the zoomed block
      if (zoomedBlockId) {
        const zoomedBlock = findBlock(zoomedBlockId, blocks)
        if (zoomedBlock && zoomedBlock.children === parent) return
      }

      let grandParentList: Block[] = blocks
      let parentBlockId: string | null = null
      function findGrandParent(list: Block[], parentList: Block[]): boolean {
        for (const b of list) {
          if (b.children === parent) { grandParentList = parentList; parentBlockId = b.id; return true }
          if (findGrandParent(b.children, list)) return true
        }
        return false
      }
      findGrandParent(blocks, blocks)
      if (!parentBlockId) return

      const blockToMove = parent[index]
      const newParentChildren = parent.filter((_, i) => i !== index)
      let newBlocks = updateBlock(parentBlockId, pb => ({ ...pb, children: newParentChildren }), blocks)
      newBlocks = insertAfter(parentBlockId, blockToMove, newBlocks)
      focusIdRef.current = blockToMove.id
      onChange(newBlocks)
    } else {
      if (index === 0) return
      const prevSibling = parent[index - 1]
      const blockToMove = parent[index]
      const newParent = parent.filter((_, i) => i !== index)
      let newBlocks: Block[]

      if (parent === blocks) {
        newBlocks = newParent
      } else {
        function replaceChildren(list: Block[]): Block[] {
          return list.map(b => {
            if (b.children === parent) return { ...b, children: newParent }
            return { ...b, children: replaceChildren(b.children) }
          })
        }
        newBlocks = replaceChildren(blocks)
      }

      newBlocks = updateBlock(prevSibling.id, pb => ({
        ...pb,
        children: [...pb.children, blockToMove],
      }), newBlocks)
      focusIdRef.current = blockToMove.id
      onChange(newBlocks)
    }
  }, [blocks, onChange, flushAndPushHistory, zoomedBlockId])

  const handleArrowUp = useCallback((id: string) => {
    const scopeBlocks = zoomedBlockId ? (_findBlock(zoomedBlockId, blocks)?.children ?? blocks) : blocks
    const flat = flattenBlocks(scopeBlocks)
    const idx = flat.findIndex(b => b.id === id)
    if (idx > 0) {
      focusIdRef.current = flat[idx - 1].id
      setFocusTick(t => t + 1)
    }
  }, [blocks, zoomedBlockId])

  const handleArrowDown = useCallback((id: string) => {
    const scopeBlocks = zoomedBlockId ? (_findBlock(zoomedBlockId, blocks)?.children ?? blocks) : blocks
    const flat = flattenBlocks(scopeBlocks)
    const idx = flat.findIndex(b => b.id === id)
    if (idx < flat.length - 1) {
      focusIdRef.current = flat[idx + 1].id
      setFocusTick(t => t + 1)
    }
  }, [blocks, zoomedBlockId])

  const handlePasteBlocks = useCallback((id: string, contentBefore: string, contentAfter: string, pastedText: string) => {
    flushAndPushHistory(blocks)

    const parsedLines = parseIndentedOutline(pastedText)
    if (parsedLines.length === 0) return
    const now = new Date().toISOString()
    const pastedTree = buildBlockTree(parsedLines, now)
    if (pastedTree.length === 0) return

    const firstBlock = pastedTree[0]
    const mergedContent = contentBefore + firstBlock.content

    let newBlocks = updateBlock(id, b => ({
      ...b,
      content: mergedContent,
      children: [...firstBlock.children, ...b.children],
      updatedAt: now,
    }), blocks)

    let lastInsertedId = id
    for (let i = 1; i < pastedTree.length; i++) {
      newBlocks = insertAfter(lastInsertedId, pastedTree[i], newBlocks)
      lastInsertedId = pastedTree[i].id
    }

    if (contentAfter) {
      const afterBlock: Block = { id: generateId(), content: contentAfter, children: [], checked: null, createdAt: now, updatedAt: now }
      newBlocks = insertAfter(lastInsertedId, afterBlock, newBlocks)
      focusIdRef.current = afterBlock.id
    } else {
      focusIdRef.current = lastInsertedId
    }

    onChange(newBlocks)
  }, [blocks, onChange, flushAndPushHistory])

  // ─── Native copy: block selection or DOM selection → indented plain text ────────
  useEffect(() => {
    const handler = (e: ClipboardEvent) => {
      const container = editorRef.current
      if (!container) return

      // 1. Custom block selection (drag-past-bullet) takes absolute priority
      if (selectedBlockIdsRef.current.size > 0) {
        const rawIds = Array.from(selectedBlockIdsRef.current)
        // Filter to roots only: prevent double-counting parent+child pairs
        const ids = _filterRoots(rawIds, blocksRef.current)
        const depthMap = _buildDepthMap(blocksRef.current, 0)
        const minDepth = Math.min(...ids.map(id => depthMap.get(id) ?? 0))
        const lines: string[] = []
        for (const id of ids) {
          const blk = _findBlock(id, blocksRef.current)
          if (!blk) continue
          const addSubtree = (b: Block, depth: number) => {
            lines.push(`${'    '.repeat(depth)}- ${b.content}`)
            for (const child of b.children) addSubtree(child, depth + 1)
          }
          addSubtree(blk, (depthMap.get(id) ?? 0) - minDepth)
        }
        if (lines.length > 0) {
          e.preventDefault()
          e.clipboardData?.setData('text/plain', lines.join('\n'))
        }
        return
      }

      // 2. DOM selection (read mode — textareas use BlockItem's onCopy instead)
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return
      const anchor = sel.anchorNode
      if (!anchor || !container.contains(anchor)) return

      const range = sel.getRangeAt(0)
      const rawIds2 = _selectedBlockIds(container, range)
      if (rawIds2.length === 0) return
      // Filter roots to avoid double-counting nested blocks
      const ids2 = _filterRoots(rawIds2, blocksRef.current)

      e.preventDefault()

      // Depth-based indentation, include each root block's full subtree
      const depthMap = _buildDepthMap(blocksRef.current, 0)
      const minDepth = Math.min(...ids2.map(id => depthMap.get(id) ?? 0))
      const lines: string[] = []
      for (const id of ids2) {
        const block = _findBlock(id, blocksRef.current)
        if (!block) continue
        const baseIndent = (depthMap.get(id) ?? 0) - minDepth
        const addSubtree = (b: Block, depth: number) => {
          lines.push(`${'    '.repeat(depth)}- ${b.content}`)
          for (const child of b.children) addSubtree(child, depth + 1)
        }
        addSubtree(block, baseIndent)
      }

      if (lines.length === 0) return
      e.clipboardData?.setData('text/plain', lines.join('\n'))
    }

    document.addEventListener('copy', handler)
    return () => document.removeEventListener('copy', handler)
  }, []) // Uses blocksRef.current — no stale closure

  // ─── Undo / Redo via menu IPC (main process sends 'menu:undo'/'menu:redo') ─────
  // The Edit menu uses custom accelerator items instead of role:'undo'/'redo' so that
  // macOS does not call webContents.undo() (which is a no-op on controlled textareas).
  // The accelerator on the menu item also intercepts the keyboard Cmd+Z before it
  // reaches the DOM, so no separate keydown handler is needed.
  useEffect(() => {
    if (!platform.isElectron()) return

    const onUndo = () => {
      const active = document.activeElement as HTMLElement
      const container = editorRef.current
      // If a non-editor editable element is focused, fall back to native undo there
      const isEditableOutside =
        (active?.tagName === 'TEXTAREA' || active?.tagName === 'INPUT') &&
        container != null && !container.contains(active)
      if (isEditableOutside) { document.execCommand('undo'); return }
      handleUndoRef.current()
    }

    const onRedo = () => {
      const active = document.activeElement as HTMLElement
      const container = editorRef.current
      const isEditableOutside =
        (active?.tagName === 'TEXTAREA' || active?.tagName === 'INPUT') &&
        container != null && !container.contains(active)
      if (isEditableOutside) { document.execCommand('redo'); return }
      handleRedoRef.current()
    }

    platform.onMenuUndo(onUndo)
    platform.onMenuRedo(onRedo)
    return () => {
      platform.offMenuUndo(onUndo)
      platform.offMenuRedo(onRedo)
    }
  }, []) // uses stable refs only

  // ─── Multi-block delete (⌫/Del) and cut (⌘X) — works with both block selection
  //     (drag-past-bullet) and regular DOM selection ───────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const container = editorRef.current
      if (!container) return

      const isCut = (e.metaKey || e.ctrlKey) && e.key === 'x'
      const isDelete = e.key === 'Backspace' || e.key === 'Delete'

      // ── Multi-block Tab: indent/outdent when block selection is active ────────
      if (e.key === 'Tab' && selectedBlockIdsRef.current.size > 0) {
        e.preventDefault()
        const rawIds = Array.from(selectedBlockIdsRef.current)
        const ids = _filterRoots(rawIds, blocksRef.current)

        // Clear visual highlights
        rawIds.forEach(id => {
          container.querySelector(`[data-block-id="${id}"]`)?.classList.remove('block-selected')
        })
        selectedBlockIdsRef.current.clear()
        blockSelectModeRef.current = false
        blockSelectAnchorIdRef.current = null
        container.classList.remove('block-select-active')

        undoStackRef.current.push(JSON.parse(JSON.stringify(blocksRef.current)))
        redoStackRef.current = []
        if (undoStackRef.current.length > 100) undoStackRef.current.shift()

        if (!e.shiftKey) {
          // Indent: make all selected roots last children of the block before the first root
          const flat = _flatBlocks(blocksRef.current)
          const selectedSet = new Set(ids)
          const firstIdx = flat.findIndex(b => selectedSet.has(b.id))
          if (firstIdx <= 0) return
          let anchorId: string | null = null
          for (let i = firstIdx - 1; i >= 0; i--) {
            if (!selectedSet.has(flat[i].id)) { anchorId = flat[i].id; break }
          }
          if (!anchorId) return
          const selectedBlocks = flat
            .filter(b => selectedSet.has(b.id))
            .map(b => _findBlock(b.id, blocksRef.current)!)
            .filter(Boolean) as Block[]
          let newBlocks = blocksRef.current
          for (const id of ids) newBlocks = _removeBlock(id, newBlocks)
          newBlocks = _updateBlock(anchorId, b => ({ ...b, children: [...b.children, ...selectedBlocks] }), newBlocks)
          onChangeRef.current(newBlocks)
        } else {
          // Outdent: move each root to after its parent, process in reverse order
          let newBlocks = blocksRef.current
          for (const id of [...ids].reverse()) {
            const parentBlockId = _findParentBlockId(id, newBlocks)
            if (parentBlockId === null) continue
            const block = _findBlock(id, newBlocks)
            if (!block) continue
            newBlocks = _removeBlock(id, newBlocks)
            newBlocks = _insertAfter(parentBlockId, block, newBlocks)
          }
          onChangeRef.current(newBlocks)
        }
        return
      }

      if (!isCut && !isDelete) return

      // ── Path A: custom block selection (drag-past-bullet) ──────────────────
      if (selectedBlockIdsRef.current.size > 0) {
        e.preventDefault()
        const ids = Array.from(selectedBlockIdsRef.current)

        // Clear visual highlights
        ids.forEach(id => {
          container.querySelector(`[data-block-id="${id}"]`)?.classList.remove('block-selected')
        })
        selectedBlockIdsRef.current.clear()
        blockSelectModeRef.current = false
        blockSelectAnchorIdRef.current = null

        if (isCut) {
          const rootIds = _filterRoots(ids, blocksRef.current)
          const depthMap = _buildDepthMap(blocksRef.current, 0)
          const minDepth = Math.min(...rootIds.map(id => depthMap.get(id) ?? 0))
          const lines: string[] = []
          for (const id of rootIds) {
            const blk = _findBlock(id, blocksRef.current)
            if (!blk) continue
            const addSubtree = (b: Block, depth: number) => {
              lines.push(`${'    '.repeat(depth)}- ${b.content}`)
              for (const child of b.children) addSubtree(child, depth + 1)
            }
            addSubtree(blk, (depthMap.get(id) ?? 0) - minDepth)
          }
          if (lines.length > 0) navigator.clipboard.writeText(lines.join('\n')).catch(() => {})
        }

        undoStackRef.current.push(JSON.parse(JSON.stringify(blocksRef.current)))
        redoStackRef.current = []
        if (undoStackRef.current.length > 100) undoStackRef.current.shift()

        const deleteIds = _filterRoots(ids, blocksRef.current)
        let newBlocks = blocksRef.current
        for (const id of deleteIds) newBlocks = _removeBlock(id, newBlocks)
        const now = new Date().toISOString()
        if (newBlocks.length === 0) {
          newBlocks = [{ id: generateId(), content: '', children: [], checked: null, createdAt: now, updatedAt: now }]
        }
        onChangeRef.current(newBlocks)
        return
      }

      // ── Path B: DOM selection spanning 2+ blocks ────────────────────────────
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return
      const anchor = sel.anchorNode
      if (!anchor || !container.contains(anchor)) return

      const range = sel.getRangeAt(0)
      const rawIds = _selectedBlockIds(container, range)
      if (rawIds.length < 2) return
      const ids = _filterRoots(rawIds, blocksRef.current)

      e.preventDefault()

      if (isCut) {
        const depthMap = _buildDepthMap(blocksRef.current, 0)
        const minDepth = Math.min(...ids.map(id => depthMap.get(id) ?? 0))
        const lines: string[] = []
        for (const id of ids) {
          const blk = _findBlock(id, blocksRef.current)
          if (!blk) continue
          const addSubtree = (b: Block, depth: number) => {
            lines.push(`${'    '.repeat(depth)}- ${b.content}`)
            for (const child of b.children) addSubtree(child, depth + 1)
          }
          addSubtree(blk, (depthMap.get(id) ?? 0) - minDepth)
        }
        if (lines.length > 0) navigator.clipboard.writeText(lines.join('\n')).catch(() => {})
      }

      if (batchTimerRef.current) {
        clearTimeout(batchTimerRef.current)
        batchTimerRef.current = null
        if (batchStartRef.current) {
          undoStackRef.current.push(batchStartRef.current)
          if (undoStackRef.current.length > 100) undoStackRef.current.shift()
          batchStartRef.current = null
        }
      }
      undoStackRef.current.push(JSON.parse(JSON.stringify(blocksRef.current)))
      redoStackRef.current = []
      if (undoStackRef.current.length > 100) undoStackRef.current.shift()

      let newBlocks = blocksRef.current
      for (const id of ids) newBlocks = _removeBlock(id, newBlocks)
      const now = new Date().toISOString()
      if (newBlocks.length === 0) {
        newBlocks = [{ id: generateId(), content: '', children: [], checked: null, createdAt: now, updatedAt: now }]
      }
      sel.removeAllRanges()
      onChangeRef.current(newBlocks)
    }

    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  // ─────────────────────────────────────────────────────────────────────────────

  const consumeFocusId = useCallback(() => {
    const id = focusIdRef.current
    focusIdRef.current = null
    return id
  }, [])

  const zoomedBlock = zoomedBlockId ? _findBlock(zoomedBlockId, blocks) : null
  const rootBlocks = zoomedBlock ? zoomedBlock.children : blocks
  const displayBlocks = rootBlocks.length > 0 ? rootBlocks : [{ id: emptyBlockIdRef.current, content: '', children: [], checked: null, createdAt: '', updatedAt: '' }]

  return (
    <div
      className="block-editor"
      ref={editorRef}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          onBlur?.()
        }
      }}
    >
      {displayBlocks.map((block) => (
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
        />
      ))}
    </div>
  )
}
