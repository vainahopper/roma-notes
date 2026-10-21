import { useState, useEffect, useCallback, useRef } from 'react'
import type { Page, Block } from '../../shared/types'
import { generateId, todayPageId, todayPageTitle } from '../utils/helpers'
import { platform } from '../platform'
import { queueCloudPush, queueCloudDelete, cloudCatchUp, fetchCloudInbox, ackCloudInbox, cloudEnabled } from '../utils/cloudBridge'

// Global store using a simple event emitter pattern
type Listener = () => void
const listeners = new Set<Listener>()
let storeState = {
  pages: new Map<string, Page>(),
  loaded: false,
  loading: false,
  loadError: false,
  pagesVersion: 0,
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
    storeState = { pages: map, loaded: true, loading: false, loadError: false, pagesVersion: storeState.pagesVersion + 1 }
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
  storeState = { ...storeState, pagesVersion: storeState.pagesVersion + 1 }
  notify()
  // Persist
  await platform.savePage(page)
  queueCloudPush(page)
}

export async function deletePage(id: string) {
  storeState.pages.delete(id)
  storeState = { ...storeState, pagesVersion: storeState.pagesVersion + 1 }
  notify()
  await platform.deletePage(id)
  queueCloudDelete(id)
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
  storeState = { ...storeState, pagesVersion: storeState.pagesVersion + 1 }
  notify()
  // Save all
  pages.forEach(p => {
    platform.savePage(p)
    queueCloudPush(p)
  })
}

// ─── Cloud bridge (agent access, see utils/cloudBridge.ts) ──────────────────

let cloudBusy = false

/** Merge blocks the agent added through the cloud API into local pages. */
async function applyCloudInbox() {
  const items = await fetchCloudInbox()
  if (!items.length) return
  const touched = new Map<string, Page>()
  for (const item of items) {
    const existing = touched.get(item.pageId) ?? storeState.pages.get(item.pageId)
    const page: Page = existing
      ? { ...existing, blocks: [...existing.blocks] }
      : { id: item.pageId, title: item.pageTitle, blocks: [], createdAt: item.createdAt, updatedAt: item.createdAt, isDaily: item.isDaily || undefined }
    const hasBlock = (bs: Block[]): boolean => bs.some(b => b.id === item.block.id || hasBlock(b.children))
    if (hasBlock(page.blocks)) continue
    // Drop a lone empty placeholder bullet so the new block isn't preceded by a blank one.
    if (page.blocks.length === 1 && !page.blocks[0].content.trim() && !page.blocks[0].children.length) page.blocks = []
    page.blocks.push(item.block)
    touched.set(page.id, page)
  }
  for (const page of touched.values()) await savePage(page)
  await ackCloudInbox(items.map(i => i.id))
}

export async function runCloudSync() {
  if (!cloudEnabled || !storeState.loaded || cloudBusy) return
  cloudBusy = true
  try {
    await applyCloudInbox()
    await cloudCatchUp([...storeState.pages.values()])
  } catch (err) {
    console.warn('[Roma] cloud sync failed:', err)
  } finally {
    cloudBusy = false
  }
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
  if (changed) {
    storeState = { ...storeState, pagesVersion: storeState.pagesVersion + 1 }
    notify()
  }
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
    storeState = { pages: map, loaded: true, loading: false, loadError: false, pagesVersion: storeState.pagesVersion + 1 }
    notify()
  } catch (err) {
    console.error('[Roma] forceReloadPages failed:', err)
  }
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useStore() {
  const [, rerender] = useState(0)

  const listenerRef = useRef<Listener>(() => rerender(n => n + 1))

  // Register on mount, unregister on unmount to prevent listener leaks
  useEffect(() => {
    const listener = listenerRef.current
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }, [])

  return storeState
}

export function subscribeToStore(listener: Listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
