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
  type: 'edit' | 'delete'
  pageId: string
  blockId: string
  content?: string
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

  const target = url.searchParams.get('page')?.trim()
  let page: Page | null
  if (!target) {
    const parts = todayParts()
    page = (await getPage(dailyId(parts))) ?? {
      id: dailyId(parts), title: dailyTitle(parts), blocks: [], createdAt: now, updatedAt: now, isDaily: true,
    }
  } else {
    const daily = parseDaily(target)
    page = await findPage(target)
    if (!page) {
      page = daily
        ? { id: dailyId(daily), title: dailyTitle(daily), blocks: [], createdAt: now, updatedAt: now, isDaily: true }
        : {
            id: target.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') + '-' + generateId().slice(0, 6),
            title: target, blocks: [], createdAt: now, updatedAt: now,
          }
    }
  }

  // Agents sometimes load the same URL twice; ignore an identical add within 2 minutes.
  const s = store()
  const inbox = ((await s.get('inbox', { type: 'json' })) as InboxItem[] | null) ?? []
  const dupe = inbox.find(i => i.pageId === page!.id && i.block.content === content && Date.now() - Date.parse(i.createdAt) < 120_000)
  if (dupe) return text(`Already added to "${page.title}": ${content}`)

  const block: Block = { id: generateId(), content, children: [], checked: null, createdAt: now, updatedAt: now }
  // Drop a lone empty placeholder bullet so the new block isn't preceded by a blank one.
  if (page.blocks.length === 1 && !page.blocks[0].content.trim() && !page.blocks[0].children.length) page.blocks = []
  page.blocks.push(block)
  page.updatedAt = now
  await savePages([page])

  inbox.push({ id: generateId(), pageId: page.id, pageTitle: page.title, isDaily: !!page.isDaily, block, createdAt: now })
  await s.setJSON('inbox', inbox)

  return text(`Added to "${page.title}": ${content}`)
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
    return json(((await store().get('ops', { type: 'json' })) as CloudOp[] | null) ?? [])
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

function isAgentAuthorized(req: Request): boolean {
  const password = Netlify.env.get('ROMA_AGENT_PASSWORD')
  const header = req.headers.get('authorization') ?? ''
  if (!password || !header.startsWith('Basic ')) return false
  try {
    return atob(header.slice(6)) === `instinct:${password}`
  } catch {
    return false
  }
}

export default async (req: Request, _context: Context): Promise<Response> => {
  const url = new URL(req.url)
  const [, , token, ...rest] = url.pathname.split('/')
  const secret = Netlify.env.get('ROMA_TOKEN')
  if (!secret || token !== secret) return text('Not found', 404)

  const route = rest.join('/').replace(/\/$/, '')
  const base = `${url.origin}/n/${token}`
  try {
    // The apps authenticate with the path token alone; the agent routes also need
    // HTTP Basic auth (user "instinct", password ROMA_AGENT_PASSWORD).
    if (route.startsWith('sync/')) return await routeSync(req, route.slice(5))
    if (!isAgentAuthorized(req)) {
      return new Response('Authentication required (user: instinct)', {
        status: 401,
        headers: { 'www-authenticate': 'Basic realm="Roma Research", charset="UTF-8"', 'content-type': 'text/plain; charset=utf-8' },
      })
    }
    switch (route) {
      case '': return text(help(base))
      case 'today': return await routeToday()
      case 'page': return await routePage(url)
      case 'search': return await routeSearch(url)
      case 'recent': return await routeRecent(url)
      case 'add': return await routeAdd(url)
      case 'edit': return await routeEdit(url)
      case 'delete': return await routeDelete(url)
    }
    return text(`Unknown route. See ${base}/`, 404)
  } catch (err) {
    return text(`Error: ${(err as Error).message}`, 500)
  }
}

export const config: Config = { path: '/n/*' }
