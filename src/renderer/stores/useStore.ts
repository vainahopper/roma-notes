import { useState, useCallback, useRef } from 'react'
import type { Page, Block } from '../../shared/types'
import { generateId, todayPageId, todayPageTitle } from '../utils/helpers'
import { platform } from '../platform'

// Global store using a simple event emitter pattern
type Listener = () => void
const listeners = new Set<Listener>()
let storeState = {
  pages: new Map<string, Page>(),
  loaded: false,
  loading: false,
  loadError: false,
}

function notify() {
  listeners.forEach(l => l())
}

export function getStoreState() {
  return storeState
}

// ─── Actions ────────────────────────────────────────────────────────────────

export async function loadAllPages() {
  if (storeState.loaded || storeState.loading) return
  storeState = { ...storeState, loading: true, loadError: false }
  notify()

  try {
    const pages: Page[] = await platform.getAllPages()
    const map = new Map<string, Page>()
    for (const p of pages) {
      map.set(p.id, p)
    }
    storeState = { pages: map, loaded: true, loading: false, loadError: false }
  } catch (err) {
    console.error('Failed to load pages:', err)
    // Do NOT set loaded:true here — an empty pages map would cause getOrCreateDailyPage
    // to overwrite existing notes on disk with empty content.
    storeState = { ...storeState, loaded: false, loading: false, loadError: true }
  }
  notify()
}

export function retryLoad() {
  storeState = { pages: new Map(), loaded: false, loading: false, loadError: false }
  notify()
  loadAllPages()
}

export function getPage(id: string): Page | undefined {
  return storeState.pages.get(id)
}

export function getOrCreateDailyPage(dateId: string, dateTitle: string): Page {
  if (storeState.pages.has(dateId)) {
    return storeState.pages.get(dateId)!
  }
  const now = new Date().toISOString()
  const isToday = dateId === todayPageId()
  const page: Page = {
    id: dateId,
    title: dateTitle,
    blocks: [{ id: generateId(), content: '', children: [], checked: null }],
    createdAt: now,
    // Past daily pages get an epoch timestamp so the iCloud version (with real
    // content) always wins conflict resolution regardless of cloud timestamp.
    // This prevents empty auto-created placeholders from overwriting real notes.
    updatedAt: isToday ? now : '1970-01-01T00:00:00.000Z',
    isDaily: true,
  }
  // Only persist + push when the store is loaded AND it's today's page.
  // Past-date placeholders stay in-memory only — iCloud sync will provide the
  // real content on the next pull (epoch updatedAt guarantees cloud always wins).
  if (storeState.loaded && isToday) {
    savePage(page)
  } else {
    storeState.pages.set(page.id, page)
    notify()
  }
  return page
}

export async function savePage(page: Page) {
  page.updatedAt = new Date().toISOString()
  storeState.pages.set(page.id, page)
  notify()
  // Persist
  await platform.savePage(page)
}

export async function deletePage(id: string) {
  storeState.pages.delete(id)
  notify()
  await platform.deletePage(id)
}

export function createNewPage(title: string, id?: string): Page {
  // If id is provided (e.g. from a wikilink click), use it directly so navigation finds the page.
  // Otherwise generate a slug-based id for ⌘N new pages.
  const pageId = id ?? (title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') + '-' + generateId().slice(0, 6))
  const now = new Date().toISOString()
  const page: Page = {
    id: pageId,
    title,
    blocks: [{ id: generateId(), content: '', children: [], checked: null }],
    createdAt: now,
    updatedAt: now,
  }
  savePage(page)
  return page
}

export function importPages(pages: Page[]) {
  for (const page of pages) {
    storeState.pages.set(page.id, page)
  }
  notify()
  // Save all
  pages.forEach(p => platform.savePage(p))
}

/**
 * Merge pages from iCloud sync directly into the in-memory store.
 * Called after syncPull() returns pages that were newer in the cloud.
 * This bypasses the loadAllPages() guard (which is a no-op after first load).
 */
export function mergeSyncedPages(pages: Page[]) {
  if (pages.length === 0) return
  let changed = false
  for (const page of pages) {
    if (!page.id) continue
    const existing = storeState.pages.get(page.id)
    if (!existing || page.updatedAt > existing.updatedAt) {
      storeState.pages.set(page.id, page)
      changed = true
    }
  }
  if (changed) notify()
}

/**
 * Force-reload all pages from the platform (disk/IndexedDB).
 * Used by Electron when the main process notifies of iCloud changes.
 * Unlike loadAllPages(), this always re-reads regardless of the loaded flag.
 */
export async function forceReloadPages() {
  try {
    const pages: Page[] = await platform.getAllPages()
    const map = new Map<string, Page>()
    for (const p of pages) {
      map.set(p.id, p)
    }
    storeState = { pages: map, loaded: true, loading: false, loadError: false }
    notify()
  } catch (err) {
    console.error('[Roma] forceReloadPages failed:', err)
  }
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useStore() {
  const [, rerender] = useState(0)

  const listenerRef = useRef<Listener>(() => rerender(n => n + 1))

  // Register/unregister listener
  if (!listeners.has(listenerRef.current)) {
    listeners.add(listenerRef.current)
  }

  // Note: cleanup happens in useEffect in component
  return storeState
}

export function subscribeToStore(listener: Listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
