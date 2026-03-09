import type { Page, Block } from '../../shared/types'
import { generateId, parseDatePage, dateToPageId, dateToPageTitle, formatDateTitle } from './helpers'

interface RawFile {
  name: string
  content: string
}

// ─── Main entry point (markdown) ─────────────────────────────────────────────

export function importFromRoamFiles(files: RawFile[]): Page[] {
  const pages: Page[] = []

  for (const file of files) {
    try {
      const page = parseRoamMarkdown(file)
      if (page) pages.push(page)
    } catch (err) {
      console.warn(`Failed to parse ${file.name}:`, err)
    }
  }

  return pages
}

// ─── JSON import (full Roam export with timestamps) ───────────────────────────

interface RoamJsonBlock {
  uid: string
  string: string
  'create-time'?: number
  'edit-time'?: number
  children?: RoamJsonBlock[]
  refs?: { uid: string }[]
}

interface RoamJsonPage {
  title: string
  uid: string
  'create-time'?: number
  'edit-time'?: number
  children?: RoamJsonBlock[]
}

export function importFromRoamJson(jsonStr: string): Page[] {
  let data: RoamJsonPage[]
  try {
    data = JSON.parse(jsonStr)
    if (!Array.isArray(data)) throw new Error('Expected array')
  } catch (err) {
    throw new Error('Invalid Roam JSON format')
  }

  const pages: Page[] = []

  for (const rawPage of data) {
    try {
      const page = parseRoamJsonPage(rawPage)
      if (page) pages.push(page)
    } catch (err) {
      console.warn(`Failed to parse page "${rawPage.title}":`, err)
    }
  }

  return pages
}

function parseRoamJsonPage(raw: RoamJsonPage): Page | null {
  if (!raw.title) return null

  const title = raw.title
  const date = parseDatePage(title)
  const isDaily = date !== null

  let id: string
  let displayTitle: string
  if (isDaily && date) {
    id = dateToPageId(date)
    displayTitle = formatDateTitle(date)
  } else {
    id = title.toLowerCase().trim()
    displayTitle = title
  }

  const pageCreatedAt = raw['create-time']
    ? new Date(raw['create-time']).toISOString()
    : new Date().toISOString()
  const pageUpdatedAt = raw['edit-time']
    ? new Date(raw['edit-time']).toISOString()
    : pageCreatedAt

  const blocks = raw.children ? raw.children.map(b => parseRoamJsonBlock(b)) : []

  return {
    id,
    title: displayTitle,
    blocks: blocks.length > 0 ? blocks : [{ id: generateId(), content: '', children: [], checked: null }],
    createdAt: pageCreatedAt,
    updatedAt: pageUpdatedAt,
    isDaily,
  }
}

function parseRoamJsonBlock(raw: RoamJsonBlock): Block {
  const { content, checked } = parseBlockContent(raw.string || '')

  const createdAt = raw['create-time']
    ? new Date(raw['create-time']).toISOString()
    : undefined
  const updatedAt = raw['edit-time']
    ? new Date(raw['edit-time']).toISOString()
    : createdAt

  const children = raw.children ? raw.children.map(c => parseRoamJsonBlock(c)) : []

  return {
    id: raw.uid || generateId(),
    content,
    children,
    checked,
    createdAt,
    updatedAt,
  }
}

// ─── Parse a single .md file ─────────────────────────────────────────────────

function parseRoamMarkdown(file: RawFile): Page | null {
  const rawName = file.name
    .replace(/^.*[\\/]/, '')
    .replace(/\.md$/, '')

  if (!rawName) return null

  const title = rawName
  const lines = file.content.split('\n')

  const blocks = parseBlocks(lines)

  const date = parseDatePage(title)
  const isDaily = date !== null

  let id: string
  if (isDaily && date) {
    id = dateToPageId(date)
  } else {
    id = title.toLowerCase().trim()
  }

  let displayTitle = title
  if (isDaily && date) {
    displayTitle = formatDateTitle(date)
  }

  const now = new Date().toISOString()

  return {
    id,
    title: displayTitle,
    blocks: blocks.length > 0 ? blocks : [{ id: generateId(), content: '', children: [], checked: null }],
    createdAt: now,
    updatedAt: now,
    isDaily,
  }
}

// ─── Block parsing (markdown) ─────────────────────────────────────────────────

function parseBlocks(lines: string[]): Block[] {
  const items: { indent: number; content: string }[] = []

  for (const line of lines) {
    if (!line.trim()) continue

    const match = line.match(/^(\s*)- (.*)$/)
    if (match) {
      const spaces = match[1].length
      const indent = Math.floor(spaces / 4)
      const content = match[2]
      items.push({ indent, content })
    } else if (line.trim().startsWith('-')) {
      items.push({ indent: 0, content: line.trim().slice(1).trim() })
    }
  }

  return buildTree(items, 0, items.length, 0)
}

function buildTree(
  items: { indent: number; content: string }[],
  start: number,
  end: number,
  currentIndent: number
): Block[] {
  const blocks: Block[] = []
  let i = start

  while (i < end) {
    const item = items[i]
    if (item.indent < currentIndent) break
    if (item.indent === currentIndent) {
      const block = createBlock(item.content)
      const childStart = i + 1
      let childEnd = childStart
      while (childEnd < end && items[childEnd].indent > currentIndent) {
        childEnd++
      }
      if (childEnd > childStart) {
        block.children = buildTree(items, childStart, childEnd, currentIndent + 1)
      }
      blocks.push(block)
      i = childEnd
    } else {
      i++
    }
  }

  return blocks
}

function createBlock(rawContent: string): Block {
  const { content, checked } = parseBlockContent(rawContent)
  return {
    id: generateId(),
    content,
    children: [],
    checked,
  }
}

// ─── Content transformation ────────────────────────────────────────────────────

function parseBlockContent(raw: string): { content: string; checked: boolean | null } {
  let content = raw
  let checked: boolean | null = null

  if (/\{\{\[\[TODO\]\]\}\}/.test(content)) {
    checked = false
    content = content.replace(/\{\{\[\[TODO\]\]\}\}\s*/, '')
  } else if (/\{\{\[\[DONE\]\]\}\}/.test(content)) {
    checked = true
    content = content.replace(/\{\{\[\[DONE\]\]\}\}\s*/, '')
  }

  return { content: content.trim(), checked }
}

// ─── Duplicate detection ──────────────────────────────────────────────────────

export function deduplicatePages(pages: Page[]): Page[] {
  const seen = new Map<string, Page>()
  for (const page of pages) {
    if (!seen.has(page.id)) {
      seen.set(page.id, page)
    } else {
      const existing = seen.get(page.id)!
      const existingBlockCount = countBlocks(existing.blocks)
      const newBlockCount = countBlocks(page.blocks)
      if (newBlockCount > existingBlockCount) {
        seen.set(page.id, page)
      }
    }
  }
  return Array.from(seen.values())
}

function countBlocks(blocks: Block[]): number {
  return blocks.reduce((sum, b) => sum + 1 + countBlocks(b.children), 0)
}
