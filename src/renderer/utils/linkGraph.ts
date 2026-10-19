import type { Page } from '../../shared/types'
import { getLinksFromBlocks, titleToId } from './helpers'

export interface LinkIndex {
  /** page id → ids of pages it links to (wikilinks, #tags, attributes) */
  outgoing: Map<string, Set<string>>
  /** page id → number of distinct pages that link to it */
  incomingCount: Map<string, number>
}

/**
 * Resolve every page's links to page ids. Links are matched by title first
 * (pages made with ⌘N have slug ids), then by the id a wikilink would create.
 * Links to pages that don't exist are dropped.
 */
export function buildLinkIndex(pages: Page[]): LinkIndex {
  const idByTitle = new Map<string, string>()
  const ids = new Set<string>()
  for (const p of pages) {
    ids.add(p.id)
    idByTitle.set(p.title.toLowerCase().trim(), p.id)
  }

  const outgoing = new Map<string, Set<string>>()
  const incomingCount = new Map<string, number>()

  for (const p of pages) {
    const targets = new Set<string>()
    for (const link of getLinksFromBlocks(p.blocks)) {
      const id = idByTitle.get(link) ?? (ids.has(titleToId(link)) ? titleToId(link) : null)
      if (id && id !== p.id) targets.add(id)
    }
    outgoing.set(p.id, targets)
    for (const t of targets) incomingCount.set(t, (incomingCount.get(t) ?? 0) + 1)
  }

  return { outgoing, incomingCount }
}
