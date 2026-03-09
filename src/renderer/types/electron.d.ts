import type { Page } from '../../shared/types'

interface ElectronAPI {
  listPages: () => Promise<import('../../shared/types').PageMeta[]>
  getPage: (id: string) => Promise<import('../../shared/types').Page | null>
  savePage: (page: import('../../shared/types').Page) => Promise<boolean>
  deletePage: (id: string) => Promise<boolean>
  getAllPages: () => Promise<import('../../shared/types').Page[]>
  getSettings: () => Promise<import('../../shared/types').AppSettings>
  saveSettings: (s: import('../../shared/types').AppSettings) => Promise<boolean>
  importSelectFile: () => Promise<string | null>
  importSelectFolder: () => Promise<string | null>
  importReadFile: (path: string) => Promise<string | null>
  importReadZip: (path: string) => Promise<{ name: string; content: string }[] | { error: string }>
  importReadFolder: (path: string) => Promise<{ name: string; content: string }[]>
  onMenuEvent: (callback: (event: string, ...args: any[]) => void) => void
  removeMenuListeners: () => void
  // Touch ID + secure key storage
  canTouchId: () => Promise<boolean>
  promptTouchId: (reason?: string) => Promise<{ success: boolean; error?: string }>
  saveKey: (blockId: string, password: string) => Promise<boolean>
  hasKey: (blockId: string) => Promise<boolean>
  getKey: (blockId: string) => Promise<string | null>
  deleteKey: (blockId: string) => Promise<boolean>
}

declare global {
  interface Window {
    api: ElectronAPI
  }
}

export {}
