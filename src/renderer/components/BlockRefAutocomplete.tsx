import React, { useState, useEffect } from 'react'
import type { Page, Block } from '../../shared/types'
import { stripMarkdown } from '../utils/helpers'
import Fuse from 'fuse.js'
import './BlockRefAutocomplete.css'

interface BlockResult {
  blockId: string
  blockContent: string
  pageTitle: string
  pageId: string
}

interface Props {
  query: string
  allPages: Map<string, Page>
  anchorRef: React.RefObject<HTMLTextAreaElement | null>
  onSelect: (blockId: string, blockContent: string) => void
  onClose: () => void
}

export function BlockRefAutocomplete({ query, allPages, anchorRef, onSelect, onClose }: Props) {
  const [selected, setSelected] = useState(0)

  // Build flat list of all blocks
  const allBlocks: BlockResult[] = []
  for (const [, page] of allPages) {
    function collect(block: Block) {
      const text = stripMarkdown(block.content)
      if (text.trim()) allBlocks.push({ blockId: block.id, blockContent: text, pageTitle: page.title, pageId: page.id })
      block.children.forEach(collect)
    }
    page.blocks.forEach(collect)
  }

  const results: BlockResult[] = query.trim()
    ? new Fuse(allBlocks, { keys: ['blockContent'], threshold: 0.4, ignoreLocation: true }).search(query, { limit: 8 }).map(r => r.item)
    : allBlocks.slice(0, 8)

  useEffect(() => setSelected(0), [query])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); setSelected(i => (i + 1) % Math.max(results.length, 1)) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); setSelected(i => (i - 1 + Math.max(results.length, 1)) % Math.max(results.length, 1)) }
      else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault(); e.stopPropagation()
        if (results[selected]) onSelect(results[selected].blockId, results[selected].blockContent)
      } else if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler, { capture: true })
    return () => window.removeEventListener('keydown', handler, { capture: true })
  }, [results, selected, onSelect, onClose])

  if (results.length === 0) return null

  const rect = anchorRef.current?.getBoundingClientRect()
  const style: React.CSSProperties = rect
    ? { position: 'fixed', top: rect.bottom + 4, left: rect.left, zIndex: 500 }
    : { position: 'fixed', top: 0, left: 0, zIndex: 500 }

  return (
    <div className="blockref-autocomplete" style={style}>
      <div className="blockref-header">Block reference</div>
      {results.map((r, i) => (
        <button
          key={r.blockId}
          className={`blockref-item ${i === selected ? 'selected' : ''}`}
          onMouseDown={e => { e.preventDefault(); onSelect(r.blockId, r.blockContent) }}
          onMouseEnter={() => setSelected(i)}
        >
          <span className="blockref-page">{r.pageTitle}</span>
          <span className="blockref-content">{r.blockContent.slice(0, 80)}</span>
        </button>
      ))}
    </div>
  )
}
