import React from 'react'
import './MobileBottomBar.css'

interface Props {
  activeView: string
  onDailyNotes: () => void
  onSearch: () => void
  onCalendar: () => void
  syncStatus?: string | null
}

export function MobileBottomBar({ activeView, onDailyNotes, onSearch, onCalendar, syncStatus }: Props) {
  const isDailyActive = activeView === 'daily'

  return (
    <nav className="mobile-bottom-bar">
      <button
        className={`mobile-bottom-item${isDailyActive ? ' active' : ''}`}
        onClick={onDailyNotes}
        aria-label="Daily Notes"
      >
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
          <rect x="3" y="4" width="16" height="15" rx="2.5" stroke="currentColor" strokeWidth="1.4"/>
          <path d="M7 2V5M15 2V5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          <path d="M3 8H19" stroke="currentColor" strokeWidth="1.4"/>
          <path d="M7 12H11M7 15H13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
        </svg>
        <span>Daily</span>
      </button>

      <button
        className="mobile-bottom-item"
        onClick={onSearch}
        aria-label="Search"
      >
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
          <circle cx="10" cy="10" r="6.5" stroke="currentColor" strokeWidth="1.4"/>
          <path d="M15 15L19 19" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
        </svg>
        <span>Search</span>
      </button>

      <button
        className="mobile-bottom-item"
        onClick={onCalendar}
        aria-label="Calendar"
      >
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
          <rect x="3" y="4" width="16" height="15" rx="2.5" stroke="currentColor" strokeWidth="1.4"/>
          <path d="M7 2V5M15 2V5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          <path d="M3 8H19" stroke="currentColor" strokeWidth="1.4"/>
          <circle cx="11" cy="13.5" r="2" fill="currentColor"/>
        </svg>
        <span>Calendar</span>
      </button>

      {syncStatus && (
        <span className="mobile-bottom-sync">{syncStatus}</span>
      )}
    </nav>
  )
}
