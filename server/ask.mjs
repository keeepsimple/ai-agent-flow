// The agent runs this to ask the human something and block until they answer.
//   node ask.mjs "should this hit the live API or the cached copy?"
// FLOW_URL and FLOW_TASK_ID come from the environment the runner set up.
// Written against node:http rather than fetch because fetch times a response
// out after five minutes, and a human may take longer than that.
import http from 'node:http'

const question = process.argv.slice(2).join(' ').trim()
if (!question) {
  console.error('usage: node ask.mjs "your question"')
  process.exit(2)
}

const { FLOW_URL, FLOW_TASK_ID } = process.env
if (!FLOW_URL || !FLOW_TASK_ID) {
  console.error('ask: FLOW_URL and FLOW_TASK_ID are not set, so there is nobody to ask')
  process.exit(2)
}

const url = new URL(`/api/tasks/${FLOW_TASK_ID}/ask`, FLOW_URL)
const body = Buffer.from(question, 'utf8')

const req = http.request(
  {
    hostname: url.hostname,
    port: url.port,
    path: url.pathname,
    method: 'POST',
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': body.length },
  },
  (res) => {
    let answer = ''
    res.setEncoding('utf8')
    res.on('data', (chunk) => (answer += chunk))
    res.on('end', () => {
      if (res.statusCode !== 200) {
        console.error(`ask: server said ${res.statusCode}: ${answer.trim()}`)
        process.exit(1)
      }
      process.stdout.write(answer)
    })
  },
)

req.setTimeout(0) // a human is on the other end
req.on('error', (err) => {
  console.error(`ask: could not reach Agent Flow: ${err.message}`)
  process.exit(1)
})
req.end(body)
