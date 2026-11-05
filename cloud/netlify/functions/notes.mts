import { getStore } from '@netlify/blobs'
import type { Config, Context } from '@netlify/functions'

// Roma Research cloud bridge: lets an agent that can only browse URLs read and
// write notes. Every route lives under /n/<ROMA_TOKEN>/, so the URL is the secret.
// Writes use GET on purpose — browsing agents often can't send POST requests.

interface Block {
  id: string
  content: string
  children: Block[]
  checked?: boolean | null
  createdAt?: string
  updatedAt?: string
}

interface Page {
  id: string
  title: string
  blocks: Block[]
  createdAt: string
  updatedAt: string
  isDaily?: boolean
  starred?: boolean
}

interface IndexEntry {
  id: string
  title: string
  updatedAt: string
  isDaily?: boolean
  text: string
}

interface InboxItem {
  id: string
  pageId: string
  pageTitle: string
  isDaily: boolean
  block: Block
  createdAt: string
}

// Agent edits/deletes waiting for the apps. Kept apart from the "inbox" (adds)
// so app builds that only understand adds keep working.
interface CloudOp {
  id: string
  type: 'edit' | 'delete' | 'move'
  pageId: string
  blockId: string
  content?: string
  // move: destination. parentId null = top level; afterId null = first position.
  // A cross-page move carries the block and the target page so a device that
  // lacks either can still apply it.
  toPageId?: string
  toPageTitle?: string
  toIsDaily?: boolean
  parentId?: string | null
  afterId?: string | null
  block?: Block
  createdAt: string
}

interface TrashItem {
  pageId: string
  pageTitle: string
  block: Block
  deletedAt: string
}

const TZ = 'Europe/Madrid'
const ENCRYPT_PATTERN = /\{\{encrypt:[^}]+\}\}/

const store = () => getStore({ name: 'roma', consistency: 'strong' })

// ── helpers (mirror src/renderer/utils/helpers.ts) ──────────────────────────

function generateId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

function sanitizeFilename(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').substring(0, 200)
}

function todayParts(): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date())
  const get = (t: string) => Number(parts.find(p => p.type === t)!.value)
  return { y: get('year'), m: get('month'), d: get('day') }
}

function dailyId({ y, m, d }: { y: number; m: number; d: number }): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function dailyTitle({ y, m, d }: { y: number; m: number; d: number }): string {
  const month = new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' })
  const suffix = d >= 11 && d <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[d % 10] ?? 'th'
  return `${month} ${d}${suffix}, ${y}`
}

function parseDaily(s: string): { y: number; m: number; d: number } | null {
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (iso) return { y: +iso[1], m: +iso[2], d: +iso[3] }
  const roam = s.match(/^([A-Za-z]+)\s+(\d+)(?:st|nd|rd|th),\s+(\d{4})$/)
  if (roam) {
    const m = new Date(`${roam[1]} 1, 2000`).getMonth() + 1
    if (m) return { y: +roam[3], m, d: +roam[2] }
  }
  return null
}

function blocksToMarkdown(blocks: Block[], indent = 0, withIds = false): string {
  const lines: string[] = []
  for (const b of blocks) {
    if (!b.content.trim() && b.children.length === 0) continue
    const content = ENCRYPT_PATTERN.test(b.content) ? '[encrypted]' : b.content
    // "^id" suffix lets the agent target a block with /edit or /delete
    lines.push(`${'  '.repeat(indent)}- ${content}${withIds ? `  ^${b.id}` : ''}`)
    if (b.children.length) lines.push(blocksToMarkdown(b.children, indent + 1, withIds))
  }
  return lines.filter(Boolean).join('\n')
}

/** Locate a block anywhere in a tree: the array holding it and its index there. */
function findBlock(blocks: Block[], id: string): { list: Block[]; index: number } | null {
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].id === id) return { list: blocks, index: i }
    const inner = findBlock(blocks[i].children, id)
    if (inner) return inner
  }
  return null
}

