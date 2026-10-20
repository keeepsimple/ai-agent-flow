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

fs.mkdirSync(bin)

// Two repos, so the check covers a feature that spans more than one.
const REPOS = ['api', 'web']
const git = (repo, ...args) =>
  execFileSync('git', ['-C', path.join(repos, repo), ...args], { encoding: 'utf8' })
for (const repo of REPOS) {
  fs.mkdirSync(path.join(repos, repo), { recursive: true })
  git(repo, 'init', '-q', '-b', 'main')
  git(repo, 'config', 'user.email', 'test@example.com')
  git(repo, 'config', 'user.name', 'Test')
  fs.writeFileSync(path.join(repos, repo, 'README.md'), `# ${repo}\n`)
  git(repo, 'add', '.')
  git(repo, 'commit', '-qm', 'init')
}

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

if (prompt.includes('SLEEPY')) {
  process.on('SIGTERM', () => {}) // ignore it, the way a real agent tree can
  fs.writeFileSync(path.join(art, 'pid'), String(process.pid))
  say('settling in')
  await new Promise((r) => setTimeout(r, 120000))
} else if (prompt.includes('Phase: write the spec')) {
  say('spec phase')
  fs.writeFileSync(path.join(art, 'argv.json'), JSON.stringify(args))
  fs.writeFileSync(path.join(art, 'prompt.txt'), prompt)
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
  for (const line of prompt.split('\\n')) {
    const match = line.match(/^\\s+worktree\\s+(\\S+)$/)
    if (!match) continue
    const tree = match[1]
    fs.writeFileSync(path.join(tree, 'impl.txt'), 'stubbed')
    execFileSync('git', ['-C', tree, 'add', '-A'])
    execFileSync('git', ['-C', tree, '-c', 'user.email=t@e.com', '-c', 'user.name=T', 'commit', '-qm', 'impl'])
  }
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
  const last = await (await fetch(`${base}/api/tasks/${id}`)).json()
  throw new Error(`timed out waiting for ${what}\nstatus=${last.status} error=${last.error}\n` +
    last.log.slice(-6).map((l) => `  [${l.kind}] ${l.text}`).join('\n'))
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
  assert.deepEqual(state.repos, REPOS, 'should discover both demo repos')

  const noRepo = await fetch(`${base}/api/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'x', repos: [], prompt: 'x' }),
  })
  assert.equal(noRepo.status, 400, 'a task with no repo should be refused')

  // A rejected model must never reach a command line, especially on Windows
  // where the child goes through cmd.exe.
  const rejected = await fetch(`${base}/api/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'bad', repos: REPOS, prompt: 'x', model: 'opus" & calc' }),
  })
  assert.equal(rejected.status, 400, 'an unknown model should be refused')
  assert.match((await rejected.json()).error, /model must be one of/)

  // A pasted image: uploaded, sniffed, then handed to the agent by path.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  )
  const uploaded = await (
    await fetch(`${base}/api/uploads`, { method: 'POST', headers: { 'X-Filename': 'figma frame.png' }, body: png })
  ).json()
  assert.match(uploaded.file, /^[0-9a-f]{8}-figma-frame\.png$/, 'the stored name should be sanitised')

  const notAnImage = await fetch(`${base}/api/uploads`, { method: 'POST', body: Buffer.from('<?php ?>') })
  assert.equal(notAnImage.status, 400, 'a non-image must be refused on its bytes, not its headers')

  const outsideUploads = await fetch(`${base}/api/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'x', repos: REPOS, prompt: 'x', images: ['/etc/passwd'] }),
  })
  assert.equal(outsideUploads.status, 400, 'an image path outside the uploads dir must be refused')

  const created = await post('/api/tasks', {
    title: 'Add a thing',
    repos: REPOS,
    prompt: 'add a thing',
    images: [uploaded.path],
    model: 'sonnet',
    effort: 'high',
  })

  let task = await waitFor(created.id, (t) => t.status === 'awaiting_approval', 'the spec gate')
  assert.equal(task.awaitingPhase, 'spec')
  assert.equal(task.docs['spec.md']?.trim(), '# spec', 'spec.md should be readable at the gate')
  assert.equal(task.trees.length, 2, 'one worktree per repo')
  for (const tree of task.trees) {
    assert.ok(fs.existsSync(tree.worktree), `${tree.repo} worktree should exist on disk`)
    assert.match(tree.branch, /^flow\/add-a-thing-/)
    assert.equal(tree.baseBranch, 'main')
  }
  assert.notEqual(task.trees[0].worktree, task.trees[1].worktree, 'the repos must not share a checkout')

  const argv = JSON.parse(fs.readFileSync(path.join(root, 'data', 'tasks', created.id, 'argv.json'), 'utf8'))
  const flag = (name) => argv[argv.indexOf(name) + 1]
  assert.equal(flag('--model'), 'sonnet', 'the chosen model should reach the CLI')
  assert.equal(flag('--effort'), 'high', 'the chosen effort should reach the CLI')
  assert.equal(flag('--permission-mode'), 'bypassPermissions', 'the default mode should reach the CLI')
  const sentPrompt = fs.readFileSync(path.join(root, 'data', 'tasks', created.id, 'prompt.txt'), 'utf8')
  assert.ok(sentPrompt.includes(uploaded.path), 'the attached image should be named in the prompt')
  assert.ok(
    argv.filter((a) => a === '--add-dir').length === 2,
    'the agent needs the artifact dir and the uploads dir',
  )
  assert.ok(!argv.includes('--permission-prompts'), 'bypassPermissions has nothing to prompt about')

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
  for (const tree of task.trees) {
    assert.match(
      git(tree.repo, 'log', '--oneline', tree.branch),
      /impl/,
      `${tree.repo} should carry its own commit`,
    )
  }

  // Dropping the checkouts must leave the work on the branches.
  await fetch(`${base}/api/tasks/${created.id}/worktree`, { method: 'DELETE' })
  task = await (await fetch(`${base}/api/tasks/${created.id}`)).json()
  assert.equal(task.root, null, 'the worktrees should be gone')
  for (const tree of task.trees) {
    assert.ok(!fs.existsSync(tree.worktree), `${tree.repo} checkout should be removed`)
    assert.match(git(tree.repo, 'log', '--oneline', tree.branch), /impl/, `${tree.repo} branch should survive`)
  }

  // Cancel has to actually stop the agent. It used to send SIGTERM to one pid,
  // leave the tree running, and the survivor could revive the task by asking.
  const sleepy = await post('/api/tasks', { title: 'SLEEPY', repos: ['api'], prompt: 'SLEEPY' })
  const pidFile = path.join(root, 'data', 'tasks', sleepy.id, 'pid')
  for (let i = 0; i < 100 && !fs.existsSync(pidFile); i++) await sleep(100)
  const pid = Number(fs.readFileSync(pidFile, 'utf8'))
  assert.doesNotThrow(() => process.kill(pid, 0), 'the stub should be running before cancel')

  await post(`/api/tasks/${sleepy.id}/cancel`)
  let stopped = false
  for (let i = 0; i < 70; i++) {
    try { process.kill(pid, 0) } catch { stopped = true; break }
    await sleep(100)
  }
  assert.ok(stopped, 'cancel must stop a process that ignores SIGTERM')

  const lateAsk = await fetch(`${base}/api/tasks/${sleepy.id}/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: 'am I still needed?',
  })
  assert.equal(lateAsk.status, 400, 'a cancelled task must not be revived by a late question')
  assert.match((await lateAsk.json()).error, /cancelled/)

  console.log(
    'ok  2 repos, 2 worktrees, both gates, blocking ask, 4 phases, per-repo commits,\n' +
    '    drop keeps branches, pasted image reaches the prompt, bad uploads refused,\n' +
    '    cancel kills a SIGTERM-ignoring tree, late ask cannot revive a dead task',
  )
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
