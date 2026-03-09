import React, { useState, useCallback, useMemo, useRef, Fragment } from 'react'
import type { Page, Block, ZoomFrame } from '../../shared/types'
import { BlockEditor } from './BlockEditor'
import { BlockContent } from './BlockContent'
import { LinkedReferences } from './LinkedReferences'
import { savePage, deletePage, createNewPage } from '../stores/useStore'
import { isDatePage } from '../utils/helpers'
import './PageView.css'

interface Props {
  page: Page
  allPages: Map<string, Page>
  onNavigate: (id: string, title?: string) => void
  onOpenSidebar: (id: string) => void
  onPageDeleted?: (id: string) => void
  isSidebar?: boolean
  scrollToBlockId?: string | null
  onClearScrollTarget?: () => void
  onNavigateToBlock?: (pageId: string, pageTitle: string, blockId: string) => void
  onToggleStar?: () => void
  initialZoom?: ZoomFrame[] | null
}

// Pages whose title triggers special linked-refs treatment
const TODO_PAGE_TITLES = ['todo', 'todos', 'tasks']

export function PageView({ page, allPages, onNavigate, onOpenSidebar, onPageDeleted, isSidebar = false, scrollToBlockId, onClearScrollTarget, onNavigateToBlock, onToggleStar, initialZoom }: Props) {
  const [blocks, setBlocks] = useState<Block[]>(page.blocks)
  const [title, setTitle] = useState(page.title)
  const [editingTitle, setEditingTitle] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const allPagesRef = useRef(allPages)
  allPagesRef.current = allPages

  // Block zoom state: initialized from initialZoom prop (set when navigating to a block)
  const [zoomStack, setZoomStack] = useState<ZoomFrame[]>(initialZoom ?? [])
  const zoomedBlockId = zoomStack.length > 0 ? zoomStack[zoomStack.length - 1].blockId : null

  const handleZoom = useCallback((blockId: string, blockContent: string) => {
    setZoomStack(prev => [...prev, { blockId, blockContent }])
  }, [])

  const handleBreadcrumbNav = useCallback((index: number) => {
    if (index < 0) setZoomStack([])
    else setZoomStack(prev => prev.slice(0, index + 1))
  }, [])


  const isDaily = page.isDaily || isDatePage(page.title)
  const isTodoPage = TODO_PAGE_TITLES.includes(page.title.toLowerCase())

  // Live content of the currently-zoomed block (for zoom hero title)
  const currentZoomedBlock = useMemo(() => {
    if (!zoomedBlockId) return null
    function find(list: Block[]): Block | null {
      for (const b of list) {
        if (b.id === zoomedBlockId) return b
        const found = find(b.children)
        if (found) return found
      }
      return null
    }
    return find(blocks)
  }, [zoomedBlockId, blocks])

  const triggerSave = useCallback((newBlocks: Block[], newTitle?: string) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      savePage({ ...page, title: newTitle ?? title, blocks: newBlocks })
    }, 500)
  }, [page, title])

  const blocksRef = useRef(blocks)
  blocksRef.current = blocks

  const handleEditorBlur = useCallback(() => {
    ensureWikilinkPages(blocksRef.current, allPagesRef.current)
  }, [])

  const handleBlocksChange = useCallback((newBlocks: Block[]) => {
    setBlocks(newBlocks)
    triggerSave(newBlocks)
  }, [triggerSave])

  const handleTitleChange = useCallback((newTitle: string) => {
    setTitle(newTitle)
    triggerSave(blocks, newTitle)
  }, [blocks, triggerSave])

  const handleDeletePage = useCallback(async () => {
    await deletePage(page.id)
    setShowDeleteConfirm(false)
    onPageDeleted?.(page.id)
  }, [page.id, onPageDeleted])

  const handleToggleBacklinkTodo = useCallback((pageId: string, blockId: string) => {
    const targetPage = allPages.get(pageId)
    if (!targetPage) return
    function updateBlockChecked(blocks: Block[]): Block[] {
      return blocks.map(b => {
        if (b.id === blockId) {
          const next = b.checked === true ? false : true
          const newContent = b.content
            .replace(/\{\{\[\[TODO\]\]\}\}|{{TODO}}/gi, '')
            .replace(/\{\{\[\[DONE\]\]\}\}|{{DONE}}/gi, '')
            .trim()
          return { ...b, checked: next, content: newContent }
        }
        return { ...b, children: updateBlockChecked(b.children) }
      })
    }
    savePage({ ...targetPage, blocks: updateBlockChecked(targetPage.blocks) })
  }, [allPages])

  const handleEditBacklinkBlock = useCallback((pageId: string, blockId: string, content: string) => {
    const targetPage = allPages.get(pageId)
    if (!targetPage) return
    function updateBlockContent(blist: Block[]): Block[] {
      return blist.map(b => {
        if (b.id === blockId) return { ...b, content, updatedAt: new Date().toISOString() }
        return { ...b, children: updateBlockContent(b.children) }
      })
    }
    savePage({ ...targetPage, blocks: updateBlockContent(targetPage.blocks) })
  }, [allPages])

  // ── Linked references (explicit [[PageTitle]] wikilinks) ─────────────────────
  const backlinks = useMemo(() => {
    const pageTitleLower = page.title.toLowerCase()
    const pageIdLower = page.id.toLowerCase()
    const results: { page: Page; blocks: Block[] }[] = []
    for (const [, p] of allPages) {
      if (p.id === page.id) continue
      const matchingBlocks = findBlocksWithLink(p.blocks, pageTitleLower, pageIdLower)
      if (matchingBlocks.length > 0) results.push({ page: p, blocks: matchingBlocks })
    }
    // Sort most-recently-updated pages first
    return results.sort((a, b) => new Date(b.page.updatedAt).getTime() - new Date(a.page.updatedAt).getTime())
  }, [page.id, page.title, allPages])

  // Build a Set of block IDs that are already linked (for filtering unlinked)
  const linkedBlockIds = useMemo(() => {
    const ids = new Set<string>()
    for (const { blocks: bs } of backlinks) {
      bs.forEach(b => ids.add(b.id))
    }
    return ids
  }, [backlinks])

  // ── Unlinked references (plain-text mention, not inside [[…]]) ───────────────
  const unlinkedRefs = useMemo(() => {
    if (!title || title === 'Untitled') return []
    const results: { page: Page; blocks: Block[] }[] = []
    for (const [, p] of allPages) {
      if (p.id === page.id) continue
      // Exclude blocks already in linked refs
      const matchingBlocks = findBlocksWithUnlinkedMention(p.blocks, title).filter(
        b => !linkedBlockIds.has(b.id)
      )
      if (matchingBlocks.length > 0) results.push({ page: p, blocks: matchingBlocks })
    }
    // Sort most-recently-updated pages first
    return results.sort((a, b) => new Date(b.page.updatedAt).getTime() - new Date(a.page.updatedAt).getTime())
  }, [page.id, title, allPages, linkedBlockIds])

  // ── TODO page: collect all todo blocks across all pages ──────────────────────
  const todoRefs = useMemo(() => {
    if (!isTodoPage) return []
    const results: { page: Page; blocks: Block[] }[] = []
    for (const [, p] of allPages) {
      if (p.id === page.id) continue
      const todoBlocks = findTodoBlocks(p.blocks)
      if (todoBlocks.length > 0) results.push({ page: p, blocks: todoBlocks })
    }
    return results.sort((a, b) => new Date(b.page.updatedAt).getTime() - new Date(a.page.updatedAt).getTime())
  }, [isTodoPage, allPages, page.id])

  // ── "Link All" — convert unlinked plain-text mentions to [[wikilinks]] ───────
  const handleLinkAll = useCallback(async () => {
    const titleEscaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(`(?<!\\[\\[)${titleEscaped}(?!\\]\\])`, 'gi')

    for (const { page: p, blocks: unlinkedBlocks } of unlinkedRefs) {
      let changed = false
      function replaceInBlock(b: Block): Block {
        let newContent = b.content
        if (unlinkedBlocks.some(ub => ub.id === b.id)) {
          newContent = b.content.replace(regex, `[[${title}]]`)
          if (newContent !== b.content) changed = true
        }
        return { ...b, content: newContent, children: b.children.map(replaceInBlock) }
      }
      const newBlocks = p.blocks.map(replaceInBlock)
      if (changed) {
        await savePage({ ...p, blocks: newBlocks })
      }
    }
  }, [title, unlinkedRefs])

  return (
    <div className={`page-view ${isSidebar ? 'is-sidebar' : ''}`}>
      {/* Breadcrumbs — only shown when zoomed into a block */}
      {zoomStack.length > 0 && (
        <div className="block-breadcrumbs">
          <span className="breadcrumb-item" onClick={() => handleBreadcrumbNav(-1)}>{title}</span>
          {zoomStack.map((frame, i) => (
            <Fragment key={frame.blockId}>
              <span className="breadcrumb-sep">›</span>
              <span
                className={`breadcrumb-item${i === zoomStack.length - 1 ? ' breadcrumb-current' : ''}`}
                onClick={() => handleBreadcrumbNav(i)}
              >
                {frame.blockContent.replace(/\*\*|__|~~|\^\^|`|^#+\s/g, '').slice(0, 50) || 'Block'}
              </span>
            </Fragment>
          ))}
        </div>
      )}
      {/* Page header — hidden when zoomed into a block */}
      {zoomStack.length === 0 && (
      <div className="page-header">
        <div className="page-title-row">
          {isDaily ? (
            <h1 className="page-title daily-title">{title}</h1>
          ) : editingTitle ? (
            <input
              ref={titleInputRef}
              className="page-title-input"
              value={title}
              onChange={e => handleTitleChange(e.target.value)}
              onBlur={() => setEditingTitle(false)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); setEditingTitle(false) } }}
              autoFocus
            />
          ) : (
            <h1 className="page-title editable" onClick={() => setEditingTitle(true)}>
              {title || 'Untitled'}
            </h1>
          )}

          {!isDaily && !isSidebar && (
            <>
              {onToggleStar && (
                <button
                  className={`page-star-btn${page.starred ? ' is-starred' : ''}`}
                  onClick={onToggleStar}
                  title={page.starred ? 'Remove from starred' : 'Star page'}
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M7 1L8.6 4.8L12.7 5.2L9.6 7.8L10.5 11.9L7 9.7L3.5 11.9L4.4 7.8L1.3 5.2L5.4 4.8Z"
                      stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"
                      fill={page.starred ? 'currentColor' : 'none'}/>
                  </svg>
                </button>
              )}
              <button
                className="page-delete-btn"
                onClick={() => setShowDeleteConfirm(true)}
                title="Delete page"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M2 3.5H12M5 3.5V2.5C5 2 5.5 1.5 6 1.5H8C8.5 1.5 9 2 9 2.5V3.5M5.5 6V10.5M8.5 6V10.5M3 3.5L3.5 11.5C3.5 12 4 12.5 4.5 12.5H9.5C10 12.5 10.5 12 10.5 11.5L11 3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                </svg>
              </button>
            </>
          )}
        </div>
      </div>
      )}

      {/* Zoom hero — block protagonist title (shown instead of page header when zoomed) */}
      {zoomStack.length > 0 && (
        <div className="zoom-hero">
          <div className="zoom-hero-title">
            <BlockContent
              content={currentZoomedBlock?.content || zoomStack[zoomStack.length - 1].blockContent || 'Block'}
              allPages={allPages}
              onNavigate={onNavigate}
              onOpenSidebar={onOpenSidebar}
              onNavigateToBlock={onNavigateToBlock}
            />
          </div>
        </div>
      )}

      {/* Scrollable content + references */}
      <div className="page-scroll">
        <div className="page-content">
          <BlockEditor
            blocks={blocks}
            onChange={handleBlocksChange}
            allPages={allPages}
            onNavigate={onNavigate}
            onOpenSidebar={onOpenSidebar}
            scrollToBlockId={scrollToBlockId}
            onClearScrollTarget={onClearScrollTarget}
            zoomedBlockId={zoomedBlockId}
            onZoom={handleZoom}
            onNavigateToBlock={onNavigateToBlock}
            onBlur={handleEditorBlur}
          />
        </div>

        {/* TODO page: show all todo blocks */}
        {isTodoPage && todoRefs.length > 0 && !isSidebar && (
          <LinkedReferences
            backlinks={todoRefs}
            allPages={allPages}
            onNavigate={onNavigate}
            onNavigateToBlock={onNavigateToBlock}
            onToggleBlock={handleToggleBacklinkTodo}
            onEditBlock={handleEditBacklinkBlock}
            title="All To-dos"
          />
        )}

        {/* Linked references */}
        {backlinks.length > 0 && !isSidebar && (
          <LinkedReferences
            backlinks={backlinks}
            allPages={allPages}
            onNavigate={onNavigate}
            onNavigateToBlock={onNavigateToBlock}
            onToggleBlock={handleToggleBacklinkTodo}
            onEditBlock={handleEditBacklinkBlock}
            title="Linked References"
          />
        )}

        {/* Unlinked references */}
        {unlinkedRefs.length > 0 && !isSidebar && (
          <LinkedReferences
            backlinks={unlinkedRefs}
            allPages={allPages}
            onNavigate={onNavigate}
            onNavigateToBlock={onNavigateToBlock}
            onToggleBlock={handleToggleBacklinkTodo}
            onEditBlock={handleEditBacklinkBlock}
            title="Unlinked References"
            onLinkAll={handleLinkAll}
          />
        )}
      </div>

      {showDeleteConfirm && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setShowDeleteConfirm(false) }}>
          <div className="modal-box">
            <h3>Delete page?</h3>
            <p>Delete "<strong>{title}</strong>"? This cannot be undone.</p>
            <div className="modal-actions">
              <button className="modal-btn secondary" onClick={() => setShowDeleteConfirm(false)}>Cancel</button>
              <button className="modal-btn danger" onClick={handleDeletePage}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const WIKILINK_RE = /\[\[([^\]]+)\]\]/g

/** Extract all [[title]] targets from a block tree and create any missing pages. */
function ensureWikilinkPages(blocks: Block[], allPages: Map<string, Page>) {
  const seen = new Set<string>()
  function traverse(list: Block[]) {
    for (const b of list) {
      WIKILINK_RE.lastIndex = 0
      let m
      while ((m = WIKILINK_RE.exec(b.content)) !== null) {
        seen.add(m[1])
      }
      traverse(b.children)
    }
  }
  traverse(blocks)

  for (const rawTitle of seen) {
    const titleLower = rawTitle.toLowerCase().trim()
    if (!titleLower) continue
    const existsById = allPages.has(titleLower)
    const existsByTitle = existsById || Array.from(allPages.values()).some(
      p => p.title.toLowerCase().trim() === titleLower
    )
    if (!existsByTitle) {
      createNewPage(rawTitle, titleLower)
    }
  }
}

function findBlocksWithLink(blocks: Block[], titleLower: string, idLower: string): Block[] {
  const results: Block[] = []
  function traverse(block: Block) {
    const contentLower = block.content.toLowerCase()
    if (contentLower.includes(`[[${titleLower}]]`) || contentLower.includes(`[[${idLower}]]`)) {
      results.push(block)
    }
    block.children.forEach(traverse)
  }
  blocks.forEach(traverse)
  return results
}

function findBlocksWithUnlinkedMention(blocks: Block[], title: string): Block[] {
  const results: Block[] = []
  const titleLower = title.toLowerCase()
  function traverse(block: Block) {
    const contentLower = block.content.toLowerCase()
    if (contentLower.includes(titleLower)) {
      // Strip all [[...]] wikilinks from content before checking for plain mention
      const stripped = block.content.replace(/\[\[[^\]]*\]\]/g, '').toLowerCase()
      if (stripped.includes(titleLower)) results.push(block)
    }
    block.children.forEach(traverse)
  }
  blocks.forEach(traverse)
  return results
}

const TODO_CONTENT_RE = /\{\{\[\[TODO\]\]\}\}|\{\{\[\[DONE\]\]\}\}/i

function findTodoBlocks(blocks: Block[]): Block[] {
  const results: Block[] = []
  function traverse(block: Block) {
    const hasTodoProp = block.checked !== null && block.checked !== undefined
    const hasTodoContent = TODO_CONTENT_RE.test(block.content)
    if (hasTodoProp || hasTodoContent) results.push(block)
    block.children.forEach(traverse)
  }
  blocks.forEach(traverse)
  return results
}