/** Parent block of `id` (null when top-level), or undefined when not found. */
function findParent(blocks: Block[], id: string, parent: Block | null = null): Block | null | undefined {
  for (const b of blocks) {
    if (b.id === id) return parent
    const inner = findParent(b.children, id, b)
    if (inner !== undefined) return inner
  }
  return undefined
}

function containsBlock(block: Block, id: string): boolean {
  return block.id === id || block.children.some(c => containsBlock(c, id))
}

/**
 * Move a block (with its children) under `parentId` (null = top level), right
 * after sibling `afterId` (null = first, 'last' = end). Mutates both pages.
 * Returns an error message, or the resolved afterId on success.
 */
function moveBlock(
  src: Page, blockId: string, dest: Page, parentId: string | null, afterId: string | null | 'last',
): { error: string } | { afterId: string | null } {
  const hit = findBlock(src.blocks, blockId)
  if (!hit) return { error: `Block ^${blockId} not found on "${src.title}"` }
  const block = hit.list[hit.index]
  if (parentId && containsBlock(block, parentId)) return { error: `Can't move ^${blockId} inside itself` }
  let target = dest.blocks
  if (parentId) {
    const p = findBlock(dest.blocks, parentId)
    if (!p) return { error: `Parent ^${parentId} not found on "${dest.title}"` }
    target = p.list[p.index].children
  }
  if (afterId === blockId) return { error: `Can't place ^${blockId} after itself` }
  if (afterId && afterId !== 'last' && !target.some(b => b.id === afterId)) {
    return { error: `^${afterId} is not a sibling at the destination` }
  }
  hit.list.splice(hit.index, 1)
  const index = afterId === 'last' ? target.length : afterId ? target.findIndex(b => b.id === afterId) + 1 : 0
  target.splice(index, 0, block)
  return { afterId: index > 0 ? target[index - 1].id : null }
}

function plainText(blocks: Block[]): string {
  const parts: string[] = []
  const walk = (bs: Block[]) => {
    for (const b of bs) {
      if (!ENCRYPT_PATTERN.test(b.content) && b.content.trim()) parts.push(b.content.trim())
      walk(b.children)
    }
  }
  walk(blocks)
  return parts.join('\n')
}

function text(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } })
}

// ── storage ──────────────────────────────────────────────────────────────────

async function getIndex(): Promise<IndexEntry[]> {
  return ((await store().get('index', { type: 'json' })) as IndexEntry[] | null) ?? []
}

async function getPage(id: string): Promise<Page | null> {
  return (await store().get(`pages/${sanitizeFilename(id)}`, { type: 'json' })) as Page | null
}

function hasRealContent(blocks: Block[]): boolean {
  return blocks.some(b => b.content.trim() !== '' || hasRealContent(b.children))
}

async function savePages(incoming: Page[], { fromApp = false } = {}): Promise<void> {
  const s = store()
  const pages: Page[] = []
  for (const p of incoming) {
    // A device that saves a not-yet-synced empty daily note must not wipe the
    // real one (same content-wins rule as iCloud sync). Only for app uploads of
    // dailies: emptying a topic page — or an agent delete — is intentional.
    if (fromApp && p.isDaily && !hasRealContent(p.blocks)) {
      const existing = await getPage(p.id)
      if (existing && hasRealContent(existing.blocks)) continue
    }
    pages.push(p)
  }
  for (const p of pages) await s.setJSON(`pages/${sanitizeFilename(p.id)}`, p)
  const index = await getIndex()
  const byId = new Map(index.map(e => [e.id, e]))
  for (const p of pages) {
    byId.set(p.id, { id: p.id, title: p.title, updatedAt: p.updatedAt, isDaily: p.isDaily, text: plainText(p.blocks) })
  }
  await s.setJSON('index', [...byId.values()])
}

async function findPage(query: string): Promise<Page | null> {
  const daily = parseDaily(query.trim())
  if (daily) return getPage(dailyId(daily))
  const direct = await getPage(query)
  if (direct) return direct
  const q = query.trim().toLowerCase()
  const hit = (await getIndex()).find(e => e.title.toLowerCase() === q || e.id.toLowerCase() === q)
  return hit ? getPage(hit.id) : null
}

