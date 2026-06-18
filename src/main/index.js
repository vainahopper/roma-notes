const { app, BrowserWindow, ipcMain, dialog, Menu, shell, safeStorage } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const https = require('https')
const { execSync, exec, execFile } = require('child_process')

const isDev = process.env.NODE_ENV === 'development'

// Data directory
const DATA_DIR = path.join(os.homedir(), 'Library', 'Application Support', 'RomaNotes')
const PAGES_DIR = path.join(DATA_DIR, 'pages')
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json')

// iCloud Documents sync directory
const ICLOUD_CONTAINER = path.join(
  os.homedir(), 'Library', 'Mobile Documents',
  'iCloud~com~codevainas~romanotes', 'Documents', 'pages'
)

function ensureDirectories() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
  if (!fs.existsSync(PAGES_DIR)) fs.mkdirSync(PAGES_DIR, { recursive: true })
  // Create iCloud sync folder (only works if iCloud Drive is enabled)
  try {
    if (!fs.existsSync(ICLOUD_CONTAINER)) fs.mkdirSync(ICLOUD_CONTAINER, { recursive: true })
  } catch {}
}

// ─── iCloud Sync Helpers ─────────────────────────────────────────────────────

function isICloudAvailable() {
  try {
    const parent = path.join(os.homedir(), 'Library', 'Mobile Documents', 'iCloud~com~codevainas~romanotes')
    // If we can create or see the container folder, iCloud Drive is working
    if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true })
    return true
  } catch {
    return false
  }
}

/** Mirror a page to iCloud (non-blocking, best-effort). */
function syncPageToICloud(page) {
  try {
    if (!fs.existsSync(ICLOUD_CONTAINER)) fs.mkdirSync(ICLOUD_CONTAINER, { recursive: true })
    const filePath = path.join(ICLOUD_CONTAINER, `${sanitizeFilename(page.id)}.json`)
    fs.writeFileSync(filePath, JSON.stringify(page, null, 2))
  } catch (err) {
    console.error('iCloud sync write failed:', err.message)
  }
}

/** Delete a page from iCloud (non-blocking, best-effort). */
function deletePageFromICloud(id) {
  try {
    const filePath = path.join(ICLOUD_CONTAINER, `${sanitizeFilename(id)}.json`)
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
  } catch (err) {
    console.error('iCloud sync delete failed:', err.message)
  }
}

/** Returns true if a page has at least one block with non-empty text content. */
function pageHasRealContent(page) {
  function check(blocks) {
    if (!Array.isArray(blocks)) return false
    return blocks.some(b => (b.content && b.content.trim()) || check(b.children))
  }
  return check(page.blocks)
}

// ─── Page merge (block-level, by id) ─────────────────────────────────────────
// Prevents data loss when Mac and iPhone edit the same page concurrently.
// Without this, the device that pushes last would replace the other's whole
// page (last-write-wins on the page). With this merge:
//   - blocks present on both sides: take the per-block newer `updatedAt`
//   - blocks present only on one side: kept (appended after the newer side's blocks)
//   - children merged recursively
// Trade-off: there are no tombstones, so a block deleted on one device may
// resurrect from the other device's older copy. For a personal notes app,
// resurrecting a block is preferable to silently losing real edits.

function blockIdSet(blocks) {
  const out = new Set()
  function walk(arr) {
    for (const b of arr || []) {
      out.add(b.id)
      if (b.children?.length) walk(b.children)
    }
  }
  walk(blocks)
  return out
}

// Compare two pages ignoring only the page-level `updatedAt` (which the
// merge bumps to now even when no content actually changed). Used to decide
// whether the merged result is meaningfully different from either side —
// if not, we skip the write/push to avoid ping-pong.
function pagesEqualIgnoringPageTs(a, b) {
  const stripA = { ...a }; delete stripA.updatedAt
  const stripB = { ...b }; delete stripB.updatedAt
  return JSON.stringify(stripA) === JSON.stringify(stripB)
}

function mergeBlock(a, b) {
  const aTs = a.updatedAt || ''
  const bTs = b.updatedAt || ''
  const winner = aTs >= bTs ? a : b
  const loser  = aTs >= bTs ? b : a
  return {
    ...winner,
    children: mergeBlockLists(winner.children || [], loser.children || []),
  }
}

