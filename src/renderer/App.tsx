import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Sidebar } from './components/Sidebar'
import { PageView } from './components/PageView'
import { DailyNotesView } from './components/DailyNotesView'
import { SearchModal } from './components/SearchModal'
import { ImportModal } from './components/ImportModal'
import { CalendarModal } from './components/CalendarModal'
import { TitleBar } from './components/TitleBar'
import { MobileBottomBar } from './components/MobileBottomBar'
import { MobileKeyboardToolbar } from './components/MobileKeyboardToolbar'
import { loadAllPages, retryLoad, useStore, createNewPage, getOrCreateDailyPage, savePage, deletePage, mergeSyncedPages, forceReloadPages } from './stores/useStore'
import { todayPageId, todayPageTitle } from './utils/helpers'
import { buildSearchIndex } from './utils/search'
import type { Block, ZoomFrame } from '../shared/types'
import { platform } from './platform'
import './styles/app.css'
import './styles/mobile.css'

type MainView = 'daily' | string
type ThemeMode = 'dark' | 'light' | 'system'

/** Returns the full ancestor path (inclusive) from page root to the target block. */
function findBlockPath(id: string, blocks: Block[], path: ZoomFrame[] = []): ZoomFrame[] | null {
  for (const b of blocks) {
    const next: ZoomFrame[] = [...path, { blockId: b.id, blockContent: b.content }]
    if (b.id === id) return next
    const found = findBlockPath(id, b.children ?? [], next)
    if (found) return found
  }
  return null
}

