import React from 'react'
import type { Page } from '../../shared/types'
import { titleToId } from '../utils/helpers'
import { platform } from '../platform'
import './BlockContent.css'

interface Props {
  content: string
  checked?: boolean | null
  allPages: Map<string, Page>
  onNavigate: (id: string, title?: string) => void
  onOpenSidebar: (id: string) => void
  onNavigateToBlock?: (pageId: string, pageTitle: string, blockId: string) => void
}

export function BlockContent({ content, checked, allPages, onNavigate, onOpenSidebar, onNavigateToBlock }: Props) {
  const rendered = parseContent(content, allPages, onNavigate, onOpenSidebar, onNavigateToBlock)

  return (
    <span className={`block-content ${checked === true ? 'done' : ''}`}>
      {rendered}
    </span>
  )
}

// Open external URL safely using platform adapter
function openExternal(url: string) {
  try {
    platform.openExternal(url)
  } catch {
    window.open(url, '_blank', 'noreferrer')
  }
}

// ─── Token types ──────────────────────────────────────────────────────────────

type Token =
  | { type: 'text'; value: string }
  | { type: 'wikilink'; title: string }
  | { type: 'tag'; value: string }
  | { type: 'bold'; value: string }
  | { type: 'italic'; value: string }
  | { type: 'highlight'; value: string }
  | { type: 'code'; value: string }
  | { type: 'link'; text: string; url: string }
  | { type: 'autolink'; url: string }
  | { type: 'blockref'; id: string }
  | { type: 'todo'; done: boolean }
  | { type: 'attribute'; key: string; value: string }
  | { type: 'heading'; level: number; value: string }
  | { type: 'encrypt'; value: string }

// Find a block by ID across all pages (recursive)
function findBlockById(pages: Map<string, Page>, blockId: string): { block: import('../../shared/types').Block; page: Page } | null {
  function searchBlocks(blocks: import('../../shared/types').Block[], page: Page): import('../../shared/types').Block | null {
    for (const b of blocks) {
      if (b.id === blockId) return b
      const found = searchBlocks(b.children, page)
      if (found) return found
    }
    return null
  }
  for (const page of pages.values()) {
    const found = searchBlocks(page.blocks, page)
    if (found) return { block: found, page }
  }
  return null
}

function parseContent(
  content: string,
  allPages: Map<string, Page>,
  onNavigate: (id: string, title?: string) => void,
  onOpenSidebar: (id: string) => void,
  onNavigateToBlock?: (pageId: string, pageTitle: string, blockId: string) => void,
): React.ReactNode[] {
  const tokens = tokenize(content)
  return tokens.map((token, i) => renderToken(token, i, allPages, onNavigate, onOpenSidebar, onNavigateToBlock))
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = []
  let remaining = text

  // Attribute syntax at start: "Key:: value"
  const attrMatch = remaining.match(/^([^:\n]+)::\s*(.*)$/)
  if (attrMatch) {
    tokens.push({ type: 'attribute', key: attrMatch[1].trim(), value: attrMatch[2].trim() })
    return tokens
  }

  // Heading: "### Title"
  const headingMatch = remaining.match(/^(#{1,6})\s+(.+)$/)
  if (headingMatch) {
    tokens.push({ type: 'heading', level: headingMatch[1].length, value: headingMatch[2] })
    return tokens
  }

  while (remaining.length > 0) {
    // {{[[TODO]]}} or {{[[DONE]]}}
    const todoMatch = remaining.match(/^\{\{\[\[(TODO|DONE)\]\]\}\}/)
    if (todoMatch) {
      tokens.push({ type: 'todo', done: todoMatch[1] === 'DONE' })
      remaining = remaining.slice(todoMatch[0].length)
      continue
    }

    // {{encrypt:...}}
    const encryptMatch = remaining.match(/^\{\{encrypt:([^}]+)\}\}/)
    if (encryptMatch) {
      tokens.push({ type: 'encrypt', value: encryptMatch[1] })
      remaining = remaining.slice(encryptMatch[0].length)
      continue
    }

    // [[wikilink]]
    const wikilinkMatch = remaining.match(/^\[\[([^\]]+)\]\]/)
    if (wikilinkMatch) {
      tokens.push({ type: 'wikilink', title: wikilinkMatch[1] })
      remaining = remaining.slice(wikilinkMatch[0].length)
      continue
    }

    // ((block-ref))
    const blockrefMatch = remaining.match(/^\(\(([^)]+)\)\)/)
    if (blockrefMatch) {
      tokens.push({ type: 'blockref', id: blockrefMatch[1] })
      remaining = remaining.slice(blockrefMatch[0].length)
      continue
    }

    // #[[multi word tag]] or #tag
    const multiTagMatch = remaining.match(/^#\[\[([^\]]+)\]\]/)
    if (multiTagMatch) {
      tokens.push({ type: 'tag', value: multiTagMatch[1] })
      remaining = remaining.slice(multiTagMatch[0].length)
      continue
    }

    const tagMatch = remaining.match(/^#([A-Za-z0-9_À-ÿ-]+)/)
    if (tagMatch) {
      tokens.push({ type: 'tag', value: tagMatch[1] })
      remaining = remaining.slice(tagMatch[0].length)
      continue
    }

    // **bold**
    const boldMatch = remaining.match(/^\*\*([^*]+)\*\*/)
    if (boldMatch) {
      tokens.push({ type: 'bold', value: boldMatch[1] })
      remaining = remaining.slice(boldMatch[0].length)
      continue
    }

    // __italic__
    const italicMatch = remaining.match(/^__([^_]+)__/)
    if (italicMatch) {
      tokens.push({ type: 'italic', value: italicMatch[1] })
      remaining = remaining.slice(italicMatch[0].length)
      continue
    }

    // ^^highlight^^
    const highlightMatch = remaining.match(/^\^\^([^^]+)\^\^/)
    if (highlightMatch) {
      tokens.push({ type: 'highlight', value: highlightMatch[1] })
      remaining = remaining.slice(highlightMatch[0].length)
      continue
    }

    // `code`
    const codeMatch = remaining.match(/^`([^`]+)`/)
    if (codeMatch) {
      tokens.push({ type: 'code', value: codeMatch[1] })
      remaining = remaining.slice(codeMatch[0].length)
      continue
    }

    // [text](url) — markdown link
    const linkMatch = remaining.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)/)
    if (linkMatch) {
      tokens.push({ type: 'link', text: linkMatch[1], url: linkMatch[2] })
      remaining = remaining.slice(linkMatch[0].length)
      continue
    }

    // Auto-detect bare URLs: http:// or https://
    const urlMatch = remaining.match(/^https?:\/\/[^\s\])"'>]+/)
    if (urlMatch) {
      tokens.push({ type: 'autolink', url: urlMatch[0] })
      remaining = remaining.slice(urlMatch[0].length)
      continue
    }

    // Plain text (consume until next special char)
    const plainMatch = remaining.match(/^[^[\]#*_^`({h]+/)
    if (plainMatch) {
      tokens.push({ type: 'text', value: plainMatch[0] })
      remaining = remaining.slice(plainMatch[0].length)
      continue
    }

    // Fallback: consume one char
    tokens.push({ type: 'text', value: remaining[0] })
    remaining = remaining.slice(1)
  }

  return tokens
}