// ── routes ───────────────────────────────────────────────────────────────────

function help(base: string): string {
  const t = dailyTitle(todayParts())
  return `Roma Research — notes API (plain text responses)

Notes use Roam syntax: [[page links]], #tags, {{[[TODO]]}} / {{[[DONE]]}}, **bold**.
Daily note pages are titled like "${t}".

READ
  ${base}/today                     today's daily note
  ${base}/page?title=<title>        one page (also accepts a date like 2026-10-21)
  ${base}/search?q=<words>          full-text search, newest first
  ${base}/recent?n=20               recently edited pages

WRITE (GET requests; URL-encode the text)
  ${base}/add?text=<text>                       add a bullet to today's daily note
  ${base}/add?text=<text>&todo=1                add it as a TODO
  ${base}/add?text=<text>&page=<title>          add to another page (created if missing)

EDIT / DELETE (block ids are the "^id" at the end of each line in /today and /page)
  ${base}/edit?page=<title>&id=<blockId>&text=<new text>   replace a block's text
  ${base}/delete?page=<title>&id=<blockId>                 delete a block (and its sub-bullets)
  ${base}/delete?page=<title>&id=<id1>,<id2>,...           delete several blocks
  Encrypted blocks can't be edited or deleted. Deleted blocks are kept in a server-side trash.

STRUCTURE (sub-bullets always move with their block; several ids keep their order)
  ${base}/indent?page=<title>&id=<blockId>                 indent (child of the bullet above)
  ${base}/outdent?page=<title>&id=<blockId>                outdent (sibling right after its parent)
  ${base}/move?page=<title>&id=<blockId>&under=<parentId>  make it the last child of another block
  ${base}/move?page=<title>&id=<blockId>&after=<blockId>   place it right after another block
  ${base}/move?page=<title>&id=<blockId>&after=first       first bullet at its level (add &under=top for top level)
  ${base}/move?page=<title>&id=<blockId>&to=<other page>   move to another page (end; combine with under/after)
  ${base}/add?text=<text>&page=<title>&under=<id>          add as a sub-bullet (or &after=<id> to add below a block)
  /add replies with the new block's ^id.

Writes reach the Mac/iPhone apps the next time they open.
`
}

async function routeToday(): Promise<Response> {
  const parts = todayParts()
  const page = await getPage(dailyId(parts))
  if (!page) return text(`# ${dailyTitle(parts)}\n\n(empty)`)
  return text(`# ${page.title}\n\n${blocksToMarkdown(page.blocks, 0, true) || '(empty)'}`)
}

async function routePage(url: URL): Promise<Response> {
  const title = url.searchParams.get('title') ?? url.searchParams.get('id')
  if (!title) return text('Missing ?title=', 400)
  const page = await findPage(title)
  if (!page) return text(`Page "${title}" not found. Try /search?q=${encodeURIComponent(title)}`, 404)
  const link = `[[${page.title.toLowerCase()}]]`
  const refs = (await getIndex())
    .filter(e => e.id !== page.id && e.text.toLowerCase().includes(link))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 20)
    .map(e => `## ${e.title}\n${e.text.split('\n').filter(l => l.toLowerCase().includes(link)).map(l => `- ${l}`).join('\n')}`)
  const refsSection = refs.length ? `\n\n---\nLinked references:\n\n${refs.join('\n\n')}` : ''
  return text(`# ${page.title}\nupdated ${page.updatedAt}\n\n${blocksToMarkdown(page.blocks, 0, true) || '(empty)'}${refsSection}`)
}

