import { format, parse, isValid } from 'date-fns'
import type { CSSProperties, RefObject } from 'react'
import type { Block } from '../../shared/types'

export function generateId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

// Today's daily note ID and title
export function todayPageId(): string {
  return format(new Date(), 'yyyy-MM-dd')
}

export function todayPageTitle(): string {
  return formatDateTitle(new Date())
}

export function formatDateTitle(date: Date): string {
  const day = date.getDate()
  const suffix = getDaySuffix(day)
  return format(date, `MMMM d'${suffix}', yyyy`)
}

function getDaySuffix(day: number): string {
  if (day >= 11 && day <= 13) return 'th'
  switch (day % 10) {
    case 1: return 'st'
    case 2: return 'nd'
    case 3: return 'rd'
    default: return 'th'
  }
}

// Parse a date page title or ID to a Date object
export function parseDatePage(titleOrId: string): Date | null {
  // ISO format: 2023-12-06
  const isoMatch = titleOrId.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (isoMatch) {
    const d = new Date(`${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`)
    if (isValid(d)) return d
  }

  // Roam format: January 5th, 2023
  const roamMatch = titleOrId.match(/^([A-Za-z]+)\s+(\d+)(?:st|nd|rd|th),\s+(\d{4})$/)
  if (roamMatch) {
    const dateStr = `${roamMatch[1]} ${roamMatch[2]}, ${roamMatch[3]}`
    const d = parse(dateStr, 'MMMM d, yyyy', new Date())
    if (isValid(d)) return d
  }

  return null
}

export function isDatePage(titleOrId: string): boolean {
  return parseDatePage(titleOrId) !== null
}

export function dateToPageId(date: Date): string {
  return format(date, 'yyyy-MM-dd')
}

export function dateToPageTitle(date: Date): string {
  return formatDateTitle(date)
}

// Extract [[wikilinks]] from text
export function extractWikilinks(text: string): string[] {
  const matches = text.match(/\[\[([^\]]+)\]\]/g) || []
  return matches.map(m => m.slice(2, -2))
}

// Extract #tags from text
export function extractTags(text: string): string[] {
  const matches = text.match(/#(?:\[\[([^\]]+)\]\]|([A-Za-z0-9_À-ÿ-]+))/g) || []
  return matches.map(m => {
    if (m.startsWith('#[[')) return m.slice(3, -2)
    return m.slice(1)
  })
}

// Extract attribute key from "Key:: value" syntax
export function extractAttributes(text: string): string[] {
  const match = text.match(/^([^:\n]+)::\s/)
  return match ? [match[1].trim()] : []
}

// Convert page title to ID/slug for lookup
export function titleToId(title: string): string {
  // Check if it's a date first
  const date = parseDatePage(title)
  if (date) return dateToPageId(date)
  return title.toLowerCase().trim()
}

// Truncate text for previews
export function truncate(text: string, max: number): string {
  const clean = stripMarkdown(text)
  if (clean.length <= max) return clean
  return clean.slice(0, max).trim() + '…'
}

// Strip markdown syntax for plain text display
export function stripMarkdown(text: string): string {
  return text
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/#\[\[([^\]]+)\]\]/g, '$1')
    .replace(/#([A-Za-z0-9_À-ÿ-]+)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\^\^([^^]+)\^\^/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\{\{(?:\[\[)?(?:TODO|DONE)(?:\]\])?\}\}/g, '')
    .replace(/\{\{[^}]+\}\}/g, '')
    .replace(/\(\([^)]+\)\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .trim()
}

// ─── Mobile popup positioning ─────────────────────────────────────────────────

/** Matches the `.mobile-kb-toolbar` height in CSS */
export const MOBILE_KEYBOARD_TOOLBAR_HEIGHT = 46

/**
 * Returns a `position: fixed` style that places a popup above the keyboard
 * on mobile, or below the anchor element on desktop.
 * Pass `center: true` to horizontally center on mobile (e.g. date picker).
 */
export function getMobilePopupStyle(
  anchorRef: RefObject<HTMLTextAreaElement | null>,
  center = false,
): CSSProperties {
  const isMobile = window.innerWidth <= 768
  const vv = window.visualViewport
  if (isMobile && vv) {
    const kbHeight = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
    return center
      ? { position: 'fixed', bottom: kbHeight + MOBILE_KEYBOARD_TOOLBAR_HEIGHT + 4, left: '50%', transform: 'translateX(-50%)', zIndex: 500 }
      : { position: 'fixed', bottom: kbHeight + MOBILE_KEYBOARD_TOOLBAR_HEIGHT + 4, left: 8, right: 8, zIndex: 500 }
  }
  const rect = anchorRef.current?.getBoundingClientRect()
  return rect
    ? { position: 'fixed', top: rect.bottom + 4, left: rect.left, zIndex: 500 }
    : { position: 'fixed', top: 0, left: 0, zIndex: 500 }
}

// ─── Block search utilities ───────────────────────────────────────────────────

export function findBlocksWithLink(blocks: Block[], titleLower: string, idLower: string): Block[] {
  const results: Block[] = []
  // Match #tag with word boundary, and Key:: attribute syntax
  const tagRegex = new RegExp(`(?:#\\[\\[(?:${escapeRegex(titleLower)}|${escapeRegex(idLower)})\\]\\]|#(?:${escapeRegex(titleLower)}|${escapeRegex(idLower)})(?=[^A-Za-z0-9_À-ÿ-]|$))`)
  const attrRegex = new RegExp(`^(?:${escapeRegex(titleLower)}|${escapeRegex(idLower)})::`, 'm')
  function traverse(block: Block) {
    const c = block.content.toLowerCase()
    if (
      c.includes(`[[${titleLower}]]`) || c.includes(`[[${idLower}]]`) ||
      tagRegex.test(c) || attrRegex.test(c)
    ) {
      results.push(block)
    }
    block.children.forEach(traverse)
  }
  blocks.forEach(traverse)
  return results
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Get all page IDs that a page links to (wikilinks + tags)
export function getLinksFromBlocks(blocks: import('../../shared/types').Block[]): string[] {
  const links = new Set<string>()
  function traverse(block: import('../../shared/types').Block) {
    extractWikilinks(block.content).forEach(l => links.add(l.toLowerCase().trim()))
    extractTags(block.content).forEach(t => links.add(t.toLowerCase().trim()))
    extractAttributes(block.content).forEach(a => links.add(a.toLowerCase().trim()))
    block.children.forEach(traverse)
  }
  blocks.forEach(traverse)
  return Array.from(links)
}
