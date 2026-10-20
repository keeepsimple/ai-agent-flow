// Check for the patch parser. Run: npm test
import assert from 'node:assert/strict'
import { parsePatch } from './diff.js'

const patch = `diff --git a/src/tax.ts b/src/tax.ts
index 1111111..2222222 100644
--- a/src/tax.ts
+++ b/src/tax.ts
@@ -12,4 +12,5 @@ export function calcTax(cart, region) {
   const lines = cart.lines;
-  const rate = RATES[region.code] ?? 0;
+  if (cart.taxExempt) return 0;
+  const rate = RATES[region.code] ?? RATES.DEFAULT;
   return subtotal * rate;
 }`

const lines = parsePatch(patch)

assert.equal(lines[0].type, 'hunk', 'the header is dropped and the hunk starts it')
assert.equal(lines[0].context, 'export function calcTax(cart, region) {')

const body = lines.slice(1)
assert.deepEqual(
  body.map((l) => l.type),
  ['ctx', 'del', 'add', 'add', 'ctx', 'ctx'],
)

// Numbering is the part that is easy to get wrong: a removed line advances only
// the old side, an added line only the new one.
assert.deepEqual(
  body.map((l) => [l.oldNo, l.newNo]),
  [
    [12, 12],
    [13, undefined],
    [undefined, 13],
    [undefined, 14],
    [14, 15],
    [15, 16],
  ],
)

assert.equal(body[1].text, '  const rate = RATES[region.code] ?? 0;', 'the marker is stripped, the indent is not')

// Two hunks reset the counters rather than carrying on.
const twoHunks = parsePatch('@@ -1,1 +1,1 @@\n a\n@@ -40,1 +50,1 @@\n b')
assert.deepEqual(twoHunks.filter((l) => l.type === 'ctx').map((l) => [l.oldNo, l.newNo]), [[1, 1], [40, 50]])

assert.deepEqual(parsePatch(''), [])
assert.deepEqual(parsePatch(null), [])
assert.deepEqual(parsePatch('diff --git a/x b/x\nindex 1..2'), [], 'a header with no hunk has nothing to show')

console.log('ok  diff: hunk headers, both line numbers, markers stripped')