async function routeSearch(url: URL): Promise<Response> {
  const q = (url.searchParams.get('q') ?? '').trim().toLowerCase()
  if (!q) return text('Missing ?q=', 400)
  const terms = q.split(/\s+/)
  const limit = Math.min(Number(url.searchParams.get('n')) || 20, 50)
  const hits = (await getIndex())
    .filter(e => terms.every(term => (e.title + '\n' + e.text).toLowerCase().includes(term)))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit)
  if (!hits.length) return text(`No results for "${q}".`)
  const out = hits.map(e => {
    const lines = e.text.split('\n').filter(l => terms.some(term => l.toLowerCase().includes(term))).slice(0, 3)
    return `## ${e.title}\n${lines.map(l => `- ${l.slice(0, 300)}`).join('\n')}`
  })
  return text(`${hits.length} result(s) for "${q}":\n\n${out.join('\n\n')}`)
}

async function routeRecent(url: URL): Promise<Response> {
  const n = Math.min(Number(url.searchParams.get('n')) || 20, 100)
  const list = (await getIndex()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, n)
  return text(list.map(e => `- ${e.title} (${e.updatedAt.slice(0, 10)})`).join('\n'))
}

async function routeAdd(url: URL): Promise<Response> {
  const raw = (url.searchParams.get('text') ?? '').trim()
  if (!raw) return text('Missing ?text=', 400)
  const todo = ['1', 'true', 'yes'].includes(url.searchParams.get('todo') ?? '')
  const content = todo ? `{{[[TODO]]}} ${raw}` : raw
  const now = new Date().toISOString()
  const page = await findOrNewPage(url.searchParams.get('page')?.trim(), now)
  const under = url.searchParams.get('under')?.trim()
  const after = url.searchParams.get('after')?.trim()
  if (under && under !== 'top' && !findBlock(page.blocks, under)) return text(`Parent ^${under} not found on "${page.title}" — nothing added.`)
  if (after && !['first', 'last'].includes(after) && !findBlock(page.blocks, after)) return text(`Block ^${after} not found on "${page.title}" — nothing added.`)

  // Agents sometimes load the same URL twice; ignore an identical add within 2 minutes.
  const s = store()
  const inbox = ((await s.get('inbox', { type: 'json' })) as InboxItem[] | null) ?? []
  const dupe = inbox.find(i => i.pageId === page.id && i.block.content === content && Date.now() - Date.parse(i.createdAt) < 120_000)
  if (dupe) return text(`Already added to "${page.title}": ${content}`)

  const block: Block = { id: generateId(), content, children: [], checked: null, createdAt: now, updatedAt: now }
  // Drop a lone empty placeholder bullet so the new block isn't preceded by a blank one.
  if (page.blocks.length === 1 && !page.blocks[0].content.trim() && !page.blocks[0].children.length) page.blocks = []
  page.blocks.push(block)
  // Positioned add = plain add (inbox, appended at the end) + a move op; the apps
  // replay ops after the inbox, so old app builds still get the block.
  let move: CloudOp | null = null
  if (under || after) {
    const dest = resolveDestination(page, under, after)
    if ('error' in dest) return text(`${dest.error} — nothing added.`)
    const res = moveBlock(page, block.id, page, dest.parentId, dest.afterId)
    if ('error' in res) return text(`${res.error} — nothing added.`)
    move = { id: generateId(), type: 'move', pageId: page.id, blockId: block.id, parentId: dest.parentId, afterId: res.afterId, createdAt: now }
  }
  page.updatedAt = now
  await savePages([page])

  inbox.push({ id: generateId(), pageId: page.id, pageTitle: page.title, isDaily: !!page.isDaily, block, createdAt: now })
  await s.setJSON('inbox', inbox)
  if (move) await pushOps([move])

  return text(`Added to "${page.title}": ${content}  ^${block.id}`)
}

/** Page by title/date; today's daily note when no title; a new (unsaved) page when missing. */
async function findOrNewPage(target: string | undefined, now: string): Promise<Page> {
  if (!target) {
    const parts = todayParts()
    return (await getPage(dailyId(parts))) ?? {
      id: dailyId(parts), title: dailyTitle(parts), blocks: [], createdAt: now, updatedAt: now, isDaily: true,
    }
  }
  const found = await findPage(target)
  if (found) return found
  const daily = parseDaily(target)
  return daily
    ? { id: dailyId(daily), title: dailyTitle(daily), blocks: [], createdAt: now, updatedAt: now, isDaily: true }
    : {
        id: target.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') + '-' + generateId().slice(0, 6),
        title: target, blocks: [], createdAt: now, updatedAt: now,
      }
}

