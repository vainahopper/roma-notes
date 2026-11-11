// End-to-end tests for the iCloud sync engine, run against real temp
// directories. Run with `node scripts/test-icloud-sync.js`.
//
// These exercise src/main/icloud-sync.js directly (not a copy of its logic),
// because syncCloudFile() DELETES files in the user's iCloud container and the
// one thing that must never happen is content disappearing with them.

const fs = require('fs')
const os = require('os')
const path = require('path')
const assert = require('assert')

const { createICloudSync, sanitizeFilename, LOCAL_ONLY_MARK } = require('../src/main/icloud-sync')

let passed = 0
let failed = 0
const tests = []
const test = (name, fn) => tests.push({ name, fn })

// ─── Fixtures ────────────────────────────────────────────────────────────────

let PAGES_DIR, ICLOUD_DIR, sync

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'roma-sync-test-'))
  PAGES_DIR = path.join(root, 'local')
  ICLOUD_DIR = path.join(root, 'icloud')
  fs.mkdirSync(PAGES_DIR)
  fs.mkdirSync(ICLOUD_DIR)
  sync = createICloudSync({ pagesDir: PAGES_DIR, icloudContainer: ICLOUD_DIR })
  return root
}

const block = (id, content, updatedAt, children = []) => ({ id, content, children, updatedAt })

const page = (id, blocks, updatedAt) => ({
  id, title: id, blocks, createdAt: '2026-01-01T00:00:00.000Z', updatedAt,
})

const writeLocal = (p) => fs.writeFileSync(
  path.join(PAGES_DIR, `${sanitizeFilename(p.id)}.json`), JSON.stringify(p, null, 2))
const writeCloud = (name, p) => fs.writeFileSync(path.join(ICLOUD_DIR, name), JSON.stringify(p, null, 2))
const readLocal = (id) => JSON.parse(fs.readFileSync(path.join(PAGES_DIR, `${sanitizeFilename(id)}.json`), 'utf-8'))
const readCloud = (name) => JSON.parse(fs.readFileSync(path.join(ICLOUD_DIR, name), 'utf-8'))
const cloudFiles = () => fs.readdirSync(ICLOUD_DIR).sort()

/** Every non-empty block content in a page, flattened — used to assert nothing was lost. */
function contents(p) {
  const out = []
  const walk = (blocks) => {
    for (const b of blocks || []) {
      if (b.content && b.content.trim()) out.push(b.content)
      walk(b.children)
    }
  }
  walk(p.blocks)
  return out.sort()
}

// ─── sanitizeFilename ────────────────────────────────────────────────────────

test('sanitizeFilename maps every Windows-reserved char to _', () => {
  assert.strictEqual(sanitizeFilename('fintech 2025: the next wave'), 'fintech 2025_ the next wave')
  assert.strictEqual(sanitizeFilename('¿quién se ha llevado mi queso?'), '¿quién se ha llevado mi queso_')
  assert.strictEqual(sanitizeFilename('cómo decir "no"'), 'cómo decir _no_')
  assert.strictEqual(sanitizeFilename('a/b\\c|d*e<f>g'), 'a_b_c_d_e_f_g')
})

test('sanitizeFilename leaves accented/normal titles untouched', () => {
  assert.strictEqual(sanitizeFilename('biotipos'), 'biotipos')
  assert.strictEqual(sanitizeFilename('2026-09-01'), '2026-09-01')
  assert.strictEqual(sanitizeFilename('el efecto halo'), 'el efecto halo')
})

test('Mac and iPhone derive the SAME cloud filename (the invariant that broke)', () => {
  // The two platforms share one iCloud folder, so their filename functions must
  // agree exactly. They live in different languages/files, so this test reads the
  // iPhone one straight out of the source and runs both over the same inputs.
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'platform', 'capacitor.ts'), 'utf-8')
  const body = src.match(/function cloudFileId\(id: string\): string \{\s*return ([^\n]+)\n\s*\}/)
  assert.ok(body, 'cloudFileId() not found in capacitor.ts — did it get renamed?')
  // eslint-disable-next-line no-new-func
  const iphone = new Function('id', `return ${body[1].trim()}`)

  const titles = [
    'fintech 2025: the next wave',
    '¿quién se ha llevado mi queso?',
    'cómo decir "no"',
    'why, how, what: how great leaders inspire to action - simon sinek',
    'a/b\\c|d*e<f>g',
    'biotipos', '2026-09-01', 'el efecto halo',
    'x'.repeat(250),
  ]
  for (const t of titles) {
    assert.strictEqual(iphone(t), sanitizeFilename(t),
      `Mac and iPhone disagree on the filename for ${JSON.stringify(t)}`)
  }
})

