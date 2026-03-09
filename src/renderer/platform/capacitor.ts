import type { PlatformAdapter } from './adapter'
import type { Page, PageMeta, AppSettings } from '../../shared/types'
import { BiometricAuth } from '@aparajita/capacitor-biometric-auth'
import { SecureStorage } from '@aparajita/capacitor-secure-storage'

// ─── Simple IndexedDB wrapper for page storage ──────────────────────────────

const DB_NAME = 'roma-notes'
const DB_VERSION = 1
const PAGES_STORE = 'pages'
const SETTINGS_STORE = 'settings'

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(PAGES_STORE)) {
        db.createObjectStore(PAGES_STORE, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
        db.createObjectStore(SETTINGS_STORE, { keyPath: 'key' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function idbGet<T>(storeName: string, key: string): Promise<T | undefined> {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly')
    const store = tx.objectStore(storeName)
    const req = store.get(key)
    req.onsuccess = () => resolve(req.result as T | undefined)
    req.onerror = () => reject(req.error)
  }))
}

function idbPut<T>(storeName: string, value: T): Promise<void> {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite')
    const store = tx.objectStore(storeName)
    const req = store.put(value)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  }))
}

function idbDelete(storeName: string, key: string): Promise<void> {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite')
    const store = tx.objectStore(storeName)
    const req = store.delete(key)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  }))
}

function idbGetAll<T>(storeName: string): Promise<T[]> {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly')
    const store = tx.objectStore(storeName)
    const req = store.getAll()
    req.onsuccess = () => resolve(req.result as T[])
    req.onerror = () => reject(req.error)
  }))
}

// ─── Keychain key prefix for encryption passwords ───────────────────────────

const KEY_PREFIX = 'roma-enc-'

// ─── Settings defaults ──────────────────────────────────────────────────────

const DEFAULT_SETTINGS: AppSettings & Record<string, any> = {
  theme: 'system',
  fontSize: 16,
  encryptionEnabled: true,
}

// ─── Adapter ────────────────────────────────────────────────────────────────

/**
 * Capacitor platform adapter.
 * Uses IndexedDB for local page/settings storage.
 * Face ID via @aparajita/capacitor-biometric-auth.
 * Encryption keys in iOS Keychain via @aparajita/capacitor-secure-storage.
 */