/**
 * Turn the agent's ?under= / ?after= into a destination.
 * under=<id> → child of that block (default: last child); under=top → top level.
 * after=<id> → right after that block, as its sibling; after=first|last → ends of the list.
 */
function resolveDestination(
  page: Page, under: string | undefined, after: string | undefined,
): { error: string } | { parentId: string | null; afterId: string | null | 'last' } {
  const parentId = under && under !== 'top' ? under : null
  if (after && after !== 'first' && after !== 'last') {
    const p = findParent(page.blocks, after)
    if (p === undefined) return { error: `Block ^${after} not found on "${page.title}"` }
    if (under && (p?.id ?? null) !== parentId) return { error: `^${after} is not a child of ${under === 'top' ? 'the top level' : `^${under}`}` }
    return { parentId: p?.id ?? null, afterId: after }
  }
  return { parentId, afterId: after === 'first' ? null : 'last' }
}

function parseIds(url: URL): string[] {
  return (url.searchParams.get('id') ?? '').split(',').map(s => s.trim()).filter(Boolean)
}

/** Save the touched pages and queue the move ops for the apps. */
async function commitMoves(pages: Page[], ops: CloudOp[], now: string): Promise<void> {
  for (const p of pages) p.updatedAt = now
  await savePages(pages)
  await pushOps(ops)
}

async function routeMove(url: URL): Promise<Response> {
  const title = url.searchParams.get('page')?.trim()
  const ids = parseIds(url)
  const under = url.searchParams.get('under')?.trim()
  const after = url.searchParams.get('after')?.trim()
  const to = url.searchParams.get('to')?.trim()
  if (!title || !ids.length || (!under && !after && !to)) {
    return text('Usage: /move?page=<title>&id=<blockId>[,...]&under=<id|top>&after=<id|first|last>[&to=<other page>]', 400)
  }
  const src = await findPage(title)
  if (!src) return text(`Page "${title}" not found — nothing moved.`)
  const now = new Date().toISOString()
  const dest = to ? await findOrNewPage(to, now) : src
  const sameDest = dest.id === src.id
  const target = sameDest ? src : dest

  const where = resolveDestination(target, under, after)
  if ('error' in where) return text(`${where.error} — nothing moved.`)
  const ops: CloudOp[] = []
  const report: string[] = []
  // Several ids keep their order: each one lands right after the previous one.
  let afterId = where.afterId
  for (const id of ids) {
    const hit = findBlock(src.blocks, id)
    if (!hit) { report.push(`^${id}: not found`); continue }
    const block = hit.list[hit.index]
    const res = moveBlock(src, id, target, where.parentId, afterId)
    if ('error' in res) { report.push(`^${id}: ${res.error}`); continue }
    afterId = id
    ops.push({
      id: generateId(), type: 'move', pageId: src.id, blockId: id, parentId: where.parentId, afterId: res.afterId, createdAt: now,
      ...(sameDest ? {} : { toPageId: target.id, toPageTitle: target.title, toIsDaily: !!target.isDaily, block: structuredClone(block) }),
    })
    report.push(`^${id}: moved — ${block.content.slice(0, 80)}`)
  }
  if (!ops.length) return text(`Nothing moved:\n${report.join('\n')}`)
  await commitMoves(sameDest ? [src] : [src, target], ops, now)
  return text(`${sameDest ? `On "${src.title}"` : `"${src.title}" → "${target.title}"`}:\n${report.join('\n')}`)
}

