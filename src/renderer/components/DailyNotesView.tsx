import React, { useEffect, useLayoutEffect, useRef, useCallback, useState, useMemo } from 'react'
import type { Page, Block } from '../../shared/types'
import { BlockEditor } from './BlockEditor'
import { LinkedReferences } from './LinkedReferences'
import { savePage, getOrCreateDailyPage, createNewPage } from '../stores/useStore'
import { generateId, dateToPageId, dateToPageTitle, parseDatePage, findBlocksWithLink, spliceSubtreeIntoPage } from '../utils/helpers'

// Sort backlink pages: daily notes by actual date, others by updatedAt. Newest first.
function sortByPageDate(a: { page: Page }, b: { page: Page }): number {
  const da = parseDatePage(a.page.id)
  const db = parseDatePage(b.page.id)
  if (da && db) return db.getTime() - da.getTime()
  if (da) return -1
  if (db) return 1
  return new Date(b.page.updatedAt).getTime() - new Date(a.page.updatedAt).getTime()
}
import { subDays, format, differenceInCalendarDays } from 'date-fns'
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
  // The feed is a window of days, as offsets from today (0 = today, 1 = yesterday).
  // newestDayOffset > 0 when the feed was opened on an older day: newer days
  // are then loaded on demand as the user scrolls up.
  const [newestDayOffset, setNewestDayOffset] = useState(0)
  const [oldestDayOffset, setOldestDayOffset] = useState(DAYS_TO_LOAD - 1)
  const newestRef = useRef(newestDayOffset)
  newestRef.current = newestDayOffset
  const oldestRef = useRef(oldestDayOffset)
  oldestRef.current = oldestDayOffset
  // scrollHeight before prepending newer days, so the view doesn't jump
  const prependFromHeightRef = useRef<number | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const loadingMoreRef = useRef(false)
  const lastScrollToRef = useRef<string | null | undefined>(undefined)
  const [showFab, setShowFab] = useState(false)

  const today = new Date()
  const todayId = dateToPageId(today)

  const dates: Date[] = []
  for (let i = newestDayOffset; i <= oldestDayOffset; i++) {
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
  }, [newestDayOffset, oldestDayOffset, allPages])

  // Keep the visible content in place after newer days are prepended above it
  useLayoutEffect(() => {
    const container = containerRef.current
    const fromHeight = prependFromHeightRef.current
    if (!container || fromHeight === null) return
    prependFromHeightRef.current = null
    container.scrollTop += container.scrollHeight - fromHeight
  }, [newestDayOffset])

  // Always scroll to top on mount (today is at top)
  useEffect(() => {
    const container = containerRef.current
    if (container) container.scrollTop = 0
  }, [])

  // Scroll to a specific date entry, or to top for today
  useEffect(() => {
    if (scrollToDate === lastScrollToRef.current) return
    if (!scrollToDate) return

    const targetDate = scrollToDate === todayId ? today : parseDatePage(scrollToDate)
    if (targetDate) {
      const offset = differenceInCalendarDays(today, targetDate)
      if (offset < newestRef.current || offset > oldestRef.current) {
        // Open the window a few days above the target so there's room to scroll up
        setNewestDayOffset(offset <= DAYS_TO_LOAD ? Math.min(0, offset) : offset - 3)
        setOldestDayOffset(prev => Math.max(prev, offset + DAYS_TO_LOAD))
        // Don't let the jump itself trigger top/bottom loading
        loadingMoreRef.current = true
        setTimeout(() => { loadingMoreRef.current = false }, 400)
      }
    }

    const timer = setTimeout(() => {
      const container = containerRef.current
      if (!container) return
      // Mark handled only once the scroll actually runs (StrictMode re-runs
      // effects and cancels the first timer).
      lastScrollToRef.current = scrollToDate

      if (scrollToDate === todayId && newestRef.current <= 0) {
        container.scrollTo({ top: 0, behavior: 'smooth' })
        return
      }

      const el = document.getElementById(`daily-${scrollToDate}`)
      if (el) {
        // Instant jump when the window doesn't start at today: a smooth scroll
        // would pass through the top edge and trigger loading newer days.
        el.scrollIntoView({ behavior: newestRef.current > 0 ? 'auto' : 'smooth', block: 'start' })
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

    // Show FAB when user has scrolled past first screenful, or isn't on today's window
    setShowFab(container.scrollTop > 400 || newestRef.current > 0)

    // Near the top of a window that starts before today → load newer days
    if (!loadingMoreRef.current && newestRef.current > 0 && container.scrollTop < 300) {
      loadingMoreRef.current = true
      prependFromHeightRef.current = container.scrollHeight
      setNewestDayOffset(prev => Math.max(0, prev - DAYS_EXTRA))
      setTimeout(() => { loadingMoreRef.current = false }, 200)
      return
    }

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
    if (newestRef.current > 0) {
      // Jump back to a window that starts at today
      setNewestDayOffset(0)
      requestAnimationFrame(() => { if (containerRef.current) containerRef.current.scrollTop = 0 })
      setShowFab(false)
      return
    }
    containerRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  return (
    <div className="daily-notes-view" ref={containerRef}>
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
    const results: { page: Page; matches: ReturnType<typeof findBlocksWithLink> }[] = []
    for (const [, p] of allPages) {
      if (p.id === page.id) continue
      const matches = findBlocksWithLink(p.blocks, pageTitleLower, pageIdLower)
      if (matches.length > 0) results.push({ page: p, matches })
    }
    return results.sort(sortByPageDate)
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

  const handleToggleTodoMarker = useCallback((pageId: string, blockId: string) => {
    const target = allPages.get(pageId)
    if (!target) return
    function updateBlock(bs: Block[]): Block[] {
      return bs.map(b => {
        if (b.id === blockId) {
          const isTodo = b.checked !== null && b.checked !== undefined
          const hasContentTodo = /\{\{\[\[TODO\]\]\}\}|\{\{\[\[DONE\]\]\}\}/i.test(b.content)
          if (isTodo || hasContentTodo) {
            const newContent = b.content
              .replace(/\{\{\[\[TODO\]\]\}\}|{{TODO}}/gi, '')
              .replace(/\{\{\[\[DONE\]\]\}\}|{{DONE}}/gi, '')
              .trim()
            return { ...b, checked: null, content: newContent }
          } else {
            return { ...b, checked: false }
          }
        }
        return { ...b, children: updateBlock(b.children) }
      })
    }
    savePage({ ...target, blocks: updateBlock(target.blocks) })
  }, [allPages])

  const handleSaveRefSubtree = useCallback((pageId: string, matchBlockId: string, editedSubtree: Block[]) => {
    const target = allPages.get(pageId)
    if (!target) return
    savePage({ ...target, blocks: spliceSubtreeIntoPage(target.blocks, matchBlockId, editedSubtree), updatedAt: new Date().toISOString() })
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
            onToggleTodoMarker={handleToggleTodoMarker}
            onSaveRefSubtree={handleSaveRefSubtree}
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
