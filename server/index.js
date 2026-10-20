import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { bus, tasks, readLog, artifact } from './store.js'
import * as runner from './runner.js'

const DIST = path.join(import.meta.dirname, '..', 'web', 'dist')
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
}

const json = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

function body(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (c) => {
      data += c
      if (data.length > 1e6) reject(new Error('request body too large'))
    })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

const ARTIFACTS = ['spec.md', 'plan.md', 'review.md']

function taskView(id) {
  const task = tasks[id]
  if (!task) return null
  const docs = {}
  for (const name of ARTIFACTS) {
    const text = artifact(id, name)
    if (text) docs[name] = text
  }
  return { ...task, log: readLog(id), docs }
}

async function api(req, res, url) {
  const [, , section, id, action] = url.pathname.split('/')

  if (section === 'state' && req.method === 'GET') {
    return json(res, 200, {
      tasks: Object.values(tasks).sort((a, b) => b.createdAt - a.createdAt),
      repos: runner.listRepos(),
      repoRoot: runner.REPO_ROOT,
      options: { models: runner.MODELS, efforts: runner.EFFORTS, modes: runner.MODE_CHOICES },
      defaults: runner.DEFAULTS,
    })
  }

  if (section === 'events' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })
    res.write(': connected\n\n')
    const send = (event) => (payload) => res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`)
    const onTask = send('task')
    const onLog = send('log')
    bus.on('task', onTask)
    bus.on('log', onLog)
    const beat = setInterval(() => res.write(': beat\n\n'), 25_000)
    req.on('close', () => {
      clearInterval(beat)
      bus.off('task', onTask)
      bus.off('log', onLog)
    })
    return
  }

  if (section !== 'tasks') return json(res, 404, { error: 'not found' })

  if (req.method === 'POST' && !id) {
    const task = runner.createTask(JSON.parse(await body(req)))
    return json(res, 201, task)
  }

  if (req.method === 'GET' && id && !action) {
    const view = taskView(id)
    return view ? json(res, 200, view) : json(res, 404, { error: 'not found' })
  }

  if (!tasks[id]) return json(res, 404, { error: 'not found' })

  // ask.mjs calls this and holds the connection open until a human answers in
  // the UI. No timeout here on purpose: a decision can take as long as it takes.
  if (req.method === 'POST' && action === 'ask') {
    const question = (await body(req)).trim()
    if (!question) return json(res, 400, { error: 'question is empty' })
    const answer = await runner.askQuestion(id, question)
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
    return res.end(answer + '\n')
  }

  if (req.method === 'POST' && action === 'approve') {
    const { approved, feedback } = JSON.parse(await body(req))
    return json(res, 200, runner.approve(id, { approved, feedback }))
  }

  if (req.method === 'POST' && action === 'answer') {
    const { questionId, answer } = JSON.parse(await body(req))
    if (!answer?.trim()) return json(res, 400, { error: 'answer is empty' })
    return json(res, 200, runner.answerQuestion(id, questionId, answer.trim()))
  }

  if (req.method === 'POST' && action === 'cancel') return json(res, 200, runner.cancel(id))
  if (req.method === 'POST' && action === 'retry') return json(res, 200, runner.retry(id))
  if (req.method === 'DELETE' && action === 'worktree') return json(res, 200, runner.removeWorktree(id))

  return json(res, 404, { error: 'not found' })
}

function serveStatic(req, res, url) {
  const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1)
  const file = path.join(DIST, rel)
  // Keep path traversal out: resolve, then require the result to stay in DIST.
  const target = path.normalize(file).startsWith(DIST) && fs.existsSync(file) && fs.statSync(file).isFile()
    ? file
    : path.join(DIST, 'index.html')
  if (!fs.existsSync(target)) {
    res.writeHead(503, { 'Content-Type': 'text/plain' })
    return res.end('UI is not built yet. Run: npm run build\n')
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(target)] || 'application/octet-stream' })
  fs.createReadStream(target).pipe(res)
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  if (!url.pathname.startsWith('/api/')) return serveStatic(req, res, url)
  try {
    await api(req, res, url)
  } catch (err) {
    if (!res.headersSent) json(res, 400, { error: err.message })
  }
})

// Loopback only. This server can start an agent with permissions bypassed, so it
// has no business listening on the network.
server.listen(runner.PORT, '127.0.0.1', () => {
  console.log(`agent-flow  http://127.0.0.1:${runner.PORT}`)
  console.log(`repos       ${runner.REPO_ROOT}`)
})