/** Indent: become the last child of the previous sibling (Tab in the app). */
async function routeIndent(url: URL): Promise<Response> {
  const title = url.searchParams.get('page')?.trim()
  const ids = parseIds(url)
  if (!title || !ids.length) return text('Usage: /indent?page=<title>&id=<blockId>[,...]', 400)
  const page = await findPage(title)
  if (!page) return text(`Page "${title}" not found — nothing indented.`)
  const now = new Date().toISOString()
  const ops: CloudOp[] = []
  const report: string[] = []
  for (const id of ids) {
    const hit = findBlock(page.blocks, id)
    if (!hit) { report.push(`^${id}: not found`); continue }
    if (hit.index === 0) { report.push(`^${id}: no previous sibling to indent under`); continue }
    const parentId = hit.list[hit.index - 1].id
    const res = moveBlock(page, id, page, parentId, 'last')
    if ('error' in res) { report.push(`^${id}: ${res.error}`); continue }
    ops.push({ id: generateId(), type: 'move', pageId: page.id, blockId: id, parentId, afterId: res.afterId, createdAt: now })
    report.push(`^${id}: indented under ^${parentId}`)
  }
  if (!ops.length) return text(`Nothing indented:\n${report.join('\n')}`)
  await commitMoves([page], ops, now)
  return text(`On "${page.title}":\n${report.join('\n')}`)
}

/** Outdent: become the sibling right after its parent (Shift-Tab in the app). */
async function routeOutdent(url: URL): Promise<Response> {
  const title = url.searchParams.get('page')?.trim()
  const ids = parseIds(url)
  if (!title || !ids.length) return text('Usage: /outdent?page=<title>&id=<blockId>[,...]', 400)
  const page = await findPage(title)
  if (!page) return text(`Page "${title}" not found — nothing outdented.`)
  const now = new Date().toISOString()
  const ops: CloudOp[] = []
  const report: string[] = []
  // Reverse order so outdented siblings keep their relative order after the parent.
  for (const id of [...ids].reverse()) {
    const parent = findParent(page.blocks, id)
    if (parent === undefined) { report.push(`^${id}: not found`); continue }
    if (parent === null) { report.push(`^${id}: already at the top level`); continue }
    const grand = findParent(page.blocks, parent.id) ?? null
    const parentId = grand?.id ?? null
    const res = moveBlock(page, id, page, parentId, parent.id)
    if ('error' in res) { report.push(`^${id}: ${res.error}`); continue }
    ops.push({ id: generateId(), type: 'move', pageId: page.id, blockId: id, parentId, afterId: res.afterId, createdAt: now })
    report.push(`^${id}: outdented`)
  }
  if (!ops.length) return text(`Nothing outdented:\n${report.reverse().join('\n')}`)
  await commitMoves([page], ops, now) // replayed in execution order
  return text(`On "${page.title}":\n${report.reverse().join('\n')}`)
}

async function pushOps(ops: CloudOp[]): Promise<void> {
  const s = store()
  const queue = ((await s.get('ops', { type: 'json' })) as CloudOp[] | null) ?? []
  await s.setJSON('ops', [...queue, ...ops])
}

async function routeEdit(url: URL): Promise<Response> {
  const title = url.searchParams.get('page')?.trim()
  const blockId = url.searchParams.get('id')?.trim()
  const raw = url.searchParams.get('text')
  if (!title || !blockId || raw === null) return text('Usage: /edit?page=<title>&id=<blockId>&text=<new text>', 400)
  const content = raw.trim()
  if (!content) return text('Empty text — use /delete to remove a block.', 400)
  const page = await findPage(title)
  // Outcomes are reported as 200 + message: agents read the text, and some
  // platforms swap 4xx bodies for their own error pages.
  if (!page) return text(`Page "${title}" not found — nothing edited.`)
  const hit = findBlock(page.blocks, blockId)
  if (!hit) return text(`Block ^${blockId} not found on "${page.title}" — nothing edited. Reload the page to get current ids.`)
  const block = hit.list[hit.index]
  if (ENCRYPT_PATTERN.test(block.content)) return text('That block is encrypted and can\'t be edited.')
  if (block.content === content) return text(`Unchanged: ${content}`)

  const now = new Date().toISOString()
  block.content = content
  block.updatedAt = now
  page.updatedAt = now
  await savePages([page])
  await pushOps([{ id: generateId(), type: 'edit', pageId: page.id, blockId, content, createdAt: now }])
  return text(`Edited on "${page.title}": ${content}`)
}