function mergeBlockLists(newer, older) {
  const olderMap = new Map()
  for (const b of older || []) olderMap.set(b.id, b)
  const seen = new Set()
  const out = []
  for (const b of newer || []) {
    seen.add(b.id)
    const o = olderMap.get(b.id)
    out.push(o ? mergeBlock(b, o) : b)
  }
  for (const b of older || []) {
    if (!seen.has(b.id)) out.push(b)
  }
  return out
}

function mergePages(cloudPage, localPage) {
  const cloudNewer = (cloudPage.updatedAt || '') >= (localPage.updatedAt || '')
  const newer = cloudNewer ? cloudPage : localPage
  const older = cloudNewer ? localPage : cloudPage
  return {
    ...newer,
    blocks: mergeBlockLists(newer.blocks || [], older.blocks || []),
    updatedAt: new Date().toISOString(), // bump so the merged version supersedes both sides
  }
}

/** Pull all pages from iCloud and merge with local. Returns pages that were newer in iCloud. */
// Merge a SINGLE cloud file into its local counterpart (and push back if the
// merge changed the cloud side). Returns the merged page if the local copy
// changed, otherwise null. Extracted so the fs.watch handler can react to one
// changed file in ~0.2ms instead of re-reading + re-parsing every page on disk
// (the latter was this app's main energy drain — a full pull is ~5600 file
// reads / ~7MB of JSON.parse, and iCloud's background churn fires the watcher
// several times a second).
async function syncCloudFile(file) {
  try {
    const cloudFilePath = path.join(ICLOUD_CONTAINER, file)
    if (!fs.existsSync(cloudFilePath)) return null
    const cloudPage = JSON.parse(await fs.promises.readFile(cloudFilePath, 'utf-8'))
    if (!cloudPage.id) return null
    const localPath = path.join(PAGES_DIR, `${sanitizeFilename(cloudPage.id)}.json`)
    if (fs.existsSync(localPath)) {
      const localPage = JSON.parse(await fs.promises.readFile(localPath, 'utf-8'))
      const cloudHasContent = pageHasRealContent(cloudPage)
      const localHasContent = pageHasRealContent(localPage)

      // Empty-stub protection: a stub must never overwrite real content. Stubs
      // come from a device opening a daily note before sync has completed.
      if (cloudHasContent && !localHasContent) {
        // Cloud has data, local is empty → accept cloud regardless of timestamp
        await fs.promises.writeFile(localPath, JSON.stringify(cloudPage, null, 2))
        return cloudPage
      } else if (!cloudHasContent && localHasContent) {
        // Cloud is empty, local has data → push local to cloud regardless of timestamp
        console.log(`iCloud sync: keeping real local content for ${cloudPage.id} (cloud stub discarded)`)
        syncPageToICloud(localPage)
        return null
      } else if (cloudHasContent && localHasContent) {
        // Both sides have content → ALWAYS merge by block id, never replace the
        // whole page. Catches the silent data-loss case where both devices kept
        // the same block IDs but edited different blocks' content. To avoid
        // ping-pong, skip the write to whichever side already byte-matches the
        // merge (ignoring only page-level updatedAt, which the merge bumps).
        const mergedPage = mergePages(cloudPage, localPage)
        const sameAsLocal = pagesEqualIgnoringPageTs(mergedPage, localPage)
        const sameAsCloud = pagesEqualIgnoringPageTs(mergedPage, cloudPage)
        if (!sameAsLocal) {
          await fs.promises.writeFile(localPath, JSON.stringify(mergedPage, null, 2))
        }
        if (!sameAsCloud) {
          syncPageToICloud(mergedPage)
        }
        if (!sameAsLocal || !sameAsCloud) {
          console.log(`iCloud sync: block-merged ${cloudPage.id} (writeLocal=${!sameAsLocal} pushCloud=${!sameAsCloud})`)
        }
        return sameAsLocal ? null : mergedPage
      }
      // else: both empty → no-op
      return null
    } else {
      // New page from cloud → save locally (always accept, nothing to lose)
      await fs.promises.writeFile(localPath, JSON.stringify(cloudPage, null, 2))
      return cloudPage
    }
  } catch {
    return null
  }
}

