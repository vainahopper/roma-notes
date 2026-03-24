import React, { useRef, useEffect, useLayoutEffect, useState, useCallback, useMemo } from 'react'
import type { Block, Page } from '../../shared/types'
import { BlockContent } from './BlockContent'
import { WikilinkAutocomplete } from './WikilinkAutocomplete'
import { BlockRefAutocomplete } from './BlockRefAutocomplete'
import { SlashMenu, type SlashCommand } from './SlashMenu'
import { DatePickerInline } from './DatePickerInline'
import { isEncryptedBlock, encryptBlock, encryptBlockSync, decryptBlock } from '../utils/encryption'
import { dateToPageTitle } from '../utils/helpers'
import { platform } from '../platform'
import './BlockItem.css'

interface Props {
  block: Block
  depth: number
  allPages: Map<string, Page>
  requestFocusId: string | null
  onConsumeFocus: () => string | null
  onChange: (id: string, content: string) => void
  onToggleCheck: (id: string) => void
  onToggleTodo: (id: string) => void
  onEnter: (id: string, cursorPos: number, content: string) => void
  onBackspace: (id: string, isEmpty: boolean, isCollapsed?: boolean) => void
  onTab: (id: string, shift: boolean) => void
  onArrowUp: (id: string) => void
  onArrowDown: (id: string) => void
  onNavigate: (id: string, title?: string) => void
  onOpenSidebar: (id: string) => void
  onDelete?: (id: string) => void
  onPasteBlocks?: (id: string, contentBefore: string, contentAfter: string, pastedText: string) => void
  onZoom?: (id: string, content: string) => void
  onNavigateToBlock?: (pageId: string, pageTitle: string, blockId: string) => void
  hasBlockSelection?: boolean
  onDragHandleMouseDown?: (e: React.MouseEvent, blockId: string) => void
}

/** Recursively build indented plain text from a block subtree (4 spaces + bullet per level). */
function buildIndentedText(block: Block, depth: number): string {
  const indent = '    '.repeat(depth)
  const lines = [`${indent}- ${block.content}`]
  for (const child of block.children) lines.push(buildIndentedText(child, depth + 1))
  return lines.join('\n')
}

