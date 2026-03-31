import Fuse from 'fuse.js'
import type { Page, Block, SearchResult } from '../../shared/types'
import { stripMarkdown, truncate } from './helpers'

function normalizeAccents(str: string): string {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

interface SearchIndex {
  type: 'page' | 'block'
  pageId: string
  pageTitle: string
  pageUpdatedAt: string
  blockId?: string
  text: string
  normalized: string
  wikilinkOnly: boolean
}

let fuseIndex: Fuse<SearchIndex> | null = null
let indexedItems: SearchIndex[] = []

// Returns true if the block content is essentially just wikilink/tag references
// with no meaningful surrounding text (e.g. "[[Page]]" or "#tag [[other]]")
function isWikilinkOnly(raw: string): boolean {
  const stripped = raw
    .replace(/#?\[\[.*?\]\]/g, '')
    .replace(/#\S+/g, '')
    .trim()
  return stripped.length < 5
}

export function buildSearchIndex(pages: Page[]) {
  indexedItems = []

  for (const page of pages) {
    // Add page title
    indexedItems.push({
      type: 'page',
      pageId: page.id,
      pageTitle: page.title,
      pageUpdatedAt: page.updatedAt,
      text: page.title,
      normalized: normalizeAccents(page.title),
      wikilinkOnly: false,
    })

    // Add all blocks
    addBlocksToIndex(page.id, page.title, page.updatedAt, page.blocks)
  }

  fuseIndex = new Fuse(indexedItems, {
    keys: ['normalized'],
    threshold: 0.15,
    includeScore: true,
    minMatchCharLength: 3,
    ignoreLocation: true,
  })
}

function addBlocksToIndex(pageId: string, pageTitle: string, pageUpdatedAt: string, blocks: Block[]) {
  for (const block of blocks) {
    const text = stripMarkdown(block.content)
    if (text.trim()) {
      indexedItems.push({
        type: 'block',
        pageId,
        pageTitle,
        pageUpdatedAt,
        blockId: block.id,
        text,
        normalized: normalizeAccents(text),
        wikilinkOnly: isWikilinkOnly(block.content),
      })
    }
    if (block.children.length > 0) {
      addBlocksToIndex(pageId, pageTitle, pageUpdatedAt, block.children)
    }
  }
}

export function search(query: string, limit = 30): SearchResult[] {
  if (!fuseIndex || !query.trim()) return []

  const results = fuseIndex.search(normalizeAccents(query), { limit: limit * 5 })

  // Pages always rank above blocks (each group sorted by Fuse score)
  const pages = results.filter(r => r.item.type === 'page')
  const blocks = results.filter(r => r.item.type === 'block')

  // Deduplicate blocks: one result per page.
  // Prefer blocks with real content over wikilink-only; among equals use Fuse score.
  const seenPageIds = new Set(pages.map(r => r.item.pageId))
  const bestBlockPerPage = new Map<string, typeof blocks[number]>()
  for (const r of blocks) {
    const pageId = r.item.pageId
    if (seenPageIds.has(pageId)) continue // page title already in results
    const existing = bestBlockPerPage.get(pageId)
    if (!existing) {
      bestBlockPerPage.set(pageId, r)
      continue
    }
    const existingWikilink = existing.item.wikilinkOnly
    const candidateWikilink = r.item.wikilinkOnly
    // Real content beats wikilink-only regardless of score
    if (existingWikilink && !candidateWikilink) {
      bestBlockPerPage.set(pageId, r)
    } else if (!existingWikilink && candidateWikilink) {
      // keep existing
    } else if ((r.score ?? 1) < (existing.score ?? 1)) {
      bestBlockPerPage.set(pageId, r)
    }
  }

  // Pages: sorted by Fuse score (match quality)
  const sortedPages = pages.sort((a, b) => (a.score ?? 1) - (b.score ?? 1))

  // Blocks: sorted by recency (most recently updated page first).
  // Wikilink-only blocks are pushed to the end within the same recency group.
  const sortedBlocks = [...bestBlockPerPage.values()].sort((a, b) => {
    const aWikilink = a.item.wikilinkOnly ? 1 : 0
    const bWikilink = b.item.wikilinkOnly ? 1 : 0
    if (aWikilink !== bWikilink) return aWikilink - bWikilink
    return new Date(b.item.pageUpdatedAt).getTime() - new Date(a.item.pageUpdatedAt).getTime()
  })

  const deduped = [...sortedPages, ...sortedBlocks].slice(0, limit)

  return deduped.map(r => ({
    type: r.item.type,
    pageId: r.item.pageId,
    pageTitle: r.item.pageTitle,
    blockId: r.item.blockId,
    content: truncate(r.item.text, 120),
    score: r.score ?? 1,
  }))
}

// Quick page-only search (for [[ autocomplete)
export function searchPages(query: string, pages: Page[], limit = 10): Page[] {
  if (!query.trim()) return pages.slice(0, limit)

  const normalizedPages = pages.map(p => ({ ...p, _normalized: normalizeAccents(p.title) }))
  const fuse = new Fuse(normalizedPages, {
    keys: ['_normalized'],
    threshold: 0.4,
    includeScore: true,
  })

  return fuse.search(normalizeAccents(query), { limit }).map(r => {
    const { _normalized: _, ...page } = r.item
    return page as Page
  })
}
