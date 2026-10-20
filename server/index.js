import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { bus, sse, tasks, readLog, artifact } from './store.js'
import * as runner from './runner.js'
import * as uploads from './uploads.js'
import * as repoGit from './git.js'
import * as disk from './disk.js'
import * as preview from './preview.js'
import * as browser from './browser.js'

const DIST = path.join(import.meta.dirname, '..', 'web', 'dist')
const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
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

function rawBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

const body = async (req) => (await rawBody(req, 1e6)).toString('utf8')

const ARTIFACTS = ['spec.md', 'plan.md', 'review.md']

function taskView(id) {
  const task = tasks[id]
  if (!task) return null
  const docs = {}
  for (const name of ARTIFACTS) {
    const text = artifact(id, name)
    if (text) docs[name] = text
  }
  return { ...task, log: readLog(id), docs, git: repoGit.status(id) }
}

async function api(req, res, url) {
  const [, , section, id, action] = url.pathname.split('/')

  if (section === 'state' && req.method === 'GET') {
    return json(res, 200, {
      tasks: Object.values(tasks).sort((a, b) => b.createdAt - a.createdAt),
      repos: runner.listRepos(),
      roots: runner.roots(),
      options: {
        models: runner.MODELS,
        efforts: runner.EFFORTS,
        modes: runner.MODE_CHOICES,
        runs: runner.RUNS,
      },
      defaults: runner.DEFAULTS,
      watching: sse.clients,
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
    const onNotify = send('notify')
    bus.on('task', onTask)
    bus.on('log', onLog)
    bus.on('notify', onNotify)
    sse.clients++
    const beat = setInterval(() => res.write(': beat\n\n'), 25_000)
    req.on('close', () => {
      clearInterval(beat)
      sse.clients--
      bus.off('task', onTask)
      bus.off('log', onLog)
      bus.off('notify', onNotify)
    })
    return
  }

  if (section === 'shopify' && req.method === 'GET') {
    const repo = url.searchParams.get('repo')
    return json(res, 200, (repo && runner.shopifyOptions(repo)) || { configs: [], stores: [] })
  }

  if (section === 'browser' && req.method === 'POST') {
    // Opens the tool's own Chrome so a human can sign in to it once.
    return json(res, 200, { ...(await browser.ensure()), profile: browser.profile() })
  }

  if (section === 'roots') {
    if (req.method === 'POST' && id === 'browse') {
      const chosen = await runner.browse()
      return json(res, 200, chosen ? { path: chosen } : { cancelled: true })
    }
    if (req.method === 'GET') return json(res, 200, { roots: runner.roots(), repos: runner.listRepos() })
    if (req.method === 'POST') {
      const { path: dir } = JSON.parse(await body(req))
      return json(res, 200, { roots: runner.addRoot(dir), repos: runner.listRepos() })
    }
    if (req.method === 'DELETE') {
      const { path: dir } = JSON.parse(await body(req))
      return json(res, 200, { roots: runner.removeRoot(dir), repos: runner.listRepos() })
    }
  }

  if (section === 'disk') {
    if (req.method === 'GET' && !id) return json(res, 200, disk.usage())
    if (req.method === 'POST' && id === 'prune') {
      return json(res, 200, { dropped: disk.prune(runner.removeWorktrees), usage: disk.usage() })
    }
  }

  if (section === 'uploads') {
    if (req.method === 'POST' && !id) {
      const saved = uploads.save(await rawBody(req, 12e6), req.headers['x-filename'] || '')
      return json(res, 201, saved)
    }
    if (req.method === 'GET' && id) {
      const file = uploads.read(decodeURIComponent(id))
      if (!file) return json(res, 404, { error: 'not found' })
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' })
      return fs.createReadStream(file).pipe(res)
    }
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

  if (req.method === 'GET' && action === 'git') return json(res, 200, repoGit.status(id))
  if (req.method === 'GET' && action === 'diff') return json(res, 200, repoGit.diff(id))
  if (req.method === 'POST' && action === 'push') {
    const { repo, base } = JSON.parse((await body(req)) || '{}')
    return json(res, 200, { done: repoGit.push(id, repo, { base }), git: repoGit.status(id) })
  }
  if (req.method === 'POST' && action === 'preview') {
    const { path: where } = JSON.parse((await body(req)) || '{}')
    return json(res, 200, await runner.preview(id, where))
  }
  if (req.method === 'POST' && action === 'follow-up') {
    const { request } = JSON.parse(await body(req))
    return json(res, 200, runner.followUp(id, request))
  }
  if (req.method === 'POST' && action === 'catch-up') {
    const { repo } = JSON.parse((await body(req)) || '{}')
    return json(res, 200, runner.catchUp(id, repo))
  }
  if (req.method === 'POST' && action === 'merge') {
    const { repo } = JSON.parse((await body(req)) || '{}')
    return json(res, 200, { done: repoGit.merge(id, repo), git: repoGit.status(id) })
  }
  if (req.method === 'POST' && action === 'cancel') return json(res, 200, runner.cancel(id))
  if (req.method === 'POST' && action === 'retry') return json(res, 200, runner.retry(id))
  if (req.method === 'DELETE' && action === 'worktree') return json(res, 200, runner.removeWorktrees(id))
  if (req.method === 'DELETE' && !action) return json(res, 200, runner.remove(id))

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
  console.log(`repos       ${runner.listRepos().length} in ${runner.roots().length} folder(s)`)
  // The app has no window of its own; the window is the browser. Started from
  // a terminal, nobody asked for a tab to appear.
  if (process.env.FLOW_OPEN) {
    const open = { darwin: 'open', win32: 'explorer' }[process.platform] || 'xdg-open'
    spawn(open, [`http://127.0.0.1:${runner.PORT}`], { stdio: 'ignore', detached: true }).unref()
  }
})
