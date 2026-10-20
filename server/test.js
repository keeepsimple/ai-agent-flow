// One end-to-end check of the whole machine: worktree, four phases, both
// approval gates, and the agent's blocking `ask`. Run: npm test
// `claude` is stubbed, so this costs nothing and needs no network. The stub is
// plain Node behind a one-line launcher, so this runs on macOS, Linux and
// Windows alike.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, execFileSync } from 'node:child_process'

const WIN = process.platform === 'win32'
const here = import.meta.dirname
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-flow-test-'))
const repos = path.join(root, 'repos')
const bin = path.join(root, 'bin')
const PORT = 7893
const base = `http://127.0.0.1:${PORT}`

fs.mkdirSync(path.join(repos, 'demo'), { recursive: true })
fs.mkdirSync(bin)

const git = (...args) => execFileSync('git', ['-C', path.join(repos, 'demo'), ...args], { encoding: 'utf8' })
git('init', '-q', '-b', 'main')
git('config', 'user.email', 'test@example.com')
git('config', 'user.name', 'Test')
fs.writeFileSync(path.join(repos, 'demo', 'README.md'), '# demo\n')
git('add', '.')
git('commit', '-qm', 'init')

// The stub reads the prompt from stdin exactly as the real CLI does, writes the
// artifact its phase is supposed to write, and blocks on `ask` once so the
// question path is covered too.
const stub = path.join(bin, 'stub.mjs')
fs.writeFileSync(stub, `
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const args = process.argv.slice(2)
const art = args[args.indexOf('--add-dir') + 1]
let prompt = ''
process.stdin.setEncoding('utf8')
for await (const chunk of process.stdin) prompt += chunk

const say = (text) =>
  console.log(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } }))

if (prompt.includes('Phase: write the spec')) {
  say('spec phase')
  fs.writeFileSync(path.join(art, 'spec.md'), '# spec')
} else if (prompt.includes('Phase: write the implementation plan')) {
  say('plan phase')
  fs.writeFileSync(path.join(art, 'plan.md'), '# plan')
} else if (prompt.includes('Phase: implement')) {
  const ask = ${JSON.stringify(path.join(here, 'ask.mjs'))}
  const answer = execFileSync(process.execPath, [ask, 'ship the narrow version or the full one?'], {
    encoding: 'utf8',
  }).trim()
  say('human said: ' + answer)
  fs.writeFileSync('impl.txt', 'stubbed')
  execFileSync('git', ['add', '-A'])
  execFileSync('git', ['-c', 'user.email=t@e.com', '-c', 'user.name=T', 'commit', '-qm', 'impl'])
} else {
  say('review phase')
  fs.writeFileSync(path.join(art, 'review.md'), '# review')
}

console.log(JSON.stringify({
  type: 'result', subtype: 'success', is_error: false,
  result: 'ok', total_cost_usd: 0.01, num_turns: 2,
}))
`)

const launcher = path.join(bin, WIN ? 'claude.cmd' : 'claude')
fs.writeFileSync(
  launcher,
  WIN ? `@node "${stub}" %*\n` : `#!/bin/sh\nexec node "${stub}" "$@"\n`,
  { mode: 0o755 },
)

const server = spawn(process.execPath, [path.join(here, 'index.js')], {
  env: {
    ...process.env,
    FLOW_CLAUDE_BIN: launcher,
    FLOW_DATA: path.join(root, 'data'),
    FLOW_REPO_ROOT: repos,
    FLOW_PORT: String(PORT),
    FLOW_NOTIFY: 'off',
  },
  stdio: ['ignore', 'pipe', 'inherit'],
})

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function post(url, payload) {
  const res = await fetch(base + url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const text = await res.text()
  assert.ok(res.ok, `POST ${url} failed: ${res.status} ${text}`)
  return JSON.parse(text)
}

async function waitFor(id, predicate, what) {
  for (let i = 0; i < 300; i++) {
    const task = await (await fetch(`${base}/api/tasks/${id}`)).json()
    if (predicate(task)) return task
    await sleep(100)
  }
  throw new Error(`timed out waiting for ${what}`)
}

let failure = null
try {
  for (let i = 0; ; i++) {
    try { await fetch(`${base}/api/state`); break } catch {
      if (i > 50) throw new Error('server never came up')
      await sleep(100)
    }
  }

  const state = await (await fetch(`${base}/api/state`)).json()
  assert.deepEqual(state.repos, ['demo'], 'should discover the demo repo')

  const created = await post('/api/tasks', {
    title: 'Add a thing',
    repo: 'demo',
    prompt: 'add a thing',
  })

  let task = await waitFor(created.id, (t) => t.status === 'awaiting_approval', 'the spec gate')
  assert.equal(task.awaitingPhase, 'spec')
  assert.equal(task.docs['spec.md']?.trim(), '# spec', 'spec.md should be readable at the gate')
  assert.ok(fs.existsSync(task.worktree), 'worktree should exist on disk')
  assert.match(task.branch, /^flow\/add-a-thing-/)
  await post(`/api/tasks/${created.id}/approve`, { approved: true, feedback: 'keep it narrow' })

  task = await waitFor(created.id, (t) => t.awaitingPhase === 'plan', 'the plan gate')
  assert.equal(task.docs['plan.md']?.trim(), '# plan')
  await post(`/api/tasks/${created.id}/approve`, { approved: true })

  task = await waitFor(created.id, (t) => t.status === 'awaiting_answer', 'the agent to ask something')
  const question = task.questions.find((q) => q.answer === null)
  assert.match(question.text, /narrow version/)
  await post(`/api/tasks/${created.id}/answer`, { questionId: question.id, answer: 'narrow' })

  task = await waitFor(created.id, (t) => t.status === 'done' || t.status === 'failed', 'the task to finish')
  assert.equal(task.status, 'done', `task failed: ${task.error}`)
  assert.deepEqual(
    Object.fromEntries(Object.entries(task.phases).map(([k, v]) => [k, v.status])),
    { spec: 'done', plan: 'done', implement: 'done', review: 'done' },
  )
  assert.equal(task.docs['review.md']?.trim(), '# review')
  assert.ok(task.log.some((l) => l.text?.includes('human said: narrow')), 'the answer should reach the agent')
  assert.ok(task.cost > 0, 'cost should accumulate across phases')
  assert.match(git('log', '--oneline', task.branch), /impl/, 'the branch should carry the commit')

  console.log('ok  spec gate, plan gate, blocking ask, 4 phases, commit on branch')
} catch (err) {
  failure = err
} finally {
  server.kill('SIGKILL')
  await sleep(200)
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 })
}

if (failure) {
  console.error(failure)
  process.exit(1)
}