// ─── The bug this fixes ──────────────────────────────────────────────────────

test('REGRESSION: iPhone-named file (raw id) merges into the Mac page and is retired', async () => {
  setup()
  const id = 'fintech 2025: the next wave'
  // Mac wrote the canonical, sanitized name…
  writeLocal(page(id, [block('b1', 'from mac', '2026-01-02T00:00:00.000Z')], '2026-01-02T00:00:00.000Z'))
  writeCloud(`${sanitizeFilename(id)}.json`, readLocal(id))
  // …while an old iPhone build wrote the raw name with an edit the Mac never saw.
  writeCloud(`${id}.json`, page(id, [block('b2', 'from iphone', '2026-01-03T00:00:00.000Z')], '2026-01-03T00:00:00.000Z'))

  await sync.syncCloudFile(`${id}.json`)

  // Both edits survive, in the one local page.
  assert.deepStrictEqual(contents(readLocal(id)), ['from iphone', 'from mac'])
  // The duplicate is gone and the canonical file carries the merge.
  assert.deepStrictEqual(cloudFiles(), [`${sanitizeFilename(id)}.json`])
  assert.deepStrictEqual(contents(readCloud(`${sanitizeFilename(id)}.json`)), ['from iphone', 'from mac'])
})

test('REGRESSION: a page that exists ONLY under the raw name still reaches the Mac', async () => {
  setup()
  const id = '¿quién se ha llevado mi queso?'
  writeCloud(`${id}.json`, page(id, [block('b1', 'solo del iphone', '2026-01-01T00:00:00.000Z')], '2026-01-01T00:00:00.000Z'))

  await sync.syncCloudFile(`${id}.json`)

  assert.deepStrictEqual(contents(readLocal(id)), ['solo del iphone'])
  assert.deepStrictEqual(cloudFiles(), [`${sanitizeFilename(id)}.json`])
})

test('iCloud conflict copy ("<name> 2.json") is merged in, then removed', async () => {
  setup()
  const id = '2026-06-01'
  writeLocal(page(id, [block('b1', 'real note', '2026-06-30T00:00:00.000Z')], '2026-06-30T00:00:00.000Z'))
  writeCloud(`${id}.json`, readLocal(id))
  writeCloud(`${id} 2.json`, page(id, [block('b9', 'older stray', '2026-06-01T00:00:00.000Z')], '2026-06-01T00:00:00.000Z'))

  await sync.syncCloudFile(`${id} 2.json`)

  assert.deepStrictEqual(cloudFiles(), [`${id}.json`])
  // Merge is a union — the stray block is kept rather than silently dropped.
  assert.deepStrictEqual(contents(readLocal(id)), ['older stray', 'real note'])
})

test('an empty conflict copy never overwrites real content', async () => {
  setup()
  const id = '2026-05-28'
  writeLocal(page(id, [block('b1', 'notas de verdad', '2026-05-29T00:00:00.000Z')], '2026-05-29T00:00:00.000Z'))
  writeCloud(`${id}.json`, readLocal(id))
  writeCloud(`${id} 2.json`, page(id, [block('b9', '', '2026-05-28T00:00:00.000Z')], '2026-05-28T00:00:00.000Z'))

  await sync.syncCloudFile(`${id} 2.json`)

  assert.deepStrictEqual(contents(readLocal(id)), ['notas de verdad'])
  assert.deepStrictEqual(contents(readCloud(`${id}.json`)), ['notas de verdad'])
  assert.deepStrictEqual(cloudFiles(), [`${id}.json`])
})

