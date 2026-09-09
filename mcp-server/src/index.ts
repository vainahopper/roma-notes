import http from 'node:http'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import { z } from 'zod'
import { flattenBlocks } from './flatten.js'
import { readPage, getRecentPages, getDailyNote, loadAllPageMeta, startWatcher } from './pages.js'
import { searchNotes } from './search.js'

const PORT = Number(process.env.ROMA_NOTES_PORT) || 7474

function createMcpServer() {
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
        `# ${page.title}`,
        `ID: ${page.id}`,
        `Created: ${page.createdAt}`,
        `Updated: ${page.updatedAt}`,
        page.isDaily ? 'Type: Daily note' : '',
        page.starred ? 'Starred: yes' : '',
        '---',
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
      const text = pages.map((p, i) =>
        `${i + 1}. ${p.title} (id: ${p.id}) — updated ${p.updatedAt}`
      ).join('\n')
      return { content: [{ type: 'text', text }] }
    }
  )

  server.tool(
    'get_all_notes',
    'List ALL notes with title and date. Use this for a global overview.',
    {},
    async () => {
      const pages = await loadAllPageMeta()
      if (pages.length === 0) return { content: [{ type: 'text', text: 'No notes found.' }] }
      const sorted = [...pages].sort((a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      )
      const text = sorted.map(p =>
        `- ${p.title} (id: ${p.id}) [${p.updatedAt?.slice(0, 10) || '?'}]${p.isDaily ? ' [daily]' : ''}`
      ).join('\n')
      return { content: [{ type: 'text', text: `Total: ${sorted.length} notes\n\n${text}` }] }
    }
  )

  server.tool(
    'get_daily_note',
    "Read today's daily note, or a specific date's note.",
    { date: z.string().optional().describe('Date in YYYY-MM-DD format (defaults to today)') },
    async ({ date }) => {
      const page = await getDailyNote(date)
      if (!page) {
        const d = date || new Date().toISOString().slice(0, 10)
        return { content: [{ type: 'text', text: `No daily note found for ${d}.` }] }
      }
      const body = flattenBlocks(page.blocks)
      return { content: [{ type: 'text', text: `# ${page.title}\n---\n${body}` }] }
    }
  )

  return server
}

startWatcher()

// SSE transport: one McpServer per connection
const transports = new Map<string, SSEServerTransport>()

const httpServer = http.createServer(async (req, res) => {
  const url = new URL(req.url!, `http://localhost:${PORT}`)

  // CORS headers for Claude Code
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  if (req.method === 'GET' && url.pathname === '/sse') {
    const transport = new SSEServerTransport('/message', res)
    const sessionId = transport.sessionId
    transports.set(sessionId, transport)

    res.on('close', () => transports.delete(sessionId))

    const mcpServer = createMcpServer()
    await mcpServer.connect(transport)
    return
  }

  if (req.method === 'POST' && url.pathname === '/message') {
    const sessionId = url.searchParams.get('sessionId')
    if (!sessionId) {
      res.writeHead(400)
      res.end('Missing sessionId')
      return
    }
    const transport = transports.get(sessionId)
    if (!transport) {
      res.writeHead(404)
      res.end('Session not found')
      return
    }
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', async () => {
      await transport.handlePostMessage(req, res, JSON.parse(body))
    })
    return
  }

  if (url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end(`roma-notes MCP server running on port ${PORT}\nSSE endpoint: http://localhost:${PORT}/sse`)
    return
  }

  res.writeHead(404)
  res.end('Not found')
})

httpServer.listen(PORT, '127.0.0.1', () => {
  console.error(`roma-notes MCP server listening on http://localhost:${PORT}/sse`)
})