async function pullFromICloud() {
  const merged = []
  try {
    if (!fs.existsSync(ICLOUD_CONTAINER)) return merged
    const cloudFiles = (await fs.promises.readdir(ICLOUD_CONTAINER)).filter(f => f.endsWith('.json'))
    for (const file of cloudFiles) {
      const m = await syncCloudFile(file)
      if (m) merged.push(m)
    }
    // Also push local pages that don't exist in cloud
    const localFiles = (await fs.promises.readdir(PAGES_DIR)).filter(f => f.endsWith('.json'))
    for (const file of localFiles) {
      const cloudPath = path.join(ICLOUD_CONTAINER, file)
      if (!fs.existsSync(cloudPath)) {
        try {
          const localPage = JSON.parse(await fs.promises.readFile(path.join(PAGES_DIR, file), 'utf-8'))
          syncPageToICloud(localPage)
        } catch {}
      }
    }
  } catch (err) {
    console.error('iCloud pull failed:', err.message)
  }
  return merged
}

// ─── Startup backup ──────────────────────────────────────────────────────────
// On every launch, copy all pages into backups/<YYYY-MM-DD>/ before the
// renderer touches anything. Keeps the last 7 daily snapshots.
const BACKUPS_DIR = path.join(DATA_DIR, 'backups')
const MAX_BACKUPS = 7

function createStartupBackup() {
  try {
    const files = fs.readdirSync(PAGES_DIR).filter(f => f.endsWith('.json'))
    if (files.length === 0) return // nothing to back up

    const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
    const dest = path.join(BACKUPS_DIR, today)

    // Only back up once per calendar day. A second launch in the same day must NOT
    // overwrite today's backup — by then the data may have been altered (e.g. by
    // a bad sync) and we'd lose the clean first-launch snapshot.
    if (fs.existsSync(dest) && fs.readdirSync(dest).some(f => f.endsWith('.json'))) return

    fs.mkdirSync(dest, { recursive: true })

    for (const file of files) {
      fs.copyFileSync(path.join(PAGES_DIR, file), path.join(dest, file))
    }

    // Prune old backups — keep only the most recent MAX_BACKUPS days
    const days = fs.readdirSync(BACKUPS_DIR)
      .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
      .sort()
    for (const old of days.slice(0, -MAX_BACKUPS)) {
      fs.rmSync(path.join(BACKUPS_DIR, old), { recursive: true, force: true })
    }
  } catch (err) {
    console.error('Startup backup failed:', err)
  }
}

// ─── Auto-update ────────────────────────────────────────────────────────────
//
// Place a `latest.json` in ~/Library/Application Support/RomaNotes/ with:
//   {
//     "version": "1.4.0",
//     "notes": "Bug fixes and improvements",
//     "dmgPath": "/path/to/Roma Notes.dmg"
//   }
//
// Or set ROMA_UPDATE_URL env to a remote JSON endpoint.

const REMOTE_UPDATE_URL = 'https://github.com/vainahopper/roma-notes/releases/download/latest/latest.json'
const UPDATE_CHECK_URL = process.env.ROMA_UPDATE_URL || REMOTE_UPDATE_URL
const LOCAL_LATEST = path.join(DATA_DIR, 'latest.json')

// Cached latest update info (set when detected, used for direct install)
let cachedUpdateInfo = null

/** HTTPS GET that follows up to 5 redirects (needed for GitHub release assets). */
function httpsGetFollowRedirects(url, callback, _redirectCount = 0) {
  if (_redirectCount > 5) { callback(new Error('Too many redirects')); return }
  const proto = url.startsWith('https') ? https : require('http')
  proto.get(url, (res) => {
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      httpsGetFollowRedirects(res.headers.location, callback, _redirectCount + 1)
      return
    }
    if (res.statusCode !== 200) { callback(new Error(`HTTP ${res.statusCode}`)); return }
    let data = ''
    res.on('data', chunk => { data += chunk })
    res.on('end', () => callback(null, data))
    res.on('error', err => callback(err))
  }).on('error', err => callback(err))
}

/** Download a file from URL to local path, following redirects, with progress callback. */
function downloadFile(url, destPath, onProgress, callback, _redirectCount = 0) {
  if (_redirectCount > 5) { callback(new Error('Too many redirects')); return }
  const proto = url.startsWith('https') ? https : require('http')
  proto.get(url, (res) => {
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      downloadFile(res.headers.location, destPath, onProgress, callback, _redirectCount + 1)
      return
    }
    if (res.statusCode !== 200) { callback(new Error(`HTTP ${res.statusCode}`)); return }
    const totalBytes = parseInt(res.headers['content-length'] || '0', 10)
    let receivedBytes = 0
    const fileStream = fs.createWriteStream(destPath)
    res.on('data', (chunk) => {
      receivedBytes += chunk.length
      if (totalBytes > 0) onProgress(Math.round((receivedBytes / totalBytes) * 100))
    })
    res.pipe(fileStream)
    fileStream.on('finish', () => fileStream.close(() => callback(null)))
    fileStream.on('error', (err) => { fs.unlink(destPath, () => {}); callback(err) })
    res.on('error', (err) => { fs.unlink(destPath, () => {}); callback(err) })
  }).on('error', err => callback(err))
}

