import React, { useState, useEffect, useRef } from 'react'
import { getMobilePopupStyle } from '../utils/helpers'
import './DatePickerInline.css'

interface Props {
  anchorRef: React.RefObject<HTMLTextAreaElement | null>
  onSelect: (dateStr: string) => void  // returns "[[Month Dth, YYYY]]" formatted title
  onClose: () => void
}

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
const DAY_LABELS = ['Su','Mo','Tu','We','Th','Fr','Sa']

function ordinal(n: number): string {
  const s = ['th','st','nd','rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

function formatRoamDate(date: Date): string {
  return `${MONTHS[date.getMonth()]} ${ordinal(date.getDate())}, ${date.getFullYear()}`
}

export function DatePickerInline({ anchorRef, onSelect, onClose }: Props) {
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())
  const containerRef = useRef<HTMLDivElement>(null)

  const style = getDropdownStyle(anchorRef)

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose() }
    }
    window.addEventListener('keydown', handler, { capture: true })
    return () => window.removeEventListener('keydown', handler, { capture: true })
  }, [onClose])

  // Build calendar grid
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  const cells: (number | null)[] = []
  for (let i = 0; i < firstDay; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  function prevMonth() {
    if (month === 0) { setMonth(11); setYear(y => y - 1) }
    else setMonth(m => m - 1)
  }
  function nextMonth() {
    if (month === 11) { setMonth(0); setYear(y => y + 1) }
    else setMonth(m => m + 1)
  }

  function selectDay(day: number) {
    const date = new Date(year, month, day)
    onSelect(formatRoamDate(date))
  }

  const isToday = (day: number) =>
    day === today.getDate() && month === today.getMonth() && year === today.getFullYear()

  return (
    <div ref={containerRef} className="date-picker-inline" style={style}>
      <div className="dp-header">
        <button className="dp-nav" onClick={prevMonth} title="Previous month">‹</button>
        <span className="dp-month-label">{MONTHS[month]} {year}</span>
        <button className="dp-nav" onClick={nextMonth} title="Next month">›</button>
      </div>
      <div className="dp-grid">
        {DAY_LABELS.map(d => (
          <div key={d} className="dp-day-label">{d}</div>
        ))}
        {cells.map((day, i) => (
          <button
            key={i}
            className={`dp-cell ${day === null ? 'dp-empty' : ''} ${day && isToday(day) ? 'dp-today' : ''}`}
            onClick={() => day && selectDay(day)}
            disabled={day === null}
            tabIndex={day === null ? -1 : 0}
          >
            {day ?? ''}
          </button>
        ))}
      </div>
      <div className="dp-footer">
        <button className="dp-today-btn" onClick={() => selectDay(today.getDate())}>Today</button>
      </div>
    </div>
  )
}

function getDropdownStyle(anchorRef: React.RefObject<HTMLTextAreaElement | null>): React.CSSProperties {
  return getMobilePopupStyle(anchorRef, true)
}
