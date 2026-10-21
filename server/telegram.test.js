import assert from 'node:assert/strict'
process.env.FLOW_DATA = process.env.FLOW_DATA || '/tmp/agent-flow-telegram-test'
const { handleUpdate } = await import('./telegram.js')

const q = 'Q ab12cd34/9f8e7d6c: keep the old column?'
const bot = { is_bot: true }
assert.deepEqual(handleUpdate({ message: { text: ' yes, keep it ', reply_to_message: { text: q, from: bot } } }),
  { answered: { taskId: 'ab12cd34', questionId: '9f8e7d6c', text: 'yes, keep it' } }, 'a reply to the question answers it')
assert.deepEqual(handleUpdate({ message: { text: '9f8e7d6c drop it' } }),
  { answered: { taskId: null, questionId: '9f8e7d6c', text: 'drop it' } }, 'or a message that starts with the id')
assert.deepEqual(handleUpdate({ message: { text: 'hello?' } }), { hint: true }, 'anything else gets a hint')
assert.equal(handleUpdate({ message: { photo: [] } }), null, 'no text, nothing')
assert.equal(handleUpdate({}), null)
// Only the configured chat, and only replies to what the bot itself said.
assert.equal(handleUpdate({ message: { chat: { id: 99 }, text: '9f8e7d6c yes' } }, '42'), null, 'another chat is ignored outright')
assert.deepEqual(handleUpdate({ message: { chat: { id: 42 }, text: '9f8e7d6c yes' } }, '42').answered.questionId, '9f8e7d6c')
assert.deepEqual(handleUpdate({ message: { chat: { id: 42 }, text: 'B', reply_to_message: { text: q, from: { is_bot: false } } } }, '42'), { hint: true }, 'a reply to a forged question is not an answer')
// Commands: progress from the phone. A bot suffix and a Vietnamese word work too.
const cmd = (text) => handleUpdate({ message: { chat: { id: 42 }, text } }, '42')
assert.deepEqual(cmd('/status'), { command: 'status', arg: '' })
assert.deepEqual(cmd('/status@agentflow_apex_bot'), { command: 'status', arg: '' })
assert.deepEqual(cmd('tiến độ'), { command: 'status', arg: '' })
assert.deepEqual(cmd('/task a1b2c3d4'), { command: 'task', arg: 'a1b2c3d4' })
assert.deepEqual(cmd('/help'), { command: 'help', arg: '' })
assert.deepEqual(cmd('/start'), { command: 'help', arg: '' }, 'the first /start gets the commands, not a scolding')
assert.deepEqual(cmd('/nope'), { command: 'help', arg: '' }, 'an unknown command shows what there is')
assert.equal(handleUpdate({ message: { chat: { id: 99 }, text: '/status' } }, '42'), null, 'another chat still gets nothing')
console.log('ok: a phone reply answers the question it replies to, nothing else; commands are read')