function checkForUpdates(win, silent = false) {
  const currentVersion = app.getVersion()

  function handleUpdateData(data) {
    try {
      const info = JSON.parse(data)
      if (!info.version) throw new Error('No version in update manifest')

      const isNewer = compareVersions(info.version, currentVersion) > 0
      if (isNewer) {
        cachedUpdateInfo = info
        // Always notify renderer so sidebar shows the update badge
        try { win.webContents.send('update:available', { version: info.version }) } catch {}
        // Only show native dialog if triggered manually (not silent startup check)
        if (!silent) {
          dialog.showMessageBox(win, {
            type: 'info',
            title: 'Update Available',
            message: `Roma Notes ${info.version} is available`,
            detail: info.notes
              ? `What's new:\n${info.notes}\n\nYou have version ${currentVersion}.`
              : `You have version ${currentVersion}.`,
            buttons: ['Install & Restart', 'Later'],
            defaultId: 0,
          }).then(({ response }) => {
            if (response === 0) applyUpdate(win, info)
          })
        }
      } else {
        cachedUpdateInfo = null
        if (!silent) {
          dialog.showMessageBox(win, {
            type: 'info',
            title: 'No Updates',
            message: `Roma Notes ${currentVersion} is up to date.`,
            buttons: ['OK'],
          })
        }
      }
    } catch (err) {
      if (!silent) dialog.showErrorBox('Update Check Failed', err.message)
    }
  }

  // Try local file first
  if (fs.existsSync(LOCAL_LATEST)) {
    const data = fs.readFileSync(LOCAL_LATEST, 'utf-8')
    handleUpdateData(data)
    return
  }

  // Try remote URL (GitHub Releases — needs redirect following)
  if (UPDATE_CHECK_URL) {
    httpsGetFollowRedirects(UPDATE_CHECK_URL, (err, data) => {
      if (err) {
        if (!silent) dialog.showErrorBox('Update Check Failed', err.message)
        return
      }
      handleUpdateData(data)
    })
    return
  }

  if (!silent) {
    dialog.showMessageBox(win, {
      type: 'info',
      title: 'No Updates',
      message: `Roma Notes ${currentVersion} is up to date.`,
      detail: 'No new version has been built yet.\n\nWhen you build a new version with "npm run dist", the update will be detected automatically here.',
      buttons: ['OK'],
    })
  }
}

