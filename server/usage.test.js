import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Before the import: the module reads its data dir once, at load.
process.env.FLOW_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-usage-'))
const { noteUsage, noteLimits, rateLimits } = await import('./runner.js')
const { bus } = await import('./store.js')

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

// Captured from a real rate_limit_event, verbatim.
const announced = []
bus.on('limits', (l) => announced.push(l))
noteLimits({
  status: 'allowed_warning',
  rateLimitType: 'seven_day',
  utilization: 0.56,
  unifiedWindows: {
    five_hour: { utilization: 0.16, resetsAt: 1792652400 },
    seven_day: { utilization: 0.56, resetsAt: 1793149200 },
  },
})

const limits = rateLimits()
assert.strictEqual(limits.windows.seven_day.utilization, 0.56)
assert.strictEqual(limits.windows.five_hour.resetsAt, 1792652400)
assert.strictEqual(limits.status, 'allowed_warning')

// Filing it is not enough: the windows arrive on the first run of a session,
// long after a client read its state, so they go out on the stream too.
assert.strictEqual(announced.length, 1, 'the clients are told, not left to ask again')
assert.strictEqual(announced[0].windows.five_hour.utilization, 0.16)

// An event without windows must not wipe what is already known.
noteLimits({ status: 'allowed' })
assert.strictEqual(rateLimits().windows.seven_day.utilization, 0.56, 'a bare event leaves the windows alone')
assert.strictEqual(announced.length, 1, 'and says nothing about it')

// It survives a restart, which is the whole reason it is written down.
const onDisk = JSON.parse(fs.readFileSync(path.join(process.env.FLOW_DATA, 'limits.json'), 'utf8'))
assert.strictEqual(onDisk.windows.five_hour.utilization, 0.16)

console.log('ok: the account windows are read off rate_limit_event and outlive a restart')
