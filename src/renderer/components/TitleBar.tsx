import React from 'react'
import './TitleBar.css'

declare const __APP_VERSION__: string

interface Props {
  onCalendar: () => void
  onToggleSidebar: () => void
  onSearch: () => void
  onToday: () => void
  onNewPage: () => void
  sidebarOpen: boolean
  canBack?: boolean
  canForward?: boolean
  onBack?: () => void
  onForward?: () => void
}

export function TitleBar({
  onCalendar, onToggleSidebar, onSearch, onToday, onNewPage,
  sidebarOpen, canBack = false, canForward = false, onBack, onForward,
}: Props) {
  return (
    <div className="titlebar titlebar-drag">
      {/* Left: sidebar toggle + back/forward */}
      <div className="titlebar-left titlebar-no-drag">
        <button
          className={`titlebar-btn ${sidebarOpen ? 'active' : ''}`}
          onClick={onToggleSidebar}
          title="Toggle Sidebar"
        >
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
            <rect x="1" y="1" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="1.2"/>
            <line x1="5" y1="1" x2="5" y2="14" stroke="currentColor" strokeWidth="1.2"/>
          </svg>
        </button>

        {/* Back */}
        <button
          className="titlebar-btn nav-btn"
          onClick={onBack}
          disabled={!canBack}
          title="Go Back"
        >
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
            <path d="M8 2L4 6.5L8 11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>

        {/* Forward */}
        <button
          className="titlebar-btn nav-btn"
          onClick={onForward}
          disabled={!canForward}
          title="Go Forward"
        >
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
            <path d="M5 2L9 6.5L5 11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>

      <div className="titlebar-center">
        <span className="app-name">Roma Research</span>
        <span className="titlebar-version">v{__APP_VERSION__}</span>
      </div>

      <div className="titlebar-right titlebar-no-drag">
        <button className="titlebar-btn" onClick={onSearch} title="Search">
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
            <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.2"/>
            <line x1="9.5" y1="9.5" x2="13.5" y2="13.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
          </svg>
        </button>

        <button className="titlebar-btn" onClick={onNewPage} title="New Page">
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
            <line x1="7.5" y1="2" x2="7.5" y2="13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            <line x1="2" y1="7.5" x2="13" y2="7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>

        <button className="titlebar-btn" onClick={onCalendar} title="Calendar">
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
            <rect x="1.5" y="2.5" width="12" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.2"/>
            <line x1="1.5" y1="6" x2="13.5" y2="6" stroke="currentColor" strokeWidth="1.2"/>
            <line x1="4.5" y1="1" x2="4.5" y2="4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            <line x1="10.5" y1="1" x2="10.5" y2="4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
          </svg>
        </button>
      </div>
    </div>
  )
}