function applyUpdate(win, info) {
  function sendProgress(step, pct) {
    try { win.webContents.send('update:progress', { step, pct }) } catch {}
  }

  // Determine DMG source: local path or remote URL
  const localDmg = (info.dmgPath && fs.existsSync(info.dmgPath)) ? info.dmgPath : null
  const remoteDmgUrl = info.dmgUrl || null

  if (!localDmg && !remoteDmgUrl) {
    dialog.showErrorBox('Update Failed', 'No DMG path or download URL in update manifest.')
    return
  }

  function installFromDmg(dmgPath) {
    sendProgress('Mounting update…', 30)
    setTimeout(() => {
      try {
        const mountOutput = execSync(`hdiutil attach "${dmgPath}" -nobrowse -noverify -noautoopen`, { encoding: 'utf-8' })
        const mountLines = mountOutput.trim().split('\n')
        const lastLine = mountLines[mountLines.length - 1]
        const mountPoint = lastLine.split('\t').pop().trim()

        if (!mountPoint || !fs.existsSync(mountPoint)) throw new Error('Could not mount the DMG.')

        sendProgress('Copying app…', 50)

        const items = fs.readdirSync(mountPoint)
        const appName = items.find(i => i.endsWith('.app'))
        if (!appName) {
          execSync(`hdiutil detach "${mountPoint}" -quiet || true`)
          throw new Error('No .app found in the DMG.')
        }

        const sourceApp = path.join(mountPoint, appName)
        const appIdx = process.execPath.indexOf('.app/')
        const runningApp = appIdx >= 0 ? process.execPath.slice(0, appIdx + 4) : null
        const destApp = (runningApp && !runningApp.startsWith('/Volumes/'))
          ? runningApp
          : path.join('/Applications', appName)

        execSync(`rm -rf "${destApp}"`)

        sendProgress('Installing…', 70)
        execSync(`ditto "${sourceApp}" "${destApp}"`)
        execSync(`xattr -cr "${destApp}" 2>/dev/null || true`)
        // Ad-hoc re-sign so Gatekeeper doesn't reject the freshly-copied app on launch
        execSync(`codesign --force --deep --sign - "${destApp}" 2>/dev/null || true`)

        sendProgress('Finishing…', 90)
        execSync(`hdiutil detach "${mountPoint}" -quiet || true`)

        // Clean up temp DMG if it was a remote download
        if (dmgPath !== localDmg) {
          try { fs.unlinkSync(dmgPath) } catch {}
        }

        sendProgress('Done', 100)

        setTimeout(() => {
          app.relaunch()
          app.exit(0)
        }, 800)
      } catch (err) {
        try { win.webContents.send('update:progress', { step: 'error', pct: 0, error: err.message }) } catch {}
        dialog.showErrorBox('Update Failed', err.message || 'Unknown error during update.')
      }
    }, 50)
  }

  if (localDmg) {
    sendProgress('Mounting update…', 10)
    installFromDmg(localDmg)
  } else {
    sendProgress('Downloading update…', 5)
    const tmpDmg = path.join(app.getPath('temp'), `roma-notes-${info.version}.dmg`)
    downloadFile(remoteDmgUrl, tmpDmg, (pct) => {
      sendProgress(`Downloading… ${pct}%`, 5 + Math.round(pct * 0.20))
    }, (err) => {
      if (err) {
        try { win.webContents.send('update:progress', { step: 'error', pct: 0, error: err.message }) } catch {}
        dialog.showErrorBox('Update Failed', `Download failed: ${err.message}`)
        return
      }
      installFromDmg(tmpDmg)
    })
  }
}

function compareVersions(a, b) {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0, nb = pb[i] || 0
    if (na > nb) return 1
    if (na < nb) return -1
  }
  return 0
}

// ─── Window ──────────────────────────────────────────────────────────────────

