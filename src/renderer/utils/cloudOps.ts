import type { Page, Block } from '../../shared/types'
import type { CloudOp } from './cloudBridge'
import { generateId } from './helpers'

/**
 * Apply the agent's block edits/deletes/moves (see cloud/netlify/functions/notes.mts)
 * to local pages. Pure: returns new copies of the pages that changed.
 */
export function replayCloudOps(ops: CloudOp[], lookup: (id: string) => Page | undefined): Page[] {
  // Each touched page is cloned once (new objects so React re-renders), then mutated.
  const touched = new Map<string, Page>()
  const working = (id: string): Page | undefined => {
    if (touched.has(id)) return touched.get(id)
    const page = lookup(id)
    if (!page) return undefined
    const copy = { ...page, blocks: structuredClone(page.blocks) }
    touched.set(id, copy)
    return copy
  }
  const changed = new Set<string>()
  const find = (bs: Block[], id: string): { list: Block[]; index: number } | null => {
    for (let i = 0; i < bs.length; i++) {
      if (bs[i].id === id) return { list: bs, index: i }
      const inner = find(bs[i].children, id)
      if (inner) return inner
    }
    return null
  }
  const now = new Date().toISOString()
  for (const op of ops) {
    if (op.type !== 'move') {
      const page = working(op.pageId)
      const hit = page && find(page.blocks, op.blockId)
      if (!hit) continue // block already gone or never synced here
      if (op.type === 'delete') hit.list.splice(hit.index, 1)
      else hit.list[hit.index] = { ...hit.list[hit.index], content: op.content ?? hit.list[hit.index].content, updatedAt: now }
      changed.add(op.pageId)
      continue
    }
    // Move: detach from the source page (or use the carried copy), insert at the destination.
    const src = working(op.pageId)
    const destId = op.toPageId ?? op.pageId
    let dest = working(destId)
    if (!dest && op.toPageId) {
      dest = { id: op.toPageId, title: op.toPageTitle ?? op.toPageId, blocks: [], createdAt: op.createdAt, updatedAt: op.createdAt, isDaily: op.toIsDaily || undefined }
      touched.set(dest.id, dest)
    }
    if (!dest) continue
    const hit = src && find(src.blocks, op.blockId)
    let block: Block | undefined
    if (hit) block = hit.list.splice(hit.index, 1)[0]
    else if (op.block && !find(dest.blocks, op.blockId)) block = structuredClone(op.block)
    if (!block) continue
    let target = dest.blocks
    const parent = op.parentId ? find(dest.blocks, op.parentId) : null
    if (op.parentId && parent) target = parent.list[parent.index].children
    // Parent missing here (not synced yet): fall back to the top level rather than lose the block
    const after = op.afterId ? target.findIndex(b => b.id === op.afterId) : -1
    const index = op.afterId == null ? 0 : after >= 0 ? after + 1 : target.length
    // A lone empty placeholder bullet at the destination gives way to the moved block
    if (!parent && dest !== src && dest.blocks.length === 1 && !dest.blocks[0].content.trim() && !dest.blocks[0].children.length) dest.blocks = target = []
    target.splice(Math.min(index, target.length), 0, block)
    changed.add(dest.id)
    if (hit) changed.add(op.pageId)
  }
  const out: Page[] = []
  for (const page of touched.values()) {
    if (!changed.has(page.id)) continue
    // Never leave a page with no bullet to type into
    if (!page.blocks.length) page.blocks = [{ id: generateId(), content: '', children: [], checked: null }]
    out.push(page)
  }
  return out
}
