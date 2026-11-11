export interface Block {
  id: string
  content: string
  children: Block[]
  checked?: boolean | null
  createdAt?: string
  updatedAt?: string
}

export interface Page {
  id: string
  title: string
  blocks: Block[]
  createdAt: string
  updatedAt: string
  isDaily?: boolean
  starred?: boolean
}

const ENCRYPT_PATTERN = /\{\{encrypt:[^}]+\}\}/

export function isEncrypted(content: string): boolean {
  return ENCRYPT_PATTERN.test(content)
}

export function stripMarkdown(text: string): string {
  return text
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/#\[\[([^\]]+)\]\]/g, '$1')
    .replace(/#([A-Za-z0-9_\u00C0-\u00FF-]+)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\^\^([^^]+)\^\^/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\{\{(?:\[\[)?(?:TODO|DONE)(?:\]\])?\}\}/g, '')
    .replace(/\{\{[^}]+\}\}/g, '')
    .replace(/\(\([^)]+\)\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .trim()
}

export function flattenBlocks(blocks: Block[], indent = 0): string {
  const lines: string[] = []
  const prefix = '  '.repeat(indent)

  for (const block of blocks) {
    if (!block.content.trim() && block.children.length === 0) continue

    let line: string
    if (isEncrypted(block.content)) {
      line = `${prefix}- [encrypted]`
    } else {
      const text = stripMarkdown(block.content)
      if (block.checked === true) {
        line = `${prefix}- [x] ${text}`
      } else if (block.checked === false) {
        line = `${prefix}- [ ] ${text}`
      } else {
        line = `${prefix}- ${text}`
      }
    }

    lines.push(line)

    if (block.children.length > 0) {
      lines.push(flattenBlocks(block.children, indent + 1))
    }
  }

  return lines.join('\n')
}

export function extractAllText(blocks: Block[]): string {
  const parts: string[] = []

  function walk(bs: Block[]) {
    for (const b of bs) {
      if (isEncrypted(b.content)) continue
      const text = stripMarkdown(b.content).trim()
      if (text) parts.push(text)
      if (b.children.length > 0) walk(b.children)
    }
  }

  walk(blocks)
  return parts.join(' ')
}
