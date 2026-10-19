import React, { useState, useMemo, useCallback } from 'react'
import type { Page } from '../../shared/types'
import { ALL_PAGES_VIEW, GRAPH_VIEW } from '../utils/views'
import './Sidebar.css'

declare const __APP_VERSION__: string

interface Props {
  pages: Page[]
  activePageId: string | null
  mainView: string
  onNavigate: (id: string, title?: string) => void
  onShowDailyNotes: () => void
  onShowAllPages: () => void
  onShowGraph: () => void
  onShowSettings?: () => void
  pagesExpanded: boolean
  onTogglePagesExpanded: () => void
  onToggleStar: (pageId: string) => void
  onDeletePage: (pageId: string) => void
  starredOrder?: string[]
  onReorderStarred?: (newOrder: string[]) => void
  updateVersion?: string | null
  onShowUpdateDialog?: () => void
  appVersion?: string
  syncStatus?: string | null
}

export function Sidebar({
  pages, activePageId, mainView, onNavigate, onShowDailyNotes, onShowAllPages, onShowGraph,
  pagesExpanded, onTogglePagesExpanded, onToggleStar, onDeletePage, starredOrder,
  onReorderStarred, updateVersion, onShowUpdateDialog, appVersion, syncStatus, onShowSettings,
}: Props) {
  const [filterText, setFilterText] = useState('')
  const [starredExpanded, setStarredExpanded] = useState(true)
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState<{ id: string; pos: 'before' | 'after' } | null>(null)

  const isDailyActive = mainView === 'daily'

  const regularPages = useMemo(() => {
    const filter = filterText.toLowerCase()
    return pages
      .filter(p => !p.isDaily && (!filter || p.title.toLowerCase().includes(filter)))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  }, [pages, filterText])

  const starredPages = useMemo(() => {
    return regularPages.filter(p => p.starred)
  }, [regularPages])

  // Sort starred pages by persisted order
  const orderedStarredPages = useMemo(() => {
    if (!starredOrder || starredOrder.length === 0) return starredPages
    const orderMap = new Map(starredOrder.map((id, i) => [id, i]))
    return [...starredPages].sort((a, b) => {
      const ai = orderMap.has(a.id) ? orderMap.get(a.id)! : 9999
      const bi = orderMap.has(b.id) ? orderMap.get(b.id)! : 9999
      return ai - bi
    })
  }, [starredPages, starredOrder])

  // ─── Drag handlers ───────────────────────────────────────────
  const handleDragStart = useCallback((id: string, e: React.DragEvent) => {
    setDraggedId(id)
    e.dataTransfer.effectAllowed = 'move'
  }, [])

  const handleDragEnd = useCallback(() => {
    setDraggedId(null)
    setDragOver(null)
  }, [])

  const handleDragOver = useCallback((id: string, e: React.DragEvent) => {
    e.preventDefault()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const pos: 'before' | 'after' = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
    setDragOver(prev => (prev?.id === id && prev?.pos === pos ? prev : { id, pos }))
  }, [])

  const handleDragLeave = useCallback(() => {
    setDragOver(null)
  }, [])

  const handleDrop = useCallback((targetId: string, e: React.DragEvent) => {
    e.preventDefault()
    if (!draggedId || draggedId === targetId || !onReorderStarred) return
    const currentOrder = orderedStarredPages.map(p => p.id)
    const newOrder = [...currentOrder]
    const fromIdx = newOrder.indexOf(draggedId)
    if (fromIdx === -1) return
    newOrder.splice(fromIdx, 1)
    const newTargetIdx = newOrder.indexOf(targetId)
    if (newTargetIdx === -1) return
    const insertIdx = dragOver?.pos === 'after' ? newTargetIdx + 1 : newTargetIdx
    newOrder.splice(insertIdx, 0, draggedId)
    onReorderStarred(newOrder)
    setDraggedId(null)
    setDragOver(null)
  }, [draggedId, dragOver, orderedStarredPages, onReorderStarred])

  return (
    <div className="sidebar">
      {/* Primary navigation — Roam-style: Daily Notes highlighted, then All Pages + Graph */}
      <nav className="sidebar-nav">
        <button
          className={`sidebar-nav-item daily ${isDailyActive ? 'active' : ''}`}
          onClick={onShowDailyNotes}
        >
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
            <rect x="1.5" y="2.5" width="12" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
            <line x1="1.5" y1="6" x2="13.5" y2="6" stroke="currentColor" strokeWidth="1.3"/>
            <line x1="4.5" y1="1" x2="4.5" y2="4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            <line x1="10.5" y1="1" x2="10.5" y2="4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            <rect x="4" y="8.3" width="2.2" height="2.2" rx="0.4" fill="currentColor"/>
          </svg>
          Daily Notes
        </button>
        <button
          className={`sidebar-nav-item ${mainView === ALL_PAGES_VIEW ? 'active' : ''}`}
          onClick={onShowAllPages}
        >
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
            <line x1="5" y1="3.5" x2="13" y2="3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            <line x1="5" y1="7.5" x2="13" y2="7.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            <line x1="5" y1="11.5" x2="13" y2="11.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            <circle cx="2.2" cy="3.5" r="0.9" fill="currentColor"/>
            <circle cx="2.2" cy="7.5" r="0.9" fill="currentColor"/>
            <circle cx="2.2" cy="11.5" r="0.9" fill="currentColor"/>
          </svg>
          All Pages
        </button>
        <button
          className={`sidebar-nav-item ${mainView === GRAPH_VIEW ? 'active' : ''}`}
          onClick={onShowGraph}
        >
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
            <circle cx="3.5" cy="4" r="1.8" stroke="currentColor" strokeWidth="1.2"/>
            <circle cx="11.5" cy="3.5" r="1.8" stroke="currentColor" strokeWidth="1.2"/>
            <circle cx="7.5" cy="11.5" r="1.8" stroke="currentColor" strokeWidth="1.2"/>
            <line x1="5.2" y1="4.2" x2="9.7" y2="3.7" stroke="currentColor" strokeWidth="1.1"/>
            <line x1="4.4" y1="5.6" x2="6.6" y2="9.9" stroke="currentColor" strokeWidth="1.1"/>
            <line x1="10.6" y1="5.1" x2="8.4" y2="9.9" stroke="currentColor" strokeWidth="1.1"/>
          </svg>
          Graph
        </button>
      </nav>

      {/* Filter */}
      <div className="sidebar-filter">
        <svg width="13" height="13" viewBox="0 0 15 15" fill="none" className="filter-icon">
          <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.2"/>
          <line x1="9.5" y1="9.5" x2="13.5" y2="13.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
        </svg>
        <input type="text" placeholder="Filter pages…" value={filterText}
          onChange={e => setFilterText(e.target.value)} className="filter-input" />
        {filterText && <button className="filter-clear" onClick={() => setFilterText('')}>×</button>}
      </div>

      {/* Page list */}
      <div className="sidebar-list">

        {/* Starred section — only visible when there are starred pages */}
        {orderedStarredPages.length > 0 && (
          <div className="sidebar-section">
            <button className="sidebar-section-header" onClick={() => setStarredExpanded(e => !e)}>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none"
                style={{ transform: starredExpanded ? 'rotate(90deg)' : 'none', transition: 'transform 150ms' }}>
                <path d="M3 1L7 5L3 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
              </svg>
              <svg width="11" height="11" viewBox="0 0 14 14" fill="none" className="section-star-icon">
                <path d="M7 1L8.6 4.8L12.7 5.2L9.6 7.8L10.5 11.9L7 9.7L3.5 11.9L4.4 7.8L1.3 5.2L5.4 4.8Z"
                  stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" fill="currentColor"/>
              </svg>
              <span>Starred</span>
              <span className="section-count">{orderedStarredPages.length}</span>
            </button>

            {starredExpanded && (
              <div className="sidebar-items">
                {orderedStarredPages.map(page => (
                  <SidebarItem
                    key={page.id}
                    page={page}
                    isActive={!isDailyActive && page.id === activePageId}
                    onClick={() => onNavigate(page.id, page.title)}
                    onToggleStar={onToggleStar}
                    onDeletePage={onDeletePage}
                    draggable
                    isDragging={draggedId === page.id}
                    dragOverPos={dragOver?.id === page.id ? dragOver.pos : undefined}
                    onDragStart={e => handleDragStart(page.id, e)}
                    onDragEnd={handleDragEnd}
                    onDragOver={e => handleDragOver(page.id, e)}
                    onDragLeave={handleDragLeave}
                    onDrop={e => handleDrop(page.id, e)}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* All pages section */}
        <div className="sidebar-section">
          <button className="sidebar-section-header" onClick={onTogglePagesExpanded}>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none"
              style={{ transform: pagesExpanded ? 'rotate(90deg)' : 'none', transition: 'transform 150ms' }}>
              <path d="M3 1L7 5L3 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
            <span>Pages</span>
            <span className="section-count">{regularPages.length}</span>
          </button>

          {pagesExpanded && (
            <div className="sidebar-items">
              {regularPages.map(page => (
                <SidebarItem key={page.id} page={page}
                  isActive={!isDailyActive && page.id === activePageId}
                  onClick={() => onNavigate(page.id, page.title)}
                  onToggleStar={onToggleStar}
                  onDeletePage={onDeletePage} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Bottom: update badge + sync status + version */}
      <div className="sidebar-bottom">
        {updateVersion && (
          <button className="sidebar-update-btn" onClick={onShowUpdateDialog} title={`Update to v${updateVersion}`}>
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
              <path d="M7 2v8M7 2L4 5M7 2l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
              <line x1="2" y1="12" x2="12" y2="12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
            Update available — v{updateVersion}
          </button>
        )}
        {syncStatus && (
          <div className="sidebar-sync-status">{syncStatus}</div>
        )}
        <div className="sidebar-bottom-row">
          {onShowSettings && (
            <button className="sidebar-settings-btn" onClick={onShowSettings} title="Settings (⌘,)">
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="2.2" stroke="currentColor" strokeWidth="1.3"/>
                <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              </svg>
              Settings
            </button>
          )}
          <div className="sidebar-version">v{appVersion ?? __APP_VERSION__}</div>
        </div>
      </div>
    </div>
  )
}

function SidebarItem({ page, isActive, onClick, onToggleStar, onDeletePage, draggable: isDraggable, isDragging, dragOverPos, onDragStart, onDragEnd, onDragOver, onDragLeave, onDrop }:
  {
    page: Page
    isActive: boolean
    onClick: () => void
    onToggleStar: (id: string) => void
    onDeletePage: (id: string) => void
    draggable?: boolean
    isDragging?: boolean
    dragOverPos?: 'before' | 'after'
    onDragStart?: (e: React.DragEvent) => void
    onDragEnd?: () => void
    onDragOver?: (e: React.DragEvent) => void
    onDragLeave?: () => void
    onDrop?: (e: React.DragEvent) => void
  }) {
  const className = [
    'sidebar-item',
    isActive ? 'active' : '',
    page.starred ? 'starred' : '',
    isDragging ? 'dragging' : '',
    dragOverPos === 'before' ? 'drop-before' : '',
    dragOverPos === 'after' ? 'drop-after' : '',
  ].filter(Boolean).join(' ')

  return (
    <div
      className={className}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } }}
      draggable={isDraggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {isDraggable ? (
        <span className="sidebar-drag-handle" title="Drag to reorder">
          <svg width="8" height="12" viewBox="0 0 8 12" fill="none">
            <circle cx="2" cy="2" r="1.2" fill="currentColor"/>
            <circle cx="6" cy="2" r="1.2" fill="currentColor"/>
            <circle cx="2" cy="6" r="1.2" fill="currentColor"/>
            <circle cx="6" cy="6" r="1.2" fill="currentColor"/>
            <circle cx="2" cy="10" r="1.2" fill="currentColor"/>
            <circle cx="6" cy="10" r="1.2" fill="currentColor"/>
          </svg>
        </span>
      ) : (
        <span className="sidebar-item-icon">○</span>
      )}
      <span className="sidebar-item-title">{page.title}</span>
      <button
        className="sidebar-delete-btn"
        onClick={e => { e.stopPropagation(); onDeletePage(page.id) }}
        title="Delete page"
        tabIndex={-1}
      >
        <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
          <path d="M2 3.5H12M5 3.5V2.5C5 2 5.5 1.5 6 1.5H8C8.5 1.5 9 2 9 2.5V3.5M5.5 6V10.5M8.5 6V10.5M3 3.5L3.5 11.5C3.5 12 4 12.5 4.5 12.5H9.5C10 12.5 10.5 12 10.5 11.5L11 3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
        </svg>
      </button>
      <button
        className={`sidebar-star-btn${page.starred ? ' is-starred' : ''}`}
        onClick={e => { e.stopPropagation(); onToggleStar(page.id) }}
        title={page.starred ? 'Remove from starred' : 'Star'}
        tabIndex={-1}
      >
        <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
          <path d="M7 1L8.6 4.8L12.7 5.2L9.6 7.8L10.5 11.9L7 9.7L3.5 11.9L4.4 7.8L1.3 5.2L5.4 4.8Z"
            stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"
            fill={page.starred ? 'currentColor' : 'none'}/>
        </svg>
      </button>
    </div>
  )
}