export function BlockItem({
  block, depth, allPages, requestFocusId, onConsumeFocus,
  onChange, onToggleCheck, onToggleTodo, onEnter, onBackspace, onTab,
  onArrowUp, onArrowDown, onNavigate, onOpenSidebar, onDelete, onPasteBlocks, onZoom, onNavigateToBlock,
  hasBlockSelection, onDragHandleMouseDown,
}: Props) {
  const [editing, setEditing] = useState(false)
  const [content, setContent] = useState(block.content)
  const [collapsed, setCollapsed] = useState(false)
  const [showWikilink, setShowWikilink] = useState(false)
  const [wikilinkQuery, setWikilinkQuery] = useState('')
  const [showBlockRef, setShowBlockRef] = useState(false)
  const [blockRefQuery, setBlockRefQuery] = useState('')
  const [showSlash, setShowSlash] = useState(false)
  const [slashQuery, setSlashQuery] = useState('')
  const [showEncryptModal, setShowEncryptModal] = useState(false)
  const [showDatePicker, setShowDatePicker] = useState(false)
  // When unlocked: stores the password used, so we can re-encrypt on blur/navigate
  const [unlockPassword, setUnlockPassword] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const showEncryptModalRef = useRef(false)
  // Pending cursor position: set before setEditing(true); consumed by useLayoutEffect
  const pendingCursorPos = useRef<number | null>(null)
  // Guard: prevents re-encryption on the blur that fires right after Touch ID unlock
  const justUnlockedRef = useRef(false)
  // No inter-event state needed for bracket wrapping anymore
  const isEncrypted = isEncryptedBlock(block.content)
  const isUnlocked = unlockPassword !== null

  const setEncryptModal = useCallback((val: boolean) => {
    showEncryptModalRef.current = val
    setShowEncryptModal(val)
  }, [])

  const closeAllMenus = useCallback(() => {
    setShowWikilink(false)
    setShowBlockRef(false)
    setShowSlash(false)
  }, [])

  useEffect(() => {
    // Don't overwrite local content when unlocked (showing plain text)
    if (!editing && !isUnlocked) setContent(block.content)
  }, [block.content, editing, isUnlocked])

  // Re-encrypt on unmount (page navigation) if block is unlocked
  const unlockPasswordRef = useRef<string | null>(null)
  const contentRef = useRef(content)
  unlockPasswordRef.current = unlockPassword
  contentRef.current = content
  useEffect(() => {
    return () => {
      const pw = unlockPasswordRef.current
      const ct = contentRef.current
      if (pw && ct && !isEncryptedBlock(ct)) {
        // Sync legacy encrypt for unmount cleanup (async not possible here).
        // Block will be re-encrypted with v2 (PBKDF2+AES-GCM) on next unlock+blur.
        const encrypted = encryptBlockSync(ct, pw)
        onChange(block.id, encrypted)
      }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    if (requestFocusId === block.id) {
      onConsumeFocus()
      pendingCursorPos.current = content.length  // cursor at end
      setEditing(true)
    }
  }, [requestFocusId, block.id, onConsumeFocus, content.length])

  useLayoutEffect(() => {
    if (textareaRef.current && editing) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px'
    }
  }, [content, editing])

  // Central focus handler: runs synchronously after DOM commit when entering edit mode
  useLayoutEffect(() => {
    if (editing && pendingCursorPos.current !== null && textareaRef.current) {
      const pos = pendingCursorPos.current
      pendingCursorPos.current = null
      textareaRef.current.focus({ preventScroll: true })
      textareaRef.current.setSelectionRange(pos, pos)
    }
  }, [editing])

  const handleContentChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
    const cursor = e.target.selectionStart
    setContent(val)
    onChange(block.id, val)

    const textBefore = val.slice(0, cursor)

    // [[ wikilink
    const wikilinkMatch = textBefore.match(/\[\[([^\]]*)$/)
    if (wikilinkMatch) {
      setWikilinkQuery(wikilinkMatch[1])
      setShowWikilink(true); setShowBlockRef(false); setShowSlash(false)
      return
    }

    // (( block ref
    const blockRefMatch = textBefore.match(/\(\(([^)]*)$/)
    if (blockRefMatch) {
      setBlockRefQuery(blockRefMatch[1])
      setShowBlockRef(true); setShowWikilink(false); setShowSlash(false)
      return
    }

    // / slash menu
    const slashMatch = textBefore.match(/(?:^|\s)\/([^/\s\n]*)$/)
    if (slashMatch) {
      setSlashQuery(slashMatch[1])
      setShowSlash(true); setShowWikilink(false); setShowBlockRef(false)
      return
    }

    closeAllMenus()
  }, [block.id, onChange, closeAllMenus])

  // Intercept paste of indented outlines (Roam/Obsidian style) and create nested blocks
  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (!onPasteBlocks) return
    const text = e.clipboardData.getData('text/plain')
    const lines = text.split('\n').filter(l => l.trim() !== '')
    if (lines.length < 2) return
    const hasIndentation = lines.some(l => /^[\t ]+/.test(l))
    if (!hasIndentation) return

    e.preventDefault()
    const ta = textareaRef.current
    const selStart = ta?.selectionStart ?? content.length
    const selEnd = ta?.selectionEnd ?? content.length
    const contentBefore = content.slice(0, selStart)
    const contentAfter = content.slice(selEnd)

    // Update local state immediately so the textarea reflects the merged first line
    const firstLineContent = lines[0].replace(/^[\t ]*/, '').replace(/^[-*•]\s+/, '').trimStart()
    setContent(contentBefore + firstLineContent)

    onPasteBlocks(block.id, contentBefore, contentAfter, text)
  }, [block.id, content, onPasteBlocks])

  // Always copy with "- " bullet prefix (like Roam Research).
  // Full/empty selection → copy the block + full children subtree.
  // Partial selection → prepend "- " to just the selected text.
  const handleCopy = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const ta = textareaRef.current
    if (!ta) return
    const selStart = ta.selectionStart
    const selEnd = ta.selectionEnd
    const isEmptySelection = selStart === selEnd
    const isFullSelection = selStart === 0 && selEnd === content.length

    if (isEmptySelection || isFullSelection) {
      // Copy the whole block + any children with proper indentation
      e.preventDefault()
      if (block.children.length > 0) {
        const childrenText = block.children.map(c => buildIndentedText(c, 1)).join('\n')
        e.clipboardData.setData('text/plain', `- ${content}\n${childrenText}`)
      } else {
        e.clipboardData.setData('text/plain', `- ${content}`)
      }
    } else {
      // Partial selection: copy just the selected text without a bullet prefix
      // (the user is copying a fragment, not a whole block)
    }
  }, [block, content])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const anyMenuOpen = showWikilink || showBlockRef || showSlash
    if (anyMenuOpen && ['ArrowUp', 'ArrowDown', 'Enter', 'Tab'].includes(e.key)) { e.preventDefault(); return }
    if (anyMenuOpen && e.key === 'Escape') { e.preventDefault(); closeAllMenus(); return }

    const ta = textareaRef.current

    // ⌘+Enter → add / remove TODO entirely
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      onToggleTodo(block.id)
      return
    }

    // ── Bracket / paren wrapping and auto-close ──
    if ((e.key === '[' || e.key === '(') && ta) {
      const selStart = ta.selectionStart
      const selEnd = ta.selectionEnd
      const val = ta.value
      const before = val.slice(0, selStart)
      const isSquare = e.key === '['
      const singleClose = isSquare ? ']' : ')'
      const doubleClose = isSquare ? ']]' : '))'

      // ── With selection ──
      if (selEnd > selStart) {
        e.preventDefault()
        const selected = val.slice(selStart, selEnd)
        const after = val.slice(selEnd)

        // SECOND bracket: before the cursor is "[selected" or "(selected" already → upgrade to double
        // Pattern: text before selStart ends with the bracket char, and right after cursor is the single close
        if (before.endsWith(e.key) && after.startsWith(singleClose)) {
          // Currently: ...[selected]... cursor is after [selected
          // Remove the single bracket before and the single close after, wrap with double
          const bef = before.slice(0, -1)            // strip the leading [
          const aft = after.slice(1)                  // strip the trailing ]
          const newVal = bef + (isSquare ? '[[' : '((') + selected + doubleClose + aft
          const cursorPos = bef.length + 2 + selected.length  // after [[selected, before ]]
          setContent(newVal); onChange(block.id, newVal)
          setTimeout(() => {
            ta.setSelectionRange(cursorPos, cursorPos)
            if (isSquare) { setWikilinkQuery(selected); setShowWikilink(true); setShowBlockRef(false); setShowSlash(false) }
            else { setBlockRefQuery(selected); setShowBlockRef(true); setShowWikilink(false); setShowSlash(false) }
          }, 0)
          return
        }

        // FIRST bracket: wrap with single brackets [selected] and keep selected
        const newVal = before + e.key + selected + singleClose + after
        const newSelStart = selStart + 1   // keep selection on the text (after opening bracket)
        const newSelEnd = selStart + 1 + selected.length
        setContent(newVal); onChange(block.id, newVal)
        setTimeout(() => ta.setSelectionRange(newSelStart, newSelEnd), 0)
        return
      }

      // ── No selection: auto-close on second bracket ──
      if (selEnd === selStart && before.endsWith(e.key)) {
        e.preventDefault()
        const after = val.slice(selStart)
        const newVal = before + (isSquare ? '[]]' : '())') + after
        const newCursor = selStart + 1
        setContent(newVal); onChange(block.id, newVal)
        setTimeout(() => {
          ta.setSelectionRange(newCursor, newCursor)
          if (isSquare) { setWikilinkQuery(''); setShowWikilink(true) }
          else { setBlockRefQuery(''); setShowBlockRef(true) }
        }, 0)
        return
      }
    }

    switch (e.key) {
      case 'Enter':
        if (!e.shiftKey) {
          e.preventDefault()
          const pos = ta?.selectionStart ?? content.length
          // Update local state to show only the "before" part immediately,
          // so the textarea doesn't keep showing the full original content
          // while the parent block already has the split content.
          // Skip when pos=0: inserting above leaves this block unchanged.
          if (pos > 0) setContent(content.slice(0, pos))
          onEnter(block.id, pos, content)
        }
        break

      case 'Backspace':
        if (ta) {
          const cursor = ta.selectionStart
          const val = ta.value
          const beforeCur = val.slice(0, cursor)
          const afterCur = val.slice(cursor)

          // ── Cmd+Backspace (delete to line start) → also strip orphan closing brackets ──
          if (e.metaKey) {
            // Find what will be deleted (everything before cursor on current line)
            const lineStart = beforeCur.lastIndexOf('\n') + 1
            const deletedPart = beforeCur.slice(lineStart)
            // Count unmatched [[ and (( in the deleted part
            const openBrackets = (deletedPart.match(/\[\[/g) || []).length - (deletedPart.match(/\]\]/g) || []).length
            const openParens = (deletedPart.match(/\(\(/g) || []).length - (deletedPart.match(/\)\)/g) || []).length
            if (openBrackets > 0 || openParens > 0) {
              e.preventDefault()
              let remaining = afterCur
              // Strip matching ]] from the right
              for (let i = 0; i < openBrackets; i++) {
                const idx = remaining.indexOf(']]')
                if (idx !== -1) remaining = remaining.slice(0, idx) + remaining.slice(idx + 2)
              }
              // Strip matching )) from the right
              for (let i = 0; i < openParens; i++) {
                const idx = remaining.indexOf('))')
                if (idx !== -1) remaining = remaining.slice(0, idx) + remaining.slice(idx + 2)
              }
              const newVal = beforeCur.slice(0, lineStart) + remaining
              setContent(newVal); onChange(block.id, newVal)
              setShowWikilink(false); setShowBlockRef(false)
              setTimeout(() => ta.setSelectionRange(lineStart, lineStart), 0)
              break
            }
          }

          // ── Single backspace paired deletion ──
          // After "[[" → delete "[[" and matching "]]"
          if (beforeCur.endsWith('[[')) {
            const closingIdx = afterCur.indexOf(']]')
            if (closingIdx !== -1) {
              e.preventDefault()
              const inner = afterCur.slice(0, closingIdx)
              const newVal = beforeCur.slice(0, -2) + inner + afterCur.slice(closingIdx + 2)
              const nc = cursor - 2
              setContent(newVal); onChange(block.id, newVal); setShowWikilink(false)
              setTimeout(() => ta.setSelectionRange(nc, nc), 0)
              break
            }
          }

          // After single "[" → clean up orphan "]]"
          if (beforeCur.endsWith('[') && !beforeCur.endsWith('[[')) {
            const closingIdx = afterCur.indexOf(']]')
            if (closingIdx !== -1 && !afterCur.slice(0, closingIdx).includes('[[')) {
              e.preventDefault()
              const newVal = beforeCur.slice(0, -1) + afterCur.slice(0, closingIdx) + afterCur.slice(closingIdx + 2)
              const nc = cursor - 1
              setContent(newVal); onChange(block.id, newVal); setShowWikilink(false)
              setTimeout(() => ta.setSelectionRange(nc, nc), 0)
              break
            }
          }

          // After "((" → delete "((" and matching "))"
          if (beforeCur.endsWith('((')) {
            const closingIdx = afterCur.indexOf('))')
            if (closingIdx !== -1) {
              e.preventDefault()
              const inner = afterCur.slice(0, closingIdx)
              const newVal = beforeCur.slice(0, -2) + inner + afterCur.slice(closingIdx + 2)
              const nc = cursor - 2
              setContent(newVal); onChange(block.id, newVal); setShowBlockRef(false)
              setTimeout(() => ta.setSelectionRange(nc, nc), 0)
              break
            }
          }

          // After single "(" → clean up orphan "))"
          if (beforeCur.endsWith('(') && !beforeCur.endsWith('((')) {
            const closingIdx = afterCur.indexOf('))')
            if (closingIdx !== -1 && !afterCur.slice(0, closingIdx).includes('((')) {
              e.preventDefault()
              const newVal = beforeCur.slice(0, -1) + afterCur.slice(0, closingIdx) + afterCur.slice(closingIdx + 2)
              const nc = cursor - 1
              setContent(newVal); onChange(block.id, newVal); setShowBlockRef(false)
              setTimeout(() => ta.setSelectionRange(nc, nc), 0)
              break
            }
          }

          // Close menus if brackets are gone
          if (showWikilink && !beforeCur.includes('[[')) setShowWikilink(false)
          if (showBlockRef && !beforeCur.includes('((')) setShowBlockRef(false)
        }
        // Delete empty block (including todos); pass collapsed so parent can remove subtree
        if (!content) { e.preventDefault(); onBackspace(block.id, true, collapsed) }
        break

      case 'Delete':
        // Delete key on empty block too; pass collapsed so parent can remove subtree
        if (!content) { e.preventDefault(); onBackspace(block.id, true, collapsed) }
        break

      case 'Tab':
        e.preventDefault()
        onTab(block.id, e.shiftKey)
        break

      case 'ArrowUp':
        if (ta) {
          const pos = ta.selectionStart
          const firstLineEnd = content.indexOf('\n')
          if (firstLineEnd === -1 || pos <= firstLineEnd) { e.preventDefault(); onArrowUp(block.id) }
        }
        break

      case 'ArrowDown':
        if (ta) {
          const pos = ta.selectionStart
          const lastLineStart = content.lastIndexOf('\n')
          if (lastLineStart === -1 || pos >= lastLineStart) { e.preventDefault(); onArrowDown(block.id) }
        }
        break

      case 'e':
        if (e.ctrlKey || e.metaKey) { e.preventDefault(); setEncryptModal(true) }
        break
    }
  }, [block.id, content, collapsed, showWikilink, showBlockRef, showSlash, closeAllMenus, setEncryptModal, onEnter, onBackspace, onTab, onArrowUp, onArrowDown, onToggleCheck, onToggleTodo, onChange])

  const handleSelectPage = useCallback((page: Page) => {
    const ta = textareaRef.current
    const cursor = ta?.selectionStart ?? content.length
    const newBefore = content.slice(0, cursor).replace(/\[\[[^\]]*$/, `[[${page.title}]]`)
    // Strip any auto-inserted "]]" immediately after cursor to avoid quadruple brackets
    const afterCursor = content.slice(cursor).replace(/^\]\]/, '')
    const newContent = newBefore + afterCursor
    setContent(newContent); onChange(block.id, newContent); setShowWikilink(false)
    setTimeout(() => { ta?.focus(); ta?.setSelectionRange(newBefore.length, newBefore.length) }, 0)
  }, [block.id, content, onChange])

  const handleCreatePage = useCallback((title: string) => {
    const ta = textareaRef.current
    const cursor = ta?.selectionStart ?? content.length
    const newBefore = content.slice(0, cursor).replace(/\[\[[^\]]*$/, `[[${title}]]`)
    // Strip any auto-inserted "]]" immediately after cursor to avoid quadruple brackets
    const afterCursor = content.slice(cursor).replace(/^\]\]/, '')
    const newContent = newBefore + afterCursor
    setContent(newContent); onChange(block.id, newContent); setShowWikilink(false)
    setTimeout(() => ta?.focus(), 0)
  }, [block.id, content, onChange])

  const handleSelectBlockRef = useCallback((blockId: string) => {
    const ta = textareaRef.current
    const cursor = ta?.selectionStart ?? content.length
    const newBefore = content.slice(0, cursor).replace(/\(\([^)]*$/, `((${blockId}))`)
    // Strip the auto-inserted )) that sit right after the cursor (added by the autocomplete on '((')
    const afterCursor = content.slice(cursor)
    const newAfter = afterCursor.startsWith('))') ? afterCursor.slice(2) : afterCursor
    const newContent = newBefore + newAfter
    setContent(newContent); onChange(block.id, newContent); setShowBlockRef(false)
    setTimeout(() => { ta?.focus(); ta?.setSelectionRange(newBefore.length, newBefore.length) }, 0)
  }, [block.id, content, onChange])

  // fn receives (cleanedContent, cleanedCursor) — the content with the slash command
  // stripped and the cursor position within that cleaned content. Use these instead of
  // ta.value / ta.selectionStart to avoid operating on stale data before re-render.
  const applySlashCommand = useCallback((fn: (cleanedContent: string, cleanedCursor: number) => void) => {
    const ta = textareaRef.current
    const cursor = ta?.selectionStart ?? content.length
    const textBefore = content.slice(0, cursor)
    const newBefore = textBefore.replace(/(?:^|\s)\/[^/\n]*$/, m => m.startsWith('/') ? '' : m.slice(0, m.indexOf('/')))
    const newContent = newBefore + content.slice(cursor)
    const newCursor = newBefore.length
    closeAllMenus()
    fn(newContent, newCursor)
    setTimeout(() => ta?.focus(), 0)
  }, [block.id, content, onChange, closeAllMenus])

  const slashCommands: SlashCommand[] = [
    { id: 'todo', label: 'To-do', description: 'Toggle todo checkbox (⌘↵)', icon: '☐',
      action: () => applySlashCommand((base) => { setContent(base); onChange(block.id, base); onToggleTodo(block.id) }) },
    { id: 'page', label: 'Page link', description: 'Link to a page [[…]]', icon: '📄',
      action: () => applySlashCommand((base, cur) => {
        const ta = textareaRef.current
        const nv = base.slice(0, cur) + '[[]]' + base.slice(cur)
        setContent(nv); onChange(block.id, nv)
        setTimeout(() => { ta?.setSelectionRange(cur+2, cur+2); setWikilinkQuery(''); setShowWikilink(true) }, 0)
      }) },
    { id: 'blockref', label: 'Block reference', description: 'Reference a block ((…))', icon: '🔗',
      action: () => applySlashCommand((base, cur) => {
        const ta = textareaRef.current
        const nv = base.slice(0, cur) + '(())' + base.slice(cur)
        setContent(nv); onChange(block.id, nv)
        setTimeout(() => { ta?.setSelectionRange(cur+2, cur+2); setBlockRefQuery(''); setShowBlockRef(true) }, 0)
      }) },
    { id: 'bold', label: 'Bold', description: '**bold**', icon: 'B',
      action: () => applySlashCommand((base, cur) => { const ta=textareaRef.current; const nv=base.slice(0,cur)+'****'+base.slice(cur); setContent(nv); onChange(block.id,nv); setTimeout(()=>ta?.setSelectionRange(cur+2,cur+2),0) }) },
    { id: 'italic', label: 'Italic', description: '__italic__', icon: 'I',
      action: () => applySlashCommand((base, cur) => { const ta=textareaRef.current; const nv=base.slice(0,cur)+'____'+base.slice(cur); setContent(nv); onChange(block.id,nv); setTimeout(()=>ta?.setSelectionRange(cur+2,cur+2),0) }) },
    { id: 'highlight', label: 'Highlight', description: '^^highlight^^', icon: '✏️',
      action: () => applySlashCommand((base, cur) => { const ta=textareaRef.current; const nv=base.slice(0,cur)+'^^^^'+base.slice(cur); setContent(nv); onChange(block.id,nv); setTimeout(()=>ta?.setSelectionRange(cur+2,cur+2),0) }) },
    { id: 'code', label: 'Inline code', description: '`code`', icon: '</>',
      action: () => applySlashCommand((base, cur) => { const ta=textareaRef.current; const nv=base.slice(0,cur)+'``'+base.slice(cur); setContent(nv); onChange(block.id,nv); setTimeout(()=>ta?.setSelectionRange(cur+1,cur+1),0) }) },
    { id: 'encrypt', label: 'Encrypt block', description: 'Encrypt with AES (⌘E)', icon: '🔒',
      action: () => applySlashCommand((base) => { setContent(base); onChange(block.id, base); setEncryptModal(true) }) },
    { id: 'date', label: 'Date', description: 'Insert a date as [[link]]', icon: '📅',
      action: () => applySlashCommand((base) => { setContent(base); onChange(block.id, base); setShowDatePicker(true) }) },
    { id: 'yesterday', label: 'Yesterday', description: 'Link to yesterday\'s note', icon: '←',
      action: () => applySlashCommand((base, cur) => {
        const ta = textareaRef.current
        const d = new Date(); d.setDate(d.getDate() - 1)
        const link = `[[${dateToPageTitle(d)}]]`
        const newContent = base.slice(0, cur) + link + base.slice(cur)
        setContent(newContent); onChange(block.id, newContent); closeAllMenus()
        setTimeout(() => { ta?.setSelectionRange(cur + link.length, cur + link.length); ta?.focus() }, 0)
      }) },
    { id: 'tomorrow', label: 'Tomorrow', description: 'Link to tomorrow\'s note', icon: '→',
      action: () => applySlashCommand((base, cur) => {
        const ta = textareaRef.current
        const d = new Date(); d.setDate(d.getDate() + 1)
        const link = `[[${dateToPageTitle(d)}]]`
        const newContent = base.slice(0, cur) + link + base.slice(cur)
        setContent(newContent); onChange(block.id, newContent); closeAllMenus()
        setTimeout(() => { ta?.setSelectionRange(cur + link.length, cur + link.length); ta?.focus() }, 0)
      }) },
    { id: 'h1', label: 'Heading 1', description: '# Large heading', icon: 'H1',
      action: () => applySlashCommand((base) => { const ta=textareaRef.current; const nc='# '+base.replace(/^#+\s*/,''); setContent(nc); onChange(block.id,nc); setTimeout(()=>{ ta?.focus(); ta?.setSelectionRange(nc.length,nc.length) },0) }) },
    { id: 'h2', label: 'Heading 2', description: '## Medium heading', icon: 'H2',
      action: () => applySlashCommand((base) => { const ta=textareaRef.current; const nc='## '+base.replace(/^#+\s*/,''); setContent(nc); onChange(block.id,nc); setTimeout(()=>{ ta?.focus(); ta?.setSelectionRange(nc.length,nc.length) },0) }) },
    { id: 'h3', label: 'Heading 3', description: '### Small heading', icon: 'H3',
      action: () => applySlashCommand((base) => { const ta=textareaRef.current; const nc='### '+base.replace(/^#+\s*/,''); setContent(nc); onChange(block.id,nc); setTimeout(()=>{ ta?.focus(); ta?.setSelectionRange(nc.length,nc.length) },0) }) },
  ]

  // Called by EncryptedBlockView when user successfully decrypts
  const handleUnlock = useCallback((plaintext: string, password: string) => {
    setUnlockPassword(password)
    setContent(plaintext)
    pendingCursorPos.current = plaintext.length  // cursor at end
    // Guard against the blur that fires when window regains focus after Touch ID system dialog
    justUnlockedRef.current = true
    setEditing(true)
    platform.saveKey(block.id, password).catch(() => {})
    setTimeout(() => { justUnlockedRef.current = false }, 800)
  }, [block.id])

  // Re-encrypt with the unlock password and lock the block
  const reEncrypt = useCallback(async (currentContent: string, password: string) => {
    const encrypted = await encryptBlock(currentContent, password)
    setContent(encrypted)
    onChange(block.id, encrypted)
    setUnlockPassword(null)
    setEditing(false)
  }, [block.id, onChange])

  const handleEncrypt = useCallback(async (password: string) => {
    const encrypted = await encryptBlock(content, password)
    setContent(encrypted); onChange(block.id, encrypted)
    setUnlockPassword(null)
    setEncryptModal(false); setEditing(false)
    // Always save key for Touch ID unlock
    try { await platform.saveKey(block.id, password) } catch {}
  }, [block.id, content, onChange, setEncryptModal])

  const handleDateSelect = (dateTitle: string) => {
    const ta = textareaRef.current
    const cursor = ta?.selectionStart ?? content.length
    const newContent = content.slice(0, cursor) + `[[${dateTitle}]]` + content.slice(cursor)
    setContent(newContent); onChange(block.id, newContent)
    setShowDatePicker(false)
    setTimeout(() => { ta?.focus(); ta?.setSelectionRange(cursor + dateTitle.length + 4, cursor + dateTitle.length + 4) }, 0)
  }

  const isTodo = block.checked !== null && block.checked !== undefined
  const hasChildren = block.children.length > 0

  // Detect Key:: value attribute pattern for inline rendering while editing
  const attrMatch = useMemo(() => {
    const m = content.match(/^([^:\n]+)::\s(.*)$/s)
    return m ? { key: m[1], prefix: m[1] + ':: ' } : null
  }, [content])
  const attrMeasureRef = useRef<HTMLSpanElement>(null)
  const [attrOverlayWidth, setAttrOverlayWidth] = useState(0)
  useLayoutEffect(() => {
    if (attrMatch && editing && attrMeasureRef.current) {
      setAttrOverlayWidth(attrMeasureRef.current.offsetWidth)
    } else {
      setAttrOverlayWidth(0)
    }
  }, [attrMatch, editing])

  // Click on rendered block → enter edit mode with cursor at the clicked position
  const handleContentAreaClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (editing) return
    // Default: end of content
    let targetPos = content.length

    // Resolve caret position from click coordinates.
    // IMPORTANT: call methods directly on `document` — extracting to a variable
    // loses the `this` context and throws "Illegal invocation".
    let caretNode: Node | null = null
    let caretOffset = 0

    try {
      if (typeof (document as any).caretPositionFromPoint === 'function') {
        const pos = (document as any).caretPositionFromPoint(e.clientX, e.clientY)
        if (pos) { caretNode = pos.offsetNode; caretOffset = pos.offset }
      } else if (typeof (document as any).caretRangeFromPoint === 'function') {
        const range = (document as any).caretRangeFromPoint(e.clientX, e.clientY)
        if (range) { caretNode = range.startContainer; caretOffset = range.startOffset }
      }
    } catch {
      // API unavailable or threw — fall back to cursor at end of content
    }

    if (caretNode && caretNode.nodeType === Node.TEXT_NODE) {
      const renderedDiv = (e.currentTarget as HTMLElement).querySelector('.block-rendered')
      if (renderedDiv && renderedDiv.contains(caretNode)) {
        let renderedCharCount = 0
        let found = false
        const walker = document.createTreeWalker(renderedDiv, NodeFilter.SHOW_TEXT, null)
        let node = walker.nextNode() as Text | null
        while (node) {
          if (node === caretNode) {
            renderedCharCount += caretOffset
            found = true
            break
          }
          renderedCharCount += node.length
          node = walker.nextNode() as Text | null
        }
        // Map the rendered-HTML character offset to the raw-markdown offset
        // (they differ because **bold** renders as "bold", `code` as "code", etc.)
        if (found) targetPos = Math.min(renderedPosToMarkdownPos(content, renderedCharCount), content.length)
      }
    }

    pendingCursorPos.current = targetPos
    setEditing(true)
  }, [editing, content])

  return (
    <div className={`block-item depth-${Math.min(depth, 8)}`} data-block-id={block.id}>
      <div className={`block-row${collapsed && hasChildren ? ' collapsed' : ''}`}>
        {/* Collapse toggle — only shown on hover when there are children */}
        <div className="block-toggle-area">
          {hasChildren && (
            <button
              className={`block-toggle ${collapsed ? 'collapsed' : ''}`}
              onClick={e => { e.stopPropagation(); setCollapsed(c => !c) }}
              title={collapsed ? 'Expand' : 'Collapse'}
            >
              <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                <path d={collapsed ? 'M2 1L6 4L2 7' : 'M1 2L4 6L7 2'} stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          )}
        </div>

        <div className="block-bullet-area">
          {/* Drag handle — visible only when block is selected + hovered (CSS controls visibility) */}
          {hasBlockSelection && (
            <span
              className="block-drag-handle"
              onMouseDown={(e) => onDragHandleMouseDown?.(e, block.id)}
              title="Drag to move"
            >⠿</span>
          )}
          {isTodo ? (
            <span className="block-bullet">
              <span className="block-bullet-dot" />
            </span>
          ) : (
            <span
              className="block-bullet"
              onClick={() => {
                if (onZoom) { onZoom(block.id, content) }
                else { pendingCursorPos.current = content.length; setEditing(true) }
              }}
              title="Open block"
            >
              <span className="block-bullet-dot" />
              {(block.createdAt || block.updatedAt) && (
                <span className="block-bullet-tooltip">
                  {block.createdAt && <span>Created: {new Date(block.createdAt).toLocaleString()}</span>}
                  {block.updatedAt && block.updatedAt !== block.createdAt && <span>Edited: {new Date(block.updatedAt).toLocaleString()}</span>}
                </span>
              )}
            </span>
          )}
        </div>

        {isTodo && (
          <button className="block-checkbox" onClick={() => onToggleCheck(block.id)}>
            {block.checked ? (
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                <rect x="0.5" y="0.5" width="13" height="13" rx="3" fill="var(--text-muted)" stroke="var(--text-muted)"/>
                <path d="M3.5 7L6 9.5L10.5 4.5" stroke="white" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            ) : (
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                <rect x="0.5" y="0.5" width="13" height="13" rx="3" stroke="var(--border-normal)" strokeWidth="1.5"/>
              </svg>
            )}
          </button>
        )}

        <div className="block-content-area" onClick={handleContentAreaClick}>
          {editing ? (
            <div className="block-textarea-wrapper">
              {attrMatch && editing && (
                <>
                  {/* Hidden span to measure the textarea prefix width */}
                  <span className="attr-measure" ref={attrMeasureRef} aria-hidden="true">{attrMatch.prefix}</span>
                  {/* Visible overlay that covers the prefix with styled text */}
                  <span className="attr-key-overlay" style={{ minWidth: attrOverlayWidth || undefined }} aria-hidden="true">{attrMatch.key}:</span>
                </>
              )}
              <textarea
                ref={textareaRef}
                className={`block-textarea ${isTodo && block.checked ? 'done-text' : ''}`}
                value={content}
                onChange={handleContentChange}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                onCopy={handleCopy}
                onBlur={() => setTimeout(() => {
                  if (showEncryptModalRef.current) return
                  if (justUnlockedRef.current) return  // skip re-encrypt on blur right after Touch ID unlock
                  if (isUnlocked && unlockPassword) {
                    reEncrypt(textareaRef.current?.value ?? content, unlockPassword)
                  } else {
                    setEditing(false)
                    closeAllMenus()
                  }
                }, 150)}
                rows={1}
                spellCheck
              />
            </div>
          ) : (
            <div className={`block-rendered ${isTodo && block.checked ? 'done-text' : ''}`}>
              {isEncrypted && !isUnlocked
                ? <EncryptedBlockView blockId={block.id} content={block.content} onUnlock={handleUnlock} />
                : <BlockContent content={content} checked={block.checked} allPages={allPages} onNavigate={onNavigate} onOpenSidebar={onOpenSidebar} onNavigateToBlock={onNavigateToBlock} />
              }
            </div>
          )}
        </div>
      </div>

      {showWikilink && editing && (
        <WikilinkAutocomplete query={wikilinkQuery} allPages={allPages} anchorRef={textareaRef}
          onSelect={handleSelectPage} onCreate={handleCreatePage} onClose={() => setShowWikilink(false)} />
      )}

      {showBlockRef && editing && (
        <BlockRefAutocomplete query={blockRefQuery} allPages={allPages} anchorRef={textareaRef}
          onSelect={handleSelectBlockRef} onClose={() => setShowBlockRef(false)} />
      )}

      {showSlash && editing && (
        <SlashMenu query={slashQuery} commands={slashCommands} anchorRef={textareaRef} onClose={() => setShowSlash(false)} />
      )}

      {showEncryptModal && (
        <EncryptModal onEncrypt={handleEncrypt} onClose={() => setEncryptModal(false)} />
      )}

      {showDatePicker && editing && (
        <DatePickerInline anchorRef={textareaRef} onSelect={handleDateSelect} onClose={() => setShowDatePicker(false)} />
      )}

      {!collapsed && hasChildren && (
        <div className="block-children">
          {block.children.map(child => (
            <BlockItem key={child.id} block={child} depth={depth + 1} allPages={allPages}
              requestFocusId={requestFocusId} onConsumeFocus={onConsumeFocus}
              onChange={onChange} onToggleCheck={onToggleCheck} onToggleTodo={onToggleTodo} onEnter={onEnter}
              onBackspace={onBackspace} onTab={onTab} onArrowUp={onArrowUp} onArrowDown={onArrowDown}
              onNavigate={onNavigate} onOpenSidebar={onOpenSidebar} onDelete={onDelete}
              onPasteBlocks={onPasteBlocks} onZoom={onZoom} onNavigateToBlock={onNavigateToBlock} />
          ))}
        </div>
      )}
    </div>
  )
}

function EncryptedBlockView({ blockId, content, onUnlock }: {
  blockId: string
  content: string
  onUnlock: (plaintext: string, password: string) => void
}) {
  const [mode, setMode] = useState<'idle' | 'touchid' | 'password'>('idle')
  const [touchIdAvailable, setTouchIdAvailable] = useState(false)
  const [hasStoredKey, setHasStoredKey] = useState(false)
  const [password, setPassword] = useState('')
  const [error, setError] = useState(false)

  const biometricLabel = platform.isCapacitor() ? 'Face ID' : 'Touch ID'

  // Check biometric availability AND whether a stored key exists for this block
  useEffect(() => {
    let cancelled = false
    Promise.all([
      platform.canBiometric(),
      platform.hasKey(blockId),
    ]).then(([bioAvail, keyExists]) => {
      if (!cancelled) {
        setTouchIdAvailable(bioAvail)
        setHasStoredKey(keyExists)
      }
    }).catch(() => {})
    return () => { cancelled = true }
  }, [blockId])

  // Biometric flow: prompt → auto-decrypt with stored key
  const tryBiometric = useCallback(async () => {
    setMode('touchid')
    try {
      const res = await platform.promptBiometric('Unlock encrypted block in Roma Notes')
      if (res.success) {
        const key = await platform.getKey(blockId)
        if (key !== null) {
          const plaintext = await decryptBlock(content, key)
          if (plaintext !== null) { onUnlock(plaintext, key); return }
        }
        // Key not found or decrypt failed → fall to password
        setHasStoredKey(false)
        setMode('password')
      } else {
        setMode('password')
      }
    } catch {
      setMode('password')
    }
  }, [blockId, content, onUnlock])

  // Click "Unlock": biometric only when a stored key exists, otherwise password
  const handleUnlockClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation()
    if (touchIdAvailable && hasStoredKey) {
      tryBiometric()
    } else {
      setMode('password')
    }
  }, [touchIdAvailable, hasStoredKey, tryBiometric])

  // Password submit: decrypt + save key for future biometric unlock
  const handleDecrypt = useCallback(async () => {
    const result = await decryptBlock(content, password)
    if (result !== null) {
      setError(false)
      try { await platform.saveKey(blockId, password) } catch {}
      setHasStoredKey(true)
      onUnlock(result, password)
    } else {
      setError(true)
    }
  }, [blockId, content, password, onUnlock])

  if (mode === 'touchid') {
    return (
      <span className="encrypted-block">
        <span className="encrypted-icon">🔒</span>
        <span className="encrypted-label">Authenticating…</span>
        <button className="decrypt-btn-link"
          onClick={e => { e.stopPropagation(); setMode('password') }}>
          Use password
        </button>
      </span>
    )
  }

  if (mode === 'password') {
    return (
      <span className="encrypted-block">
        <span className="encrypted-icon">🔒</span>
        {/* decrypt-password-wrap: column flex so the hint sits ABOVE the input row */}
        <span className="decrypt-password-wrap">
          {touchIdAvailable && !hasStoredKey && (
            <span className="decrypt-biometric-hint">
              Enter password once to enable {biometricLabel}
            </span>
          )}
          <span className="decrypt-input-row">
            <input type="password" placeholder="Password" value={password}
              onChange={e => setPassword(e.target.value)}
              onClick={e => e.stopPropagation()}
              onKeyDown={e => {
                e.stopPropagation()
                if (e.key === 'Enter') { e.preventDefault(); handleDecrypt() }
                if (e.key === 'Escape') { e.preventDefault(); setMode('idle'); setPassword(''); setError(false) }
              }}
              className={`decrypt-input ${error ? 'error' : ''}`} autoFocus />
            <button className="decrypt-btn" onClick={e => { e.stopPropagation(); handleDecrypt() }}>Unlock</button>
            {touchIdAvailable && hasStoredKey && (
              <button className="decrypt-btn-link"
                onClick={e => { e.stopPropagation(); tryBiometric() }}>
                {biometricLabel}
              </button>
            )}
          </span>
        </span>
      </span>
    )
  }

  // idle — show appropriate unlock action
  return (
    <span className="encrypted-block">
      <span className="encrypted-icon">🔒</span>
      <span className="encrypted-label">Encrypted block</span>
      {touchIdAvailable && hasStoredKey ? (
        <>
          <button className="decrypt-btn" onClick={handleUnlockClick}>
            Unlock with {biometricLabel}
          </button>
          <button className="decrypt-btn-link"
            onClick={e => { e.stopPropagation(); setMode('password') }}>
            Use password
          </button>
        </>
      ) : (
        <button className="decrypt-btn" onClick={handleUnlockClick}>
          Unlock
        </button>
      )}
    </span>
  )
}

/**
 * Maps a character offset in the rendered (visible) text back to the
 * corresponding offset in the raw markdown source.
 *
 * Markdown tokens change the visible length vs the raw length, e.g.:
 *   **bold**  → renders as "bold"  (4 rendered chars, 8 raw chars)
 *   __italic__ → "italic"          (6 rendered, 10 raw)
 *   ^^hi^^     → "hi"              (2 rendered, 6 raw)
 *   `code`     → "code"            (4 rendered, 6 raw)
 *   [[page]]   → "[[page]]"        (same, brackets are rendered)
 *   # Heading  → "Heading"         (prefix stripped in render)
 *
 * All other tokens (plain text, wikilinks, tags, URLs) pass through 1-to-1.
 */
function renderedPosToMarkdownPos(content: string, renderedPos: number): number {
  let rawIdx = 0
  let renderedIdx = 0

  // Heading: "# text" → rendered as just "text" (the # prefix is stripped)
  const headingMatch = content.match(/^(#{1,6})\s+/)
  if (headingMatch) {
    return Math.min(headingMatch[0].length + Math.max(0, renderedPos), content.length)
  }

  while (rawIdx < content.length) {
    if (renderedIdx > renderedPos) return rawIdx
    const rem = content.slice(rawIdx)
    let m: RegExpMatchArray | null

    // **bold** (rendered as inner text only)
    if ((m = rem.match(/^\*\*([^*]+)\*\*/))) {
      const inner = m[1].length
      if (renderedIdx + inner > renderedPos) return rawIdx + 2 + (renderedPos - renderedIdx)
      rawIdx += m[0].length; renderedIdx += inner; continue
    }

    // __italic__
    if ((m = rem.match(/^__([^_]+)__/))) {
      const inner = m[1].length
      if (renderedIdx + inner > renderedPos) return rawIdx + 2 + (renderedPos - renderedIdx)
      rawIdx += m[0].length; renderedIdx += inner; continue
    }

    // ^^highlight^^
    if ((m = rem.match(/^\^\^([^^]+)\^\^/))) {
      const inner = m[1].length
      if (renderedIdx + inner > renderedPos) return rawIdx + 2 + (renderedPos - renderedIdx)
      rawIdx += m[0].length; renderedIdx += inner; continue
    }

    // `code`
    if ((m = rem.match(/^`([^`]+)`/))) {
      const inner = m[1].length
      if (renderedIdx + inner > renderedPos) return rawIdx + 1 + (renderedPos - renderedIdx)
      rawIdx += m[0].length; renderedIdx += inner; continue
    }

    // ((block-ref)) — rendered as the referenced block's content; we treat it as opaque
    // and advance by the raw token length so the cursor lands just after the "))"
    if ((m = rem.match(/^\(\(([^)]+)\)\)/))) {
      const len = m[0].length
      if (renderedIdx + len > renderedPos) return rawIdx + (renderedPos - renderedIdx)
      rawIdx += len; renderedIdx += len; continue
    }

    // {{[[TODO]]}} / {{[[DONE]]}} — rendered as single "○"/"✓" char
    if ((m = rem.match(/^\{\{\[\[(TODO|DONE)\]\]\}\}/i))) {
      rawIdx += m[0].length; renderedIdx += 1; continue
    }

    // {{encrypt:…}} — rendered as "🔒 [encrypted]" (skip; clicks handled separately)
    if ((m = rem.match(/^\{\{encrypt:[^}]+\}\}/))) {
      rawIdx += m[0].length; renderedIdx += 14; continue
    }

    // [[wikilink]] — "[[" and "]]" are rendered as text → same char count
    if ((m = rem.match(/^\[\[[^\]]+\]\]/))) {
      const len = m[0].length
      if (renderedIdx + len > renderedPos) return rawIdx + (renderedPos - renderedIdx)
      rawIdx += len; renderedIdx += len; continue
    }

    // #[[multi word tag]] → rendered as "#title"
    if ((m = rem.match(/^#\[\[([^\]]+)\]\]/))) {
      const rLen = 1 + m[1].length
      if (renderedIdx + rLen > renderedPos) return rawIdx + Math.min(renderedPos - renderedIdx, m[0].length)
      rawIdx += m[0].length; renderedIdx += rLen; continue
    }

    // #tag — same chars
    if ((m = rem.match(/^#[A-Za-z0-9_\u00C0-\u00FF-]+/))) {
      const len = m[0].length
      if (renderedIdx + len > renderedPos) return rawIdx + (renderedPos - renderedIdx)
      rawIdx += len; renderedIdx += len; continue
    }

    // [text](url) markdown link — rendered as link text (without the URL part)
    if ((m = rem.match(/^\[([^\]]+)\]\(https?:\/\/[^)]+\)/))) {
      const textLen = m[1].length
      if (renderedIdx + textLen > renderedPos) return rawIdx + 1 + (renderedPos - renderedIdx)
      rawIdx += m[0].length; renderedIdx += textLen; continue
    }

    // bare URL — same chars
    if ((m = rem.match(/^https?:\/\/[^\s\])"'>]+/))) {
      const len = m[0].length
      if (renderedIdx + len > renderedPos) return rawIdx + (renderedPos - renderedIdx)
      rawIdx += len; renderedIdx += len; continue
    }

    // Plain text — bulk consume up to the next special char
    if ((m = rem.match(/^[^[\]#*_^`({]+/))) {
      const len = m[0].length
      if (renderedIdx + len > renderedPos) return rawIdx + (renderedPos - renderedIdx)
      rawIdx += len; renderedIdx += len; continue
    }

    // Fallback: single char (unmatched special char like lone '[', '#', etc.)
    rawIdx++; renderedIdx++
  }

  return Math.min(rawIdx, content.length)
}

function EncryptModal({ onEncrypt, onClose }: { onEncrypt: (pw: string) => void; onClose: () => void }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal-box">
        <h3>Encrypt Block</h3>
        <p>This block will be encrypted with AES. You'll need the password to decrypt it.</p>
        <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} className="modal-input" autoFocus />
        <input type="password" placeholder="Confirm password" value={confirm} onChange={e => setConfirm(e.target.value)} className="modal-input"
          onKeyDown={e => { if (e.key === 'Enter' && password === confirm && password) onEncrypt(password) }} />
        <div className="modal-actions">
          <button className="modal-btn secondary" onClick={onClose}>Cancel</button>
          <button className="modal-btn primary" onClick={() => password === confirm && password && onEncrypt(password)} disabled={!password || password !== confirm}>Encrypt</button>
        </div>
      </div>
    </div>
  )
}