function renderToken(
  token: Token,
  key: number,
  allPages: Map<string, Page>,
  onNavigate: (id: string, title?: string) => void,
  onOpenSidebar: (id: string) => void,
  onNavigateToBlock?: (pageId: string, pageTitle: string, blockId: string) => void,
): React.ReactNode {
  switch (token.type) {
    case 'text':
      return <span key={key}>{token.value}</span>

    case 'wikilink': {
      const pageId = titleToId(token.title)
      const exists = allPages.has(pageId) || allPages.has(token.title.toLowerCase())
      return (
        <span key={key} className="wikilink-group">
          <a
            className={`wikilink ${exists ? 'exists' : 'new'}`}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              if (e.shiftKey) {
                onOpenSidebar(pageId)
              } else {
                onNavigate(pageId, token.title)
              }
            }}
            title={`Navigate to "${token.title}"`}
          >
            <span className="wikilink-brackets">[[</span>
            <span className="wikilink-text">{token.title}</span>
            <span className="wikilink-brackets">]]</span>
          </a>
        </span>
      )
    }

    case 'tag':
      return (
        <span key={key} className="tag" onClick={() => onNavigate(token.value.toLowerCase(), token.value)}>
          #{token.value}
        </span>
      )

    case 'bold':
      return <strong key={key}>{token.value}</strong>

    case 'italic':
      return <em key={key}>{token.value}</em>

    case 'highlight':
      return <mark key={key}>{token.value}</mark>

    case 'code':
      return <code key={key}>{token.value}</code>

    case 'link':
      return (
        <a
          key={key}
          href={token.url}
          className="external-link"
          onClick={e => { e.preventDefault(); e.stopPropagation(); openExternal(token.url) }}
          title={token.url}
        >
          {token.text}
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ marginLeft: 2, verticalAlign: 'middle' }}>
            <path d="M5.5 2H8V4.5M8 2L4 6M2 2.5H3.5V8H9V6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
          </svg>
        </a>
      )

    case 'autolink':
      return (
        <a
          key={key}
          href={token.url}
          className="external-link"
          onClick={e => { e.preventDefault(); e.stopPropagation(); openExternal(token.url) }}
          title={token.url}
        >
          {token.url}
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ marginLeft: 2, verticalAlign: 'middle' }}>
            <path d="M5.5 2H8V4.5M8 2L4 6M2 2.5H3.5V8H9V6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
          </svg>
        </a>
      )

    case 'blockref': {
      const found = findBlockById(allPages, token.id)
      const refText = found ? found.block.content : token.id
      const refPageId = found?.page.id
      const refPageTitle = found?.page.title
      return (
        <span
          key={key}
          className={`block-ref ${found ? 'block-ref-found' : 'block-ref-missing'}`}
          title={found ? `From "${refPageTitle}"` : `Block not found: ${token.id}`}
          onClick={found ? (e) => {
            e.preventDefault()
            e.stopPropagation()
            if (e.shiftKey) onOpenSidebar(refPageId!)
            else if (onNavigateToBlock) onNavigateToBlock(refPageId!, refPageTitle!, token.id)
            else onNavigate(refPageId!, refPageTitle)
          } : undefined}
        >
          <span className="block-ref-brackets">((</span>
          <span className="block-ref-content">{refText}</span>
          <span className="block-ref-brackets">))</span>
        </span>
      )
    }

    case 'todo':
      return (
        <span key={key} className={`inline-todo ${token.done ? 'done' : ''}`}>
          {token.done ? '✓' : '○'}
        </span>
      )

    case 'attribute':
      return (
        <span key={key} className="attribute">
          <span className="attr-key">{token.key}::</span>
          <span className="attr-value"> {token.value}</span>
        </span>
      )

    case 'heading': {
      const Tag = `h${Math.min(token.level, 6)}` as keyof JSX.IntrinsicElements
      return <Tag key={key} className={`inline-heading h${token.level}`}>{token.value}</Tag>
    }

    case 'encrypt':
      return <span key={key} className="encrypted-inline">🔒 [encrypted]</span>

    default:
      return null
  }
}