function createWindow() {
  // Restore saved window bounds
  let savedBounds = { width: 1400, height: 900 }
  const BOUNDS_FILE = path.join(DATA_DIR, 'window-bounds.json')
  try {
    if (fs.existsSync(BOUNDS_FILE)) {
      const b = JSON.parse(fs.readFileSync(BOUNDS_FILE, 'utf-8'))
      if (b.width >= 800 && b.height >= 600) savedBounds = b
    }
  } catch {}

  const win = new BrowserWindow({
    width: savedBounds.width,
    height: savedBounds.height,
    x: savedBounds.x,
    y: savedBounds.y,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    vibrancy: 'sidebar',
    // 'followWindow' (the default) lets macOS stop re-sampling the vibrancy blur
    // when the app isn't frontmost — saves GPU/energy in the background and is the
    // native look (sidebar dims when unfocused). 'active' forced live blur always.
    visualEffectState: 'followWindow',
    backgroundColor: '#00000000',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      sandbox: false,
    },
  })

  // Save bounds on resize/move
  function saveBounds() {
    try {
      fs.writeFileSync(BOUNDS_FILE, JSON.stringify(win.getBounds(), null, 2))
    } catch {}
  }
  win.on('resize', saveBounds)
  win.on('move', saveBounds)

  if (isDev) {
    win.loadURL('http://localhost:5173')
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  // Timers/watchers that must be torn down when the window closes, otherwise
  // they keep firing in a windowless background process and burn energy even
  // though the user thinks the app is "closed".
  const startupTimers = []
  let updateTimer = null
  let iCloudWatcher = null

  // Check for updates silently on startup (after 3 seconds),
  // then keep polling every 10 minutes while the app is open
  if (!isDev) {
    startupTimers.push(setTimeout(() => checkForUpdates(win, true), 3000))
    updateTimer = setInterval(() => checkForUpdates(win, true), 10 * 60 * 1000)
  }

  // iCloud sync: pull on startup (after 2s) and on focus. While the window is
  // focused we poll every 30s. While it's in the background, fs.watch (below)
  // and the focus handler already deliver iPhone changes, so we drop to a slow
  // 5-min safety-net poll. This lets macOS idle the app (App Nap) instead of
  // waking the CPU twice a minute to scan + parse every page — the main source
  // of this app's energy impact when it just sits open in the background.
  // Full pull over every page. Guarded so the 30s/focus timers can't stack
  // overlapping O(all-pages) scans on top of each other (each scan reads +
  // parses thousands of JSON files and would otherwise pile up under churn).
  let fullPullInFlight = false
  const doSyncPull = async () => {
    if (fullPullInFlight) return
    fullPullInFlight = true
    try {
      const merged = await pullFromICloud()
      if (merged.length > 0) {
        try { win.webContents.send('sync:updated') } catch {}
      }
    } finally {
      fullPullInFlight = false
    }
  }
  let syncTimer = null
  const FOCUSED_SYNC_MS = 30 * 1000
  const BACKGROUND_SYNC_MS = 5 * 60 * 1000
  const rescheduleSync = () => {
    if (syncTimer) clearInterval(syncTimer)
    syncTimer = setInterval(doSyncPull, win.isFocused() ? FOCUSED_SYNC_MS : BACKGROUND_SYNC_MS)
  }
  startupTimers.push(setTimeout(() => { doSyncPull(); rescheduleSync() }, 2000))
  win.on('focus', () => { doSyncPull(); rescheduleSync() })
  win.on('blur', rescheduleSync)

  // Watch iCloud pages folder for instant detection of iPhone changes.
  // fs.watch fires the moment iCloud downloads a file locally — no polling needed.
  // CRITICAL for energy: react to ONLY the files that actually changed. iCloud's
  // background daemon touches individual page files several times a second; the
  // old handler ran a full pull (re-reading + parsing every page on disk, ~310ms
  // of CPU) on each event, which pinned the main process near 100% indefinitely.
  // We coalesce the changed filenames and merge just those — ~0.2ms per file.
  let watchDebounce = null
  const pendingFiles = new Set()
  const startICloudWatch = () => {
    if (!fs.existsSync(ICLOUD_CONTAINER)) return
    try {
      iCloudWatcher = fs.watch(ICLOUD_CONTAINER, { persistent: false }, (eventType, filename) => {
        if (!filename || !filename.endsWith('.json')) return
        pendingFiles.add(filename)
        clearTimeout(watchDebounce)
        watchDebounce = setTimeout(async () => {
          const files = [...pendingFiles]
          pendingFiles.clear()
          let changed = 0
          for (const f of files) {
            if (await syncCloudFile(f)) changed++
          }
          if (changed > 0) {
            try { win.webContents.send('sync:updated') } catch {}
          }
        }, 500)
      })
    } catch {}
  }
  // Start watching after initial pull (gives iCloud time to create the folder)
  startupTimers.push(setTimeout(startICloudWatch, 3000))

  // Tear down every timer/watcher when the window closes so a backgrounded
  // process can't keep waking the CPU and the iCloud file watcher.
  win.on('closed', () => {
    startupTimers.forEach(clearTimeout)
    if (updateTimer) clearInterval(updateTimer)
    if (syncTimer) clearInterval(syncTimer)
    if (watchDebounce) clearTimeout(watchDebounce)
    if (iCloudWatcher) { try { iCloudWatcher.close() } catch {} }
  })

  // Set up native menu
  const template = [
    {
      label: 'Roma Notes',
      submenu: [
        { role: 'about', label: 'About Roma Notes' },
        { type: 'separator' },
        {
          label: 'Check for Updates…',
          click: () => checkForUpdates(win, false),
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        {
          label: 'New Page',
          accelerator: 'CmdOrCtrl+N',
          click: () => win.webContents.send('menu:new-page'),
        },
        {
          label: "Today's Journal",
          accelerator: 'CmdOrCtrl+D',
          click: () => win.webContents.send('menu:today'),
        },
        { type: 'separator' },
        {
          label: 'Import from Roam…',
          click: () => win.webContents.send('menu:import'),
        },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => win.webContents.send('menu:undo') },
        { label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z', click: () => win.webContents.send('menu:redo') },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Search',
          accelerator: 'CmdOrCtrl+K',
          click: () => win.webContents.send('menu:search'),
        },
        { type: 'separator' },
        { role: 'toggleDevTools' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
      ],
    },
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)

  return win
}

// Renderer-triggered update check (manual, shows dialog)
ipcMain.on('update:check', () => {
  const wins = BrowserWindow.getAllWindows()
  if (wins.length > 0) checkForUpdates(wins[0], false)
})

// Renderer-triggered install (called from sidebar badge click — installs directly, no dialog)
ipcMain.on('update:install', () => {
  const wins = BrowserWindow.getAllWindows()
  if (wins.length === 0) return
  const win = wins[0]
  if (cachedUpdateInfo) {
    applyUpdate(win, cachedUpdateInfo)
  } else {
    // Fallback: re-check and install immediately if update found
    checkForUpdates(win, false)
  }
})

app.whenReady().then(() => {
  ensureDirectories()
  createStartupBackup()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // Quit fully on every platform — including macOS. The standard mac pattern is
  // to keep the app resident after the last window closes, but this app has no
  // tray UI and runs background timers + an fs.watch, so a "closed" window left a
  // windowless process burning energy. Closing the window now ends the process;
  // the dock icon relaunches it (and `activate` recreates the window).
  app.quit()
})

// ─── IPC Handlers ───────────────────────────────────────────────────────────

// Pages
ipcMain.handle('pages:list', () => {
  const files = fs.readdirSync(PAGES_DIR).filter(f => f.endsWith('.json'))
  return files.map(f => {
    const content = JSON.parse(fs.readFileSync(path.join(PAGES_DIR, f), 'utf-8'))
    return {
      id: content.id,
      title: content.title,
      updatedAt: content.updatedAt,
      createdAt: content.createdAt,
    }
  })
})

ipcMain.handle('pages:get', (_, id) => {
  const filePath = path.join(PAGES_DIR, `${sanitizeFilename(id)}.json`)
  if (!fs.existsSync(filePath)) return null
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
})

ipcMain.handle('pages:save', (_, page) => {
  const filePath = path.join(PAGES_DIR, `${sanitizeFilename(page.id)}.json`)
  page.updatedAt = new Date().toISOString()
  fs.writeFileSync(filePath, JSON.stringify(page, null, 2))
  syncPageToICloud(page)
  return true
})

ipcMain.handle('pages:delete', (_, id) => {
  const filePath = path.join(PAGES_DIR, `${sanitizeFilename(id)}.json`)
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath)
    deletePageFromICloud(id)
    return true
  }
  return false
})