export function createCapacitorAdapter(): PlatformAdapter {
  const noop = () => {}

  return {
    // ─── Pages (IndexedDB) ────────────────────────────────────────────────
    listPages: async () => {
      const pages = await idbGetAll<Page>(PAGES_STORE)
      return pages.map((p): PageMeta => ({
        id: p.id,
        title: p.title,
        updatedAt: p.updatedAt,
        createdAt: p.createdAt,
      }))
    },

    getPage: (id) => idbGet<Page>(PAGES_STORE, id).then(p => p ?? null),

    savePage: async (page) => {
      await idbPut(PAGES_STORE, page)
      // Mirror to iCloud (best-effort)
      try {
        const plugin = (window as any).Capacitor?.Plugins?.RomaCloudSync
        if (plugin) {
          await plugin.pushPage({ id: page.id, json: JSON.stringify(page) })
        }
      } catch (e) {
        console.warn('[Roma] iCloud pushPage failed:', page.id, e)
      }
      return true
    },

    deletePage: async (id) => {
      await idbDelete(PAGES_STORE, id)
      // Mirror to iCloud (best-effort)
      try {
        const plugin = (window as any).Capacitor?.Plugins?.RomaCloudSync
        if (plugin) await plugin.deletePage({ id })
      } catch (e) {
        console.warn('[Roma] iCloud deletePage failed:', id, e)
      }
      return true
    },

    getAllPages: () => idbGetAll<Page>(PAGES_STORE),

    // ─── Settings (IndexedDB) ─────────────────────────────────────────────
    getSettings: async () => {
      const row = await idbGet<{ key: string; value: any }>(SETTINGS_STORE, 'app-settings')
      return row?.value ?? { ...DEFAULT_SETTINGS }
    },

    saveSettings: async (s) => {
      await idbPut(SETTINGS_STORE, { key: 'app-settings', value: s })
      return true
    },

    // ─── Import (not available on mobile) ─────────────────────────────────
    importSelectFile: async () => null,
    importSelectFolder: async () => null,
    importReadFile: async () => null,
    importReadZip: async () => ({ error: 'Import is not available on mobile. Import from Mac and sync will carry the data.' }),
    importReadFolder: async () => [],

    // ─── Shell ────────────────────────────────────────────────────────────
    openExternal: (url) => {
      // Use Capacitor Browser plugin if available, otherwise window.open
      try {
        const { Browser } = (window as any).Capacitor?.Plugins ?? {}
        if (Browser?.open) {
          Browser.open({ url })
        } else {
          window.open(url, '_blank')
        }
      } catch {
        window.open(url, '_blank')
      }
    },

    // ─── Biometrics (Face ID via native plugin) ──────────────────────────
    canBiometric: async () => {
      try {
        const result = await BiometricAuth.checkBiometry()
        return result.isAvailable
      } catch {
        return false
      }
    },

    promptBiometric: async (reason) => {
      try {
        await BiometricAuth.authenticate({
          reason: reason || 'Unlock encrypted block',
          allowDeviceCredential: true,
        })
        return { success: true }
      } catch (err: any) {
        return { success: false, error: err?.message || 'Authentication failed' }
      }
    },

    // ─── Encryption keys (iOS Keychain via SecureStorage) ───────────────
    saveKey: async (blockId, password) => {
      try {
        // convertDate:false — passwords must never be auto-converted to Date objects
        await SecureStorage.set(KEY_PREFIX + blockId, password, false)
        console.log('[Roma] saveKey: stored key for block', blockId)
        return true
      } catch (e) {
        console.error('[Roma] saveKey: FAILED for block', blockId, e)
        return false
      }
    },

    hasKey: async (blockId) => {
      try {
        const val = await SecureStorage.get(KEY_PREFIX + blockId, false)
        return val !== null
      } catch {
        return false
      }
    },

    getKey: async (blockId) => {
      try {
        // convertDate:false — passwords must be returned as plain strings, never as Date
        const val = await SecureStorage.get(KEY_PREFIX + blockId, false)
        const key = typeof val === 'string' ? val : null
        console.log('[Roma] getKey:', blockId, key !== null ? 'found' : 'NOT FOUND (type=' + typeof val + ')')
        return key
      } catch (e) {
        console.error('[Roma] getKey: FAILED for block', blockId, e)
        return null
      }
    },

    deleteKey: async (blockId) => {
      try {
        await SecureStorage.remove(KEY_PREFIX + blockId)
        return true
      } catch {
        return false
      }
    },

    // ─── iCloud sync (via native plugin) ──────────────────────────────────
    syncPull: async () => {
      try {
        const plugin = (window as any).Capacitor?.Plugins?.RomaCloudSync
        if (!plugin) {
          console.warn('[Roma] syncPull: RomaCloudSync plugin not found')
          return { merged: 0, pages: [], error: 'Plugin not found' }
        }

        console.log('[Roma] syncPull: calling pullAllPages…')
        const result = await Promise.race([
          plugin.pullAllPages(),
          new Promise<any>((_, reject) =>
            setTimeout(() => reject(new Error('iCloud pull timed out (90s)')), 90000)
          ),
        ])
        const placeholders: number = result.placeholders ?? 0
        const pluginError: string | undefined = result.error
        const rawPages = result.pages || []
        console.log('[Roma] syncPull: got ' + rawPages.length + ' pages from iCloud, ' + placeholders + ' placeholders' + (pluginError ? ', error: ' + pluginError : ''))

        const cloudPages: Page[] = rawPages.map((json: string) => {
          try { return JSON.parse(json) } catch { return null }
        }).filter(Boolean)

        // Returns true if a page has at least one block with non-empty text (recursive).
        // Matches Mac's pageHasRealContent() — both must use the same definition.
        function hasRealContent(page: Page): boolean {
          function check(blocks: Block[]): boolean {
            if (!Array.isArray(blocks)) return false
            return blocks.some(b => (b.content && b.content.trim() !== '') || check(b.children ?? []))
          }
          return check(page.blocks)
        }

        // Merge with local IndexedDB — content always beats no-content regardless of timestamp.
        // This prevents the "empty stub cycle": a device auto-creates an empty placeholder for a
        // past daily note (newer timestamp), pushes it to iCloud, and overwrites real content from
        // another device. Rule: empty pages must never win over pages with real content.
        const merged: Page[] = []
        for (const cloudPage of cloudPages) {
          if (!cloudPage.id) continue
          const localPage = await idbGet<Page>(PAGES_STORE, cloudPage.id)
          if (!localPage) {
            // New page from cloud — always accept
            await idbPut(PAGES_STORE, cloudPage)
            merged.push(cloudPage)
            console.log('[Roma] syncPull: new page from cloud:', cloudPage.id)
            continue
          }

          const cloudHasContent = hasRealContent(cloudPage)
          const localHasContent = hasRealContent(localPage)

          if (cloudHasContent && !localHasContent) {
            // Cloud has content, local is empty → prefer cloud regardless of timestamp
            await idbPut(PAGES_STORE, cloudPage)
            merged.push(cloudPage)
            console.log('[Roma] syncPull: cloud has content, local empty — restoring:', cloudPage.id)
          } else if (!cloudHasContent && localHasContent) {
            // Local has content, cloud is empty → push local to cloud regardless of timestamp
            try {
              await plugin.pushPage({ id: localPage.id, json: JSON.stringify(localPage) })
              console.log('[Roma] syncPull: local has content, cloud empty — pushing real content:', localPage.id)
            } catch (e) {
              console.warn('[Roma] syncPull: push local-content-over-cloud-stub failed:', localPage.id, e)
            }
          } else if (cloudPage.updatedAt > localPage.updatedAt) {
            // Both have content (or both empty) and cloud is newer → accept cloud
            await idbPut(PAGES_STORE, cloudPage)
            merged.push(cloudPage)
            console.log('[Roma] syncPull: cloud newer:', cloudPage.id)
          } else if (localPage.updatedAt > cloudPage.updatedAt && localHasContent) {
            // Both have content and local is newer → push local to cloud
            try {
              await plugin.pushPage({ id: localPage.id, json: JSON.stringify(localPage) })
            } catch (e) {
              console.warn('[Roma] syncPull: push local-newer failed:', localPage.id, e)
            }
          }
          // else: timestamps equal, or both empty — no action needed
        }
        // Push local-only pages to cloud — only pages with real content
        const allLocal = await idbGetAll<Page>(PAGES_STORE)
        const cloudIds = new Set(cloudPages.map((p: Page) => p.id))
        let pushedCount = 0
        for (const localPage of allLocal) {
          if (!cloudIds.has(localPage.id) && hasRealContent(localPage)) {
            try {
              await plugin.pushPage({ id: localPage.id, json: JSON.stringify(localPage) })
              pushedCount++
            } catch (e) {
              console.warn('[Roma] syncPull: push local-only failed:', localPage.id, e)
            }
          }
        }
        if (pushedCount > 0) console.log('[Roma] syncPull: pushed ' + pushedCount + ' local-only pages to cloud')
        return { merged: merged.length, pages: merged, placeholders, error: pluginError }
      } catch (e: any) {
        console.error('[Roma] syncPull error:', e)
        return { merged: 0, pages: [], error: e?.message ?? 'Unknown error' }
      }
    },

    syncAvailable: async () => {
      try {
        const plugin = (window as any).Capacitor?.Plugins?.RomaCloudSync
        if (!plugin) return false
        const result = await plugin.isAvailable()
        return result.available === true
      } catch {
        return false
      }
    },

    onSyncUpdated: () => {},  // iOS uses pull-based sync
    removeSyncListeners: () => {},

    // ─── Menu events (not applicable on mobile) ──────────────────────────
    onMenuEvent: noop,
    removeMenuListeners: noop,
    onMenuUndo: noop,
    offMenuUndo: noop,
    onMenuRedo: noop,
    offMenuRedo: noop,

    // ─── Updates (live web bundle via iCloud) ─────────────────────────────
    checkForUpdates: (() => {
      // JS-side guard: only one apply at a time.
      // The native plugin has its own _applyInProgress guard too, but the old
      // native code (running on device before first update) didn't block
      // checkWebUpdate while an apply was in progress. This JS guard prevents
      // the second concurrent call from getting { success: false } back and
      // then calling window.location.reload() prematurely — which would interrupt
      // the in-progress apply and leave a corrupt/incomplete WebBundle on disk.
      let applyingUpdate = false
      return async () => {
        if (applyingUpdate) {
          console.log('[Roma] checkForUpdates: apply already in progress, skipping')
          return
        }
        try {
          const plugin = (window as any).Capacitor?.Plugins?.RomaCloudSync
          if (!plugin) return
          console.log('[Roma] checkForUpdates: calling checkWebUpdate…')
          const result = await plugin.checkWebUpdate()
          console.log('[Roma] checkWebUpdate:', JSON.stringify(result))
          if (result.available) {
            console.log('[Roma] Update available:', result.version, '— applying…')
            applyingUpdate = true
            try {
              const applyResult = await plugin.applyWebUpdate()
              console.log('[Roma] applyWebUpdate:', JSON.stringify(applyResult))
              // Only reload if the apply actually succeeded — a failed apply
              // (e.g. "already in progress" from a concurrent call) must NOT
              // trigger a reload, as it would interrupt the real apply and
              // leave an incomplete WebBundle on disk.
              if (applyResult?.success) {
                window.location.reload()
              }
            } finally {
              applyingUpdate = false
            }
          }
        } catch (e) {
          applyingUpdate = false
          console.error('[Roma] checkForUpdates error:', e)
        }
      }
    })(),
    installUpdate: noop,
    onUpdateAvailable: noop,
    onUpdateProgress: noop,
    removeUpdateListeners: noop,

    // ─── Platform detection ──────────────────────────────────────────────
    isElectron: () => false,
    isCapacitor: () => true,
  }
}
