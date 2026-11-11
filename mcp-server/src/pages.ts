import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import type { Page } from './flatten.js'

export interface PageMeta {
  id: string
  title: string
  updatedAt: string
  createdAt: string
  isDaily?: boolean
  starred?: boolean
}

const PAGES_DIR = process.env.ROMA_NOTES_DIR
  || path.join(os.homedir(), 'Library', 'Application Support', 'RomaNotes', 'pages')

function sanitizeFilename(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').substring(0, 200)
}

let metaCache: PageMeta[] | null = null
let fullCache: Page[] | null = null

export function invalidateCache() {
  metaCache = null
  fullCache = null
}

export async function loadAllPageMeta(): Promise<PageMeta[]> {
  if (metaCache) return metaCache

  const entries: PageMeta[] = []
  let files: string[]
  try {
    files = await fs.readdir(PAGES_DIR)
  } catch {
    return []
  }

  for (const file of files) {
    if (!file.endsWith('.json')) continue
    try {
      const raw = await fs.readFile(path.join(PAGES_DIR, file), 'utf-8')
      const page = JSON.parse(raw)
      if (!page.id || !page.title) continue
      entries.push({
        id: page.id,
        title: page.title,
        updatedAt: page.updatedAt || '',
        createdAt: page.createdAt || '',
        isDaily: page.isDaily,
        starred: page.starred,
      })
    } catch {
      // skip malformed files
    }
  }

  metaCache = entries
  return entries
}

export async function loadAllPages(): Promise<Page[]> {
  if (fullCache) return fullCache

  const pages: Page[] = []
  let files: string[]
  try {
    files = await fs.readdir(PAGES_DIR)
  } catch {
    return []
  }

  for (const file of files) {
    if (!file.endsWith('.json')) continue
    try {
      const raw = await fs.readFile(path.join(PAGES_DIR, file), 'utf-8')
      const page = JSON.parse(raw) as Page
      if (!page.id || !page.title) continue
      pages.push(page)
    } catch {
      // skip malformed files
    }
  }

  fullCache = pages
  return pages
}

export async function readPage(id: string): Promise<Page | null> {
  const filePath = path.join(PAGES_DIR, `${sanitizeFilename(id)}.json`)
  try {
    const raw = await fs.readFile(filePath, 'utf-8')
    return JSON.parse(raw) as Page
  } catch {
    return null
  }
}

export async function getRecentPages(limit = 20): Promise<PageMeta[]> {
  const meta = await loadAllPageMeta()
  return [...meta]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, limit)
}

export async function getDailyNote(date?: string): Promise<Page | null> {
  const id = date || new Date().toISOString().slice(0, 10)
  return readPage(id)
}

// Start watching for file changes to invalidate cache
let watcher: ReturnType<typeof setTimeout> | null = null

export function startWatcher() {
  try {
    const ac = new AbortController()
    ;(async () => {
      try {
        const w = fs.watch(PAGES_DIR, { signal: ac.signal })
        for await (const _ of w) {
          if (watcher) clearTimeout(watcher)
          watcher = setTimeout(invalidateCache, 2000)
        }
      } catch {
        // watcher closed or dir not available
      }
    })()
  } catch {
    // fs.watch not available
  }
}