test('the alias is KEPT when the canonical file cannot be written', async () => {
  const root = setup()
  const id = 'algo: con dos puntos'
  writeCloud(`${id}.json`, page(id, [block('b1', 'no me borres', '2026-01-01T00:00:00.000Z')], '2026-01-01T00:00:00.000Z'))
  // Make the container read-only so the canonical write fails.
  fs.chmodSync(ICLOUD_DIR, 0o500)
  try {
    await sync.syncCloudFile(`${id}.json`)
    assert.ok(cloudFiles().includes(`${id}.json`), 'alias must survive a failed canonical write')
  } finally {
    fs.chmodSync(ICLOUD_DIR, 0o700)
    fs.rmSync(root, { recursive: true, force: true })
  }
})

// ─── No-alias paths must be untouched by the change ──────────────────────────

test('a canonical cloud file is never deleted', async () => {
  setup()
  const id = 'biotipos'
  writeLocal(page(id, [block('b1', 'local', '2026-01-02T00:00:00.000Z')], '2026-01-02T00:00:00.000Z'))
  writeCloud(`${id}.json`, page(id, [block('b2', 'cloud', '2026-01-03T00:00:00.000Z')], '2026-01-03T00:00:00.000Z'))

  await sync.syncCloudFile(`${id}.json`)

  assert.deepStrictEqual(cloudFiles(), [`${id}.json`])
  assert.deepStrictEqual(contents(readLocal(id)), ['cloud', 'local'])
})

test('identical pages settle — no rewrite, no ping-pong', async () => {
  setup()
  const id = 'estable'
  const p = page(id, [block('b1', 'same', '2026-01-02T00:00:00.000Z')], '2026-01-02T00:00:00.000Z')
  writeLocal(p)
  writeCloud(`${id}.json`, p)
  const before = fs.statSync(path.join(ICLOUD_DIR, `${id}.json`)).mtimeMs

  const result = await sync.syncCloudFile(`${id}.json`)

  assert.strictEqual(result, null, 'no change should be reported')
  assert.strictEqual(fs.statSync(path.join(ICLOUD_DIR, `${id}.json`)).mtimeMs, before, 'cloud file must not be rewritten')
})

test('pullFromICloud collapses a whole folder of duplicates in one pass', async () => {
  setup()
  const ids = ['a: uno', 'b? dos', 'c "tres"']
  for (const id of ids) {
    writeCloud(`${id}.json`, page(id, [block('b1', `contenido ${id}`, '2026-01-01T00:00:00.000Z')], '2026-01-01T00:00:00.000Z'))
  }
  await sync.pullFromICloud()

  assert.deepStrictEqual(cloudFiles(), ids.map(i => `${sanitizeFilename(i)}.json`).sort())
  for (const id of ids) assert.deepStrictEqual(contents(readLocal(id)), [`contenido ${id}`])
})

test('nested children survive an alias merge', async () => {
  setup()
  const id = 'padre: hijo'
  writeLocal(page(id, [
    block('b1', 'padre', '2026-01-02T00:00:00.000Z', [block('c1', 'hijo mac', '2026-01-02T00:00:00.000Z')]),
  ], '2026-01-02T00:00:00.000Z'))
  writeCloud(`${sanitizeFilename(id)}.json`, readLocal(id))
  writeCloud(`${id}.json`, page(id, [
    block('b1', 'padre', '2026-01-03T00:00:00.000Z', [block('c2', 'hijo iphone', '2026-01-03T00:00:00.000Z')]),
  ], '2026-01-03T00:00:00.000Z'))

  await sync.syncCloudFile(`${id}.json`)

  assert.deepStrictEqual(contents(readLocal(id)), ['hijo iphone', 'hijo mac', 'padre'])
  assert.deepStrictEqual(cloudFiles(), [`${sanitizeFilename(id)}.json`])
})

// ─── Encrypted blocks are device-local ───────────────────────────────────────

const CIPHER = '{{encrypt:v2$c2VjcmV0Y2lwaGVydGV4dA==}}'
const hasCipherText = (file) => fs.readFileSync(path.join(ICLOUD_DIR, file), 'utf-8').includes('v2$')

