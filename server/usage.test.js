import assert from 'node:assert'
import { noteUsage } from './runner.js'

// Captured from `claude -p --output-format stream-json --verbose`, verbatim.
// Guessing these names is how the panel would silently read zero for ever.
const TURN = {
  input_tokens: 2,
  cache_creation_input_tokens: 19701,
  cache_read_input_tokens: 10816,
  output_tokens: 51,
  cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 19701 },
  service_tier: 'standard',
}

const task = { id: 'x' }
noteUsage(task, TURN)

assert.strictEqual(task.context, 2 + 19701 + 10816, 'the window holds the whole input, cached or not')
assert.deepStrictEqual(task.io, { input: 2, cacheRead: 10816, cacheWrite: 19701, output: 51 })

// A second turn adds to the totals; occupancy is the latest turn, not their sum.
noteUsage(task, { ...TURN, input_tokens: 5, cache_read_input_tokens: 30000, output_tokens: 7 })
assert.strictEqual(task.context, 5 + 19701 + 30000, 'occupancy is what this turn read')
assert.deepStrictEqual(task.io, { input: 7, cacheRead: 40816, cacheWrite: 39402, output: 58 })

noteUsage(task, undefined)
assert.strictEqual(task.context, 5 + 19701 + 30000, 'a message without usage changes nothing')

console.log('ok: usage is read off the CLI\'s own field names, totals add up, occupancy is the latest turn')
