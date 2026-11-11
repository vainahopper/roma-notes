import { useCallback, useMemo, useRef, useState } from 'react'
import type { Page, Block } from '../../shared/types'
import { BlockEditor } from './BlockEditor'
import './ReferenceBlockEditor.css'

interface Props {
  /** The page that owns the referenced block. */
  targetPage: Page
  /** Id of the referenced (matched) block within targetPage. */
  matchBlockId: string
  allPages: Map<string, Page>
  onNavigate: (id: string, title?: string) => void
  onNavigateToBlock?: (pageId: string, pageTitle: string, blockId: string) => void
  /** Persist an edited subtree: parent runs splice + savePage. */
  onSaveRefSubtree: (pageId: string, matchBlockId: string, editedSubtree: Block[]) => void
  /** Called after the final save when focus leaves the editor. Parent unmounts. */
  onDone: () => void
}

function findNode(list: Block[], id: string): Block | null {
  for (const b of list) {
    if (b.id === id) return b
    const found = findNode(b.children ?? [], id)
    if (found) return found
  }
  return null
}

export function ReferenceBlockEditor({
  targetPage, matchBlockId, allPages, onNavigate, onNavigateToBlock, onSaveRefSubtree, onDone,
}: Props) {
  // Seed once from the current node. While editing we own this state; incoming
  // targetPage changes (e.g. pagesVersion bump after our own save) are ignored
  // as long as a save is pending — same anti-flicker pattern as DayEntry.
  const initialNode = useMemo(() => findNode(targetPage.blocks, matchBlockId), [])  // eslint-disable-line react-hooks/exhaustive-deps
  const [subtree, setSubtree] = useState<Block[]>(initialNode ? [initialNode] : [])
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const subtreeRef = useRef(subtree)
  subtreeRef.current = subtree

  const flushSave = useCallback(() => {
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null }
    onSaveRefSubtree(targetPage.id, matchBlockId, subtreeRef.current)
  }, [onSaveRefSubtree, targetPage.id, matchBlockId])

  const handleChange = useCallback((next: Block[]) => {
    setSubtree(next)
    subtreeRef.current = next
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null
      onSaveRefSubtree(targetPage.id, matchBlockId, subtreeRef.current)
    }, 500)
  }, [onSaveRefSubtree, targetPage.id, matchBlockId])

  const handleBlur = useCallback(() => {
    flushSave()
    onDone()
  }, [flushSave, onDone])

  if (!initialNode) return null

  return (
    <div className="reference-block-editor">
      <BlockEditor
        blocks={subtree}
        onChange={handleChange}
        allPages={allPages}
        onNavigate={onNavigate}
        onOpenSidebar={() => {}}
        onNavigateToBlock={onNavigateToBlock}
        onBlur={handleBlur}
        initialFocusBlockId={matchBlockId}
      />
    </div>
  )
}
