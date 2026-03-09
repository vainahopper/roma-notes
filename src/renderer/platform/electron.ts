import type { PlatformAdapter } from './adapter'

/**
 * Electron platform adapter — delegates to window.api (preload bridge).
 * This is a 1:1 mapping; the existing Electron app should behave identically.
 */
export function createElectronAdapter(): PlatformAdapter {
  const api = (window as any).api

  return {
    // Pages
    listPages: () => api.listPages(),
    getPage: (id) => api.getPage(id),
    savePage: (page) => api.savePage(page),
    deletePage: (id) => api.deletePage(id),
    getAllPages: () => api.getAllPages(),

    // Settings
    getSettings: () => api.getSettings(),
    saveSettings: (s) => api.saveSettings(s),

    // Import
    importSelectFile: () => api.importSelectFile(),
    importSelectFolder: () => api.importSelectFolder(),
    importReadFile: (path) => api.importReadFile(path),
    importReadZip: (path) => api.importReadZip(path),
    importReadFolder: (path) => api.importReadFolder(path),

    // Shell
    openExternal: (url) => api.openExternal(url),

    // Biometrics (Touch ID on Mac)
    canBiometric: () => api.canTouchId(),
    promptBiometric: (reason) => api.promptTouchId(reason),
    saveKey: (blockId, password) => api.saveKey(blockId, password),
    hasKey: (blockId) => api.hasKey(blockId),
    getKey: (blockId) => api.getKey(blockId),
    deleteKey: (blockId) => api.deleteKey(blockId),

    // Menu events
    onMenuEvent: (callback) => api.onMenuEvent(callback),
    removeMenuListeners: () => api.removeMenuListeners(),
    onMenuUndo: (cb) => api.onMenuUndo(cb),
    offMenuUndo: (cb) => api.offMenuUndo?.(cb),
    onMenuRedo: (cb) => api.onMenuRedo(cb),
    offMenuRedo: (cb) => api.offMenuRedo?.(cb),

    // Updates
    checkForUpdates: () => api.checkForUpdates(),
    installUpdate: () => api.installUpdate(),
    onUpdateAvailable: (cb) => api.onUpdateAvailable(cb),
    onUpdateProgress: (cb) => api.onUpdateProgress(cb),
    removeUpdateListeners: () => api.removeUpdateListeners?.(),

    // iCloud sync
    syncPull: () => api.syncPull(),
    syncAvailable: () => api.syncAvailable(),
    onSyncUpdated: (cb) => api.onSyncUpdated(cb),
    removeSyncListeners: () => api.removeSyncListeners?.(),

    // Platform detection
    isElectron: () => true,
    isCapacitor: () => false,
  }
}
