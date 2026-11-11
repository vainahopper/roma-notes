import type { Page, Block } from '../../shared/types'

// Encrypted blocks are device-local: their ciphertext never leaves the device
// (not to iCloud, not to the Netlify cloud bridge). Before any upload the block
// keeps its id and position but its content is swapped for this placeholder;
// on download the device that still holds the real ciphertext puts it back.
//
// The placeholder deliberately matches the {{encrypt:…}} pattern so every
// existing check (agent routes, markdown export, older app builds) already
// treats it as encrypted and off-limits.
//
// MUST stay identical to LOCAL_ONLY_MARK in src/main/icloud-sync.js and
// cloud/netlify/functions/notes.mts.
export const LOCAL_ONLY_MARK = '{{encrypt:local-only}}'

const ENCRYPT_PATTERN = /\{\{encrypt:[^}]+\}\}/

/** Real ciphertext held on this device (not the placeholder). */
function hasCiphertext(content: string | undefined): boolean {
  return !!content && content !== LOCAL_ONLY_MARK && ENCRYPT_PATTERN.test(content)
}

/** True when the page holds real ciphertext anywhere in its tree. */
export function pageHasCiphertext(page: Page): boolean {
  const walk = (bs: Block[]): boolean => (bs || []).some(b => hasCiphertext(b.content) || walk(b.children || []))
  return walk(page.blocks)
}

export function isLocalOnlyPlaceholder(content: string | undefined): boolean {
  return content === LOCAL_ONLY_MARK
}

function stripBlocks(blocks: Block[]): Block[] {
  return (blocks || []).map(b => ({
    ...b,
    content: hasCiphertext(b.content) ? LOCAL_ONLY_MARK : b.content,
    children: stripBlocks(b.children || []),
  }))
}

/** Copy of the page safe to upload: every encrypted block's ciphertext replaced by the placeholder. */
export function stripEncryptedForCloud(page: Page): Page {
  return { ...page, blocks: stripBlocks(page.blocks) }
}

function collectCiphertext(blocks: Block[], out: Map<string, string>) {
  for (const b of blocks || []) {
    if (hasCiphertext(b.content)) out.set(b.id, b.content)
    collectCiphertext(b.children || [], out)
  }
}

function restoreBlocks(blocks: Block[], local: Map<string, string>): Block[] {
  return (blocks || []).map(b => ({
    ...b,
    content: b.content === LOCAL_ONLY_MARK && local.has(b.id) ? local.get(b.id)! : b.content,
    children: restoreBlocks(b.children || [], local),
  }))
}

/**
 * Put this device's ciphertext back into a page that came from (or was merged
 * with) the cloud, so the placeholder never overwrites a real encrypted block.
 */
export function restoreLocalEncrypted(page: Page, localPage: Page | null | undefined): Page {
  if (!localPage) return page
  const local = new Map<string, string>()
  collectCiphertext(localPage.blocks, local)
  if (!local.size) return page
  return { ...page, blocks: restoreBlocks(page.blocks, local) }
}