test('encrypted: mirroring a page never writes ciphertext to iCloud', async () => {
  setup()
  const p = page('secret page', [
    block('b1', 'visible', '2026-01-02T00:00:00.000Z', [block('e1', CIPHER, '2026-01-02T00:00:00.000Z')]),
  ], '2026-01-02T00:00:00.000Z')
  sync.syncPageToICloud(p)
  const file = `${sanitizeFilename(p.id)}.json`
  assert.ok(!hasCipherText(file))
  const cloud = readCloud(file)
  assert.strictEqual(cloud.blocks[0].content, 'visible')
  assert.strictEqual(cloud.blocks[0].children[0].id, 'e1')
  assert.strictEqual(cloud.blocks[0].children[0].content, LOCAL_ONLY_MARK)
})

test('encrypted: a newer cloud placeholder never overwrites local ciphertext', async () => {
  setup()
  const id = 'enc merge'
  writeLocal(page(id, [block('e1', CIPHER, '2026-01-01T00:00:00.000Z'), block('b1', 'old', '2026-01-01T00:00:00.000Z')], '2026-01-01T00:00:00.000Z'))
  writeCloud(`${sanitizeFilename(id)}.json`, page(id, [
    block('e1', LOCAL_ONLY_MARK, '2026-01-05T00:00:00.000Z'),
    block('b1', 'new from iphone', '2026-01-05T00:00:00.000Z'),
  ], '2026-01-05T00:00:00.000Z'))
  await sync.syncCloudFile(`${sanitizeFilename(id)}.json`)
  const local = readLocal(id)
  assert.strictEqual(local.blocks.find(b => b.id === 'e1').content, CIPHER)
  assert.strictEqual(local.blocks.find(b => b.id === 'b1').content, 'new from iphone')
  assert.ok(!hasCipherText(`${sanitizeFilename(id)}.json`))
})

test('encrypted: ciphertext left in iCloud by older builds is purged on pull', async () => {
  setup()
  const id = 'legacy'
  const p = page(id, [block('e1', CIPHER, '2026-01-01T00:00:00.000Z')], '2026-01-01T00:00:00.000Z')
  writeLocal(p)
  writeCloud(`${sanitizeFilename(id)}.json`, p)
  await sync.pullFromICloud()
  assert.ok(!hasCipherText(`${sanitizeFilename(id)}.json`))
  assert.strictEqual(readLocal(id).blocks[0].content, CIPHER)
})

test('encrypted: an already-stripped cloud copy is not re-pushed every pull', async () => {
  setup()
  const id = 'stable'
  writeLocal(page(id, [block('e1', CIPHER, '2026-01-01T00:00:00.000Z'), block('b1', 'x', '2026-01-01T00:00:00.000Z')], '2026-01-01T00:00:00.000Z'))
  await sync.pullFromICloud() // first push (stripped)
  const file = path.join(ICLOUD_DIR, `${sanitizeFilename(id)}.json`)
  const before = fs.readFileSync(file, 'utf-8')
  const changed = await sync.syncCloudFile(`${sanitizeFilename(id)}.json`)
  assert.strictEqual(changed, null)
  assert.strictEqual(fs.readFileSync(file, 'utf-8'), before)
})

test('encrypted: a device without the ciphertext keeps the placeholder', async () => {
  setup()
  const id = 'other device'
  writeCloud(`${sanitizeFilename(id)}.json`, page(id, [block('e1', LOCAL_ONLY_MARK, '2026-01-01T00:00:00.000Z')], '2026-01-01T00:00:00.000Z'))
  await sync.syncCloudFile(`${sanitizeFilename(id)}.json`)
  assert.strictEqual(readLocal(id).blocks[0].content, LOCAL_ONLY_MARK)
})

// ─── Runner ──────────────────────────────────────────────────────────────────

;(async () => {
  for (const { name, fn } of tests) {
    try {
      await fn()
      console.log(`  ✓ ${name}`)
      passed++
    } catch (err) {
      console.log(`  ✗ ${name}`)
      console.log(`      ${err.message}`)
      failed++
    }
  }
  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
})()
