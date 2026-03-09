import React from 'react'
import './TitleBar.css'

declare const __APP_VERSION__: string

interface Props {
  theme: 'dark' | 'light'
  themeMode?: 'dark' | 'light' | 'system'
  onToggleTheme: () => void
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
  theme, themeMode = theme, onToggleTheme, onToggleSidebar, onSearch, onToday, onNewPage,
  sidebarOpen, canBack = false, canForward = false, onBack, onForward,
}: Props) {
  const themeTitle = themeMode === 'system' ? 'Theme: System (click to cycle)'
    : themeMode === 'dark' ? 'Theme: Dark (click to cycle)'
    : 'Theme: Light (click to cycle)'

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
        <span className="app-name">Roma Notes</span>
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

        <button className="titlebar-btn" onClick={onToggleTheme} title={themeTitle}>
          {themeMode === 'system' ? (
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
              <circle cx="7.5" cy="7.5" r="4" stroke="currentColor" strokeWidth="1.2"/>
              <path d="M7.5 3.5V11.5" stroke="currentColor" strokeWidth="1.2"/>
              <path d="M7.5 3.5C5.3 3.5 3.5 5.3 3.5 7.5S5.3 11.5 7.5 11.5" fill="currentColor"/>
            </svg>
          ) : theme === 'dark' ? (
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
              <circle cx="7.5" cy="7.5" r="3" stroke="currentColor" strokeWidth="1.2"/>
              <line x1="7.5" y1="1" x2="7.5" y2="2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
              <line x1="7.5" y1="12.5" x2="7.5" y2="14" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
              <line x1="1" y1="7.5" x2="2.5" y2="7.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
              <line x1="12.5" y1="7.5" x2="14" y2="7.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
          ) : (
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
              <path d="M8 2.5C8 2.5 6 3.5 6 7.5C6 11.5 8 12.5 8 12.5C4.5 12.5 2 10.5 2 7.5C2 4.5 4.5 2.5 8 2.5Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
            </svg>
          )}
        </button>
      </div>
    </div>
  )
}