ipcMain.handle('pages:getAll', async () => {
  const files = (await fs.promises.readdir(PAGES_DIR)).filter(f => f.endsWith('.json'))
  return (await Promise.all(
    files.map(async f => {
      try {
        return JSON.parse(await fs.promises.readFile(path.join(PAGES_DIR, f), 'utf-8'))
      } catch {
        return null
      }
    })
  )).filter(Boolean)
})

// Settings
ipcMain.handle('settings:get', () => {
  if (!fs.existsSync(SETTINGS_FILE)) return {}
  return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'))
})

ipcMain.handle('settings:save', (_, settings) => {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2))
  return true
})

// Import
ipcMain.handle('import:selectFile', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'Roam Export', extensions: ['json', 'zip', 'edn'] }],
  })
  return result.filePaths[0] || null
})

ipcMain.handle('import:selectFolder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
  })
  return result.filePaths[0] || null
})

ipcMain.handle('import:readFile', (_, filePath) => {
  if (!fs.existsSync(filePath)) return null
  return fs.readFileSync(filePath, 'utf-8')
})

ipcMain.handle('import:readZip', async (_, filePath) => {
  const AdmZip = require('adm-zip')
  try {
    const zip = new AdmZip(filePath)
    const entries = zip.getEntries()
    return entries
      .filter(e => !e.isDirectory && e.entryName.endsWith('.md'))
      .map(e => ({
        name: e.entryName,
        content: e.getData().toString('utf-8'),
      }))
  } catch (err) {
    return { error: err.message }
  }
})

ipcMain.handle('import:readFolder', (_, folderPath) => {
  const results = []
  function readDir(dir) {
    const items = fs.readdirSync(dir)
    for (const item of items) {
      const fullPath = path.join(dir, item)
      const stat = fs.statSync(fullPath)
      if (stat.isDirectory()) {
        readDir(fullPath)
      } else if (item.endsWith('.md')) {
        results.push({
          name: item,
          content: fs.readFileSync(fullPath, 'utf-8'),
        })
      }
    }
  }
  readDir(folderPath)
  return results
})

