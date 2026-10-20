// Check for the markdown block splitter. Run: npm test
import assert from 'node:assert/strict'
import { blocks } from './markdown.js'

const p = (src) => blocks(src).filter((b) => b.type === 'p')

// The bug this check exists for: a paragraph wrapped across source lines used to
// render as one paragraph per line.
assert.deepEqual(
  p('Judge.me already decides when\na shopper should be asked.'),
  [{ type: 'p', text: 'Judge.me already decides when a shopper should be asked.' }],
)
assert.equal(p('One.\n\nTwo.').length, 2, 'a blank line still separates paragraphs')

assert.deepEqual(blocks('## Scope'), [{ type: 'h', level: 2, text: 'Scope' }])
assert.deepEqual(blocks('Intro\n# Title'), [
  { type: 'p', text: 'Intro' },
  { type: 'h', level: 1, text: 'Title' },
])

assert.deepEqual(blocks('- one\n- two\n* three\n1. four'), [
  { type: 'ul', items: ['one', 'two', 'three', 'four'] },
])
assert.deepEqual(
  blocks('- a long item\n  that wrapped').at(0).items,
  ['a long item that wrapped'],
  'an indented line continues the item above it',
)
assert.deepEqual(blocks('Lead in\n- one\nAfter'), [
  { type: 'p', text: 'Lead in' },
  { type: 'ul', items: ['one'] },
  { type: 'p', text: 'After' },
], 'a list ends the paragraph before it and the paragraph after it stands alone')

assert.deepEqual(blocks('```json\n{ "a": 1 }\n\n{ "b": 2 }\n```'), [
  { type: 'code', text: '{ "a": 1 }\n\n{ "b": 2 }' },
], 'a blank line inside a fence stays inside it')
assert.deepEqual(blocks('```\nunclosed'), [{ type: 'code', text: 'unclosed' }])

assert.deepEqual(
  blocks('| Check | Result |\n|---|---|\n| lint | pass |\n| test | 20 passed |'),
  [{ type: 'table', head: ['Check', 'Result'], rows: [['lint', 'pass'], ['test', '20 passed']] }],
)
assert.deepEqual(
  blocks('| a | b |\n| c | d |'),
  [{ type: 'p', text: '| a | b | | c | d |' }],
  'pipes without a separator row are not a table, just two lines of one paragraph',
)
assert.deepEqual(
  blocks('| a |\n|---|\n| b |\nafter').at(-1),
  { type: 'p', text: 'after' },
  'the line after a table is not swallowed',
)

assert.deepEqual(blocks('> noted'), [{ type: 'quote', text: 'noted' }])
assert.deepEqual(blocks(''), [])
assert.deepEqual(blocks(null), [])

console.log('ok  markdown: paragraph joining, headings, lists, fences, quotes, tables')
