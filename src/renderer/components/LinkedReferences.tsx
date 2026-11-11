import React, { useState, useCallback } from 'react'
import type { Page, Block } from '../../shared/types'
import { BlockContent } from './BlockContent'
import { ReferenceBlockEditor } from './ReferenceBlockEditor'
import type { BlockMatch } from '../utils/helpers'
import './LinkedReferences.css'

interface Backlink {
  page: Page
  matches: BlockMatch[]
}

interface Props {
  backlinks: Backlink[]
  allPages: Map<string, Page>
  onNavigate: (id: string, title?: string) => void
  onNavigateToBlock?: (pageId: string, pageTitle: string, blockId: string) => void
  onToggleBlock?: (pageId: string, blockId: string) => void
  onToggleTodoMarker?: (pageId: string, blockId: string) => void
  onSaveRefSubtree?: (pageId: string, matchBlockId: string, editedSubtree: Block[]) => void
  title?: string
  onLinkAll?: () => void
  /** When true, render each source page/day as a large prominent header (TODO page) */
  prominentPageTitle?: boolean
}

export function LinkedReferences({ backlinks, allPages, onNavigate, onNavigateToBlock, onToggleBlock, onToggleTodoMarker, onSaveRefSubtree, title = 'Linked References', onLinkAll, prominentPageTitle = false }: Props) {
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
          {backlinks.map(({ page, matches }) => (
            <BacklinkItem
              key={page.id}
              page={page}
              matches={matches}
              allPages={allPages}
              onNavigate={onNavigate}
              onNavigateToBlock={onNavigateToBlock}
              onToggleBlock={onToggleBlock}
              onToggleTodoMarker={onToggleTodoMarker}
              onSaveRefSubtree={onSaveRefSubtree}
              prominentPageTitle={prominentPageTitle}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function BacklinkItem({
  page, matches, allPages, onNavigate, onNavigateToBlock, onToggleBlock, onToggleTodoMarker, onSaveRefSubtree, prominentPageTitle,
}: {
  page: Page
  matches: BlockMatch[]
  allPages: Map<string, Page>
  onNavigate: (id: string, title?: string) => void
  onNavigateToBlock?: (pageId: string, pageTitle: string, blockId: string) => void
  onToggleBlock?: (pageId: string, blockId: string) => void
  onToggleTodoMarker?: (pageId: string, blockId: string) => void
  onSaveRefSubtree?: (pageId: string, matchBlockId: string, editedSubtree: Block[]) => void
  prominentPageTitle?: boolean
}) {
  const [open, setOpen] = useState(true)

  return (
    <div className="backlink-item">
      {/* Page title row — the day is the primary navigation target (Roam-style) */}
      <button
        className={`backlink-page-title${prominentPageTitle ? ' prominent' : ''}`}
        onClick={() => onNavigate(page.id, page.title)}
        title="Open this day"
      >
        <span className="backlink-page-bullet">○</span>
        <span className="backlink-page-name">{page.title}</span>
        {prominentPageTitle && <span className="backlink-page-open-hint">↗</span>}
      </button>

      {/* Toggle button for blocks */}
      {matches.length > 0 && (
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
          {matches.map(match => (
            <BacklinkMatch
              key={match.block.id}
              match={match}
              page={page}
              allPages={allPages}
              onNavigate={onNavigate}
              onNavigateToBlock={onNavigateToBlock}
              onToggleBlock={onToggleBlock}
              onToggleTodoMarker={onToggleTodoMarker}
              onSaveRefSubtree={onSaveRefSubtree}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function BacklinkMatch({
  match, page, allPages, onNavigate, onNavigateToBlock, onToggleBlock, onToggleTodoMarker, onSaveRefSubtree,
}: {
  match: BlockMatch
  page: Page
  allPages: Map<string, Page>
  onNavigate: (id: string, title?: string) => void
  onNavigateToBlock?: (pageId: string, pageTitle: string, blockId: string) => void
  onToggleBlock?: (pageId: string, blockId: string) => void
  onToggleTodoMarker?: (pageId: string, blockId: string) => void
  onSaveRefSubtree?: (pageId: string, matchBlockId: string, editedSubtree: Block[]) => void
}) {
  const { block, parents } = match
  const handleParentClick = (parent: Block) => {
    if (onNavigateToBlock) onNavigateToBlock(page.id, page.title, parent.id)
    else onNavigate(page.id, page.title)
  }

  return (
    <div className="backlink-match">
      {parents.length > 0 && (
        <div className="backlink-parent-breadcrumb">
          {parents.map((parent, idx) => (
            <React.Fragment key={parent.id}>
              <span
                className="backlink-parent-crumb"
                onClick={() => handleParentClick(parent)}
                title="Go to parent block"
              >
                <BlockContent
                  content={parent.content}
                  allPages={allPages}
                  onNavigate={onNavigate}
                  onOpenSidebar={() => {}}
                />
              </span>
              <span className="backlink-parent-sep">›</span>
            </React.Fragment>
          ))}
        </div>
      )}
      <div>
        <BacklinkBlock
          block={block}
          page={page}
          allPages={allPages}
          onNavigate={onNavigate}
          onNavigateToBlock={onNavigateToBlock}
          onToggleBlock={onToggleBlock}
          onToggleTodoMarker={onToggleTodoMarker}
          onSaveRefSubtree={onSaveRefSubtree}
          initiallyExpanded
        />
      </div>
    </div>
  )
}

const TODO_RE = /\{\{\[\[TODO\]\]\}\}/i
const DONE_RE = /\{\{\[\[DONE\]\]\}\}/i

/** Hover tooltip with created/edited dates — mirrors BlockItem's bullet tooltip */
function BulletDates({ block }: { block: Block }) {
  if (!block.createdAt && !block.updatedAt) return null
  return (
    <span className="block-bullet-tooltip">
      {block.createdAt && <span>Created: {new Date(block.createdAt).toLocaleString()}</span>}
      {block.updatedAt && block.updatedAt !== block.createdAt && <span>Edited: {new Date(block.updatedAt).toLocaleString()}</span>}
    </span>
  )
}

function BacklinkBlock({
  block, page, allPages, onNavigate, onNavigateToBlock, onToggleBlock, onToggleTodoMarker, onSaveRefSubtree, initiallyExpanded,
}: {
  block: Block
  page: Page
  allPages: Map<string, Page>
  onNavigate: (id: string, title?: string) => void
  onNavigateToBlock?: (pageId: string, pageTitle: string, blockId: string) => void
  onToggleBlock?: (pageId: string, blockId: string) => void
  onToggleTodoMarker?: (pageId: string, blockId: string) => void
  onSaveRefSubtree?: (pageId: string, matchBlockId: string, editedSubtree: Block[]) => void
  initiallyExpanded?: boolean
}) {
  const [expanded, setExpanded] = useState(initiallyExpanded ?? false)
  const [editingHere, setEditingHere] = useState(false)
  const hasChildren = block.children.length > 0

  let effectiveChecked = block.checked
  if (effectiveChecked === null || effectiveChecked === undefined) {
    if (DONE_RE.test(block.content)) effectiveChecked = true
    else if (TODO_RE.test(block.content)) effectiveChecked = false
  }
  const isTodo = effectiveChecked !== null && effectiveChecked !== undefined

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
    if (!onSaveRefSubtree) return
    setEditingHere(true)
  }

  const handleSliderChange = useCallback((newContent: string) => {
    onSaveRefSubtree?.(page.id, block.id, [{ ...block, content: newContent }])
  }, [onSaveRefSubtree, page.id, block])

  return (
    <div className="backlink-block-row">
      <div className="backlink-block-preview">
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

        <div className={`backlink-bullet-area${isTodo ? ' todo-bullet-area' : ''}`}>
          {isTodo ? (
            <>
              <span className="backlink-bullet-hover">
                <span
                  className="backlink-bullet-dot backlink-todo-side-bullet backlink-bullet-nav"
                  onClick={handleBulletClick}
                  title="Go to block"
                />
                <BulletDates block={block} />
              </span>
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
            <span className="backlink-bullet-hover">
              <span
                className="backlink-bullet-dot backlink-bullet-nav"
                onClick={handleBulletClick}
                title="Go to block"
              />
              <BulletDates block={block} />
            </span>
          )}
        </div>

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
      </div>

      {expanded && hasChildren && !editingHere && (
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
              onSaveRefSubtree={onSaveRefSubtree}
            />
          ))}
        </div>
      )}
    </div>
  )
}
