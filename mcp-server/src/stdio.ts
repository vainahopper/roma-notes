import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { flattenBlocks } from './flatten.js'
import { readPage, getRecentPages, getDailyNote, loadAllPageMeta, startWatcher } from './pages.js'
import { searchNotes } from './search.js'

const server = new McpServer({ name: 'roma-notes', version: '1.0.0' })

server.tool(
  'search_notes',
  'Search across all notes by content or title. Returns matching excerpts.',
  { query: z.string().describe('Search query'), limit: z.number().optional().describe('Max results (default 20)') },
  async ({ query, limit }) => {
    const results = await searchNotes(query, limit ?? 20)
    if (results.length === 0) return { content: [{ type: 'text', text: `No notes found for "${query}".` }] }
    const text = results.map((r, i) =>
      `${i + 1}. [${r.pageTitle}] (id: ${r.pageId})\n   ${r.excerpt}\n   Updated: ${r.updatedAt}`
    ).join('\n\n')
    return { content: [{ type: 'text', text }] }
  }
)

server.tool(
  'read_note',
  'Read the full content of a specific note by its page ID.',
  { pageId: z.string().describe('The page ID (slug or date like 2025-04-06)') },
  async ({ pageId }) => {
    const page = await readPage(pageId)
    if (!page) return { content: [{ type: 'text', text: `Note "${pageId}" not found.` }] }
    const body = flattenBlocks(page.blocks)
    const header = [
      `# ${page.title}`, `ID: ${page.id}`,
      `Created: ${page.createdAt}`, `Updated: ${page.updatedAt}`,
      page.isDaily ? 'Type: Daily note' : '', page.starred ? 'Starred: yes' : '', '---',
    ].filter(Boolean).join('\n')
    return { content: [{ type: 'text', text: `${header}\n${body}` }] }
  }
)

server.tool(
  'list_recent_notes',
  'List the most recently updated notes.',
  { limit: z.number().optional().describe('Max results (default 20)') },
  async ({ limit }) => {
    const pages = await getRecentPages(limit ?? 20)
    if (pages.length === 0) return { content: [{ type: 'text', text: 'No notes found.' }] }
    return { content: [{ type: 'text', text: pages.map((p, i) => `${i + 1}. ${p.title} (id: ${p.id}) — updated ${p.updatedAt}`).join('\n') }] }
  }
)

server.tool(
  'get_all_notes',
  'List ALL notes with title and date. Use this for a global overview.',
  {},
  async () => {
    const pages = await loadAllPageMeta()
    if (pages.length === 0) return { content: [{ type: 'text', text: 'No notes found.' }] }
    const sorted = [...pages].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    const text = sorted.map(p => `- ${p.title} (id: ${p.id}) [${p.updatedAt?.slice(0, 10) || '?'}]${p.isDaily ? ' [daily]' : ''}`).join('\n')
    return { content: [{ type: 'text', text: `Total: ${sorted.length} notes\n\n${text}` }] }
  }
)

server.tool(
  'get_daily_note',
  "Read today's daily note, or a specific date's note.",
  { date: z.string().optional().describe('Date in YYYY-MM-DD format (defaults to today)') },
  async ({ date }) => {
    const page = await getDailyNote(date)
    if (!page) return { content: [{ type: 'text', text: `No daily note found for ${date || new Date().toISOString().slice(0, 10)}.` }] }
    return { content: [{ type: 'text', text: `# ${page.title}\n---\n${flattenBlocks(page.blocks)}` }] }
  }
)

startWatcher()

const transport = new StdioServerTransport()
server.connect(transport)
