// iCloud sync engine for the Mac app.
//
// Deliberately free of any `electron` import so it can be exercised directly by
// scripts/test-icloud-sync.js against temp directories — this module deletes
// files in the user's iCloud container, so it needs to be testable in isolation.
// src/main/index.js wires it up with the real paths via createICloudSync().

const path = require('path')
const fs = require('fs')
const os = require('os')

/**
 * Canonical on-disk name for a page id.
 * MUST stay byte-identical to cloudFileId() in src/renderer/platform/capacitor.ts —
 * the Mac and the iPhone share one iCloud folder, and the filename is the only
 * thing that pairs their two copies of a page.
 */
function sanitizeFilename(name) {
  return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').substring(0, 200)
}

// ─── Device-local encrypted blocks ───────────────────────────────────────────
// Encrypted blocks never leave the device: before a page is written to iCloud,
// each encrypted block keeps its id and position but its ciphertext is replaced
// by LOCAL_ONLY_MARK. When a cloud copy is merged in, the local ciphertext is put
// back. MUST stay identical to src/renderer/utils/localOnly.ts.
const LOCAL_ONLY_MARK = '{{encrypt:local-only}}'
const ENCRYPT_PATTERN = /\{\{encrypt:[^}]+\}\}/

function hasCiphertext(content) {
  return !!content && content !== LOCAL_ONLY_MARK && ENCRYPT_PATTERN.test(content)
}

function stripEncryptedForCloud(page) {
  const strip = blocks => (blocks || []).map(b => ({
    ...b,
    content: hasCiphertext(b.content) ? LOCAL_ONLY_MARK : b.content,
    children: strip(b.children || []),
  }))
  return { ...page, blocks: strip(page.blocks) }
}

function restoreLocalEncrypted(page, localPage) {
  if (!localPage) return page
  const local = new Map()
  const collect = blocks => {
    for (const b of blocks || []) {
      if (hasCiphertext(b.content)) local.set(b.id, b.content)
      collect(b.children)
    }
  }
  collect(localPage.blocks)
  if (!local.size) return page
  const restore = blocks => (blocks || []).map(b => ({
    ...b,
    content: b.content === LOCAL_ONLY_MARK && local.has(b.id) ? local.get(b.id) : b.content,
    children: restore(b.children || []),
  }))
  return { ...page, blocks: restore(page.blocks) }
}

/**
 * @param {{pagesDir: string, icloudContainer: string}} dirs
 */
