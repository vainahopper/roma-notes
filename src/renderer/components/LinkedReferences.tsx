import React, { useState, useRef, useCallback } from 'react'
import type { Page, Block } from '../../shared/types'
import { BlockContent } from './BlockContent'
import './LinkedReferences.css'

interface Backlink {
  page: Page
  blocks: Block[]
}

interface Props {
  backlinks: Backlink[]
  allPages: Map<string, Page>
  onNavigate: (id: string, title?: string) => void
  onNavigateToBlock?: (pageId: string, pageTitle: string, blockId: string) => void
  onToggleBlock?: (pageId: string, blockId: string) => void
  onToggleTodoMarker?: (pageId: string, blockId: string) => void
  onEditBlock?: (pageId: string, blockId: string, content: string) => void
  title?: string
  onLinkAll?: () => void
}

export function LinkedReferences({ backlinks, allPages, onNavigate, onNavigateToBlock, onToggleBlock, onToggleTodoMarker, onEditBlock, title = 'Linked References', onLinkAll }: Props) {
  const [open, setOpen] = useState(true)

  return (
    <div className="linked-refs">
      <div className="linked-refs-header-row">
        <button className="linked-refs-header" onClick={() => setOpen(o => !o)}>
          <svg
            width="10" height="10" viewBox="0 0 10 10" fill="none"
            style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 150ms', flexShrink: 0 }}
          >
            <path d="M3 1L7 5L3 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
          <span>{title}</span>
          <span className="refs-count">{backlinks.length}</span>
        </button>
        {onLinkAll && (
          <button className="link-all-btn" onClick={onLinkAll} title="Convert all plain mentions to [[wikilinks]]">
            Link All
          </button>
        )}
      </div>

      {open && (
        <div className="linked-refs-list">
          {backlinks.map(({ page, blocks }) => (
            <BacklinkItem
              key={page.id}
              page={page}
              blocks={blocks}
              allPages={allPages}
              onNavigate={onNavigate}
              onNavigateToBlock={onNavigateToBlock}
              onToggleBlock={onToggleBlock}
              onToggleTodoMarker={onToggleTodoMarker}
              onEditBlock={onEditBlock}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function BacklinkItem({
  page, blocks, allPages, onNavigate, onNavigateToBlock, onToggleBlock, onToggleTodoMarker, onEditBlock,
}: {
  page: Page
  blocks: Block[]
  allPages: Map<string, Page>
  onNavigate: (id: string, title?: string) => void
  onNavigateToBlock?: (pageId: string, pageTitle: string, blockId: string) => void
  onToggleBlock?: (pageId: string, blockId: string) => void
  onToggleTodoMarker?: (pageId: string, blockId: string) => void
  onEditBlock?: (pageId: string, blockId: string, content: string) => void
}) {
  const [open, setOpen] = useState(true)

  return (
    <div className="backlink-item">
      {/* Page title row */}
      <button className="backlink-page-title" onClick={() => onNavigate(page.id, page.title)}>
        <span className="backlink-page-bullet">○</span>
        {page.title}
      </button>

      {/* Toggle button for blocks */}
      {blocks.length > 0 && (
        <button className="backlink-toggle" onClick={() => setOpen(o => !o)} title={open ? 'Collapse' : 'Expand'}>
          <svg
            width="9" height="9" viewBox="0 0 10 10" fill="none"
            style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 150ms' }}
          >
            <path d="M3 1L7 5L3 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
        </button>
      )}

      {/* Block previews with full rendering */}
      {open && (
        <div className="backlink-blocks">
          {blocks.map(block => (
            <BacklinkBlock
              key={block.id}
              block={block}
              page={page}
              allPages={allPages}
              onNavigate={onNavigate}
              onNavigateToBlock={onNavigateToBlock}
              onToggleBlock={onToggleBlock}
              onToggleTodoMarker={onToggleTodoMarker}
              onEditBlock={onEditBlock}
            />
          ))}
        </div>
      )}
    </div>
  )
}

const TODO_RE = /\{\{\[\[TODO\]\]\}\}/i
const DONE_RE = /\{\{\[\[DONE\]\]\}\}/i

function BacklinkBlock({
  block, page, allPages, onNavigate, onNavigateToBlock, onToggleBlock, onToggleTodoMarker, onEditBlock,
}: {
  block: Block
  page: Page
  allPages: Map<string, Page>
  onNavigate: (id: string, title?: string) => void
  onNavigateToBlock?: (pageId: string, pageTitle: string, blockId: string) => void
  onToggleBlock?: (pageId: string, blockId: string) => void
  onToggleTodoMarker?: (pageId: string, blockId: string) => void
  onEditBlock?: (pageId: string, blockId: string, content: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState(block.content)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const hasChildren = block.children.length > 0

  // Sync editValue when block.content changes externally
  React.useEffect(() => {
    if (!editing) setEditValue(block.content)
  }, [block.content, editing])

  // Auto-resize textarea
  const autoResize = useCallback(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = ta.scrollHeight + 'px'
  }, [])

  React.useEffect(() => {
    if (editing) {
      autoResize()
      textareaRef.current?.focus()
      // Place cursor at end
      const len = editValue.length
      textareaRef.current?.setSelectionRange(len, len)
    }
  }, [editing]) // eslint-disable-line react-hooks/exhaustive-deps

  // Determine todo state — support both checked prop (app) and content syntax (Roam)
  let effectiveChecked = block.checked
  if (effectiveChecked === null || effectiveChecked === undefined) {
    if (DONE_RE.test(block.content)) effectiveChecked = true
    else if (TODO_RE.test(block.content)) effectiveChecked = false
  }
  const isTodo = effectiveChecked !== null && effectiveChecked !== undefined

  // Strip inline {{[[TODO]]}} / {{[[DONE]]}} tokens when we're showing a checkbox
  const displayContent = isTodo
    ? block.content.replace(/\{\{\[\[TODO\]\]\}\}|\{\{\[\[DONE\]\]\}\}/gi, '').trim()
    : block.content

  const handleBulletClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (onNavigateToBlock) {
      onNavigateToBlock(page.id, page.title, block.id)
    } else {
      onNavigate(page.id, page.title)
    }
  }

  const handleContentClick = () => {
    if (!onEditBlock) return
    setEditing(true)
    setEditValue(block.content)
  }

  const handleBlur = () => {
    setEditing(false)
    if (editValue !== block.content) {
      onEditBlock?.(page.id, block.id, editValue)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      setEditing(false)
      onToggleTodoMarker?.(page.id, block.id)
      return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      textareaRef.current?.blur()
    }
    if (e.key === 'Escape') {
      setEditValue(block.content) // revert
      setEditing(false)
    }
  }

  return (
    <div className="backlink-block-row">
      <div className="backlink-block-preview">
        {/* Toggle collapse for children */}
        <div className="backlink-toggle-area">
          {hasChildren && (
            <button
              className="backlink-child-toggle"
              onClick={e => { e.stopPropagation(); setExpanded(e => !e) }}
              title={expanded ? 'Collapse' : 'Expand'}
            >
              <svg
                width="8" height="8" viewBox="0 0 8 8" fill="none"
                style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 150ms' }}
              >
                <path d="M2 1L6 4L2 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          )}
        </div>

        {/* Bullet dot — clicking navigates to block */}
        <div className={`backlink-bullet-area${isTodo ? ' todo-bullet-area' : ''}`}>
          {isTodo ? (
            <>
              <span
                className="backlink-bullet-dot backlink-todo-side-bullet backlink-bullet-nav"
                onClick={handleBulletClick}
                title="Go to block"
              />
              <button
                className={`backlink-checkbox${effectiveChecked ? ' checked' : ''}`}
                onClick={e => { e.stopPropagation(); onToggleBlock?.(page.id, block.id) }}
                title={effectiveChecked ? 'Mark as not done' : 'Mark as done'}
              >
                {effectiveChecked ? (
                  <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                    <rect x="0.5" y="0.5" width="13" height="13" rx="3" fill="var(--text-muted)" stroke="var(--text-muted)"/>
                    <path d="M3.5 7L6 9.5L10.5 4.5" stroke="white" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                ) : (
                  <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                    <rect x="0.5" y="0.5" width="13" height="13" rx="3" stroke="var(--border-normal)" strokeWidth="1.5"/>
                  </svg>
                )}
              </button>
            </>
          ) : (
            <span
              className="backlink-bullet-dot backlink-bullet-nav"
              onClick={handleBulletClick}
              title="Go to block"
            />
          )}
        </div>

        {/* Content: editable textarea when editing, rendered content otherwise */}
        {editing ? (
          <textarea
            ref={textareaRef}
            className={`backlink-edit-textarea${isTodo && effectiveChecked ? ' done-text' : ''}`}
            value={editValue}
            onChange={e => { setEditValue(e.target.value); autoResize() }}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
          />
        ) : (
          <div
            className={`backlink-content${isTodo && effectiveChecked ? ' done-text' : ''}${onEditBlock ? ' backlink-content-editable' : ''}`}
            onClick={handleContentClick}
            title={onEditBlock ? 'Click to edit' : undefined}
          >
            <BlockContent
              content={displayContent}
              checked={effectiveChecked}
              allPages={allPages}
              onNavigate={onNavigate}
              onOpenSidebar={() => {}}
            />
          </div>
        )}
      </div>

      {/* Children blocks (indented) */}
      {expanded && hasChildren && (
        <div className="backlink-children">
          {block.children.map(child => (
            <BacklinkBlock
              key={child.id}
              block={child}
              page={page}
              allPages={allPages}
              onNavigate={onNavigate}
              onNavigateToBlock={onNavigateToBlock}
              onToggleBlock={onToggleBlock}
              onToggleTodoMarker={onToggleTodoMarker}
              onEditBlock={onEditBlock}
            />
          ))}
        </div>
      )}
    </div>
  )
}
