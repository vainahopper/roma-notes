import React, { useState } from 'react'
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isToday, addMonths, subMonths, getDay } from 'date-fns'
import type { Page } from '../../shared/types'
import { dateToPageId, dateToPageTitle, parseDatePage } from '../utils/helpers'
import { getOrCreateDailyPage } from '../stores/useStore'
import './CalendarModal.css'

interface Props {
  pages: Map<string, Page>
  onClose: () => void
  onNavigate: (pageId: string, pageTitle: string) => void
}

export function CalendarModal({ pages, onClose, onNavigate }: Props) {
  const [currentMonth, setCurrentMonth] = useState(new Date())

  const monthStart = startOfMonth(currentMonth)
  const monthEnd = endOfMonth(currentMonth)
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd })

  // Pad start with empty days
  const startPad = getDay(monthStart) // 0 = Sunday
  const emptyStart = Array(startPad).fill(null)

  function hasNote(date: Date): boolean {
    const id = dateToPageId(date)
    const page = pages.get(id)
    if (!page) return false
    // Has actual content
    return page.blocks.some(b => b.content.trim() !== '' || b.children.length > 0)
  }

  function handleDayClick(date: Date) {
    const id = dateToPageId(date)
    const title = dateToPageTitle(date)
    getOrCreateDailyPage(id, title)
    onNavigate(id, title)
  }

  const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  return (
    <div className="calendar-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="calendar-modal">
        <div className="calendar-header">
          <button className="cal-nav-btn" onClick={() => setCurrentMonth(m => subMonths(m, 1))}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M9 2L4 7L9 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
          <span className="cal-month-label">
            {format(currentMonth, 'MMMM yyyy')}
          </span>
          <button className="cal-nav-btn" onClick={() => setCurrentMonth(m => addMonths(m, 1))}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M5 2L10 7L5 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        <div className="calendar-weekdays">
          {weekDays.map(d => (
            <div key={d} className="weekday-label">{d}</div>
          ))}
        </div>

        <div className="calendar-grid">
          {emptyStart.map((_, i) => (
            <div key={`empty-${i}`} className="cal-day empty" />
          ))}
          {days.map(date => {
            const hasContent = hasNote(date)
            const today = isToday(date)
            return (
              <button
                key={date.toISOString()}
                className={`cal-day ${today ? 'today' : ''} ${hasContent ? 'has-note' : ''}`}
                onClick={() => handleDayClick(date)}
                title={format(date, 'EEEE, MMMM d, yyyy')}
              >
                <span className="day-number">{format(date, 'd')}</span>
                {hasContent && <span className="day-dot" />}
              </button>
            )
          })}
        </div>

        <div className="calendar-footer">
          <button
            className="today-btn"
            onClick={() => {
              setCurrentMonth(new Date())
              handleDayClick(new Date())
            }}
          >
            Go to Today
          </button>
        </div>
      </div>
    </div>
  )
}
