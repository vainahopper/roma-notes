import Fuse from 'fuse.js'
import type { Page, Block, SearchResult } from '../../shared/types'
import { stripMarkdown, truncate } from './helpers'

interface SearchIndex {
  type: 'page' | 'block'
  pageId: string
  pageTitle: string
  blockId?: string
  text: string
}

let fuseIndex: Fuse<SearchIndex> | null = null
let indexedItems: SearchIndex[] = []

export function buildSearchIndex(pages: Page[]) {
  indexedItems = []

  for (const page of pages) {
    // Add page title
    indexedItems.push({
      type: 'page',
      pageId: page.id,
      pageTitle: page.title,
      text: page.title,
    })

    // Add all blocks
    addBlocksToIndex(page.id, page.title, page.blocks)
  }

  fuseIndex = new Fuse(indexedItems, {
    keys: ['text'],
    threshold: 0.3,
    includeScore: true,
    minMatchCharLength: 2,
    ignoreLocation: true,
  })
}

function addBlocksToIndex(pageId: string, pageTitle: string, blocks: Block[]) {
  for (const block of blocks) {
    const text = stripMarkdown(block.content)
    if (text.trim()) {
      indexedItems.push({
        type: 'block',
        pageId,
        pageTitle,
        blockId: block.id,
        text,
      })
    }
    if (block.children.length > 0) {
      addBlocksToIndex(pageId, pageTitle, block.children)
    }
  }
}

export function search(query: string, limit = 30): SearchResult[] {
  if (!fuseIndex || !query.trim()) return []

  const results = fuseIndex.search(query, { limit })

  // Pages always rank above blocks (each group sorted by Fuse score)
  const pages = results.filter(r => r.item.type === 'page')
  const blocks = results.filter(r => r.item.type === 'block')

  return [...pages, ...blocks].map(r => ({
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

  const fuse = new Fuse(pages, {
    keys: ['title'],
    threshold: 0.4,
    includeScore: true,
  })

  return fuse.search(query, { limit }).map(r => r.item)
}