function createICloudSync({ pagesDir, icloudContainer }) {
  const PAGES_DIR = pagesDir
  const ICLOUD_CONTAINER = icloudContainer
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
      fs.writeFileSync(filePath, JSON.stringify(stripEncryptedForCloud(page), null, 2))
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

  // A cloud file is an "alias" when its name is not the canonical
  // sanitizeFilename(page.id) name. Two sources produce these:
  //   1. Older iPhone builds wrote the raw page id, so a title containing
  //      : " ? / \ | * < > produced `fintech 2025: the next wave.json` while the
  //      Mac wrote `fintech 2025_ the next wave.json` — two files, one page id.
  //      They never converged: the Mac merged the alias into the right local page
  //      but always pushed back under the canonical name, so the alias stayed
  //      stale forever and the Mac re-pushed it on every pull, endlessly.
  //   2. iCloud conflict copies (`2026-06-01 2.json`), which carry stale content.
  // Either way the fix is the same: merge the alias in, then delete it so exactly
  // one canonical file per page id remains.
  function isAliasCloudFile(file, pageId) {
    return file !== `${sanitizeFilename(pageId)}.json`
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
      const isAlias = isAliasCloudFile(file, cloudPage.id)
      // Collapse an alias onto the canonical name: the content is written to the
      // canonical file first, and only then is the alias unlinked. If that write
      // failed the canonical file won't exist, so the alias is kept and retried
      // on the next pull — content is never removed before it is safely stored.
      const retireAlias = () => {
        if (!isAlias) return
        try {
          const canonical = path.join(ICLOUD_CONTAINER, `${sanitizeFilename(cloudPage.id)}.json`)
          if (!fs.existsSync(canonical)) return
          fs.unlinkSync(cloudFilePath)
          console.log(`iCloud sync: retired duplicate "${file}" → "${path.basename(canonical)}"`)
        } catch (err) {
          console.error('iCloud sync: alias cleanup failed:', err.message)
        }
      }
      const localPath = path.join(PAGES_DIR, `${sanitizeFilename(cloudPage.id)}.json`)
      if (fs.existsSync(localPath)) {
        const localPage = JSON.parse(await fs.promises.readFile(localPath, 'utf-8'))
        const cloudHasContent = pageHasRealContent(cloudPage)
        const localHasContent = pageHasRealContent(localPage)

        // Empty-stub protection: a stub must never overwrite real content. Stubs
        // come from a device opening a daily note before sync has completed.
        if (cloudHasContent && !localHasContent) {
          // Cloud has data, local is empty → accept cloud regardless of timestamp
          const restored = restoreLocalEncrypted(cloudPage, localPage)
          await fs.promises.writeFile(localPath, JSON.stringify(restored, null, 2))
          if (isAlias) { syncPageToICloud(restored); retireAlias() }
          return restored
        } else if (!cloudHasContent && localHasContent) {
          // Cloud is empty, local has data → push local to cloud regardless of timestamp
          console.log(`iCloud sync: keeping real local content for ${cloudPage.id} (cloud stub discarded)`)
          syncPageToICloud(localPage)
          retireAlias()
          return null
        } else if (cloudHasContent && localHasContent) {
          // Both sides have content → ALWAYS merge by block id, never replace the
          // whole page. Catches the silent data-loss case where both devices kept
          // the same block IDs but edited different blocks' content. To avoid
          // ping-pong, skip the write to whichever side already byte-matches the
          // merge (ignoring only page-level updatedAt, which the merge bumps).
          // The cloud only holds placeholders for encrypted blocks: put the local
          // ciphertext back, and compare against the cloud in stripped form so a
          // page with encrypted blocks isn't re-pushed on every pull. Cloud files
          // that still hold ciphertext (written by older builds) differ from the
          // stripped merge, so they get rewritten without it.
          const mergedPage = restoreLocalEncrypted(mergePages(cloudPage, localPage), localPage)
          const sameAsLocal = pagesEqualIgnoringPageTs(mergedPage, localPage)
          const sameAsCloud = pagesEqualIgnoringPageTs(stripEncryptedForCloud(mergedPage), cloudPage)
          if (!sameAsLocal) {
            await fs.promises.writeFile(localPath, JSON.stringify(mergedPage, null, 2))
          }
          // An alias always needs the canonical file written, even when the merge
          // matched `cloudPage` byte-for-byte — `sameAsCloud` compares against the
          // alias we just read, not the canonical name we're about to keep.
          if (!sameAsCloud || isAlias) {
            syncPageToICloud(mergedPage)
          }
          retireAlias()
          if (!sameAsLocal || !sameAsCloud) {
            console.log(`iCloud sync: block-merged ${cloudPage.id} (writeLocal=${!sameAsLocal} pushCloud=${!sameAsCloud})`)
          }
          return sameAsLocal ? null : mergedPage
        }
        // Both empty → nothing to merge, but an alias still has to go.
        if (isAlias) { syncPageToICloud(localPage); retireAlias() }
        return null
      } else {
        // New page from cloud → save locally (always accept, nothing to lose)
        await fs.promises.writeFile(localPath, JSON.stringify(cloudPage, null, 2))
        if (isAlias) { syncPageToICloud(cloudPage); retireAlias() }
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

  return {
    isICloudAvailable,
    syncPageToICloud,
    deletePageFromICloud,
    pageHasRealContent,
    mergePages,
    isAliasCloudFile,
    syncCloudFile,
    pullFromICloud,
  }
}

module.exports = { createICloudSync, sanitizeFilename, stripEncryptedForCloud, restoreLocalEncrypted, LOCAL_ONLY_MARK }
