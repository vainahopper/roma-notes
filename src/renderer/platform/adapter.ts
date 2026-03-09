import type { Page, PageMeta, AppSettings } from '../../shared/types'

/**
 * Platform adapter interface — abstracts all platform-specific APIs.
 * Electron implementation wraps window.api (preload bridge).
 * Capacitor implementation uses native plugins + IndexedDB.
 */
export interface PlatformAdapter {
  // ─── Pages ──────────────────────────────────────────────────────────────────
  listPages(): Promise<PageMeta[]>
  getPage(id: string): Promise<Page | null>
  savePage(page: Page): Promise<boolean>
  deletePage(id: string): Promise<boolean>
  getAllPages(): Promise<Page[]>

  // ─── Settings ───────────────────────────────────────────────────────────────
  getSettings(): Promise<AppSettings & Record<string, any>>
  saveSettings(s: AppSettings & Record<string, any>): Promise<boolean>

  // ─── Import (Electron-only, no-op on mobile) ───────────────────────────────
  importSelectFile(): Promise<string | null>
  importSelectFolder(): Promise<string | null>
  importReadFile(path: string): Promise<string | null>
  importReadZip(path: string): Promise<{ name: string; content: string }[] | { error: string }>
  importReadFolder(path: string): Promise<{ name: string; content: string }[]>

  // ─── Shell ──────────────────────────────────────────────────────────────────
  openExternal(url: string): void

  // ─── Biometrics (Touch ID / Face ID) ────────────────────────────────────────
  canBiometric(): Promise<boolean>
  promptBiometric(reason?: string): Promise<{ success: boolean; error?: string }>
  saveKey(blockId: string, password: string): Promise<boolean>
  hasKey(blockId: string): Promise<boolean>
  getKey(blockId: string): Promise<string | null>
  deleteKey(blockId: string): Promise<boolean>

  // ─── Menu events (Electron-only, no-op on mobile) ──────────────────────────
  onMenuEvent(callback: (event: string, ...args: any[]) => void): void
  removeMenuListeners(): void
  onMenuUndo(cb: (...args: any[]) => void): void
  offMenuUndo(cb: (...args: any[]) => void): void
  onMenuRedo(cb: (...args: any[]) => void): void
  offMenuRedo(cb: (...args: any[]) => void): void

  // ─── Updates (Electron-only, no-op on mobile) ──────────────────────────────
  checkForUpdates(): void
  installUpdate(): void
  onUpdateAvailable(cb: (info: { version: string }) => void): void
  onUpdateProgress(cb: (info: { step: string; pct: number; error?: string }) => void): void
  removeUpdateListeners(): void

  // ─── iCloud Sync ───────────────────────────────────────────────────────────
  syncPull(): Promise<{ merged: number; pages: Page[]; placeholders?: number; error?: string }>
  syncAvailable(): Promise<boolean>
  onSyncUpdated(cb: () => void): void
  removeSyncListeners(): void

  // ─── Platform detection ─────────────────────────────────────────────────────
  isElectron(): boolean
  isCapacitor(): boolean
}
