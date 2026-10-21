import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { bus, sse, tasks, readLog, toolMix, artifact, artifactDir as artifactDirOf, DATA } from './store.js'
import * as runner from './runner.js'
import * as secrets from './secrets.js'
import * as repoConfig from './repo-config.js'
import * as templates from './templates.js'
import * as settings from './settings.js'
import * as telegram from './telegram.js'
import { randomBytes } from 'node:crypto'
import { resolveRepo } from './roots.js'
import * as uploads from './uploads.js'
import * as repoGit from './git.js'
import * as disk from './disk.js'
import * as files from './files.js'
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
  '.ttf': 'font/ttf',
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
  // No git status here. It is eight git calls per repo, which on a task that
  // spans a whole workspace is a hundred processes and the better part of two
  // seconds — paid every time someone opens a conversation. The one screen
  // that needs it asks for it on its own.
  // Whether a plain-route task left files in work/: the app offers the Document route then.
  const hasOutput = task.run === 'doc' ? undefined : runner.output(id).files.length > 0
  const log = readLog(id)
  return { ...task, log, docs, hasOutput, toolMix: toolMix(log) }
}

async function api(req, res, url) {
  const [, , section, id, action, rest] = url.pathname.split('/')

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
      // Of those, how many can raise a notification. When it is zero the
      // server raises the desktop one itself.
      notifying: sse.notifiers,
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
    const notifier = url.searchParams.get('notify') !== '0'
    if (notifier) sse.notifiers++
    const beat = setInterval(() => res.write(': beat\n\n'), 25_000)
    req.on('close', () => {
      clearInterval(beat)
      sse.clients--
      if (notifier) sse.notifiers--
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

  if (section === 'files' && req.method === 'GET') {
    const repos = url.searchParams.getAll('repo').filter(Boolean)
    if (!repos.length) return json(res, 200, [])
    return json(res, 200, files.search(repos, url.searchParams.get('q')))
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

  // App-wide settings: the cost line, the phone.
  if (section === 'settings' && !id) {
    if (req.method === 'GET') return json(res, 200, settings.get())
    if (req.method === 'PUT') {
      const patch = JSON.parse((await body(req)) || '{}')
      try {
        const out = settings.set(patch)
        telegram.reload()
        return json(res, 200, out)
      } catch (err) { return json(res, 400, { error: err.message }) }
    }
  }
  if (section === 'settings' && id === 'telegram-test' && req.method === 'POST') {
    telegram.reload()
    if (!telegram.enabled()) return json(res, 400, { error: 'set the chat id and the bot token first' })
    return json(res, 200, { ok: (await telegram.send('Agent Flow is here.')) === true })
  }

  // Task templates: the form, saved. One file, whole list.
  if (section === 'templates') {
    const file = path.join(DATA, 'templates.json')
    const read = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return [] } }
    const write = (list) => { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(file, JSON.stringify(list, null, 2)) }
    if (req.method === 'GET' && !id) return json(res, 200, read())
    if (req.method === 'PUT' && !id) {
      const given = JSON.parse((await body(req)) || '{}')
      if (!String(given.name || '').trim()) return json(res, 400, { error: 'a template needs a name' })
      const list = read()
      const tpl = {
        id: list.find((t) => t.id === given.id) ? given.id : randomBytes(4).toString('hex'),
        name: String(given.name).trim(),
        prompt: String(given.prompt || ''),
        repos: Array.isArray(given.repos) ? given.repos.map(String) : [],
        run: given.run || 'ask',
        permissionMode: given.permissionMode || null,
        model: given.model || null,
        effort: given.effort || null,
      }
      const at = list.findIndex((t) => t.id === tpl.id)
      if (at >= 0) list[at] = tpl
      else list.push(tpl)
      write(list)
      return json(res, 200, tpl)
    }
    if (req.method === 'DELETE' && id) {
      const list = read()
      const left = list.filter((t) => t.id !== id)
      if (left.length === list.length) return json(res, 404, { error: 'no such template' })
      write(left)
      return json(res, 200, { id })
    }
    return json(res, 404, { error: 'not found' })
  }

  // The prompts: what every agent is told, with the person's overrides.
  if (section === 'prompts') {
    if (req.method === 'GET' && !id) {
      return json(res, 200, Object.keys(templates.KNOWN).map((name) => ({
        name,
        about: templates.ABOUT[name],
        placeholders: templates.KNOWN[name],
        default: templates.defaultOf(name),
        custom: templates.overrideOf(name),
      })))
    }
    if (!templates.KNOWN[id]) return json(res, 404, { error: `unknown prompt: ${id}` })
    const file = (n = 0) => path.join(templates.OVERRIDES_DIR, n ? `${id}.${n}.md` : `${id}.md`)
    if (req.method === 'GET' && action === 'history') {
      const kept = []
      for (const n of [1, 2, 3]) if (fs.existsSync(file(n))) kept.push({ n, text: fs.readFileSync(file(n), 'utf8') })
      return json(res, 200, kept)
    }
    if (req.method === 'PUT' && !action) {
      const { text } = JSON.parse((await body(req)) || '{}')
      if (typeof text !== 'string' || !text.trim()) return json(res, 400, { error: 'the prompt is empty' })
      const unknown = templates.placeholders(text).filter((p) => !templates.KNOWN[id].includes(p))
      if (unknown.length) {
        return json(res, 400, { error: `{{${unknown[0]}}} is not something the ${id} prompt is given. It gets: ${templates.KNOWN[id].join(', ') || 'nothing'}` })
      }
      try { templates.render(text, {}) } catch (err) { return json(res, 400, { error: err.message }) }
      fs.mkdirSync(templates.OVERRIDES_DIR, { recursive: true })
      // Keep the last three saves: .1 is the newest of them.
      if (fs.existsSync(file())) {
        for (const n of [3, 2]) if (fs.existsSync(file(n - 1))) fs.renameSync(file(n - 1), file(n))
        fs.renameSync(file(), file(1))
      }
      fs.writeFileSync(file(), text)
      return json(res, 200, { name: id, custom: text })
    }
    if (req.method === 'DELETE' && !action) {
      for (const n of [0, 1, 2, 3]) fs.rmSync(file(n), { force: true })
      return json(res, 200, { name: id, custom: null })
    }
    return json(res, 404, { error: 'not found' })
  }

  // Per-repo: where prod is and what deploys it. The token never comes back out.
  if (section === 'repos' && id === 'config') {
    const name = url.searchParams.get('repo') || ''
    let repo
    try { repo = resolveRepo(name) } catch (err) { return json(res, 400, { error: err.message }) }
    if (req.method === 'GET') return json(res, 200, repoConfig.get(repo.path))
    if (req.method === 'PUT') {
      const patch = JSON.parse((await body(req)) || '{}')
      try { return json(res, 200, repoConfig.set(repo.path, patch)) } catch (err) { return json(res, 400, { error: err.message }) }
    }
  }

  // What in this text looks like a secret: names and counts, never values.
  if (section === 'secrets' && id === 'scan' && req.method === 'POST') {
    const { text, attachments } = JSON.parse((await body(req)) || '{}')
    return json(res, 200, { found: runner.scanSecrets(String(text || ''), attachments || []) })
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
    const { request, secrets: kept, hideSecrets } = JSON.parse(await body(req))
    return json(res, 200, runner.followUp(id, request, { secrets: kept, hideSecrets }))
  }
  if (req.method === 'POST' && action === 'catch-up') {
    const { repo } = JSON.parse((await body(req)) || '{}')
    return json(res, 200, runner.catchUp(id, repo))
  }
  // The agent does it: catch up first, then fast-forward. `merge-now` is the
  // plain git merge, which refuses the moment the base has moved.
  if (req.method === 'POST' && action === 'merge') {
    const { repo, target, then } = JSON.parse((await body(req)) || '{}')
    try { return json(res, 200, runner.mergeViaAgent(id, repo, { target, then })) } catch (err) { return json(res, 400, { error: err.message }) }
  }
  if (req.method === 'POST' && action === 'merge-now') {
    const { repo } = JSON.parse((await body(req)) || '{}')
    return json(res, 200, { done: repoGit.merge(id, repo), git: repoGit.status(id) })
  }
  if (req.method === 'POST' && action === 'model') {
    const { model } = JSON.parse((await body(req)) || '{}')
    return json(res, 200, runner.setModel(id, model))
  }
  if (req.method === 'POST' && action === 'cancel') return json(res, 200, runner.cancel(id))
  if (req.method === 'POST' && action === 'retry') return json(res, 200, runner.retry(id))
  if (req.method === 'POST' && action === 'resume') return json(res, 200, runner.resume(id))
  if (req.method === 'POST' && action === 'reveal') {
    const { name } = JSON.parse((await body(req)) || '{}')
    try { return json(res, 200, runner.reveal(id, name)) } catch (err) { return json(res, err.status || 400, { error: err.message }) }
  }
  if (req.method === 'PUT' && action === 'run') {
    const { run } = JSON.parse((await body(req)) || '{}')
    try { return json(res, 200, runner.switchRun(id, run)) } catch (err) { return json(res, 400, { error: err.message }) }
  }
  // Screenshots the agent took, newest first; served by bare name only.
  if (req.method === 'GET' && action === 'shots' && !rest) {
    const dir = path.join(tasks[id]?.artifactDir || artifactDirOf(id), 'shots')
    let names = []
    try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.png')) } catch {}
    const shots = names
      .map((name) => { try { const st = fs.statSync(path.join(dir, name)); return { name, bytes: st.size, mtime: st.mtimeMs } } catch { return null } })
      .filter(Boolean)
      .sort((a, b) => b.mtime - a.mtime)
    return json(res, 200, shots)
  }
  if (req.method === 'GET' && action === 'shots' && rest) {
    const name = decodeURIComponent(rest)
    if (name !== path.basename(name) || !name.endsWith('.png')) return json(res, 400, { error: 'a png name, not a path' })
    const file = path.join(tasks[id]?.artifactDir || artifactDirOf(id), 'shots', name)
    if (!fs.existsSync(file)) return json(res, 404, { error: 'no such screenshot' })
    res.writeHead(200, { 'Content-Type': 'image/png' })
    fs.createReadStream(file).pipe(res)
    return
  }
  if (req.method === 'GET' && action === 'output' && !rest) return json(res, 200, runner.output(id))
  if (req.method === 'GET' && action === 'output' && rest) {
    let file
    try { file = runner.outputFile(id, decodeURIComponent(rest)) } catch (err) { return json(res, err.status || 400, { error: err.message }) }
    const types = { md: 'text/markdown', txt: 'text/plain', csv: 'text/csv', json: 'application/json', html: 'text/html' }
    const ext = path.extname(file).slice(1).toLowerCase()
    res.writeHead(200, { 'Content-Type': `${types[ext] || 'application/octet-stream'}${types[ext]?.startsWith('text/') || ext === 'json' ? '; charset=utf-8' : ''}` })
    fs.createReadStream(file).pipe(res)
    return
  }
  if (req.method === 'POST' && action === 'ship') {
    const { repo } = JSON.parse((await body(req)) || '{}')
    return json(res, 200, runner.shipViaAgent(id, repo))
  }
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
  const continued = runner.resumeInterrupted()
  if (continued.length) console.log(`continuing  ${continued.length} interrupted task(s)`)
  // The app has no window of its own; the window is the browser. Started from
  // a terminal, nobody asked for a tab to appear.
  if (process.env.FLOW_OPEN) {
    const open = { darwin: 'open', win32: 'explorer' }[process.platform] || 'xdg-open'
    spawn(open, [`http://127.0.0.1:${runner.PORT}`], { stdio: 'ignore', detached: true }).unref()
  }
})
