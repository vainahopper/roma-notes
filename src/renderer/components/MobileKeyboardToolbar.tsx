import React, { useState, useEffect, useRef } from 'react'
import './MobileKeyboardToolbar.css'

/**
 * Floating toolbar that appears above the iOS keyboard when editing a block.
 *
 * Uses window.visualViewport to detect the actual visible area (which shrinks
 * when the keyboard opens). On iOS WKWebView, the layout viewport does NOT
 * resize when the keyboard appears, so `position:fixed; bottom:0` ends up
 * hidden behind the keyboard. We calculate the keyboard height and set
 * `bottom` via inline style so the bar rides just above the keyboard.
 */

function insertAtCursor(text: string, moveCursorBy = 0) {
  const el = document.activeElement as HTMLTextAreaElement | HTMLInputElement
  if (!el || (el.tagName !== 'TEXTAREA' && el.tagName !== 'INPUT')) return

  // execCommand('insertText') works on iOS WebKit and triggers React's onChange
  const inserted = document.execCommand('insertText', false, text)
  if (!inserted) {
    // Fallback: native setter trick
    const start = el.selectionStart ?? 0
    const end = el.selectionEnd ?? 0
    const val = el.value
    const newVal = val.slice(0, start) + text + val.slice(end)
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, 'value'
    )?.set
    setter?.call(el, newVal)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    const newCursor = start + text.length + moveCursorBy
    el.setSelectionRange(newCursor, newCursor)
    return
  }
  if (moveCursorBy !== 0) {
    const pos = (el.selectionStart ?? 0) + moveCursorBy
    el.setSelectionRange(pos, pos)
  }
}

function simulateKeyDown(key: string, shiftKey = false) {
  const el = document.activeElement
  if (!el) return
  el.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }))
}

export function MobileKeyboardToolbar() {
  const [visible, setVisible] = useState(false)
  const [bottomOffset, setBottomOffset] = useState(0)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    // ── visualViewport: track keyboard height ────────────────────────────
    const vv = window.visualViewport
    const updateOffset = () => {
      if (!vv) return
      // keyboard height = layout viewport height minus visible height minus scroll offset
      const kbHeight = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
      setBottomOffset(kbHeight)
    }
    vv?.addEventListener('resize', updateOffset)
    vv?.addEventListener('scroll', updateOffset)

    // ── Focus tracking: show toolbar when a block textarea is active ─────
    const show = (e: FocusEvent) => {
      const target = e.target as HTMLElement
      if (target?.tagName === 'TEXTAREA' && target.closest('.block-item')) {
        if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
        setVisible(true)
      }
    }
    const hide = (e: FocusEvent) => {
      const next = e.relatedTarget as HTMLElement | null
      // Stay visible if focus moves to another block textarea
      if (next?.tagName === 'TEXTAREA' && next.closest('.block-item')) return
      // Stay visible if focus moves to the toolbar itself
      if (next?.closest('.mobile-kb-toolbar')) return
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
      hideTimerRef.current = setTimeout(() => {
        setVisible(false)
        setBottomOffset(0)
      }, 150)
    }
    document.addEventListener('focusin', show)
    document.addEventListener('focusout', hide)

    return () => {
      vv?.removeEventListener('resize', updateOffset)
      vv?.removeEventListener('scroll', updateOffset)
      document.removeEventListener('focusin', show)
      document.removeEventListener('focusout', hide)
    }
  }, [])

  if (!visible) return null

  const handleWikilink = (e: React.MouseEvent) => {
    e.preventDefault()
    const ta = document.activeElement as HTMLTextAreaElement
    if (!ta || ta.tagName !== 'TEXTAREA') return
    const start = ta.selectionStart ?? 0
    const end = ta.selectionEnd ?? 0
    const selected = ta.value.slice(start, end)
    if (selected) {
      insertAtCursor(`[[${selected}]]`)
    } else {
      insertAtCursor('[[]]', -2)
    }
    ta.focus()
  }

  const handleSlash = (e: React.MouseEvent) => {
    e.preventDefault()
    const ta = document.activeElement as HTMLTextAreaElement
    if (!ta || ta.tagName !== 'TEXTAREA') return
    insertAtCursor('/')
    ta.focus()
  }

  const handleIndent = (e: React.MouseEvent) => {
    e.preventDefault()
    simulateKeyDown('Tab', false)
  }

  const handleOutdent = (e: React.MouseEvent) => {
    e.preventDefault()
    simulateKeyDown('Tab', true)
  }

  return (
    <div className="mobile-kb-toolbar" style={{ bottom: `${bottomOffset}px` }}>
      <button className="mobile-kb-btn" onMouseDown={handleWikilink} title="Insert page link">
        <span className="mobile-kb-btn-label">[[</span>
        <span className="mobile-kb-btn-sub">Page</span>
      </button>
      <div className="mobile-kb-sep" />
      <button className="mobile-kb-btn" onMouseDown={handleSlash} title="Commands">
        <span className="mobile-kb-btn-label">/</span>
        <span className="mobile-kb-btn-sub">Cmds</span>
      </button>
      <div className="mobile-kb-sep" />
      <button className="mobile-kb-btn" onMouseDown={handleIndent} title="Indent (Tab)">
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <path d="M4 5H14M4 9H11M4 13H8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          <path d="M13 11L16 9L13 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <span className="mobile-kb-btn-sub">Indent</span>
      </button>
      <button className="mobile-kb-btn" onMouseDown={handleOutdent} title="Outdent (Shift+Tab)">
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <path d="M4 5H14M7 9H14M10 13H14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          <path d="M5 7L2 9L5 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <span className="mobile-kb-btn-sub">Outdent</span>
      </button>
    </div>
  )
}
