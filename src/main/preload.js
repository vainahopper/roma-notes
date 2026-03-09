const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  // Pages
  listPages: () => ipcRenderer.invoke('pages:list'),
  getPage: (id) => ipcRenderer.invoke('pages:get', id),
  savePage: (page) => ipcRenderer.invoke('pages:save', page),
  deletePage: (id) => ipcRenderer.invoke('pages:delete', id),
  getAllPages: () => ipcRenderer.invoke('pages:getAll'),

  // Settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (s) => ipcRenderer.invoke('settings:save', s),

  // Import
  importSelectFile: () => ipcRenderer.invoke('import:selectFile'),
  importSelectFolder: () => ipcRenderer.invoke('import:selectFolder'),
  importReadFile: (p) => ipcRenderer.invoke('import:readFile', p),
  importReadZip: (p) => ipcRenderer.invoke('import:readZip', p),
  importReadFolder: (p) => ipcRenderer.invoke('import:readFolder', p),

  // Shell
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),

  // Menu events
  onMenuEvent: (callback) => {
    const events = ['menu:new-page', 'menu:today', 'menu:import', 'menu:search']
    events.forEach(event => {
      ipcRenderer.on(event, (_, ...args) => callback(event, ...args))
    })
  },
  removeMenuListeners: () => {
    const events = ['menu:new-page', 'menu:today', 'menu:import', 'menu:search']
    events.forEach(event => ipcRenderer.removeAllListeners(event))
  },

  // Undo / Redo (custom — replaces Electron role:'undo'/'redo' which bypasses JS handlers)
  onMenuUndo: (cb) => ipcRenderer.on('menu:undo', cb),
  offMenuUndo: (cb) => ipcRenderer.removeListener('menu:undo', cb),
  onMenuRedo: (cb) => ipcRenderer.on('menu:redo', cb),
  offMenuRedo: (cb) => ipcRenderer.removeListener('menu:redo', cb),

  // Update: trigger check from renderer (manual, shows dialog)
  checkForUpdates: () => ipcRenderer.send('update:check'),
  // Update: install directly (called from sidebar badge — no confirmation dialog)
  installUpdate: () => ipcRenderer.send('update:install'),

  // Update events
  onUpdateAvailable: (cb) => ipcRenderer.on('update:available', (_, info) => cb(info)),
  onUpdateProgress: (cb) => ipcRenderer.on('update:progress', (_, info) => cb(info)),
  removeUpdateListeners: () => {
    ipcRenderer.removeAllListeners('update:available')
    ipcRenderer.removeAllListeners('update:progress')
  },

  // iCloud sync
  syncPull: () => ipcRenderer.invoke('sync:pull'),
  syncAvailable: () => ipcRenderer.invoke('sync:available'),
  onSyncUpdated: (cb) => ipcRenderer.on('sync:updated', cb),
  removeSyncListeners: () => ipcRenderer.removeAllListeners('sync:updated'),

  // Touch ID + secure key storage
  canTouchId: () => ipcRenderer.invoke('auth:canTouchId'),
  promptTouchId: (reason) => ipcRenderer.invoke('auth:promptTouchId', reason),
  saveKey: (blockId, password) => ipcRenderer.invoke('auth:saveKey', blockId, password),
  hasKey: (blockId) => ipcRenderer.invoke('auth:hasKey', blockId),
  getKey: (blockId) => ipcRenderer.invoke('auth:getKey', blockId),
  deleteKey: (blockId) => ipcRenderer.invoke('auth:deleteKey', blockId),
})
