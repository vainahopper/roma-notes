export interface Block {
  id: string
  content: string
  children: Block[]
  checked?: boolean | null  // null = not a todo, true/false = todo state
  createdAt?: string        // ISO timestamp, optional for backward compat
  updatedAt?: string        // ISO timestamp, optional for backward compat
}

export interface Page {
  id: string          // slug / date string
  title: string       // display title
  blocks: Block[]
  createdAt: string
  updatedAt: string
  isDaily?: boolean
  starred?: boolean
}

export interface PageMeta {
  id: string
  title: string
  updatedAt: string
  createdAt: string
}

export interface SearchResult {
  type: 'page' | 'block'
  pageId: string
  pageTitle: string
  blockId?: string
  content: string
  score: number
}

export interface AppSettings {
  theme: 'light' | 'dark' | 'system'
  fontSize: number
  encryptionEnabled: boolean
}

export interface ZoomFrame {
  blockId: string
  blockContent: string
}
