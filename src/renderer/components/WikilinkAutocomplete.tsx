import React, { useState, useEffect, useRef } from 'react'
import type { Page } from '../../shared/types'
import { searchPages } from '../utils/search'
import './WikilinkAutocomplete.css'

interface Props {
  query: string
  allPages: Map<string, Page>
  anchorRef: React.RefObject<HTMLTextAreaElement | null>
  onSelect: (page: Page) => void
  onCreate: (title: string) => void
  onClose: () => void
}

export function WikilinkAutocomplete({ query, allPages, anchorRef, onSelect, onCreate, onClose }: Props) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const pages = Array.from(allPages.values())

  const results = searchPages(query, pages, 8)
  const showCreate = query.trim() && !results.some(p => p.title.toLowerCase() === query.toLowerCase())

  const totalItems = results.length + (showCreate ? 1 : 0)

  // Position the autocomplete
  const style = getDropdownStyle(anchorRef)

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex(i => (i + 1) % totalItems)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex(i => (i - 1 + totalItems) % totalItems)
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        e.stopPropagation()
        if (selectedIndex < results.length) {
          onSelect(results[selectedIndex])
        } else if (showCreate) {
          onCreate(query.trim())
        }
      } else if (e.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handler, { capture: true })
    return () => window.removeEventListener('keydown', handler, { capture: true })
  }, [selectedIndex, results, showCreate, query, onSelect, onCreate, onClose, totalItems])

  if (totalItems === 0 && !query) return null

  return (
    <div ref={containerRef} className="wikilink-autocomplete" style={style}>
      {results.length === 0 && !showCreate && (
        <div className="autocomplete-empty">No pages found</div>
      )}

      {results.map((page, i) => (
        <button
          key={page.id}
          className={`autocomplete-item ${i === selectedIndex ? 'selected' : ''}`}
          onMouseDown={e => { e.preventDefault(); onSelect(page) }}
          onMouseEnter={() => setSelectedIndex(i)}
        >
          <span className="item-icon">{page.isDaily ? '◆' : '○'}</span>
          <span className="item-title">{page.title}</span>
        </button>
      ))}

      {showCreate && (
        <button
          className={`autocomplete-item create-item ${selectedIndex === results.length ? 'selected' : ''}`}
          onMouseDown={e => { e.preventDefault(); onCreate(query.trim()) }}
          onMouseEnter={() => setSelectedIndex(results.length)}
        >
          <span className="item-icon">+</span>
          <span className="item-title">Create "<strong>{query}</strong>"</span>
        </button>
      )}
    </div>
  )
}

function getDropdownStyle(anchorRef: React.RefObject<HTMLTextAreaElement | null>): React.CSSProperties {
  if (!anchorRef.current) return { top: 0, left: 0 }
  const rect = anchorRef.current.getBoundingClientRect()
  return {
    position: 'fixed',
    top: rect.bottom + 4,
    left: rect.left,
    zIndex: 500,
  }
}
