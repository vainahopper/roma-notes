import { format, parse, isValid } from 'date-fns'

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

// Get all page IDs that a page links to
export function getLinksFromBlocks(blocks: import('../../shared/types').Block[]): string[] {
  const links = new Set<string>()
  function traverse(block: import('../../shared/types').Block) {
    const found = extractWikilinks(block.content)
    found.forEach(l => links.add(l.toLowerCase().trim()))
    block.children.forEach(traverse)
  }
  blocks.forEach(traverse)
  return Array.from(links)
}