async function routeDelete(url: URL): Promise<Response> {
  const title = url.searchParams.get('page')?.trim()
  const ids = (url.searchParams.get('id') ?? '').split(',').map(s => s.trim()).filter(Boolean)
  if (!title || !ids.length) return text('Usage: /delete?page=<title>&id=<blockId>[,<blockId>...]', 400)
  const page = await findPage(title)
  if (!page) return text(`Page "${title}" not found — nothing deleted.`)

  const now = new Date().toISOString()
  const deleted: Block[] = []
  const report: string[] = []
  for (const id of ids) {
    const hit = findBlock(page.blocks, id)
    if (!hit) { report.push(`^${id}: not found (already deleted?)`); continue }
    const block = hit.list[hit.index]
    const hasEncrypted = (b: Block): boolean => ENCRYPT_PATTERN.test(b.content) || b.children.some(hasEncrypted)
    if (hasEncrypted(block)) { report.push(`^${id}: contains encrypted content, not deleted`); continue }
    hit.list.splice(hit.index, 1)
    deleted.push(block)
    report.push(`^${id}: deleted — ${block.content.slice(0, 80)}`)
  }
  if (!deleted.length) return text(`Nothing deleted on "${page.title}":\n${report.join('\n')}`)

  page.updatedAt = now
  await savePages([page])
  const s = store()
  const trash = ((await s.get('trash', { type: 'json' })) as TrashItem[] | null) ?? []
  await s.setJSON('trash', [...trash, ...deleted.map(block => ({ pageId: page.id, pageTitle: page.title, block, deletedAt: now }))].slice(-500))
  await pushOps(deleted.map(b => ({ id: generateId(), type: 'delete' as const, pageId: page.id, blockId: b.id, createdAt: now })))
  return text(`On "${page.title}":\n${report.join('\n')}`)
}

// App-side sync, called by the Mac/iPhone apps (src/renderer/utils/cloudBridge.ts).
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
}

function json(body: unknown): Response {
  return Response.json(body, { headers: { ...CORS, 'cache-control': 'no-store' } })
}

async function routeSync(req: Request, sub: string): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (sub === 'pages' && req.method === 'POST') {
    const pages = (await req.json()) as Page[]
    await savePages(pages, { fromApp: true })
    return json({ ok: true, saved: pages.length })
  }
  if (sub === 'index' && req.method === 'GET') {
    return json((await getIndex()).map(e => ({ id: e.id, updatedAt: e.updatedAt })))
  }
  if (sub === 'delete' && req.method === 'POST') {
    const { ids } = (await req.json()) as { ids: string[] }
    const s = store()
    for (const id of ids) await s.delete(`pages/${sanitizeFilename(id)}`)
    await s.setJSON('index', (await getIndex()).filter(e => !ids.includes(e.id)))
    return json({ ok: true })
  }
  if (sub === 'inbox' && req.method === 'GET') {
    return json(((await store().get('inbox', { type: 'json' })) as InboxItem[] | null) ?? [])
  }
  if (sub === 'ops' && req.method === 'GET') {
    const ops = ((await store().get('ops', { type: 'json' })) as CloudOp[] | null) ?? []
    // Builds before v2 treat every non-delete op as an edit: they'd ack a move
    // without applying it, then push their stale page back over the server's.
    // Ops queue in order, so stop at the first move rather than skip past it.
    if (Number(new URL(req.url).searchParams.get('v')) >= 2) return json(ops)
    const firstMove = ops.findIndex(o => o.type === 'move')
    return json(firstMove < 0 ? ops : ops.slice(0, firstMove))
  }
  if (sub === 'ops/ack' && req.method === 'POST') {
    const { ids } = (await req.json()) as { ids: string[] }
    const s = store()
    const ops = ((await s.get('ops', { type: 'json' })) as CloudOp[] | null) ?? []
    await s.setJSON('ops', ops.filter(o => !ids.includes(o.id)))
    return json({ ok: true })
  }
  if (sub === 'inbox/ack' && req.method === 'POST') {
    const { ids } = (await req.json()) as { ids: string[] }
    const s = store()
    const inbox = ((await s.get('inbox', { type: 'json' })) as InboxItem[] | null) ?? []
    await s.setJSON('inbox', inbox.filter(i => !ids.includes(i.id)))
    return json({ ok: true })
  }
  return text('Not found', 404)
}

