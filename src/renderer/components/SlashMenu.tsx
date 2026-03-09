import React, { useState, useEffect } from 'react'
import './SlashMenu.css'

export interface SlashCommand {
  id: string
  label: string
  description: string
  icon: string
  action: () => void
}

interface Props {
  query: string
  commands: SlashCommand[]
  anchorRef: React.RefObject<HTMLTextAreaElement | null>
  onClose: () => void
}

export function SlashMenu({ query, commands, anchorRef, onClose }: Props) {
  const [selected, setSelected] = useState(0)

  const filtered = query
    ? commands.filter(c =>
        c.label.toLowerCase().includes(query.toLowerCase()) ||
        c.description.toLowerCase().includes(query.toLowerCase())
      )
    : commands

  useEffect(() => setSelected(0), [query])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault(); e.stopPropagation()
        setSelected(i => (i + 1) % Math.max(filtered.length, 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault(); e.stopPropagation()
        setSelected(i => (i - 1 + Math.max(filtered.length, 1)) % Math.max(filtered.length, 1))
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault(); e.stopPropagation()
        if (filtered[selected]) { filtered[selected].action(); onClose() }
      } else if (e.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handler, { capture: true })
    return () => window.removeEventListener('keydown', handler, { capture: true })
  }, [filtered, selected, onClose])

  if (filtered.length === 0) return null

  const style = getStyle(anchorRef)

  return (
    <div className="slash-menu" style={style}>
      <div className="slash-menu-header">Commands</div>
      {filtered.map((cmd, i) => (
        <button
          key={cmd.id}
          className={`slash-menu-item ${i === selected ? 'selected' : ''}`}
          onMouseDown={e => { e.preventDefault(); cmd.action(); onClose() }}
          onMouseEnter={() => setSelected(i)}
        >
          <span className="slash-icon">{cmd.icon}</span>
          <div className="slash-text">
            <span className="slash-label">{cmd.label}</span>
            <span className="slash-desc">{cmd.description}</span>
          </div>
        </button>
      ))}
    </div>
  )
}

function getStyle(anchorRef: React.RefObject<HTMLTextAreaElement | null>): React.CSSProperties {
  if (!anchorRef.current) return { position: 'fixed', top: 0, left: 0, zIndex: 500 }
  const rect = anchorRef.current.getBoundingClientRect()
  return { position: 'fixed', top: rect.bottom + 4, left: rect.left, zIndex: 500 }
}
