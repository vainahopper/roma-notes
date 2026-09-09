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

function pagesEqualIgnoringPageTs(a, b) {
  const stripA = { ...a }; delete stripA.updatedAt
  const stripB = { ...b }; delete stripB.updatedAt
  return JSON.stringify(stripA) === JSON.stringify(stripB)
}

// Simulates one pull iteration for the "both have content" branch:
// returns { writeLocal, pushCloud, merged } so we can assert the new behavior.
function pullStep(cloudPage, localPage) {
  const merged = mergePages(cloudPage, localPage)
  return {
    merged,
    writeLocal: !pagesEqualIgnoringPageTs(merged, localPage),
    pushCloud: !pagesEqualIgnoringPageTs(merged, cloudPage),
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

console.log('\npullStep (concurrent-edit data-loss prevention):')

test('sameSet, different per-block edits: BOTH preserved (no whole-page overwrite)', () => {
  // The hole the user worried about: Mac edits A, iPhone edits B, same ID set {A,B,C}.
  // Old code: sameSet → last-write-wins → one side lost. New code: per-block merge.
  const cloud = {
    id: '2026-05-07', title: '', isDaily: true,
    blocks: [
      blk('A', 'mac-edit-A', '2026-05-07T10:05:00Z'),
      blk('B', 'orig-B',     '2026-05-07T09:00:00Z'),
      blk('C', 'orig-C',     '2026-05-07T09:00:00Z'),
    ],
    updatedAt: '2026-05-07T10:05:00Z',
  }
  const local = {
    id: '2026-05-07', title: '', isDaily: true,
    blocks: [
      blk('A', 'orig-A',         '2026-05-07T09:00:00Z'),
      blk('B', 'iphone-edit-B',  '2026-05-07T10:06:00Z'),
      blk('C', 'orig-C',         '2026-05-07T09:00:00Z'),
    ],
    updatedAt: '2026-05-07T10:06:00Z',
  }
  const { merged, writeLocal, pushCloud } = pullStep(cloud, local)
  eq(merged.blocks.find(b => b.id === 'A').content, 'mac-edit-A')    // Mac's edit kept
  eq(merged.blocks.find(b => b.id === 'B').content, 'iphone-edit-B') // iPhone's edit kept
  eq(merged.blocks.find(b => b.id === 'C').content, 'orig-C')
  if (!writeLocal) throw new Error('expected local write (A was stale on local)')
  if (!pushCloud) throw new Error('expected cloud push (B was stale on cloud)')
})

test('sameSet, identical content: no I/O (convergence, no ping-pong)', () => {
  const blocks = [blk('A', 'a', '2026-05-07T10:00:00Z'), blk('B', 'b', '2026-05-07T11:00:00Z')]
  const cloud = { id: 'p', title: '', blocks, updatedAt: '2026-05-07T11:00:00Z' }
  const local = { id: 'p', title: '', blocks, updatedAt: '2026-05-07T11:30:00Z' } // diff page ts only
  const { writeLocal, pushCloud } = pullStep(cloud, local)
  if (writeLocal) throw new Error('expected no local write — blocks identical')
  if (pushCloud)  throw new Error('expected no cloud push — blocks identical')
})

test('cloud-only edit (local untouched): writes local, no cloud push', () => {
  const cloud = { id: 'p', title: '', blocks: [blk('A', 'updated', '2026-05-07T11:00:00Z')], updatedAt: '2026-05-07T11:00:00Z' }
  const local = { id: 'p', title: '', blocks: [blk('A', 'stale',   '2026-05-07T09:00:00Z')], updatedAt: '2026-05-07T09:00:00Z' }
  const { merged, writeLocal, pushCloud } = pullStep(cloud, local)
  eq(merged.blocks[0].content, 'updated')
  if (!writeLocal) throw new Error('expected local write')
  if (pushCloud) throw new Error('expected NO cloud push — cloud already has merged content')
})

test('local-only edit (cloud stale): pushes cloud, no local write', () => {
  const cloud = { id: 'p', title: '', blocks: [blk('A', 'stale',   '2026-05-07T09:00:00Z')], updatedAt: '2026-05-07T09:00:00Z' }
  const local = { id: 'p', title: '', blocks: [blk('A', 'updated', '2026-05-07T11:00:00Z')], updatedAt: '2026-05-07T11:00:00Z' }
  const { merged, writeLocal, pushCloud } = pullStep(cloud, local)
  eq(merged.blocks[0].content, 'updated')
  if (writeLocal) throw new Error('expected NO local write — local already has merged content')
  if (!pushCloud) throw new Error('expected cloud push')
})

test('reorder on one side + content edit on the other: both preserved', () => {
  // Mac reorders [A,B,C] → [B,A,C]. iPhone edits A's content in original order.
  // Same ID set. New per-block merge keeps Mac's order (newer page ts) AND
  // iPhone's A content (newer block ts).
  const cloud = {
    id: 'p', title: '',
    blocks: [
      blk('B', 'b', '2026-05-07T09:00:00Z'),
      blk('A', 'orig-A', '2026-05-07T09:00:00Z'),
      blk('C', 'c', '2026-05-07T09:00:00Z'),
    ],
    updatedAt: '2026-05-07T10:05:00Z', // Mac saved most recently (reorder)
  }
  const local = {
    id: 'p', title: '',
    blocks: [
      blk('A', 'iphone-A', '2026-05-07T10:00:00Z'),
      blk('B', 'b', '2026-05-07T09:00:00Z'),
      blk('C', 'c', '2026-05-07T09:00:00Z'),
    ],
    updatedAt: '2026-05-07T10:00:00Z',
  }
  const { merged } = pullStep(cloud, local)
  eq(merged.blocks.map(b => b.id), ['B', 'A', 'C']) // Mac's order (newer page ts)
  eq(merged.blocks.find(b => b.id === 'A').content, 'iphone-A') // iPhone's content (newer block ts)
})

test('convergence: after first merge, second pull is a no-op on both sides', () => {
  // Simulates: iPhone pulls and merges → pushes to cloud. Mac later pulls.
  // The Mac side now sees cloud == merged. Re-merging should be no-op.
  const cloud = { id: 'p', title: '', blocks: [blk('A', 'mac', '2026-05-07T10:00:00Z'), blk('B', 'orig', '2026-05-07T09:00:00Z')], updatedAt: '2026-05-07T10:00:00Z' }
  const local = { id: 'p', title: '', blocks: [blk('A', 'orig', '2026-05-07T09:00:00Z'), blk('B', 'iphone', '2026-05-07T10:01:00Z')], updatedAt: '2026-05-07T10:01:00Z' }
  // iPhone pulls + merges + pushes:
  const round1 = pullStep(cloud, local)
  // Cloud now has merged. Mac local is still its old cloud. Mac pulls:
  const round2 = pullStep(round1.merged, cloud)
  if (round2.pushCloud) throw new Error('round 2 should not push — cloud already has merged')
  // Mac will write merged locally (round2.writeLocal=true) → that's fine and expected.
  // Now both devices have merged. A third pull on either side:
  const round3 = pullStep(round1.merged, round1.merged)
  if (round3.writeLocal) throw new Error('round 3 should not write local — already merged')
  if (round3.pushCloud)  throw new Error('round 3 should not push cloud — already merged')
})

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
