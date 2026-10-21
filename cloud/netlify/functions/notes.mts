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

function blocksToMarkdown(blocks: Block[], indent = 0): string {
  const lines: string[] = []
  for (const b of blocks) {
    if (!b.content.trim() && b.children.length === 0) continue
    const content = ENCRYPT_PATTERN.test(b.content) ? '[encrypted]' : b.content
    lines.push(`${'  '.repeat(indent)}- ${content}`)
    if (b.children.length) lines.push(blocksToMarkdown(b.children, indent + 1))
  }
  return lines.filter(Boolean).join('\n')
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

async function savePages(pages: Page[]): Promise<void> {
  const s = store()
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

Writes reach the Mac/iPhone apps the next time they open.
`
}

async function routeToday(): Promise<Response> {
  const parts = todayParts()
  const page = await getPage(dailyId(parts))
  if (!page) return text(`# ${dailyTitle(parts)}\n\n(empty)`)
  return text(`# ${page.title}\n\n${blocksToMarkdown(page.blocks) || '(empty)'}`)
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
  return text(`# ${page.title}\nupdated ${page.updatedAt}\n\n${blocksToMarkdown(page.blocks) || '(empty)'}${refsSection}`)
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
    await savePages(pages)
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
    }
    return text(`Unknown route. See ${base}/`, 404)
  } catch (err) {
    return text(`Error: ${(err as Error).message}`, 500)
  }
}

export const config: Config = { path: '/n/*' }
