import React, { useEffect, useRef, useCallback, useState, useMemo } from 'react'
import type { Page, Block } from '../../shared/types'
import { BlockEditor } from './BlockEditor'
import { LinkedReferences } from './LinkedReferences'
import { savePage, getOrCreateDailyPage, createNewPage } from '../stores/useStore'
import { generateId, dateToPageId, dateToPageTitle, parseDatePage, findBlocksWithLink } from '../utils/helpers'
import { subDays, format } from 'date-fns'
import './DailyNotesView.css'

interface Props {
  allPages: Map<string, Page>
  pagesVersion: number
  onNavigate: (id: string, title?: string) => void
  onOpenSidebar: (id: string) => void
  onZoomToBlock: (pageId: string, pageTitle: string, blockId: string) => void
  scrollToDate?: string | null
}

const DAYS_TO_LOAD = 7
const DAYS_EXTRA = 5

export function DailyNotesView({ allPages, pagesVersion, onNavigate, onOpenSidebar, onZoomToBlock, scrollToDate }: Props) {
  const [oldestDayOffset, setOldestDayOffset] = useState(DAYS_TO_LOAD - 1)
  const containerRef = useRef<HTMLDivElement>(null)
  const loadingMoreRef = useRef(false)
  const lastScrollToRef = useRef<string | null | undefined>(undefined)
  const [showFab, setShowFab] = useState(false)

  const today = new Date()
  const todayId = dateToPageId(today)

  const dates: Date[] = []
  for (let i = 0; i <= oldestDayOffset; i++) {
    dates.push(subDays(today, i))
  }

  useEffect(() => {
    dates.forEach(date => {
      const id = dateToPageId(date)
      const title = dateToPageTitle(date)
      if (!allPages.has(id)) {
        getOrCreateDailyPage(id, title)
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oldestDayOffset, allPages])

  // Always scroll to top on mount (today is at top)
  useEffect(() => {
    const container = containerRef.current
    if (container) container.scrollTop = 0
  }, [])

  // Scroll to a specific date entry, or to top for today
  useEffect(() => {
    if (scrollToDate === lastScrollToRef.current) return
    if (!scrollToDate) return
    lastScrollToRef.current = scrollToDate

    const timer = setTimeout(() => {
      const container = containerRef.current
      if (!container) return

      if (scrollToDate === todayId) {
        container.scrollTo({ top: 0, behavior: 'smooth' })
        return
      }

      const el = document.getElementById(`daily-${scrollToDate}`)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      } else {
        container.scrollTo({ top: 0, behavior: 'smooth' })
      }
    }, 80)

    return () => clearTimeout(timer)
  }, [scrollToDate, todayId])

  // Scroll handler: load more at bottom + show/hide floating Today button
  const handleScroll = useCallback(() => {
    const container = containerRef.current
    if (!container) return

    // Show FAB when user has scrolled past first screenful
    setShowFab(container.scrollTop > 400)

    // Near the bottom → load older days
    if (!loadingMoreRef.current) {
      const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight
      if (distanceFromBottom < 300) {
        loadingMoreRef.current = true
        setOldestDayOffset(prev => prev + DAYS_EXTRA)
        // Use a short timeout instead of rAF so the guard stays active long enough
        // for React to re-render the new days before allowing another load.
        setTimeout(() => { loadingMoreRef.current = false }, 200)
      }
    }
  }, [])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => container.removeEventListener('scroll', handleScroll)
  }, [handleScroll])

  const scrollToTop = useCallback(() => {
    containerRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  return (
    <div className="daily-notes-view" ref={containerRef}>
      <div className="daily-notes-header">
        <h1 className="daily-notes-title">Daily Notes</h1>
      </div>
      <div className="daily-notes-list">
        {dates.map(date => {
          const id = dateToPageId(date)
          const title = dateToPageTitle(date)
          const page = allPages.get(id) ?? {
            id, title, blocks: [{ id: generateId(), content: '', children: [], checked: null }],
            createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), isDaily: true,
          }
          return (
            <DayEntry
              key={id}
              page={page}
              allPages={allPages}
              pagesVersion={pagesVersion}
              onNavigate={onNavigate}
              onOpenSidebar={onOpenSidebar}
              onZoomToBlock={onZoomToBlock}
              isToday={id === todayId}
            />
          )
        })}
        <div className="daily-notes-end">
          <button className="load-more-btn" onClick={() => setOldestDayOffset(o => o + DAYS_EXTRA)}>
            Load earlier days…
          </button>
        </div>
      </div>

      {/* Floating Today button */}
      {showFab && (
        <button className="today-fab" onClick={scrollToTop} title="Scroll to Today">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M7 2L7 12M7 2L3 6M7 2L11 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Today
        </button>
      )}
    </div>
  )
}

interface DayEntryProps {
  page: Page
  allPages: Map<string, Page>
  pagesVersion: number
  onNavigate: (id: string, title?: string) => void
  onOpenSidebar: (id: string) => void
  onZoomToBlock: (pageId: string, pageTitle: string, blockId: string) => void
  isToday: boolean
}

function DayEntry({ page, allPages, pagesVersion, onNavigate, onOpenSidebar, onZoomToBlock, isToday }: DayEntryProps) {
  const [blocks, setBlocks] = useState<Block[]>(page.blocks)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const allPagesRef = useRef(allPages)
  allPagesRef.current = allPages
  // Track the last updatedAt we accepted from the store (to detect iCloud-driven updates)
  const lastSyncedAtRef = useRef(page.updatedAt)

  // page.id changed → always sync blocks (navigated to a different page)
  useEffect(() => {
    lastSyncedAtRef.current = page.updatedAt
    setBlocks(page.blocks)
  }, [page.id])  // eslint-disable-line react-hooks/exhaustive-deps

  // page.updatedAt changed → iCloud (or another device) pushed a newer version.
  // Only apply if the user has no pending local save to avoid overwriting unsaved edits.
  useEffect(() => {
    if (page.updatedAt <= lastSyncedAtRef.current) return
    if (saveTimerRef.current) return  // user is actively editing — skip, their save will win
    lastSyncedAtRef.current = page.updatedAt
    setBlocks(page.blocks)
  }, [page.updatedAt, page.blocks])

  const triggerSave = useCallback((newBlocks: Block[]) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null
      const saved = { ...page, blocks: newBlocks }
      lastSyncedAtRef.current = new Date().toISOString()
      savePage(saved)
    }, 500)
  }, [page])

  const blocksRef = useRef(blocks)
  blocksRef.current = blocks

  const handleEditorBlur = useCallback(() => {
    ensureWikilinkPages(blocksRef.current, allPagesRef.current)
  }, [])

  const handleBlocksChange = useCallback((newBlocks: Block[]) => {
    setBlocks(newBlocks)
    triggerSave(newBlocks)
  }, [triggerSave])

  // Bullet click from daily notes → navigate to the page zoomed on that block
  const handleZoom = useCallback((blockId: string) => {
    onZoomToBlock(page.id, page.title, blockId)
  }, [page.id, page.title, onZoomToBlock])

  // Backlinks: blocks from other pages that mention [[this day's title]]
  const backlinks = useMemo(() => {
    const pageTitleLower = page.title.toLowerCase()
    const pageIdLower = page.id.toLowerCase()
    const results: { page: Page; blocks: Block[] }[] = []
    for (const [, p] of allPages) {
      if (p.id === page.id) continue
      const matching = findBlocksWithLink(p.blocks, pageTitleLower, pageIdLower)
      if (matching.length > 0) results.push({ page: p, blocks: matching })
    }
    return results.sort((a, b) => new Date(b.page.updatedAt).getTime() - new Date(a.page.updatedAt).getTime())
  }, [page.id, page.title, allPages, pagesVersion])

  const handleToggleTodo = useCallback((pageId: string, blockId: string) => {
    const target = allPages.get(pageId)
    if (!target) return
    function toggle(bs: Block[]): Block[] {
      return bs.map(b => {
        if (b.id === blockId) {
          const next = b.checked === true ? false : true
          const newContent = b.content
            .replace(/\{\{\[\[TODO\]\]\}\}|{{TODO}}/gi, '')
            .replace(/\{\{\[\[DONE\]\]\}\}|{{DONE}}/gi, '')
            .trim()
          return { ...b, checked: next, content: newContent }
        }
        return { ...b, children: toggle(b.children) }
      })
    }
    savePage({ ...target, blocks: toggle(target.blocks) })
  }, [allPages])

  const handleEditBlock = useCallback((pageId: string, blockId: string, content: string) => {
    const target = allPages.get(pageId)
    if (!target) return
    function update(bs: Block[]): Block[] {
      return bs.map(b => b.id === blockId
        ? { ...b, content, updatedAt: new Date().toISOString() }
        : { ...b, children: update(b.children) })
    }
    savePage({ ...target, blocks: update(target.blocks) })
  }, [allPages])

  const date = parseDatePage(page.id)
  const dayLabel = date ? format(date, 'EEEE') : ''
  const monthLabel = date ? format(date, 'MMMM d, yyyy') : page.title

  return (
    <div
      id={`daily-${page.id}`}
      className={`day-entry ${isToday ? 'is-today' : ''}`}
    >
      <div className="day-entry-header">
        <div className="day-entry-date" onClick={() => onNavigate(page.id, page.title)}>
          <span className="day-fulldate">{monthLabel}</span>
          {isToday && <span className="day-today-badge">Today</span>}
          <span className="day-open-hint">↗</span>
        </div>
        <span className="day-weekday">{dayLabel}</span>
      </div>
      <div className="day-entry-blocks">
        <BlockEditor
          blocks={blocks}
          onChange={handleBlocksChange}
          allPages={allPages}
          onNavigate={onNavigate}
          onOpenSidebar={onOpenSidebar}
          onZoom={handleZoom}
          onNavigateToBlock={onZoomToBlock}
          onBlur={handleEditorBlur}
        />
      </div>
      {backlinks.length > 0 && (
        <div className="day-entry-linked-refs">
          <LinkedReferences
            backlinks={backlinks}
            allPages={allPages}
            onNavigate={onNavigate}
            onNavigateToBlock={onZoomToBlock}
            onToggleBlock={handleToggleTodo}
            onEditBlock={handleEditBlock}
            title="Linked References"
          />
        </div>
      )}
    </div>
  )
}


const WIKILINK_RE = /\[\[([^\]]+)\]\]/g

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