// Each agent has its own password so access can be revoked one at a time.
// Grok's browser may not send Basic auth, so it can also put its password in the
// URL: /n/<token>/k/<password>/... (keeps every link in the help text working) or ?key=.
const AGENTS: { name: string; env: string; urlKey: boolean }[] = [
  { name: 'instinct', env: 'ROMA_AGENT_PASSWORD', urlKey: false },
  { name: 'grok', env: 'ROMA_GROK_PASSWORD', urlKey: true },
]

function authorizedAgent(req: Request, urlKey: string | null): string | null {
  const header = req.headers.get('authorization') ?? ''
  let basic: string | null = null
  if (header.startsWith('Basic ')) {
    try { basic = atob(header.slice(6)) } catch { basic = null }
  }
  for (const agent of AGENTS) {
    const password = Netlify.env.get(agent.env)
    if (!password) continue
    if (basic === `${agent.name}:${password}`) return agent.name
    if (agent.urlKey && urlKey === password) return agent.name
  }
  return null
}

const WRITE_ROUTES = new Set(['add', 'edit', 'delete', 'move', 'indent', 'outdent'])

// Who wrote what: last 1000 agent writes, readable in the "log" blob.
async function logWrite(agent: string, route: string, url: URL, res: Response) {
  const s = store()
  const log = ((await s.get('log', { type: 'json' })) as unknown[] | null) ?? []
  const params = Object.fromEntries([...url.searchParams].filter(([k]) => k !== 'key'))
  log.push({ agent, route, params, status: res.status, at: new Date().toISOString() })
  await s.setJSON('log', log.slice(-1000))
}

export default async (req: Request, _context: Context): Promise<Response> => {
  const url = new URL(req.url)
  const [, , token, ...rest] = url.pathname.split('/')
  const secret = Netlify.env.get('ROMA_TOKEN')
  if (!secret || token !== secret) return text('Not found', 404)

  // Optional /k/<password>/ segment (see AGENTS)
  const pathKey = rest[0] === 'k' && rest.length > 1 ? rest[1] : null
  const parts = pathKey ? rest.slice(2) : rest
  const route = parts.join('/').replace(/\/$/, '')
  const base = `${url.origin}/n/${token}${pathKey ? `/k/${pathKey}` : ''}`
  try {
    // The apps authenticate with the path token alone; the agent routes also need
    // an agent password (see AGENTS).
    if (route.startsWith('sync/')) return await routeSync(req, route.slice(5))
    const agent = authorizedAgent(req, pathKey ?? url.searchParams.get('key'))
    if (!agent) {
      return new Response('Authentication required', {
        status: 401,
        headers: { 'www-authenticate': 'Basic realm="Roma Research", charset="UTF-8"', 'content-type': 'text/plain; charset=utf-8' },
      })
    }
    const handlers: Record<string, () => Promise<Response>> = {
      '': async () => text(help(base)),
      today: routeToday,
      page: () => routePage(url),
      search: () => routeSearch(url),
      recent: () => routeRecent(url),
      add: () => routeAdd(url),
      edit: () => routeEdit(url),
      delete: () => routeDelete(url),
      move: () => routeMove(url),
      indent: () => routeIndent(url),
      outdent: () => routeOutdent(url),
    }
    const handler = handlers[route]
    if (handler) {
      const res = await handler()
      if (WRITE_ROUTES.has(route)) await logWrite(agent, route, url, res)
      return res
    }
    return text(`Unknown route. See ${base}/`, 404)
  } catch (err) {
    return text(`Error: ${(err as Error).message}`, 500)
  }
}

export const config: Config = { path: '/n/*' }
