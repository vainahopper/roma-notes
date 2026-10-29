import type { Page, Block } from '../../shared/types'

// Cloud bridge: mirrors pages to the Netlify API in cloud/ so an agent (Instinct)
// can read them without the Mac being on, and pulls the agent's writes from its
// inbox. Disabled when VITE_ROMA_CLOUD_URL (".../n/<token>") isn't set at build time.

const BASE: string | undefined = import.meta.env.VITE_ROMA_CLOUD_URL
const MAX_BATCH_BYTES = 4_000_000 // Netlify functions reject bodies over 6MB
const PUSH_DEBOUNCE_MS = 5000

export interface InboxItem {
  id: string
  pageId: string
  pageTitle: string
  isDaily: boolean
  block: Block
  createdAt: string
}

/** An agent edit/delete to replay on the local page (adds come via the inbox). */
export interface CloudOp {
  id: string
  type: 'edit' | 'delete' | 'move'
  pageId: string
  blockId: string
  content?: string
  // move: destination (parentId null = top level, afterId null = first).
  // Cross-page moves also carry the target page and the block itself.
  toPageId?: string
  toPageTitle?: string
  toIsDaily?: boolean
  parentId?: string | null
  afterId?: string | null
  block?: Block
  createdAt: string
}

export const cloudEnabled = !!BASE

const pending = new Map<string, Page>()
let pushTimer: ReturnType<typeof setTimeout> | null = null

async function post(path: string, body: unknown): Promise<void> {
  const res = await fetch(`${BASE}/sync/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`cloud ${path}: ${res.status}`)
}

async function pushPages(pages: Page[]): Promise<void> {
  let batch: Page[] = []
  let size = 0
  for (const page of pages) {
    const bytes = JSON.stringify(page).length
    if (batch.length && size + bytes > MAX_BATCH_BYTES) {
      await post('pages', batch)
      batch = []
      size = 0
    }
    batch.push(page)
    size += bytes
  }
  if (batch.length) await post('pages', batch)
}

async function flush() {
  pushTimer = null
  if (!pending.size) return
  const pages = [...pending.values()]
  pending.clear()
  try {
    await pushPages(pages)
  } catch (err) {
    console.warn('[Roma] cloud push failed, retrying later:', err)
    for (const p of pages) if (!pending.has(p.id)) pending.set(p.id, p)
    pushTimer = setTimeout(flush, 30_000)
  }
}

/** Queue a saved page for upload (debounced, batched). */
export function queueCloudPush(page: Page) {
  if (!BASE) return
  pending.set(page.id, page)
  if (pushTimer) clearTimeout(pushTimer)
  pushTimer = setTimeout(flush, PUSH_DEBOUNCE_MS)
}

export function queueCloudDelete(id: string) {
  if (!BASE) return
  pending.delete(id)
  post('delete', { ids: [id] }).catch(err => console.warn('[Roma] cloud delete failed:', err))
}

/**
 * Upload every local page that is newer than (or missing from) the cloud copy.
 * Covers edits made offline and the very first upload.
 */
export async function cloudCatchUp(pages: Page[]): Promise<number> {
  if (!BASE) return 0
  const res = await fetch(`${BASE}/sync/index`)
  if (!res.ok) throw new Error(`cloud index: ${res.status}`)
  const remote = new Map((await res.json() as { id: string; updatedAt: string }[]).map(e => [e.id, e.updatedAt]))
  const stale = pages.filter(p => {
    if (p.updatedAt.startsWith('1970')) return false // in-memory placeholder, never persisted
    const r = remote.get(p.id)
    return !r || p.updatedAt > r
  })
  if (stale.length) await pushPages(stale)
  return stale.length
}

export async function fetchCloudInbox(): Promise<InboxItem[]> {
  if (!BASE) return []
  const res = await fetch(`${BASE}/sync/inbox`)
  if (!res.ok) throw new Error(`cloud inbox: ${res.status}`)
  return res.json()
}

export async function ackCloudInbox(ids: string[]): Promise<void> {
  if (!BASE || !ids.length) return
  await post('inbox/ack', { ids })
}

export async function fetchCloudOps(): Promise<CloudOp[]> {
  if (!BASE) return []
  const res = await fetch(`${BASE}/sync/ops?v=2`) // v2: understands move ops
  if (!res.ok) throw new Error(`cloud ops: ${res.status}`)
  return res.json()
}

export async function ackCloudOps(ids: string[]): Promise<void> {
  if (!BASE || !ids.length) return
  await post('ops/ack', { ids })
}