// Shell
ipcMain.handle('shell:openExternal', (_, url) => {
  if (/^https?:\/\//.test(url)) shell.openExternal(url)
})

// iCloud sync
ipcMain.handle('sync:pull', async () => {
  const merged = await pullFromICloud()
  return { merged: merged.length, pages: merged }
})

ipcMain.handle('sync:available', () => {
  return isICloudAvailable()
})

function sanitizeFilename(name) {
  return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').substring(0, 200)
}

// ─── Touch ID + Secure Key Storage ──────────────────────────────────────────

const KEYS_FILE = path.join(DATA_DIR, 'block-keys.json')

function getTouchIdBinaryPath() {
  if (isDev) {
    return path.join(__dirname, 'touchid-helper')
  }
  return path.join(process.resourcesPath, 'touchid-helper')
}

function loadKeys() {
  if (!fs.existsSync(KEYS_FILE)) return {}
  try { return JSON.parse(fs.readFileSync(KEYS_FILE, 'utf-8')) } catch { return {} }
}

function saveKeys(keys) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(KEYS_FILE, JSON.stringify(keys, null, 2))
}

// Ensure the binary is executable (electron-builder may strip +x)
try {
  const bin = getTouchIdBinaryPath()
  if (fs.existsSync(bin)) fs.chmodSync(bin, 0o755)
} catch {}

// Check if Touch ID is available on this machine
ipcMain.handle('auth:canTouchId', () => {
  return new Promise((resolve) => {
    const bin = getTouchIdBinaryPath()
    if (!fs.existsSync(bin)) { resolve(false); return }
    execFile(bin, ['--check'], { timeout: 3000 }, (err, stdout) => {
      resolve(stdout.trim() === 'available')
    })
  })
})

// Prompt the user for Touch ID authentication
ipcMain.handle('auth:promptTouchId', (_, reason) => {
  return new Promise((resolve) => {
    const bin = getTouchIdBinaryPath()
    if (!fs.existsSync(bin)) { resolve({ success: false, error: 'binary not found' }); return }
    const msg = reason || 'Unlock encrypted block in Roma Notes'
    execFile(bin, [msg], { timeout: 30000 }, (err, stdout) => {
      const out = stdout.trim()
      if (out === 'success') {
        resolve({ success: true })
      } else {
        resolve({ success: false, error: out })
      }
    })
  })
})

// Save the encryption password for a block
// Uses safeStorage (Keychain) — refuses to store if Keychain is unavailable
ipcMain.handle('auth:saveKey', (_, blockId, password) => {
  try {
    if (!safeStorage.isEncryptionAvailable()) {
      console.warn('auth:saveKey: safeStorage (Keychain) not available — key not stored')
      return false
    }
    const keys = loadKeys()
    const encrypted = safeStorage.encryptString(password)
    keys[blockId] = { v: 2, data: encrypted.toString('hex') }
    saveKeys(keys)
    return true
  } catch (err) {
    console.error('auth:saveKey failed:', err)
    return false
  }
})

// Check if a saved key exists for a block
ipcMain.handle('auth:hasKey', (_, blockId) => {
  const keys = loadKeys()
  return Object.prototype.hasOwnProperty.call(keys, blockId)
})

// Retrieve the decrypted key for a block (call after successful Touch ID)
ipcMain.handle('auth:getKey', (_, blockId) => {
  const keys = loadKeys()
  if (!Object.prototype.hasOwnProperty.call(keys, blockId)) return null
  try {
    if (!safeStorage.isEncryptionAvailable()) return null
    const entry = keys[blockId]
    // Handle legacy format (plain hex string) and new format (object with version)
    if (typeof entry === 'string') {
      // Legacy: was safeStorage hex
      return safeStorage.decryptString(Buffer.from(entry, 'hex'))
    }
    if (entry.v === 2) {
      return safeStorage.decryptString(Buffer.from(entry.data, 'hex'))
    }
    // v:1 (base64 plaintext) — refuse to return, force password re-entry so it
    // gets re-saved as v:2 via safeStorage (Keychain-backed)
    if (entry.v === 1) {
      console.warn('auth:getKey: upgrading insecure v1 entry — user must re-enter password')
      delete keys[blockId]
      saveKeys(keys)
      return null
    }
    return null
  } catch (err) {
    console.error('auth:getKey failed:', err)
    return null
  }
})

// Delete the saved key for a block
ipcMain.handle('auth:deleteKey', (_, blockId) => {
  const keys = loadKeys()
  delete keys[blockId]
  saveKeys(keys)
  return true
})
