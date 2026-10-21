import assert from 'node:assert/strict'
process.env.FLOW_DATA = process.env.FLOW_DATA || '/tmp/agent-flow-telegram-test'
const { handleUpdate } = await import('./telegram.js')

const q = 'Q ab12cd34/9f8e7d6c: keep the old column?'
assert.deepEqual(handleUpdate({ message: { text: ' yes, keep it ', reply_to_message: { text: q } } }),
  { answered: { taskId: 'ab12cd34', questionId: '9f8e7d6c', text: 'yes, keep it' } }, 'a reply to the question answers it')
assert.deepEqual(handleUpdate({ message: { text: '9f8e7d6c drop it' } }),
  { answered: { taskId: null, questionId: '9f8e7d6c', text: 'drop it' } }, 'or a message that starts with the id')
assert.deepEqual(handleUpdate({ message: { text: 'hello?' } }), { hint: true }, 'anything else gets a hint')
assert.equal(handleUpdate({ message: { photo: [] } }), null, 'no text, nothing')
assert.equal(handleUpdate({}), null)
console.log('ok: a phone reply answers the question it replies to, nothing else')
