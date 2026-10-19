import React, { useMemo, useState } from 'react'
import type { Page } from '../../shared/types'
import { buildLinkIndex } from '../utils/linkGraph'
import './AllPagesView.css'

interface Props {
  allPages: Map<string, Page>
  pagesVersion: number
  onNavigate: (id: string, title?: string) => void
  onOpenSidebar: (id: string) => void
}

type SortKey = 'title' | 'mentions' | 'updated' | 'created'

const PAGE_CHUNK = 300

function countBlocks(blocks: Page['blocks']): number {
  let n = 0
  for (const b of blocks) {
    if (b.content.trim() !== '') n++
    n += countBlocks(b.children)
  }
  return n
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime()) || d.getFullYear() < 1980) return '—'
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export function AllPagesView({ allPages, pagesVersion, onNavigate, onOpenSidebar }: Props) {
  const [filter, setFilter] = useState('')
  const [showDaily, setShowDaily] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('updated')
  const [sortDesc, setSortDesc] = useState(true)
  const [limit, setLimit] = useState(PAGE_CHUNK)

  // allPages.size: empty daily placeholders are added without a pagesVersion bump
  const pages = useMemo(() => Array.from(allPages.values()), [allPages, pagesVersion, allPages.size])
  const { incomingCount } = useMemo(() => buildLinkIndex(pages), [pages])

  const rows = useMemo(() => {
    const q = filter.toLowerCase().trim()
    const list = pages
      .filter(p => showDaily || !p.isDaily)
      .filter(p => !q || p.title.toLowerCase().includes(q))
      // Hide never-touched placeholders (e.g. empty daily stubs)
      .filter(p => !p.isDaily || countBlocks(p.blocks) > 0)
      .map(p => ({
        page: p,
        mentions: incomingCount.get(p.id) ?? 0,
        blocks: countBlocks(p.blocks),
      }))
    const dir = sortDesc ? -1 : 1
    list.sort((a, b) => {
      switch (sortKey) {
        case 'title': return dir * a.page.title.localeCompare(b.page.title)
        case 'mentions': return dir * (a.mentions - b.mentions)
        case 'created': return dir * (new Date(a.page.createdAt).getTime() - new Date(b.page.createdAt).getTime())
        default: return dir * (new Date(a.page.updatedAt).getTime() - new Date(b.page.updatedAt).getTime())
      }
    })
    return list
  }, [pages, incomingCount, filter, showDaily, sortKey, sortDesc])

  function toggleSort(key: SortKey) {
    if (key === sortKey) setSortDesc(d => !d)
    else { setSortKey(key); setSortDesc(key !== 'title') }
  }

  function SortHeader({ k, label, className }: { k: SortKey; label: string; className?: string }) {
    const active = sortKey === k
    return (
      <th className={`${className ?? ''} ${active ? 'sorted' : ''}`} onClick={() => toggleSort(k)}>
        {label}
        <span className="sort-arrow">{active ? (sortDesc ? '↓' : '↑') : ''}</span>
      </th>
    )
  }

  return (
    <div className="all-pages-view page-scroll">
      <div className="all-pages-content">
        <div className="all-pages-header">
          <h1 className="all-pages-title">All Pages</h1>
          <span className="all-pages-count">{rows.length}</span>
        </div>

        <div className="all-pages-toolbar">
          <div className="all-pages-filter">
            <svg width="13" height="13" viewBox="0 0 15 15" fill="none">
              <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.2"/>
              <line x1="9.5" y1="9.5" x2="13.5" y2="13.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
            <input
              value={filter}
              onChange={e => { setFilter(e.target.value); setLimit(PAGE_CHUNK) }}
              placeholder="Filter pages…"
            />
          </div>
          <label className="all-pages-toggle">
            <input type="checkbox" checked={showDaily} onChange={e => setShowDaily(e.target.checked)} />
            Daily notes
          </label>
        </div>

        <table className="all-pages-table">
          <thead>
            <tr>
              <SortHeader k="title" label="Title" className="col-title" />
              <SortHeader k="mentions" label="Mentions" className="col-num" />
              <SortHeader k="updated" label="Updated" className="col-date" />
              <SortHeader k="created" label="Created" className="col-date col-created" />
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map(({ page, mentions, blocks }) => (
              <tr
                key={page.id}
                onClick={e => e.shiftKey ? onOpenSidebar(page.id) : onNavigate(page.id, page.title)}
              >
                <td className="col-title">
                  <span className="all-pages-name">{page.title || 'Untitled'}</span>
                  {page.starred && <span className="all-pages-star" title="Starred">★</span>}
                  {blocks === 0 && <span className="all-pages-empty">empty</span>}
                </td>
                <td className="col-num">{mentions || ''}</td>
                <td className="col-date">{formatDate(page.updatedAt)}</td>
                <td className="col-date col-created">{formatDate(page.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {rows.length > limit && (
          <button className="all-pages-more" onClick={() => setLimit(l => l + PAGE_CHUNK)}>
            Show more ({rows.length - limit} left)
          </button>
        )}
        {rows.length === 0 && <div className="all-pages-none">No pages match.</div>}
      </div>
    </div>
  )
}