function getEffectiveTheme(mode: ThemeMode): 'dark' | 'light' {
  if (mode === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return mode
}

export default function App() {
  const store = useStore()
  const [mainView, setMainView] = useState<MainView>('daily')
  const [scrollToDate, setScrollToDate] = useState<string | null>(null)
  const [sidebarPageId, setSidebarPageId] = useState<string | null>(null)
  const [showSearch, setShowSearch] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [showCalendar, setShowCalendar] = useState(false)
  const [themeMode, setThemeMode] = useState<ThemeMode>('system')
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth > 768)
  const [pagesExpanded, setPagesExpanded] = useState(true)
  const [updateInfo, setUpdateInfo] = useState<{ version: string } | null>(null)
  const [updateProgress, setUpdateProgress] = useState<{ step: string; pct: number; error?: string } | null>(null)
  const [scrollToBlockId, setScrollToBlockId] = useState<string | null>(null)
  const [starredOrder, setStarredOrder] = useState<string[]>([])
  const [blockZoom, setBlockZoom] = useState<ZoomFrame[] | null>(null)
  const [syncStatus, setSyncStatus] = useState<string | null>(null)

  // Track last known date to detect day changes on focus
  const lastKnownDateRef = useRef(todayPageId())

  // Navigation history for back/forward
  const historyRef = useRef<MainView[]>(['daily'])
  const historyIdxRef = useRef(0)
  const [canBack, setCanBack] = useState(false)
  const [canForward, setCanForward] = useState(false)

  function pushHistory(view: MainView) {
    const history = historyRef.current.slice(0, historyIdxRef.current + 1)
    history.push(view)
    historyRef.current = history
    historyIdxRef.current = history.length - 1
    setCanBack(historyIdxRef.current > 0)
    setCanForward(false)
  }

  function goBack() {
    if (historyIdxRef.current <= 0) return
    historyIdxRef.current -= 1
    const view = historyRef.current[historyIdxRef.current]
    setMainView(view)
    setCanBack(historyIdxRef.current > 0)
    setCanForward(true)
  }

  function goForward() {
    if (historyIdxRef.current >= historyRef.current.length - 1) return
    historyIdxRef.current += 1
    const view = historyRef.current[historyIdxRef.current]
    setMainView(view)
    setCanBack(true)
    setCanForward(historyIdxRef.current < historyRef.current.length - 1)
  }

  // Load pages + saved theme on startup
  useEffect(() => {
    loadAllPages().then(() => {
      getOrCreateDailyPage(todayPageId(), todayPageTitle())
      setMainView('daily')
    })
    // Load saved theme + UI state
    platform.getSettings().then((settings: any) => {
      if (settings?.theme) setThemeMode(settings.theme)
      if (settings?.sidebarOpen !== undefined && window.innerWidth > 768) setSidebarOpen(settings.sidebarOpen)
      if (settings?.pagesExpanded !== undefined) setPagesExpanded(settings.pagesExpanded)
      if (Array.isArray(settings?.starredOrder)) setStarredOrder(settings.starredOrder)
    })
    // Check for live web asset updates on iPhone.
    // Dense retries early (iCloud can take 1-5min to propagate) then taper off.
    // Also retries every time the app comes back to foreground.
    // If an update is found and applied, the page reloads automatically.
    if (platform.isCapacitor()) {
      // Start at 10s (iCloud needs init time), dense in 30s-3min window
      // (iCloud propagation typically 1-5min), then taper off.
      const checks = [10000, 30000, 60000, 90000, 2 * 60000, 3 * 60000, 5 * 60000, 10 * 60000]
      const timers = checks.map(ms => setTimeout(() => platform.checkForUpdates(), ms))
      // After the initial burst, keep checking every 5 minutes indefinitely.
      // iCloud sync can be slow (5-15min), so we need ongoing coverage.
      const periodicTimer = setInterval(() => platform.checkForUpdates(), 5 * 60000)
      const onForeground = () => {
        if (document.visibilityState === 'visible') platform.checkForUpdates()
      }
      document.addEventListener('visibilitychange', onForeground)
      return () => {
        timers.forEach(t => clearTimeout(t))
        clearInterval(periodicTimer)
        document.removeEventListener('visibilitychange', onForeground)
      }
    }
  }, [])

  useEffect(() => {
    if (store.loaded) buildSearchIndex(Array.from(store.pages.values()))
  }, [store.pagesVersion, store.loaded])

  // Apply theme + listen for system changes
  useEffect(() => {
    const effective = getEffectiveTheme(themeMode)
    document.documentElement.setAttribute('data-theme', effective)

    if (themeMode === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      const handler = (e: MediaQueryListEvent) => {
        document.documentElement.setAttribute('data-theme', e.matches ? 'dark' : 'light')
      }
      mq.addEventListener('change', handler)
      return () => mq.removeEventListener('change', handler)
    }
  }, [themeMode])

  const handleToggleTheme = useCallback(() => {
    setThemeMode(prev => {
      const next: ThemeMode = prev === 'dark' ? 'light' : prev === 'light' ? 'system' : 'dark'
      platform.getSettings().then((s: any) => {
        platform.saveSettings({ ...s, theme: next })
      })
      return next
    })
  }, [])

  useEffect(() => {
    if (!platform.isElectron()) return
    platform.onMenuEvent((event: string) => {
      if (event === 'menu:new-page') handleNewPage()
      if (event === 'menu:today') handleToday()
      if (event === 'menu:import') setShowImport(true)
      if (event === 'menu:search') setShowSearch(true)
    })
    return () => platform.removeMenuListeners()
  }, [])

  // Listen for update events from main process
  useEffect(() => {
    if (!platform.isElectron()) return
    platform.onUpdateAvailable((info: { version: string }) => setUpdateInfo(info))
    platform.onUpdateProgress((info: { step: string; pct: number; error?: string }) => setUpdateProgress(info))
    return () => platform.removeUpdateListeners()
  }, [])

  // Track last user interaction for activity-aware sync
  const lastInteractionRef = useRef(Date.now())

  // iCloud sync: reload pages when remote changes arrive
  useEffect(() => {
    // Electron: show startup sync status, then listen for ongoing changes
    if (platform.isElectron()) {
      let clearTimer: ReturnType<typeof setTimeout> | null = null

      const clearAfter = (ms: number) => {
        if (clearTimer) clearTimeout(clearTimer)
        clearTimer = setTimeout(() => setSyncStatus(null), ms)
      }

      // Startup pull: silent unless something actually changed or failed
      platform.syncPull().then(result => {
        if (result.merged > 0) {
          forceReloadPages()
          setSyncStatus(`iCloud: ${result.merged} updated`)
          clearAfter(3000)
        } else {
          setSyncStatus(null)
        }
      }).catch(() => {
        setSyncStatus('iCloud: unavailable')
        clearAfter(3000)
      })

      // Ongoing: file watcher in main process sends this when iPhone changes arrive
      platform.onSyncUpdated(() => {
        setSyncStatus('↓ Syncing with iCloud…')
        forceReloadPages()
        clearAfter(2500)
      })

      return () => {
        platform.removeSyncListeners()
        if (clearTimer) clearTimeout(clearTimer)
      }
    }
    // Capacitor: diagnose first (lightweight), then pull pages sequentially
    if (platform.isCapacitor()) {
      let cancelled = false
      let pendingPlaceholders = 0
      let totalSynced = 0
      let pullInProgress = false
      let iCloudReady = false

      // Lightweight diagnose: checks token + container, NO file listing
      const runDiagnose = async (): Promise<boolean> => {
        try {
          const plugin = (window as any).Capacitor?.Plugins?.RomaCloudSync
          if (!plugin) {
            setSyncStatus('iCloud: plugin not found!')
            return false
          }
          // Diagnose silently — only surface errors to the user
          const diag = await Promise.race([
            plugin.diagnose(),
            new Promise<any>((_, rej) => setTimeout(() => rej(new Error('timeout')), 15000))
          ])
          console.log('[Roma] diagnose:', JSON.stringify(diag))
          if (!diag.hasToken) {
            setSyncStatus('iCloud: not signed in — check Settings')
            return false
          }
          if (!diag.hasContainer) {
            setSyncStatus('iCloud: container unavailable — check iCloud Drive')
            return false
          }
          return true
        } catch (e: any) {
          console.error('[Roma] diagnose error:', e)
          setSyncStatus(`iCloud: ${e?.message ?? 'connection failed'}`)
          return false
        }
      }

      const pullSync = async () => {
        if (pullInProgress || !iCloudReady || cancelled) return
        pullInProgress = true
        try {
          console.log('[Roma] pullSync start')
          const result = await platform.syncPull()
          if (cancelled) return
          console.log('[Roma] pullSync: merged=' + result.merged +
            ' pages=' + result.pages.length +
            ' placeholders=' + (result.placeholders ?? 0) +
            (result.error ? ' error=' + result.error : ''))
          if (result.merged > 0) {
            // syncPull already did proper conflict resolution (incl. content-based logic)
            // and wrote the winning pages to IndexedDB. Re-read IndexedDB as ground truth
            // instead of using mergeSyncedPages(), which has a timestamp guard that can
            // silently skip updates when the cloud page has an older timestamp than an
            // in-memory placeholder (e.g. auto-created empty daily note with updatedAt=now).
            await forceReloadPages()
            totalSynced += result.merged
          }
          pendingPlaceholders = result.placeholders ?? 0
          if (result.error) {
            setSyncStatus(`iCloud: ${result.error}`)
          } else if (pendingPlaceholders > 0) {
            // Still downloading files — show progress
            setSyncStatus(`iCloud: ${pendingPlaceholders} downloading…`)
          } else if (result.merged > 0) {
            // New pages arrived — show briefly then clear
            setSyncStatus(`iCloud: ${result.merged} updated`)
            setTimeout(() => setSyncStatus(null), 3000)
          } else {
            // Nothing changed — stay silent
            setSyncStatus(null)
          }
        } finally {
          pullInProgress = false
        }
      }

      // Sequential startup: diagnose THEN first pull (never concurrent)
      const startup = async () => {
        iCloudReady = await runDiagnose()
        if (iCloudReady && !cancelled) {
          await pullSync()
        }
      }
      startup()

      // Track activity
      const markActive = () => { lastInteractionRef.current = Date.now() }
      window.addEventListener('touchstart', markActive, { passive: true })
      window.addEventListener('keydown', markActive, { passive: true })
      window.addEventListener('pointerdown', markActive, { passive: true })
      // Pull on app resume
      const onVisible = () => {
        if (document.visibilityState === 'visible') {
          markActive()
          pullSync()
        }
      }
      document.addEventListener('visibilitychange', onVisible)
      // Adaptive polling: 5s when downloading, 30s when idle
      const ACTIVE_WINDOW = 5 * 60 * 1000
      const interval = setInterval(() => {
        if (Date.now() - lastInteractionRef.current > ACTIVE_WINDOW) return
        if (pendingPlaceholders > 0) {
          pullSync()
        }
      }, 5 * 1000)
      const slowInterval = setInterval(() => {
        if (pendingPlaceholders === 0 && Date.now() - lastInteractionRef.current < ACTIVE_WINDOW) {
          pullSync()
        }
      }, 30 * 1000)
      return () => {
        cancelled = true
        window.removeEventListener('touchstart', markActive)
        window.removeEventListener('keydown', markActive)
        window.removeEventListener('pointerdown', markActive)
        document.removeEventListener('visibilitychange', onVisible)
        clearInterval(interval)
        clearInterval(slowInterval)
      }
    }
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setShowSearch(true) }
      if ((e.metaKey || e.ctrlKey) && e.key === 'd') { e.preventDefault(); handleToday() }
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') { e.preventDefault(); handleNewPage() }
      if ((e.metaKey || e.ctrlKey) && e.key === '[') { e.preventDefault(); goBack() }
      if ((e.metaKey || e.ctrlKey) && e.key === ']') { e.preventDefault(); goForward() }
      if (e.key === 'Escape') { setShowSearch(false); setShowImport(false); setShowCalendar(false) }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // Detect day changes when the app comes back to foreground
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') return
      const currentDay = todayPageId()
      if (currentDay !== lastKnownDateRef.current) {
        lastKnownDateRef.current = currentDay
        getOrCreateDailyPage(currentDay, todayPageTitle())
        if (mainView === 'daily') {
          setScrollToDate(currentDay)
          setTimeout(() => setScrollToDate(null), 600)
        }
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [mainView])

  const handleToday = useCallback(() => {
    getOrCreateDailyPage(todayPageId(), todayPageTitle())
    const todayId = todayPageId()
    pushHistory('daily')
    setMainView('daily')
    setScrollToDate(todayId)
    setTimeout(() => setScrollToDate(null), 600)
  }, [])

  const handleShowDailyNotes = useCallback(() => {
    setBlockZoom(null)
    pushHistory('daily')
    setMainView('daily')
  }, [])

  const handleNewPage = useCallback(() => {
    setBlockZoom(null)
    const page = createNewPage('Untitled')
    pushHistory(page.id)
    setMainView(page.id)
  }, [])

  const handleNavigateTo = useCallback((pageId: string, pageTitle?: string, openStandalone = false, keepZoom = false) => {
    let page = store.pages.get(pageId)
    let actualPageId = pageId

    // If not found by ID, search by title (case-insensitive) to prevent duplicates.
    // Pages created via ⌘N have slug-based IDs (e.g. "claude-abc123") while
    // wikilinks generate lowercase IDs (e.g. "claude"), so the lookup above may
    // miss an existing page.
    if (!page && pageTitle) {
      const titleLower = pageTitle.toLowerCase().trim()
      const existing = Array.from(store.pages.values()).find(
        p => p.title.toLowerCase().trim() === titleLower
      )
      if (existing) {
        page = existing
        actualPageId = existing.id
      }
    }

    const isDaily = page?.isDaily || (pageTitle && isDateLike(pageTitle))

    if (isDaily) {
      if (openStandalone) {
        if (pageTitle) getOrCreateDailyPage(pageId, pageTitle)
        pushHistory(pageId)
        setMainView(pageId)
      } else {
        if (pageTitle) getOrCreateDailyPage(pageId, pageTitle)
        pushHistory('daily')
        setMainView('daily')
        setScrollToDate(pageId)
        setTimeout(() => setScrollToDate(null), 600)
      }
    } else {
      if (!page && pageTitle) createNewPage(pageTitle, pageId)
      pushHistory(actualPageId)
      setMainView(actualPageId)
    }
    if (!keepZoom) setBlockZoom(null)

    // Track visit history in localStorage for search "Recent" ordering
    try {
      const key = 'roma-recent-pages'
      const prev: string[] = JSON.parse(localStorage.getItem(key) ?? '[]')
      const next = [actualPageId, ...prev.filter(id => id !== actualPageId)].slice(0, 20)
      localStorage.setItem(key, JSON.stringify(next))
    } catch {}
  }, [store.pages])

  /** Navigate to a specific block within a page, opening it with breadcrumbs. */
  const handleZoomToBlock = useCallback((pageId: string, pageTitle: string, blockId: string) => {
    const page = store.pages.get(pageId)
    const path = page ? findBlockPath(blockId, page.blocks) : null
    setBlockZoom(path ?? [{ blockId, blockContent: '' }])
    handleNavigateTo(pageId, pageTitle, true, true)
  }, [store.pages, handleNavigateTo])

  const handleNavigateToContent = useCallback((pageId: string, pageTitle?: string) => {
    handleNavigateTo(pageId, pageTitle, true)
  }, [handleNavigateTo])

  const handleNavigateToSidebar = useCallback((pageId: string, pageTitle?: string) => {
    handleNavigateTo(pageId, pageTitle, false)
  }, [handleNavigateTo])

  // Open in right sidebar (Shift+click)
  const handleOpenSidebar = useCallback((pageId: string) => {
    setSidebarPageId(pageId)
  }, [])

  const handlePageDeleted = useCallback((pageId: string) => {
    if (mainView === pageId) {
      pushHistory('daily')
      setMainView('daily')
    }
  }, [mainView])

  const handleSidebarDeletePage = useCallback(async (pageId: string) => {
    await deletePage(pageId)
    if (mainView === pageId) {
      pushHistory('daily')
      setMainView('daily')
    }
  }, [mainView])

  const handleCalendarNavigate = useCallback((pageId: string, pageTitle: string) => {
    handleNavigateTo(pageId, pageTitle, true)
    setShowCalendar(false)
  }, [handleNavigateTo])

  const handleSearchNavigate = useCallback((pageId: string, pageTitle: string, blockId?: string) => {
    if (blockId) {
      handleZoomToBlock(pageId, pageTitle, blockId)
    } else {
      handleNavigateTo(pageId, pageTitle, true)
    }
    setShowSearch(false)
  }, [handleNavigateTo, handleZoomToBlock])

  const handleNavigateToBlock = useCallback((pageId: string, pageTitle: string, blockId: string) => {
    handleZoomToBlock(pageId, pageTitle, blockId)
  }, [handleZoomToBlock])

  const handleToggleStar = useCallback((pageId: string) => {
    const p = store.pages.get(pageId)
    if (!p) return
    const willStar = !p.starred
    savePage({ ...p, starred: willStar })
    setStarredOrder(prev => {
      const next = willStar
        ? [pageId, ...prev.filter(id => id !== pageId)]
        : prev.filter(id => id !== pageId)
      platform.getSettings().then((s: any) => platform.saveSettings({ ...s, starredOrder: next }))
      return next
    })
  }, [store.pages])

  const handleReorderStarred = useCallback((newOrder: string[]) => {
    setStarredOrder(newOrder)
    platform.getSettings().then((s: any) => platform.saveSettings({ ...s, starredOrder: newOrder }))
  }, [])

  const activePageId = mainView !== 'daily' ? mainView : null
  const activePage = activePageId ? store.pages.get(activePageId) : null
  const sidebarPage = sidebarPageId ? store.pages.get(sidebarPageId) : null
  const isDailyView = mainView === 'daily'
  const effectiveTheme = getEffectiveTheme(themeMode)

  if (store.loadError) {
    return (
      <div className="app-loading">
        <span>Failed to load notes.</span>
        <button style={{ marginTop: 12 }} onClick={retryLoad}>Retry</button>
      </div>
    )
  }

  if (!store.loaded) {
    return (
      <div className="app-loading">
        <div className="loading-spinner" />
        <span>Loading…</span>
      </div>
    )
  }

  return (
    <div className="app-root">
      <TitleBar
        theme={effectiveTheme}
        themeMode={themeMode}
        onToggleTheme={handleToggleTheme}
        onToggleSidebar={() => setSidebarOpen(o => {
          const next = !o
          if (window.innerWidth > 768) {
            platform.getSettings().then((s: any) => platform.saveSettings({ ...s, sidebarOpen: next }))
          }
          return next
        })}
        onSearch={() => setShowSearch(true)}
        onToday={handleToday}
        onNewPage={handleNewPage}
        sidebarOpen={sidebarOpen}
        canBack={canBack}
        canForward={canForward}
        onBack={goBack}
        onForward={goForward}
      />

      <div className="app-body">
        {sidebarOpen && (
          <>
            {/* Mobile backdrop: tapping outside closes the drawer */}
            <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />
            <Sidebar
              pages={Array.from(store.pages.values())}
              activePageId={activePageId}
              mainView={mainView}
              onNavigate={(id, title) => {
                handleNavigateToSidebar(id, title)
                // Auto-close drawer on mobile after navigation
                if (window.innerWidth <= 768) setSidebarOpen(false)
              }}
              onShowDailyNotes={() => {
                handleShowDailyNotes()
                if (window.innerWidth <= 768) setSidebarOpen(false)
              }}
              onToday={() => {
                handleToday()
                if (window.innerWidth <= 768) setSidebarOpen(false)
              }}
              onNewPage={() => {
                handleNewPage()
                if (window.innerWidth <= 768) setSidebarOpen(false)
              }}
              onShowSearch={() => { setShowSearch(true); if (window.innerWidth <= 768) setSidebarOpen(false) }}
              onShowCalendar={() => { setShowCalendar(true); if (window.innerWidth <= 768) setSidebarOpen(false) }}
              pagesExpanded={pagesExpanded}
              onTogglePagesExpanded={() => setPagesExpanded(e => {
                const next = !e
                platform.getSettings().then((s: any) => platform.saveSettings({ ...s, pagesExpanded: next }))
                return next
              })}
              onToggleStar={handleToggleStar}
              onDeletePage={handleSidebarDeletePage}
              starredOrder={starredOrder}
              onReorderStarred={handleReorderStarred}
              updateVersion={updateInfo?.version ?? null}
              onShowUpdateDialog={() => {
                // Install directly from badge click (no extra dialog)
                platform.installUpdate()
              }}
              syncStatus={platform.isElectron() ? syncStatus : null}
            />
          </>
        )}

        <div className="app-main">
          {isDailyView ? (
            <DailyNotesView
              allPages={store.pages}
              pagesVersion={store.pagesVersion}
              onNavigate={handleNavigateToContent}
              onOpenSidebar={handleOpenSidebar}
              onZoomToBlock={handleZoomToBlock}
              scrollToDate={scrollToDate}
            />
          ) : activePage ? (
            <PageView
              key={activePage.id}
              page={activePage}
              allPages={store.pages}
              onNavigate={handleNavigateToContent}
              onOpenSidebar={handleOpenSidebar}
              onPageDeleted={handlePageDeleted}
              scrollToBlockId={scrollToBlockId}
              onClearScrollTarget={() => setScrollToBlockId(null)}
              onNavigateToBlock={handleNavigateToBlock}
              onToggleStar={() => handleToggleStar(activePage.id)}
              initialZoom={blockZoom}
            />
          ) : (
            <div className="app-empty">
              <div className="empty-icon">📝</div>
              <h2>Roma Notes</h2>
              <p>Press <kbd>⌘N</kbd> to create a new page</p>
            </div>
          )}
        </div>

        {sidebarPage && (
          <div className="app-right-sidebar">
            <div className="right-sidebar-header">
              <span>{sidebarPage.title}</span>
              <button className="close-btn" onClick={() => setSidebarPageId(null)} title="Close">×</button>
            </div>
            <PageView
              key={`sidebar-${sidebarPage.id}`}
              page={sidebarPage}
              allPages={store.pages}
              onNavigate={handleNavigateToContent}
              onOpenSidebar={handleOpenSidebar}
              onNavigateToBlock={handleNavigateToBlock}
              isSidebar
            />
          </div>
        )}
      </div>

      {showSearch && (
        <SearchModal
          pages={store.pages}
          onClose={() => setShowSearch(false)}
          onNavigate={handleSearchNavigate}
        />
      )}

      {showImport && <ImportModal onClose={() => setShowImport(false)} />}

      {showCalendar && (
        <CalendarModal
          pages={store.pages}
          onClose={() => setShowCalendar(false)}
          onNavigate={handleCalendarNavigate}
        />
      )}

      {/* Mobile: keyboard accessory bar (shown when editing a block) */}
      <MobileKeyboardToolbar />

      {/* Mobile: iOS-style bottom navigation */}
      <MobileBottomBar
        activeView={mainView}
        onDailyNotes={handleShowDailyNotes}
        onSearch={() => setShowSearch(true)}
        onCalendar={() => setShowCalendar(true)}
        syncStatus={platform.isCapacitor() ? syncStatus : null}
      />

      {/* Update progress overlay */}
      {updateProgress && (
        <div className="update-progress-overlay">
          <div className="update-progress-box">
            {updateProgress.error ? (
              <>
                <div className="update-progress-title">Update Failed</div>
                <div className="update-progress-error">{updateProgress.error}</div>
                <button className="update-progress-dismiss" onClick={() => setUpdateProgress(null)}>Dismiss</button>
              </>
            ) : updateProgress.pct === 100 ? (
              <>
                <div className="update-progress-title">Restarting…</div>
                <div className="update-progress-bar-wrap"><div className="update-progress-bar-fill" style={{ width: '100%' }} /></div>
              </>
            ) : (
              <>
                <div className="update-progress-title">{updateProgress.step}</div>
                <div className="update-progress-bar-wrap"><div className="update-progress-bar-fill" style={{ width: `${updateProgress.pct}%` }} /></div>
                <div className="update-progress-pct">{updateProgress.pct}%</div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function isDateLike(s: string): boolean {
  return /\d{4}-\d{2}-\d{2}/.test(s) || /\w+ \d+(st|nd|rd|th), \d{4}/.test(s)
}
