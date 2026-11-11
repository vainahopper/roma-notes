// Unit test for spliceSubtreeIntoPage. Run: node scripts/test-reference-splice.js
// Duplicates the pure logic from src/renderer/utils/helpers.ts in isolation
// (repo convention — see scripts/test-merge.js).

function spliceSubtreeIntoPage(pageBlocks, matchBlockId, editedSubtree) {
  if (!editedSubtree || editedSubtree.length === 0) return pageBlocks
  const editedIds = new Set()
  const collect = (b) => { editedIds.add(b.id); (b.children || []).forEach(collect) }
  editedSubtree.forEach(collect)

  let found = false
  function walk(list) {
    const out = []
    for (const b of list) {
      if (b.id === matchBlockId) {
        found = true
        for (const r of editedSubtree) out.push(r)
      } else if (editedIds.has(b.id)) {
        continue
      } else {
        out.push({ ...b, children: walk(b.children || []) })
      }
    }
    return out
  }
  const result = walk(pageBlocks)
  return found ? result : pageBlocks
}

let passed = 0, failed = 0
function test(name, fn) {
  try { fn(); passed++; console.log('ok  - ' + name) }
  catch (e) { failed++; console.log('FAIL - ' + name + '\n  ' + e.message) }
}
function eq(a, b) {
  const sa = JSON.stringify(a), sb = JSON.stringify(b)
  if (sa !== sb) throw new Error(`expected ${sb}\n  got      ${sa}`)
}
const blk = (id, content, children = []) => ({ id, content, children, checked: null })

test('root replaced in place, children preserved', () => {
  const page = [blk('A', 'a'), blk('M', 'm-old', [blk('C', 'c')]), blk('B', 'b')]
  const edited = [blk('M', 'm-new', [blk('C', 'c2')])]
  const out = spliceSubtreeIntoPage(page, 'M', edited)
  eq(out.map(b => b.id), ['A', 'M', 'B'])
  eq(out[1], blk('M', 'm-new', [blk('C', 'c2')]))
})

test('new sibling blocks inserted after the matched node in order', () => {
  const page = [blk('A', 'a'), blk('M', 'm'), blk('B', 'b')]
  const edited = [blk('M', 'm'), blk('N1', 'n1'), blk('N2', 'n2')]
  const out = spliceSubtreeIntoPage(page, 'M', edited)
  eq(out.map(b => b.id), ['A', 'M', 'N1', 'N2', 'B'])
})

test('nested matched block spliced at the right position', () => {
  const page = [blk('A', 'a', [blk('M', 'm'), blk('C', 'c')])]
  const edited = [blk('M', 'm2'), blk('N', 'n')]
  const out = spliceSubtreeIntoPage(page, 'M', edited)
  eq(out[0].children.map(b => b.id), ['M', 'N', 'C'])
})

test('fallback: edited[0] is not the matched id → replace position with whole array', () => {
  const page = [blk('M', 'm')]
  const edited = [blk('X', 'x'), blk('Y', 'y')]
  const out = spliceSubtreeIntoPage(page, 'M', edited)
  eq(out.map(b => b.id), ['X', 'Y'])
})

test('idempotent: re-splicing the same subtree does not duplicate new siblings', () => {
  const page = [blk('A', 'a'), blk('M', 'm'), blk('B', 'b')]
  const edited = [blk('M', 'm-edited'), blk('N', 'new bullet')]
  const once = spliceSubtreeIntoPage(page, 'M', edited)
  eq(once.map(b => b.id), ['A', 'M', 'N', 'B'])
  const twice = spliceSubtreeIntoPage(once, 'M', edited)
  eq(twice.map(b => b.id), ['A', 'M', 'N', 'B'])
  eq(twice, once)
})

test('idempotent with nested new child across re-splice', () => {
  const page = [blk('M', 'm')]
  const edited = [blk('M', 'm', [blk('K', 'kid')])]
  const once = spliceSubtreeIntoPage(page, 'M', edited)
  const twice = spliceSubtreeIntoPage(once, 'M', edited)
  eq(twice, once)
  eq(twice[0].children.map(b => b.id), ['K'])
})

test('matched id absent → input returned unchanged', () => {
  const page = [blk('A', 'a')]
  const edited = [blk('M', 'm')]
  const out = spliceSubtreeIntoPage(page, 'M', edited)
  eq(out, page)
})

test('empty edited subtree → input returned unchanged', () => {
  const page = [blk('M', 'm')]
  eq(spliceSubtreeIntoPage(page, 'M', []), page)
})

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
