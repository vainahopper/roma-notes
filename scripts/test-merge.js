// Quick sanity test for the page-merge logic. Run with `node scripts/test-merge.js`.
// This duplicates the merge logic from src/main/index.js so we can validate it
// in isolation. After integrating, both sides should produce identical results.

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
    updatedAt: new Date().toISOString(),
  }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

let passed = 0, failed = 0
function test(name, fn) {
  try { fn(); console.log('  ✓', name); passed++ }
  catch (e) { console.log('  ✗', name, '\n   →', e.message); failed++ }
}
function eq(a, b, msg) {
  const A = JSON.stringify(a), B = JSON.stringify(b)
  if (A !== B) throw new Error((msg || '') + `\n   got:      ${A}\n   expected: ${B}`)
}

const blk = (id, content, ts, children = []) => ({
  id, content, children, checked: null, createdAt: ts, updatedAt: ts,
})

console.log('mergeBlockLists:')

test('disjoint blocks: both kept, newer-side order first', () => {
  const newer = [blk('A', 'a', '2026-05-07T10:00:00Z')]
  const older = [blk('B', 'b', '2026-05-07T09:00:00Z')]
  eq(mergeBlockLists(newer, older).map(b => b.id), ['A', 'B'])
})

test('same id on both: per-block newer wins', () => {
  const newer = [blk('A', 'a-new', '2026-05-07T10:00:00Z')]
  const older = [blk('A', 'a-old', '2026-05-07T09:00:00Z')]
  eq(mergeBlockLists(newer, older)[0].content, 'a-new')
})

test('same id on both, but older has newer per-block ts → older wins for that block', () => {
  const newer = [blk('A', 'a-page-newer', '2026-05-07T09:00:00Z')]
  const older = [blk('A', 'a-block-newer', '2026-05-07T10:00:00Z')]
  eq(mergeBlockLists(newer, older)[0].content, 'a-block-newer')
})

test('children merged recursively', () => {
  const newer = [blk('P', 'parent', '2026-05-07T10:00:00Z', [
    blk('A', 'a', '2026-05-07T10:00:00Z'),
  ])]
  const older = [blk('P', 'parent', '2026-05-07T09:00:00Z', [
    blk('B', 'b', '2026-05-07T09:00:00Z'),
  ])]
  const m = mergeBlockLists(newer, older)
  eq(m[0].children.map(c => c.id), ['A', 'B'])
})

test('mac wrote A,B; iphone wrote C: all preserved (data-loss scenario)', () => {
  const cloud = { id: '2026-05-07', title: '', blocks: [blk('C', 'iphone', '2026-05-07T18:00:00Z')], updatedAt: '2026-05-07T18:00:00Z' }
  const local = { id: '2026-05-07', title: '', blocks: [blk('A', 'mac1', '2026-05-07T17:00:00Z'), blk('B', 'mac2', '2026-05-07T17:30:00Z')], updatedAt: '2026-05-07T17:30:00Z' }
  const merged = mergePages(cloud, local)
  eq(merged.blocks.map(b => b.id), ['C', 'A', 'B'])
})

test('identical blocks: merge result has same structure as input', () => {
  const blocks = [blk('A', 'a', '2026-05-07T10:00:00Z'), blk('B', 'b', '2026-05-07T11:00:00Z')]
  const cloud = { blocks, updatedAt: '2026-05-07T11:00:00Z' }
  const local = { blocks, updatedAt: '2026-05-07T11:00:00Z' }
  const merged = mergePages(cloud, local)
  // structural equality of blocks (timestamps may bump but blocks should match)
  eq(merged.blocks, blocks)
})

test('blockIdSet: recursive', () => {
  const blocks = [blk('A', '', '', [blk('B', '', '', [blk('C', '', '')])])]
  eq([...blockIdSet(blocks)].sort(), ['A', 'B', 'C'])
})

test('missing updatedAt fields: still merges without crashing', () => {
  const newer = [{ id: 'A', content: 'a', children: [] }]
  const older = [{ id: 'B', content: 'b', children: [] }]
  eq(mergeBlockLists(newer, older).map(b => b.id), ['A', 'B'])
})

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
