import Fuse from 'fuse.js'
import type { Page } from './flatten.js'
import { stripMarkdown, isEncrypted, extractAllText } from './flatten.js'
import { loadAllPages } from './pages.js'

function normalizeAccents(str: string): string {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

interface SearchEntry {
  type: 'page' | 'block'
  pageId: string
  pageTitle: string
  pageUpdatedAt: string
  blockId?: string
  text: string
  normalized: string
}

let fuse: Fuse<SearchEntry> | null = null
let entries: SearchEntry[] = []

function buildIndex(pages: Page[]) {
  entries = []

  for (const page of pages) {
    entries.push({
      type: 'page',
      pageId: page.id,
      pageTitle: page.title,
      pageUpdatedAt: page.updatedAt,
      text: page.title,
      normalized: normalizeAccents(page.title),
    })

    addBlocks(page.id, page.title, page.updatedAt, page.blocks)
  }

  fuse = new Fuse(entries, {
    keys: ['normalized'],
    threshold: 0.15,
    includeScore: true,
    minMatchCharLength: 3,
    ignoreLocation: true,
  })
}

function addBlocks(pageId: string, pageTitle: string, pageUpdatedAt: string, blocks: Page['blocks']) {
  for (const block of blocks) {
    if (isEncrypted(block.content)) continue
    const text = stripMarkdown(block.content)
    if (text.trim()) {
      entries.push({
        type: 'block',
        pageId,
        pageTitle,
        pageUpdatedAt,
        blockId: block.id,
        text,
        normalized: normalizeAccents(text),
      })
    }
    if (block.children.length > 0) {
      addBlocks(pageId, pageTitle, pageUpdatedAt, block.children)
    }
  }
}

export interface NoteSearchResult {
  type: 'page' | 'block'
  pageId: string
  pageTitle: string
  excerpt: string
  updatedAt: string
}

export async function searchNotes(query: string, limit = 20): Promise<NoteSearchResult[]> {
  if (!query.trim()) return []

  if (!fuse) {
    const pages = await loadAllPages()
    buildIndex(pages)
  }

  const results = fuse!.search(normalizeAccents(query), { limit: limit * 3 })

  // Deduplicate: one result per page, prefer page-type matches
  const seen = new Set<string>()
  const deduped: NoteSearchResult[] = []

  for (const r of results) {
    if (seen.has(r.item.pageId)) continue
    seen.add(r.item.pageId)
    deduped.push({
      type: r.item.type,
      pageId: r.item.pageId,
      pageTitle: r.item.pageTitle,
      excerpt: r.item.text.slice(0, 300),
      updatedAt: r.item.pageUpdatedAt,
    })
    if (deduped.length >= limit) break
  }

  return deduped
}

export function invalidateSearchIndex() {
  fuse = null
  entries = []
}
