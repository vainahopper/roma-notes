import React, { useState, useEffect, useRef } from 'react'
import type { Page, SearchResult } from '../../shared/types'
import { search, buildSearchIndex } from '../utils/search'
import { createNewPage } from '../stores/useStore'
import './SearchModal.css'

interface Props {
  pages: Map<string, Page>
  onClose: () => void
  onNavigate: (pageId: string, pageTitle: string, blockId?: string) => void
}

export function SearchModal({ pages, onClose, onNavigate }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const trimmedQuery = query.trim()
  const showCreate = trimmedQuery.length > 0 &&
    !Array.from(pages.values()).some(p => p.title.toLowerCase() === trimmedQuery.toLowerCase())
  const totalItems = results.length + (showCreate ? 1 : 0)
  const createIndex = showCreate ? results.length : -1

  const handleCreatePage = () => {
    const id = trimmedQuery.toLowerCase()
    createNewPage(trimmedQuery, id)
    onNavigate(id, trimmedQuery)
  }

  // Rebuild index with latest pages every time modal opens
  useEffect(() => {
    buildSearchIndex(Array.from(pages.values()))
    inputRef.current?.focus()
  }, [pages])

  useEffect(() => {
    if (query.trim()) {
      const r = search(query, 20)
      setResults(r)
      setSelected(0)
    } else {
      // Show recently visited pages (tracked in localStorage), fallback to updatedAt
      let recentIds: string[] = []
      try {
        recentIds = JSON.parse(localStorage.getItem('roma-recent-pages') ?? '[]')
      } catch {}

      let recent: SearchResult[]
      if (recentIds.length > 0) {
        recent = recentIds
          .map(id => pages.get(id))
          .filter((p): p is Page => p != null)
          .slice(0, 10)
          .map(p => ({
            type: 'page' as const,
            pageId: p.id,
            pageTitle: p.title,
            content: p.title,
            score: 0,
          }))
      } else {
        recent = Array.from(pages.values())
          .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
          .slice(0, 10)
          .map(p => ({
            type: 'page' as const,
            pageId: p.id,
            pageTitle: p.title,
            content: p.title,
            score: 0,
          }))
      }
      setResults(recent)
      setSelected(0)
    }
  }, [query, pages])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelected(i => Math.min(i + 1, totalItems - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelected(i => Math.max(i - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (selected === createIndex) {
          handleCreatePage()
        } else {
          const r = results[selected]
          if (r) onNavigate(r.pageId, r.pageTitle, r.blockId)
        }
      } else if (e.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [results, selected, totalItems, createIndex, onNavigate, onClose, trimmedQuery])

  function highlight(text: string, q: string): React.ReactNode {
    if (!q.trim()) return text
    const regex = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')
    const parts = text.split(regex)
    return parts.map((part, i) =>
      regex.test(part) ? <mark key={i}>{part}</mark> : <span key={i}>{part}</span>
    )
  }

  return (
    <div className="search-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="search-modal">
        <div className="search-input-row">
          <svg width="16" height="16" viewBox="0 0 15 15" fill="none" className="search-icon">
            <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.3"/>
            <line x1="9.5" y1="9.5" x2="13.5" y2="13.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
          </svg>
          <input
            ref={inputRef}
            type="text"
            placeholder="Search pages and blocks…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="search-input"
          />
          <kbd className="search-esc" onClick={onClose}>Esc</kbd>
        </div>

        <div className="search-results">
          {!query && (
            <div className="search-section-label">Recent</div>
          )}
          {results.map((result, i) => (
            <button
              key={`${result.pageId}-${result.blockId ?? 'page'}-${i}`}
              className={`search-result ${i === selected ? 'selected' : ''}`}
              onClick={() => onNavigate(result.pageId, result.pageTitle, result.blockId)}
              onMouseEnter={() => setSelected(i)}
            >
              <div className="result-type">
                {result.type === 'page' ? (
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <rect x="1" y="1" width="10" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2"/>
                    <line x1="3" y1="4" x2="9" y2="4" stroke="currentColor" strokeWidth="1"/>
                    <line x1="3" y1="6" x2="9" y2="6" stroke="currentColor" strokeWidth="1"/>
                    <line x1="3" y1="8" x2="6" y2="8" stroke="currentColor" strokeWidth="1"/>
                  </svg>
                ) : (
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <circle cx="2.5" cy="6" r="1.5" fill="currentColor"/>
                    <line x1="5" y1="6" x2="10" y2="6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                  </svg>
                )}
              </div>
              <div className="result-content">
                <div className="result-page">{highlight(result.pageTitle, query)}</div>
                {result.type === 'block' && result.content !== result.pageTitle && (
                  <div className="result-block">{highlight(result.content, query)}</div>
                )}
              </div>
              <div className="result-arrow">→</div>
            </button>
          ))}
        </div>

        {showCreate && (
          <div className="search-create-bar">
            <button
              className={`search-result search-create ${selected === createIndex ? 'selected' : ''}`}
              onClick={handleCreatePage}
              onMouseEnter={() => setSelected(createIndex)}
            >
              <div className="result-type">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <line x1="6" y1="2" x2="6" y2="10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                  <line x1="2" y1="6" x2="10" y2="6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                </svg>
              </div>
              <div className="result-content">
                <div className="result-page">Create page <strong>"{trimmedQuery}"</strong></div>
              </div>
              <div className="result-arrow">→</div>
            </button>
          </div>
        )}

        <div className="search-footer">
          <span><kbd>↑↓</kbd> Navigate</span>
          <span><kbd>↵</kbd> Open</span>
          <span><kbd>Esc</kbd> Close</span>
        </div>
      </div>
    </div>
  )
}
