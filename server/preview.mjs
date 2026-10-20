// The agent runs this to see the app it just changed.
//
//   node preview.mjs                 start the app, print its URL
//   node preview.mjs /app/pricing    open that path and report what is there
//
// FLOW_URL and FLOW_TASK_ID come from the environment the runner set up.
import http from 'node:http'

const { FLOW_URL, FLOW_TASK_ID } = process.env
if (!FLOW_URL || !FLOW_TASK_ID) {
  console.error('preview: FLOW_URL and FLOW_TASK_ID are not set')
  process.exit(2)
}

const where = process.argv[2] || ''
const body = Buffer.from(JSON.stringify({ path: where }), 'utf8')
const url = new URL(`/api/tasks/${FLOW_TASK_ID}/preview`, FLOW_URL)

const req = http.request(
  {
    hostname: url.hostname,
    port: url.port,
    path: url.pathname,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': body.length },
  },
  (res) => {
    let out = ''
    res.setEncoding('utf8')
    res.on('data', (chunk) => (out += chunk))
    res.on('end', () => {
      let data
      try {
        data = JSON.parse(out)
      } catch {
        console.error(`preview: ${out.trim()}`)
        process.exit(1)
      }
      if (res.statusCode !== 200) {
        console.error(`preview: ${data.error}`)
        process.exit(1)
      }
      if (!where) {
        console.log(data.url)
        return
      }
      // The screenshot is the point: read it, do not take this text as the page.
      console.log(`url:        ${data.url}`)
      console.log(`title:      ${data.title}`)
      console.log(`screenshot: ${data.screenshot}   <- open this with Read`)
      console.log('---- visible text ----')
      console.log(data.text)
    })
  },
)

// Starting a dev server and waiting for a tunnel is minutes, not seconds.
req.setTimeout(0)
req.on('error', (err) => {
  console.error(`preview: could not reach Agent Flow: ${err.message}`)
  process.exit(1)
})
req.end(body)
