import React, { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { getMobilePopupStyle } from '../utils/helpers'
import './DatePickerInline.css'

interface Props {
  anchorRef: React.RefObject<HTMLTextAreaElement | null>
  onSelect: (dateStr: string) => void  // returns "[[Month Dth, YYYY]]" formatted title
  onClose: () => void
}

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
const DAY_LABELS = ['Su','Mo','Tu','We','Th','Fr','Sa']
// Always render 6 weeks so the popup never changes height between months —
// otherwise the header (and the ‹ › buttons) jump under the pointer.
const GRID_CELLS = 42

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
  const [, setViewportTick] = useState(0)
  const [flipUp, setFlipUp] = useState(false)

  const style = getDropdownStyle(anchorRef, flipUp)

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose() }
    }
    window.addEventListener('keydown', handler, { capture: true })
    return () => window.removeEventListener('keydown', handler, { capture: true })
  }, [onClose])

  // Close on tap/click outside the picker (and outside the block's textarea)
  useEffect(() => {
    const handler = (e: PointerEvent) => {
      const t = e.target as Node
      if (containerRef.current?.contains(t)) return
      if (anchorRef.current?.contains(t)) return
      onClose()
    }
    document.addEventListener('pointerdown', handler, true)
    return () => document.removeEventListener('pointerdown', handler, true)
  }, [anchorRef, onClose])

  // Reposition when the iOS keyboard / visual viewport changes
  useEffect(() => {
    const vv = window.visualViewport
    const bump = () => setViewportTick(t => t + 1)
    vv?.addEventListener('resize', bump)
    vv?.addEventListener('scroll', bump)
    window.addEventListener('resize', bump)
    return () => {
      vv?.removeEventListener('resize', bump)
      vv?.removeEventListener('scroll', bump)
      window.removeEventListener('resize', bump)
    }
  }, [])

  // Desktop: open above the block when there's no room below
  useLayoutEffect(() => {
    if (window.innerWidth <= 768) return
    const el = containerRef.current
    const rect = anchorRef.current?.getBoundingClientRect()
    if (!el || !rect) return
    const h = el.offsetHeight
    setFlipUp(rect.bottom + 4 + h > window.innerHeight && rect.top - 4 - h >= 0)
  }, [anchorRef])

  // Build calendar grid (fixed 6 rows)
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  const cells: (number | null)[] = []
  for (let i = 0; i < firstDay; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  while (cells.length < GRID_CELLS) cells.push(null)

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

  function selectToday() {
    onSelect(formatRoamDate(today))
  }

  const isToday = (day: number) =>
    day === today.getDate() && month === today.getMonth() && year === today.getFullYear()

  return (
    <div
      ref={containerRef}
      className="date-picker-inline"
      style={style}
      // Keep focus in the block textarea: otherwise the textarea blurs, editing
      // ends (or the iOS keyboard closes) and the picker unmounts/jumps.
      onMouseDown={e => e.preventDefault()}
    >
      <div className="dp-header">
        <button type="button" className="dp-nav" onClick={prevMonth} title="Previous month" aria-label="Previous month">‹</button>
        <span className="dp-month-label">{MONTHS[month]} {year}</span>
        <button type="button" className="dp-nav" onClick={nextMonth} title="Next month" aria-label="Next month">›</button>
      </div>
      <div className="dp-grid">
        {DAY_LABELS.map(d => (
          <div key={d} className="dp-day-label">{d}</div>
        ))}
        {cells.map((day, i) => (
          <button
            type="button"
            key={i}
            className={`dp-cell ${day === null ? 'dp-empty' : ''} ${day && isToday(day) ? 'dp-today' : ''}`}
            onClick={() => day && selectDay(day)}
            disabled={day === null}
            tabIndex={-1}
          >
            {day ?? ''}
          </button>
        ))}
      </div>
      <div className="dp-footer">
        <button type="button" className="dp-today-btn" onClick={selectToday}>Today</button>
      </div>
    </div>
  )
}

function getDropdownStyle(
  anchorRef: React.RefObject<HTMLTextAreaElement | null>,
  flipUp: boolean,
): React.CSSProperties {
  const style = getMobilePopupStyle(anchorRef, true)
  if (window.innerWidth <= 768) return style
  const rect = anchorRef.current?.getBoundingClientRect()
  if (!rect) return style
  // Keep the 240px popup inside the window horizontally
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - 248))
  return flipUp
    ? { position: 'fixed', bottom: window.innerHeight - rect.top + 4, left, zIndex: 500 }
    : { ...style, left }
}
