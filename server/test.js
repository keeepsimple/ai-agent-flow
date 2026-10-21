// One end-to-end check of the whole machine: worktree, four phases, both
// approval gates, and the agent's blocking `ask`. Run: npm test
// `claude` is stubbed, so this costs nothing and needs no network. The stub is
// plain Node behind a one-line launcher, so this runs on macOS, Linux and
// Windows alike.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { spawn, execFileSync } from 'node:child_process'

const WIN = process.platform === 'win32'
const here = import.meta.dirname
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-flow-test-'))
const repos = path.join(root, 'repos')
const bin = path.join(root, 'bin')
const PORT = 7100 + Math.floor(Math.random() * 800) // not a fixed port: another server may hold it
const base = `http://127.0.0.1:${PORT}`

fs.mkdirSync(bin)

// Two repos, so the check covers a feature that spans more than one.
const REPOS = ['api', 'web']
const git = (repo, ...args) =>
  execFileSync('git', ['-C', path.join(repos, repo), ...args], { encoding: 'utf8' })
const origin = path.join(root, 'origin.git')
execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin])

for (const repo of REPOS) {
  fs.mkdirSync(path.join(repos, repo), { recursive: true })
  git(repo, 'init', '-q', '-b', 'main')
  git(repo, 'config', 'user.email', 'test@example.com')
  git(repo, 'config', 'user.name', 'Test')
  fs.writeFileSync(path.join(repos, repo, 'README.md'), `# ${repo}\n`)
  fs.mkdirSync(path.join(repos, repo, 'app', 'services'), { recursive: true })
  fs.writeFileSync(path.join(repos, repo, 'app', 'services', 'discount.server.ts'), 'x\n')
  fs.writeFileSync(path.join(repos, repo, 'app', 'discount-notes.md'), 'x\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-qm', 'init')
}
// Only 'web' gets a remote, so the no-remote path stays covered by 'api'.
git('web', 'remote', 'add', 'origin', origin)
git('web', 'push', '-q', '-u', 'origin', 'main')
// And only 'web' has a prod branch, so a repo without one stays covered too.
git('web', 'branch', 'prod')
git('web', 'push', '-q', 'origin', 'prod')

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

const session = 'stub-' + process.pid
fs.writeFileSync(path.join(art, 'prompt.txt'), prompt)
fs.writeFileSync(path.join(art, 'argv.json'), JSON.stringify(args))
if (process.env.FLOW_SECRET_EGO_API_KEY) {
  fs.writeFileSync(path.join(art, 'seen-env.txt'), process.env.FLOW_SECRET_EGO_API_KEY)
}
const say = (text) =>
  console.log(JSON.stringify({ type: 'assistant', session_id: session, message: { content: [{ type: 'text', text }] } }))

if (args.includes('--resume') && process.env.STUB_REFUSE_RESUME) {
  process.exit(1) // an expired session: the CLI says nothing and quits
} else if (args.includes('--resume')) {
  fs.writeFileSync(path.join(art, 'resumed.txt'), args[args.indexOf('--resume') + 1])
  say('picked up where I was')
} else if (prompt.includes('SLEEPY') && fs.existsSync(path.join(art, 'pid'))) {
  say('napped already, carrying on') // a fresh re-run of a task that already slept
} else if (prompt.includes('LEAKY')) {
  // An agent that wrote the value into a tracked file, against the rule.
  fs.writeFileSync('leak.txt', 'EGO_API_KEY=' + process.env.FLOW_SECRET_EGO_API_KEY)
  execFileSync('git', ['add', '-A'])
  execFileSync('git', ['commit', '-q', '-m', 'oops'])
  say('committed the config')
} else if (prompt.includes('SLEEPY')) {
  process.on('SIGTERM', () => {}) // ignore it, the way a real agent tree can
  fs.writeFileSync(path.join(art, 'pid'), String(process.pid))
  say('settling in')
  await new Promise((r) => setTimeout(r, 120000))
} else if (prompt.includes('Phase: write the spec')) {
  say('spec phase')
  fs.writeFileSync(path.join(art, 'prompt.txt'), prompt)
  if (prompt.includes('title.txt')) fs.writeFileSync(path.join(art, 'title.txt'), 'Named by the agent')
  fs.writeFileSync(path.join(art, 'spec.md'), '# spec')
} else if (prompt.includes('Phase: write the implementation plan')) {
  say('plan phase')
  fs.writeFileSync(path.join(art, 'plan.md'), '# plan')
} else if (prompt.includes('## Follow-up')) {
  for (const line of prompt.split('\\n')) {
    const match = line.match(/^\\s+worktree\\s+(\\S+)$/)
    if (!match) continue
    const where = match[1]
    fs.writeFileSync(path.join(where, 'fix.txt'), 'fixed the build ' + Date.now() + '-' + Math.random())
    execFileSync('git', ['-C', where, 'add', '-A'])
    execFileSync('git', ['-C', where, '-c', 'user.email=t@e.com', '-c', 'user.name=T', 'commit', '-qm', 'fix build'])
  }
  say('reproduced it, fixed it, checks pass')
} else if (prompt.includes('Commits to pick, oldest first:')) {
  // The ship run: cherry-pick what it was told, in order, then push prod.
  const NL = String.fromCharCode(10)
  const listed = prompt.split('Commits to pick, oldest first:' + NL)[1].split(NL + NL)[0]
  const shas = listed.split(NL).map((l) => l.trim()).filter(Boolean)
  for (const sha of shas) execFileSync('git', ['-c', 'user.email=t@e.com', '-c', 'user.name=T', 'cherry-pick', sha])
  const target = prompt.split('git push origin ')[1].split(NL)[0].trim()
  execFileSync('git', ['push', '-q', 'origin', target])
  say('picked ' + shas.length + ', checks pass, pushed ' + target)
} else if (prompt.includes('--ff-only')) {
  // The merge run: catch the branch up here, then fast-forward the base in
  // the repo itself.
  const at = (text, after, before) => text.split(after)[1].split(before)[0]
  const branch = at(prompt, ', on ', ',')
  const repoPath = at(prompt, 'git -C ', ' status --short')
  const target = at(prompt, 'put it into ', ',')
  execFileSync('git', ['-c', 'user.email=t@e.com', '-c', 'user.name=T', 'merge', target])
  execFileSync('git', ['-C', repoPath, 'merge', '--ff-only', branch])
  say('caught up, checks pass, fast-forwarded ' + target)
} else if (prompt.includes('into this branch')) {
  // Catch-up run: do the merge for real, in the worktree we were started in.
  execFileSync('git', ['-c', 'user.email=t@e.com', '-c', 'user.name=T', 'merge', 'main'])
  say('merged main in')
} else if (prompt.includes('## Phase: write the document')) {
  // The document route: no worktree, so the output goes where it was told.
  fs.writeFileSync('estimate.md', '# Estimate' + String.fromCharCode(10) + 'three days')
  fs.writeFileSync('seen-cwd.txt', process.cwd())
  say('wrote the estimate')
} else if (prompt.includes('## What the human asked')) {
  if (prompt.includes('title.txt')) fs.writeFileSync(path.join(art, 'title.txt'), 'Named on the plain route')
  say('read the code, here is the answer')
} else if (prompt.includes('Phase: implement')) {
  if (prompt.includes('title.txt')) fs.writeFileSync(path.join(art, 'title.txt'), 'Named from the build')
  const ask = ${JSON.stringify(path.join(here, 'ask.mjs'))}
  const answer = execFileSync(process.execPath, [ask, 'ship the narrow version or the full one?'], {
    encoding: 'utf8',
  }).trim()
  say('human said: ' + answer)
  for (const line of prompt.split('\\n')) {
    const match = line.match(/^\\s+worktree\\s+(\\S+)$/)
    if (!match) continue
    const tree = match[1]
    fs.writeFileSync(path.join(tree, 'impl.txt'), 'stubbed ' + Date.now() + '-' + Math.random())
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
  session_id: session,
}))
`)

const launcher = path.join(bin, WIN ? 'claude.cmd' : 'claude')
fs.writeFileSync(
  launcher,
  WIN ? `@node "${stub}" %*\n` : `#!/bin/sh\nexec node "${stub}" "$@"\n`,
  { mode: 0o755 },
)

const startServer = (extra = {}) =>
  spawn(process.execPath, [path.join(here, 'index.js')], {
    env: {
      ...process.env,
      FLOW_CLAUDE_BIN: launcher,
      FLOW_DATA: path.join(root, 'data'),
      FLOW_REPO_ROOT: repos,
      FLOW_PORT: String(PORT),
      FLOW_NOTIFY: 'off',
      ...extra,
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
let server = startServer()

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

async function up() {
  for (let i = 0; ; i++) {
    try { await fetch(`${base}/api/state`); return } catch {
      if (i > 50) throw new Error('server never came up')
      await sleep(100)
    }
  }
}

/** Kill the server (and the agent it was running) the way a crash would. */
async function restart(extra = {}) {
  await sleep(300) // the store's save is debounced; a real crash can lose that much too
  server.kill('SIGKILL')
  await sleep(300)
  server = startServer(extra)
  await up()
}

let failure = null
try {
  await up()

  const state = await (await fetch(`${base}/api/state`)).json()
  assert.deepEqual(state.repos.map((r) => r.name), REPOS, 'should discover both demo repos')

  // A repo can live under a second folder entirely. Adding one must find it,
  // and a folder with nothing to work on is a typo rather than a workspace.
  const other = path.join(root, 'elsewhere')
  fs.mkdirSync(path.join(other, 'api'), { recursive: true })
  const noRepoThere = await fetch(`${base}/api/roots`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: other }),
  })
  assert.equal(noRepoThere.status, 400, 'a folder with no repo in it is refused')
  assert.match((await noRepoThere.json()).error, /no git repo/)

  execFileSync('git', ['-C', path.join(other, 'api'), 'init', '-q', '-b', 'main'])
  fs.writeFileSync(path.join(other, 'api', 'R.md'), 'other')
  execFileSync('git', ['-C', path.join(other, 'api'), 'add', '-A'])
  execFileSync('git', [
    '-C', path.join(other, 'api'), '-c', 'user.email=t@e.com', '-c', 'user.name=T', 'commit', '-qm', 'init',
  ])
  const added = await post('/api/roots', { path: other })
  assert.equal(added.roots.length, 2, 'the second folder should be watched')
  assert.equal(added.repos.length, 3, 'and its repo found')

  // 'api' now exists in both folders, so the bare name cannot be resolved.
  const ambiguous = await fetch(`${base}/api/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repos: ['api'], prompt: 'x' }),
  })
  assert.equal(ambiguous.status, 400, 'an ambiguous name must be refused, not guessed')
  assert.match((await ambiguous.json()).error, /full path/)

  // The full path still works, and names stay unambiguous once it is gone.
  const elsewhere = await post('/api/tasks', { repos: [path.join(other, 'api')], prompt: 'quick', run: 'quick' })
  assert.equal(elsewhere.repoPaths[0], path.join(other, 'api'), 'the task should hold the real path')
  await post(`/api/tasks/${elsewhere.id}/cancel`, {})
  await post('/api/roots', { path: other }).catch(() => {})
  await fetch(`${base}/api/roots`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: other }),
  })

  // The watcher count decides who raises notifications. If it leaks, the server
  // stops raising desktop ones and a closed tab means never hearing about a run.
  assert.equal(state.watching, 0, 'nobody is watching yet')
  const watcher = new AbortController()
  const stream = await fetch(`${base}/api/events`, { signal: watcher.signal })
  for (let i = 0; i < 30; i++) {
    if ((await (await fetch(`${base}/api/state`)).json()).watching === 1) break
    await sleep(50)
  }
  assert.equal((await (await fetch(`${base}/api/state`)).json()).watching, 1, 'the stream should register')
  watcher.abort()
  await stream.body?.cancel().catch(() => {})
  for (let i = 0; i < 40; i++) {
    if ((await (await fetch(`${base}/api/state`)).json()).watching === 0) break
    await sleep(50)
  }
  assert.equal((await (await fetch(`${base}/api/state`)).json()).watching, 0, 'closing must release it')

  // Unattended has to mean unattended: a run nobody is watching must not sit
  // blocked on a question, and a task with no title gets named by the agent.
  // A quick run skips the writing entirely: two phases, no gates, same review.
  const fast = await post('/api/tasks', { repos: ['api'], prompt: 'small fix', run: 'quick' })
  assert.deepEqual(Object.keys(fast.phases), ['implement', 'review'], 'quick runs skip spec and plan')
  // No gates, but the question channel is still open: skipping the writing is
  // not the same as deciding alone.
  let fastTask = await waitFor(fast.id, (t) => t.status === 'awaiting_answer', 'the quick run to ask')
  await post(`/api/tasks/${fast.id}/answer`, { questionId: fastTask.openQuestionId, answer: 'narrow' })
  fastTask = await waitFor(fast.id, (t) => t.status === 'done' || t.status === 'failed', 'the quick run')
  assert.equal(fastTask.status, 'done', `quick run failed: ${fastTask.error}`)
  assert.ok(!fastTask.docs['spec.md'], 'no spec should have been written')
  assert.equal(fastTask.title, 'Named from the build', 'a run with no spec still names itself')
  assert.ok(fastTask.docs['review.md'], 'but the review still happens')
  assert.ok(
    !fastTask.log.some((l) => l.kind === 'decision'),
    'and there was nothing to approve on the way',
  )

  // @ in a prompt box asks this. It reads tracked files, so it never has to
  // be told to skip node_modules.
  const found = await (await fetch(`${base}/api/files?repo=api&q=discount`)).json()
  assert.deepEqual(
    found.map((f) => f.path),
    ['app/discount-notes.md', 'app/services/discount.server.ts'],
    'a match on the file name outranks one further up the path',
  )
  const everything = await (await fetch(`${base}/api/files?repo=api`)).json()
  assert.ok(
    everything.some((f) => f.path === 'README.md'),
    'and no query means the whole list',
  )
  assert.deepEqual(
    await (await fetch(`${base}/api/files?q=discount`)).json(),
    [],
    'naming no repo is not a reason to search every repo there is',
  )

  // Nothing chosen on the form means this: one run, no documents, no review.
  const plain = await post('/api/tasks', { repos: ['api'], prompt: 'what does getDiscounts return?' })
  assert.equal(plain.run, 'ask', 'an omitted run is the plain route, not the full one')
  const answered = await waitFor(plain.id, (t) => t.status === 'done' || t.status === 'failed', 'the plain run')
  assert.equal(answered.status, 'done', `plain run failed: ${answered.error}`)
  assert.deepEqual(Object.keys(answered.phases), ['answer'])
  assert.deepEqual(answered.docs, {}, 'it writes no documents')
  assert.equal(answered.title, 'Named on the plain route', 'and still names itself')

  const badRun = await fetch(`${base}/api/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repos: ['api'], prompt: 'x', run: 'whatever' }),
  })
  assert.equal(badRun.status, 400, 'an unknown run shape should be refused')

  const quiet = await post('/api/tasks', {
    repos: ['api'],
    prompt: 'just do it, nobody is watching',
    run: 'full',
    autoApprove: true,
  })
  assert.equal(quiet.title, 'just do it, nobody is watching', 'the prompt stands in until the agent names it')
  assert.equal(quiet.namedByHuman, false)
  let quietTask = await waitFor(quiet.id, (t) => t.status === 'done' || t.status === 'failed', 'the quiet run')
  assert.equal(quietTask.status, 'done', `unattended run stalled: ${quietTask.error}`)
  assert.equal(quietTask.title, 'Named by the agent', 'the spec phase should have renamed it')

  // Retrying a task with nothing left to run used to walk past every finished
  // phase and announce that it was done, which it had been for hours.
  const pointless = await fetch(`${base}/api/tasks/${quiet.id}/retry`, { method: 'POST' })
  assert.equal(pointless.status, 400)
  assert.match((await pointless.json()).error, /nothing to run again/)
  assert.equal(
    (await (await fetch(`${base}/api/tasks/${quiet.id}`)).json()).status,
    'done',
    'and it is left alone rather than queued',
  )
  assert.equal(
    quietTask.trees[0].branch,
    `flow/named-by-the-agent-${quiet.id}`,
    'and the branch should follow the name the agent gave it',
  )
  assert.doesNotThrow(
    () => git('api', 'rev-parse', '--verify', quietTask.trees[0].branch),
    'the rename has to reach git, not only the record',
  )
  assert.throws(
    () => git('api', 'rev-parse', '--verify', `flow/just-do-it-nobody-is-watching-${quiet.id}`),
    'and the name cut from the request should be gone',
  )
  assert.ok(
    quietTask.questions.every((q) => q.answer),
    'an unattended run must not leave a question hanging',
  )
  assert.ok(
    quietTask.log.some((l) => l.kind === 'answer' && l.text.includes('Nobody is available')),
    'and the agent must be told why, rather than silently blocked',
  )

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
  assert.equal(uploaded.kind, 'image')

  // A build log is the other thing worth attaching, and it is not an image.
  const log = await (
    await fetch(`${base}/api/uploads`, {
      method: 'POST',
      headers: { 'X-Filename': 'build.log' },
      body: Buffer.from('error TS2345: argument of type string\n'),
    })
  ).json()
  assert.equal(log.kind, 'text')
  assert.match(log.file, /\.log$/, 'a text file keeps the extension it came with')

  // A binary wearing a text suffix must not get in on the suffix alone.
  const liar = await fetch(`${base}/api/uploads`, {
    method: 'POST',
    headers: { 'X-Filename': 'notes.log' },
    body: Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x00, 0x01, 0x02]),
  })
  assert.equal(liar.status, 400)
  assert.match((await liar.json()).error, /not text/)

  const notAnImage = await fetch(`${base}/api/uploads`, {
    method: 'POST',
    headers: { 'X-Filename': 'thing.bin' },
    body: Buffer.from('<?php ?>'),
  })
  assert.equal(notAnImage.status, 400, 'an unknown kind is refused on its bytes, not its headers')

  const outsideUploads = await fetch(`${base}/api/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'x', repos: REPOS, prompt: 'x', attachments: ['/etc/passwd'] }),
  })
  assert.equal(outsideUploads.status, 400, 'a path outside the uploads dir must be refused')

  const created = await post('/api/tasks', {
    title: 'Add a thing',
    repos: REPOS,
    prompt: 'add a thing',
    run: 'full',
    attachments: [uploaded.path, log.path],
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
  // Every run reports its session; the task remembers the latest so an
  // interrupted run can be picked up where it stopped.
  assert.equal(task.lastSession?.kind, 'phase', 'the spec run should leave its session behind')
  assert.equal(task.lastSession.phase, 'spec')
  assert.match(task.lastSession.id, /^stub-\d+$/)
  assert.equal(task.lastSession.cwd, task.root)

  const argv = JSON.parse(fs.readFileSync(path.join(root, 'data', 'tasks', created.id, 'argv.json'), 'utf8'))
  const flag = (name) => argv[argv.indexOf(name) + 1]
  assert.equal(flag('--model'), 'sonnet', 'the chosen model should reach the CLI')
  assert.equal(flag('--effort'), 'high', 'the chosen effort should reach the CLI')
  assert.equal(flag('--permission-mode'), 'bypassPermissions', 'the default mode should reach the CLI')
  const sentPrompt = fs.readFileSync(path.join(root, 'data', 'tasks', created.id, 'prompt.txt'), 'utf8')
  assert.ok(sentPrompt.includes(uploaded.path), 'the attached image should be named in the prompt')
  assert.ok(sentPrompt.includes(log.path), 'and so should the attached log')
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
  assert.equal(task.openQuestionId, question.id, 'the server should name the live question')
  await post(`/api/tasks/${created.id}/answer`, { questionId: question.id, answer: 'narrow' })

  task = await waitFor(created.id, (t) => t.status === 'done' || t.status === 'failed', 'the task to finish')
  assert.equal(task.status, 'done', `task failed: ${task.error}`)
  assert.equal(task.openQuestionId, null, 'answering should clear the live question')
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

  // Shipping. The demo repos have no remote, so push must say so rather than
  // throw something from git, and merge must only touch a clean base branch.
  const gitState = await (await fetch(`${base}/api/tasks/${created.id}/git`)).json()
  assert.equal(gitState.length, 2)
  for (const repo of gitState) {
    assert.equal(repo.ahead, 1, `${repo.repo} should be one commit ahead`)
    assert.equal(repo.unpushed, null, 'never pushed, so there is no upstream to compare with')
    assert.equal(repo.mergeBlockedBy, null, `${repo.repo} base should be mergeable: ${repo.mergeBlockedBy}`)
  }

  // What prod is still missing, counted by patch so a hand cherry-pick counts.
  const webRow = gitState.find((r) => r.repo === 'web')
  assert.deepEqual(webRow.prod, { branch: 'prod', exists: true, toPick: 1, picked: 0, jenkins: null })
  assert.deepEqual(gitState.find((r) => r.repo === 'api').prod, { branch: 'prod', exists: false, toPick: 0, picked: 0, jenkins: null })
  const prodTmp = path.join(root, 'prod-tmp')
  git('web', 'worktree', 'add', '-q', prodTmp, 'prod')
  execFileSync('git', ['-C', prodTmp, 'cherry-pick', webRow.branch], { stdio: 'ignore' })
  git('web', 'worktree', 'remove', '--force', prodTmp)
  const picked = (await (await fetch(`${base}/api/tasks/${created.id}/git`)).json()).find((r) => r.repo === 'web')
  assert.deepEqual(picked.prod, { branch: 'prod', exists: true, toPick: 0, picked: 1, jenkins: null })

  // The diff is the thing you are being asked to approve, so it has to be
  // readable from here rather than from a terminal.
  const changes = await (await fetch(`${base}/api/tasks/${created.id}/diff`)).json()
  assert.equal(changes.length, 2, 'one entry per repo')
  const impl = changes[0].files.find((f) => f.path === 'impl.txt')
  assert.ok(impl, 'the file the task wrote should be in its diff')
  assert.equal(impl.added, 1)
  assert.equal(impl.removed, 0)
  assert.match(impl.patch, /\+stubbed/, 'with the actual lines, not just a count')

  // A generated file can be longer than anything worth reading.
  const big = path.join(root, 'data', 'worktrees', created.id, 'api')
  fs.writeFileSync(path.join(big, 'generated.txt'), 'x'.repeat(80_000))
  execFileSync('git', ['-C', big, 'add', '-A'])
  execFileSync('git', ['-C', big, '-c', 'user.email=t@e.com', '-c', 'user.name=T', 'commit', '-qm', 'generated'])
  const withBig = await (await fetch(`${base}/api/tasks/${created.id}/diff`)).json()
  const huge = withBig.find((r) => r.repo === 'api').files.find((f) => f.path === 'generated.txt')
  assert.equal(huge.patch, null, 'an enormous file is described, not shipped to the browser')
  assert.ok(huge.bytes > 60_000)

  // A finished task can be worked on again without losing what it already is:
  // same branches, same worktrees, no new task.
  await post(`/api/tasks/${created.id}/follow-up`, { request: 'the build is broken, fix it' })
  const followed = await waitFor(created.id, (t) => t.status === 'done' || t.status === 'failed', 'the follow-up')
  assert.equal(followed.status, 'done', `follow-up failed: ${followed.error}`)
  assert.equal(followed.phase, null, 'and the task goes back to what it was, not a phase that does not exist')
  for (const tree of followed.trees) {
    assert.match(git(tree.repo, 'log', '--oneline', tree.branch), /fix build/, `${tree.repo} kept its branch`)
  }
  assert.ok(
    followed.log.some((l) => l.kind === 'decision' && l.text.includes('the build is broken')),
    'the request should be in the history, not just its effect',
  )

  const empty = await fetch(`${base}/api/tasks/${created.id}/follow-up`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ request: '   ' }),
  })
  assert.equal(empty.status, 400, 'an empty follow-up should be refused')

  // The base moving on makes the merge something other than a fast-forward.
  // Catching up is an agent run in the worktree; the human's checkout is
  // untouched until they press merge themselves.
  fs.writeFileSync(path.join(repos, 'api', 'moved-on.txt'), 'someone else shipped')
  git('api', 'add', '-A')
  git('api', 'commit', '-qm', 'moved on')

  let moved = (await (await fetch(`${base}/api/tasks/${created.id}/git`)).json()).find((r) => r.repo === 'api')
  assert.equal(moved.behind, 1, 'the branch should be a commit behind its base')
  const aheadBefore = moved.ahead

  await post(`/api/tasks/${created.id}/catch-up`, { repo: 'api' })
  await waitFor(created.id, (t) => t.status === 'done', 'the catch-up to finish')
  moved = (await (await fetch(`${base}/api/tasks/${created.id}/git`)).json()).find((r) => r.repo === 'api')
  assert.equal(moved.behind, 0, 'catching up should leave nothing behind')
  // Counting absolute commits breaks every time the setup grows one; what
  // matters is that catching up added exactly the merge and nothing else.
  assert.equal(moved.ahead, aheadBefore + 1, 'catching up should add the merge commit and no more')
  assert.equal(
    git('api', 'status', '--porcelain'),
    '',
    'the human checkout must not have been touched',
  )

  const noRemote = await fetch(`${base}/api/tasks/${created.id}/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repo: 'api' }),
  })
  assert.equal(noRemote.status, 400)
  assert.match((await noRemote.json()).error, /no remote/)

  // Unrelated uncommitted work must not block the merge: having something else
  // open is the normal case, and git merges around it.
  fs.writeFileSync(path.join(repos, 'web', 'unrelated.txt'), 'in progress')
  let dirty = await (await fetch(`${base}/api/tasks/${created.id}/git`)).json()
  assert.equal(dirty.find((r) => r.repo === 'web').mergeBlockedBy, null, 'unrelated work is not a reason')
  assert.equal(dirty.find((r) => r.repo === 'web').uncommitted, 1, 'but it is still reported')
  fs.rmSync(path.join(repos, 'web', 'unrelated.txt'))

  // Uncommitted work in a file the merge would overwrite must block it, by name.
  fs.writeFileSync(path.join(repos, 'web', 'impl.txt'), 'my own edit')
  dirty = await (await fetch(`${base}/api/tasks/${created.id}/git`)).json()
  assert.match(dirty.find((r) => r.repo === 'web').mergeBlockedBy, /impl\.txt/)
  const refused = await fetch(`${base}/api/tasks/${created.id}/merge-now`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repo: 'web' }),
  })
  assert.equal(refused.status, 400, 'and the merge itself must refuse, not just the button')
  fs.rmSync(path.join(repos, 'web', 'impl.txt'))

  // Pushing the task branch, then the base branch after the merge lands on it.
  // Merging locally leaves the base ahead of its own remote, which is the step
  // the tool used to stop short of.
  await post(`/api/tasks/${created.id}/push`, { repo: 'web' })
  let web = (await (await fetch(`${base}/api/tasks/${created.id}/git`)).json()).find((r) => r.repo === 'web')
  assert.equal(web.unpushed, 0, 'the task branch should be on the remote')
  assert.equal(web.baseUnpushed, 0, 'and the base has not moved yet')

  await post(`/api/tasks/${created.id}/merge-now`, {})
  for (const repo of REPOS) {
    assert.match(git(repo, 'log', '--oneline', 'main'), /impl/, `${repo} main should have the work`)
  }

  web = (await (await fetch(`${base}/api/tasks/${created.id}/git`)).json()).find((r) => r.repo === 'web')
  assert.ok(web.baseUnpushed > 0, 'merging locally leaves the base ahead of its remote')
  await post(`/api/tasks/${created.id}/push`, { repo: 'web', base: true })
  web = (await (await fetch(`${base}/api/tasks/${created.id}/git`)).json()).find((r) => r.repo === 'web')
  assert.equal(web.baseUnpushed, 0, 'and that last step must be reachable from here')
  assert.match(
    execFileSync('git', ['-C', origin, 'log', '--oneline', 'main'], { encoding: 'utf8' }),
    /impl/,
    'the remote main should carry the work',
  )

  // Dropping one task's checkouts by hand, before the sweep takes the rest.
  await fetch(`${base}/api/tasks/${created.id}/worktree`, { method: 'DELETE' })
  task = await (await fetch(`${base}/api/tasks/${created.id}`)).json()
  assert.equal(task.root, null, 'the worktrees should be gone')
  for (const tree of task.trees) {
    assert.ok(!fs.existsSync(tree.worktree), `${tree.repo} checkout should be removed`)
    assert.match(git(tree.repo, 'log', '--oneline', tree.branch), /impl/, `${tree.repo} branch should survive`)
  }
  const afterDrop = await (await fetch(`${base}/api/tasks/${created.id}/git`)).json()
  assert.equal(afterDrop[0].ahead, 0, 'merged into the base, so there is nothing left to merge')
  assert.ok(afterDrop[0].produced > 0, 'but the task did produce commits: that is a merged branch, not an empty one')
  assert.equal(afterDrop[0].branch, task.trees[0].branch, 'the branch is still reported')

  // Running the app rewrites an app's URLs on the Partner dashboard, so which
  // app it points at must never be guessed.
  const shopTree = path.join(root, 'data', 'worktrees', fast.id, 'api')
  fs.writeFileSync(path.join(shopTree, 'shopify.app.toml'), 'name = "Live App"\nclient_id = "live123"\n')
  fs.writeFileSync(
    path.join(shopTree, 'shopify.app.demo.toml'),
    'name = "Demo App"\nclient_id = "demo456"\napplication_url = "https://demo.example.com/"\n',
  )

  const { isShopifyApp, target } = await import('./preview.js')
  assert.ok(isShopifyApp(shopTree), 'a shopify.app.toml marks the repo')
  assert.deepEqual(
    { ...target(shopTree, 'demo'), file: undefined },
    { file: undefined, name: 'Demo App', clientId: 'demo456', appUrl: 'https://demo.example.com/' },
    'the named config is what gets reported, not the default one',
  )
  assert.equal(target(shopTree, 'nope'), null)

  // The configs a repo offers come from the files beside it, and a remembered
  // dev store pairs with a config by client id.
  fs.mkdirSync(path.join(shopTree, '.shopify'), { recursive: true })
  fs.writeFileSync(
    path.join(shopTree, '.shopify', 'project.json'),
    JSON.stringify({ demo456: { dev_store_url: 'demo-store.myshopify.com' } }),
  )
  const offered = await (
    await fetch(`${base}/api/shopify?repo=${encodeURIComponent(shopTree)}`)
  ).json()
  assert.deepEqual(
    offered.configs.map((c) => [c.config, c.appName, c.store]),
    [['demo', 'Demo App', 'demo-store.myshopify.com']],
    'the active shopify.app.toml is not offered: it is the one that gets rewritten',
  )
  assert.deepEqual(offered.stores, ['demo-store.myshopify.com'])

  const ungated = await fetch(`${base}/api/tasks/${fast.id}/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  assert.equal(ungated.status, 400, 'with no config named, it must refuse to start')
  assert.match((await ungated.json()).error, /never guessed/)

  // Two ways to let go of a task, and the difference between them is the point:
  // dropping frees the disk, deleting throws the conversation away, and neither
  // touches a branch.
  // Its own task: the other checks count the ones above and this one ends by
  // deleting what it made.
  const keepsake = await (await fetch(`${base}/api/uploads`, {
    method: 'POST',
    headers: { 'X-Filename': 'keepsake.png' },
    body: png,
  })).json()
  const doomed = await post('/api/tasks', {
    repos: ['api'],
    prompt: 'throwaway',
    title: 'Đổi nút Create with AI',
    run: 'quick',
    autoApprove: true,
    attachments: [keepsake.path],
  })
  await waitFor(doomed.id, (t) => t.status === 'done' || t.status === 'failed', 'the throwaway run')

  const born = await (await fetch(`${base}/api/tasks/${doomed.id}`)).json()
  assert.equal(
    born.status,
    'done',
    `throwaway run failed: ${born.error}\n` +
      born.log.slice(-8).map((l) => `  [${l.kind}] ${(l.text || '').slice(0, 160)}`).join('\n'),
  )
  assert.deepEqual(Object.keys(born.phases), ['implement', 'review'])
  // A title the human wrote is never rewritten, so this branch is slugify's own
  // work on a request that is not in English.
  assert.equal(
    born.trees[0].branch,
    `flow/doi-nut-create-with-ai-${doomed.id}`,
    'the accents come off the letters instead of taking the letters with them',
  )
  assert.ok(born.docs['review.md'], `no review.md; docs were ${Object.keys(born.docs)}`)
  const keptLog = born.log.length
  assert.ok(keptLog > 0, 'it has a conversation to lose')

  await fetch(`${base}/api/tasks/${doomed.id}/worktree`, { method: 'DELETE' })
  let after = await (await fetch(`${base}/api/tasks/${doomed.id}`)).json()
  assert.equal(after.root, null, 'the checkout is gone')
  assert.equal(after.log.length, keptLog, 'but the conversation is not')
  assert.ok(after.docs['review.md'], 'nor the documents')

  const branch = after.trees[0].branch
  assert.match(git('api', 'log', '--oneline', branch), /impl|ok/, 'nor the branch')
  assert.ok(
    fs.existsSync(keepsake.path),
    'and not the picture that was sent with it: the conversation still shows it',
  )

  // Dropping is tidying, not finishing. Asking for one more thing has to put
  // the checkout back rather than making someone rebuild it by hand.
  await post(`/api/tasks/${doomed.id}/follow-up`, { request: 'one more thing' })
  const revived = await waitFor(doomed.id, (t) => t.status === 'done' || t.status === 'failed', 'the revived run')
  assert.equal(revived.status, 'done', `follow-up on a dropped worktree failed: ${revived.error}\n` +
    revived.log.slice(-6).map((l) => `  [${l.kind}] ${l.text || ''}`).join('\n'))
  assert.ok(revived.root && fs.existsSync(revived.root), 'the checkout is back on disk')
  assert.equal(revived.droppedAt, null, 'and the task no longer reads as dropped')
  assert.equal(revived.trees[0].branch, branch, 'on the branch it already had, not a new one')

  await fetch(`${base}/api/tasks/${doomed.id}/worktree`, { method: 'DELETE' })
  after = await (await fetch(`${base}/api/tasks/${doomed.id}`)).json()
  assert.equal(after.root, null, 'and it can be dropped again')

  const gone = await (await fetch(`${base}/api/tasks/${doomed.id}`, { method: 'DELETE' })).json()
  assert.deepEqual(gone.branches, [`api/${branch}`], 'deleting names what it is leaving behind')
  assert.equal(
    (await fetch(`${base}/api/tasks/${doomed.id}`)).status,
    404,
    'and the task is really gone, not hidden',
  )
  assert.ok(
    !fs.existsSync(path.join(root, 'data', 'logs', `${doomed.id}.jsonl`)) &&
      !fs.existsSync(path.join(root, 'data', 'tasks', doomed.id)),
    'with its log and its documents',
  )
  assert.ok(
    !fs.existsSync(keepsake.path),
    'and the picture it was sent, which nothing else was going to clean up',
  )
  assert.doesNotThrow(
    () => git('api', 'rev-parse', '--verify', branch),
    'but the branch it produced is still there',
  )

  // Disk: a worktree is a full checkout, and the one thing that must stay true
  // is that reclaiming the space never reclaims the work.
  const before = await (await fetch(`${base}/api/disk`)).json()
  const counted = before.tasks.map((t) => t.id)
  assert.ok(counted.includes(fast.id) && counted.includes(quiet.id), 'tasks with a checkout are counted')
  assert.ok(!counted.includes(created.id), 'and one already dropped is not counted twice')
  assert.ok(before.total > 0, 'the count is a real measurement')
  assert.ok(
    before.tasks.every((t) => t.reclaimable),
    'nothing is running, so all of it can go',
  )

  const pruned = await (await fetch(`${base}/api/disk/prune`, { method: 'POST' })).json()
  assert.equal(pruned.usage.total, 0, 'pruning should leave nothing behind')
  assert.equal(pruned.usage.orphans.length, 0)
  for (const repo of REPOS) {
    assert.match(git(repo, 'log', '--oneline', 'main'), /impl/, `${repo} still has the merged work`)
  }

  // Cancel has to actually stop the agent. It used to send SIGTERM to one pid,
  // leave the tree running, and the survivor could revive the task by asking.
  const sleepy = await post('/api/tasks', { title: 'SLEEPY', repos: ['api'], prompt: 'SLEEPY' })
  const pidFile = path.join(root, 'data', 'tasks', sleepy.id, 'pid')
  for (let i = 0; i < 100 && !fs.existsSync(pidFile); i++) await sleep(100)
  const pid = Number(fs.readFileSync(pidFile, 'utf8'))
  assert.doesNotThrow(() => process.kill(pid, 0), 'the stub should be running before cancel')

  // Busy is not a reason to lose what someone typed: it waits in line.
  await post(`/api/tasks/${sleepy.id}/follow-up`, { request: 'and fix the other thing' })
  const waiting = await (await fetch(`${base}/api/tasks/${sleepy.id}`)).json()
  assert.deepEqual(waiting.queued, ['and fix the other thing'])
  assert.equal(waiting.status, 'running', 'queueing must not disturb the run in front of it')
  assert.ok(
    waiting.log.some((l) => l.kind === 'decision' && l.text === 'Queued: and fix the other thing'),
    'and it shows in the conversation rather than vanishing until later',
  )

  await post(`/api/tasks/${sleepy.id}/cancel`)
  let stopped = false
  for (let i = 0; i < 70; i++) {
    try { process.kill(pid, 0) } catch { stopped = true; break }
    await sleep(100)
  }
  assert.ok(stopped, 'cancel must stop a process that ignores SIGTERM')

  // Stop means stop. The queue goes with it, and says so.
  const cancelled = await (await fetch(`${base}/api/tasks/${sleepy.id}`)).json()
  assert.deepEqual(cancelled.queued, [], 'cancelling drops what was waiting')
  assert.ok(
    cancelled.log.some((l) => l.text?.startsWith('Dropped 1 queued message')),
    'rather than letting it evaporate quietly',
  )

  const lateAsk = await fetch(`${base}/api/tasks/${sleepy.id}/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: 'am I still needed?',
  })
  assert.equal(lateAsk.status, 400, 'a cancelled task must not be revived by a late question')
  assert.match((await lateAsk.json()).error, /cancelled/)

  // Merging is the agent's job now: it catches the branch up first, which is
  // what makes the merge itself a fast-forward. `merge-now` is the plain one.
  const landing = await post('/api/tasks', {
    repos: ['api'],
    prompt: 'land me',
    run: 'quick',
    autoApprove: true, // the implement stub asks one question
  })
  await waitFor(landing.id, (t) => t.status === 'done' || t.status === 'failed', 'the run to land')
  const beforeMerge = git('api', 'rev-parse', 'main')

  await post(`/api/tasks/${landing.id}/merge`, { repo: 'api' })
  const landed = await waitFor(
    landing.id,
    (t) => t.status === 'done' || t.status === 'failed',
    'the merge run',
  )
  assert.equal(landed.status, 'done', `merge run failed: ${landed.error}`)
  assert.ok(
    landed.log.some((l) => l.kind === 'decision' && l.text.includes('merge request')),
    'the conversation should say what was asked for',
  )
  assert.notEqual(git('api', 'rev-parse', 'main'), beforeMerge, 'and main should have moved')

  // Ship: once a branch is on the base, its commits go to prod by cherry-pick,
  // in a worktree on prod, never by merging the base in. Refused when there
  // is nothing left to pick, or when the branch has not landed yet.
  const shipping = await post('/api/tasks', { repos: ['web'], prompt: 'ship me', run: 'quick', autoApprove: true })
  await waitFor(shipping.id, (t) => t.status === 'done', 'the run to ship')
  const early = await fetch(`${base}/api/tasks/${shipping.id}/ship`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repo: 'web' }),
  })
  assert.equal(early.status, 400, 'not before it has landed')
  assert.match((await early.json()).error, /land/i)
  await post(`/api/tasks/${shipping.id}/merge-now`, {})
  const prodBefore = git('web', 'rev-parse', 'prod')
  await post(`/api/tasks/${shipping.id}/ship`, { repo: 'web' })
  const shipped = await waitFor(shipping.id, (t) => t.status === 'done' || t.status === 'failed', 'the ship run')
  assert.equal(shipped.status, 'done', `ship run failed: ${shipped.error}\n` + shipped.log.slice(-6).map((l) => `  [${l.kind}] ${l.text}`).join('\n'))
  assert.ok(shipped.log.some((l) => l.kind === 'decision' && /cherry-pick/.test(l.text)), 'the conversation says what was asked')
  assert.notEqual(git('web', 'rev-parse', 'prod'), prodBefore, 'prod moved')
  assert.equal(git('web', 'rev-parse', 'prod'), execFileSync('git', ['-C', origin, 'rev-parse', 'prod'], { encoding: 'utf8' }), 'and was pushed')
  assert.ok(!git('web', 'log', '--merges', '--oneline', 'prod').trim(), 'by cherry-pick, never by merge')
  assert.ok(fs.existsSync(path.join(root, 'data', 'worktrees', shipping.id, 'web-prod')), 'in a worktree on prod')
  assert.equal(git('web', 'symbolic-ref', '--short', 'HEAD').trim(), 'main', 'the checkout was left alone')
  const shippedRow = (await (await fetch(`${base}/api/tasks/${shipping.id}/git`)).json()).find((r) => r.repo === 'web')
  assert.deepEqual(shippedRow.prod, { branch: 'prod', exists: true, toPick: 0, picked: 1, jenkins: null })
  const again = await fetch(`${base}/api/tasks/${shipping.id}/ship`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repo: 'web' }),
  })
  assert.equal(again.status, 400)
  assert.match((await again.json()).error, /nothing left to pick/)
  const noProd = await fetch(`${base}/api/tasks/${landing.id}/ship`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repo: 'api' }),
  })
  assert.equal(noProd.status, 400, 'a repo with no prod branch cannot ship')
  assert.ok(!fs.existsSync(path.join(root, 'data', 'worktrees', landing.id, 'api-prod')), 'and no worktree was made for it')

  // The deploy watcher: waits for a build newer than the one it found, then
  // for it to finish, and says how it went. It runs as a child because the
  // fake Jenkins lives in this process and has to be free to answer.
  let jenkinsHits = 0
  let jenkinsMode = 'ok' // ok | fail | stuck
  const jenkins = http.createServer((req, res) => {
    jenkinsHits++
    if (req.url.endsWith('/consoleText')) return res.end('line one\nline two\nBUILD FAILED\n')
    assert.equal(req.headers.authorization, 'Basic ' + Buffer.from('ci:tok').toString('base64'))
    if (jenkinsMode === 'stuck') return res.end(JSON.stringify({ number: 7, building: false, result: 'SUCCESS' }))
    const number = jenkinsHits === 1 ? 7 : 8
    const building = jenkinsHits === 2
    res.end(JSON.stringify({ number, building, result: building ? null : jenkinsMode === 'fail' ? 'FAILURE' : 'SUCCESS' }))
  })
  await new Promise((r) => jenkins.listen(0, '127.0.0.1', r))
  const jurl = `http://127.0.0.1:${jenkins.address().port}`
  const watch = (extra = {}) =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, [path.join(here, 'jenkins.mjs'), jurl, 'web-prod'], {
        env: { ...process.env, FLOW_JENKINS_USER: 'ci', FLOW_JENKINS_TOKEN: 'tok', FLOW_JENKINS_POLL_MS: '20', ...extra },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let out = ''
      child.stdout.on('data', (d) => { out += d })
      child.stderr.on('data', (d) => { out += d })
      child.on('close', (code) => resolve({ code, out }))
    })
  const good = await watch()
  assert.equal(good.code, 0, good.out)
  assert.match(good.out, /#8: SUCCESS/)
  assert.equal(jenkinsHits, 3, 'found #7, saw #8 building, saw #8 finish')
  jenkinsHits = 0
  jenkinsMode = 'fail'
  const bad = await watch()
  assert.equal(bad.code, 1, bad.out)
  assert.match(bad.out, /#8: FAILURE/)
  assert.match(bad.out, /BUILD FAILED/, 'the console tail is in the report')
  jenkinsHits = 0
  jenkinsMode = 'stuck'
  const never = await watch({ FLOW_JENKINS_START_MS: '60', FLOW_JENKINS_POLL_MS: '30' })
  assert.equal(never.code, 2, never.out)
  assert.match(never.out, /no new build/i)
  jenkins.closeAllConnections()
  jenkins.close()
  assert.equal(
    git('api', 'rev-parse', 'main'),
    git('api', 'rev-parse', landed.trees[0].branch),
    'to exactly the branch, because a fast-forward writes no merge commit',
  )

  console.log(
    'ok  2 repos, 2 worktrees, both gates, blocking ask, 4 phases, per-repo commits,\n' +
    '    drop keeps branches, pasted image reaches the prompt, bad uploads refused,\n' +
    '    cancel kills a SIGTERM-ignoring tree, late ask cannot revive a dead task,\n' +
    '    push needs a remote, merge refuses a clashing edit and lands on a clean base,\n' +
    '    catch-up merges the base in from the worktree without touching the checkout,\n' +
    '    push covers the task branch and the base branch after it is merged,\n' +
    '    unattended answers its own questions and the agent names an untitled task,\n' +
    '    the branch follows that name and a request in Vietnamese still slugs readably,\n' +
    '    retrying a finished task is refused rather than silently repeated,\n' +
    '    merging is an agent run that catches up first and fast-forwards,\n' +
    '    a message typed mid-run waits in line, and cancelling drops it out loud,\n' +
    '    @ finds a tracked file, name matches first,\n' +
    '    choosing no run shape is the plain one: no documents, no review,\n' +
    '    a quick run skips spec and plan but still reviews itself,\n' +
    '    a finished task takes a follow-up on the same branches,\n' +
    '    an attached log reaches the prompt and a binary in a .log is refused,\n' +
    '    the diff is readable from the app and an enormous file is only described,\n' +
    '    reclaiming worktree space never reclaims the work,\n' +
    '    a second folder can be added and an ambiguous repo name is refused,\n' +
    '    dropping keeps the conversation and its pictures, deleting takes both,\n' +
    '    a follow-up on a dropped task checks the same branch back out,\n' +
    '    running the app refuses until the config it may repoint is named,\n' +
    '    and the configs offered come from the repo, paired with their dev stores',
  )

  // Secrets: named on the task, valued only in the agent's shell.
  process.env.FLOW_DATA = path.join(root, 'data')
  const secrets = await import('./secrets.js')
  const scan = await post('/api/secrets/scan', {
    text: 'EGO_API_KEY=ck_test_value_1234567890 and glpat-ABCDEFGHIJKLMNOPQRST',
  })
  assert.deepEqual(scan.found.map((f) => f.name), ['EGO_API_KEY', 'SECRET_1'])
  assert.ok(!JSON.stringify(scan).includes('ck_test_value'), 'scan names what it found, never the value')

  const envNote = await (
    await fetch(`${base}/api/uploads`, {
      method: 'POST',
      headers: { 'X-Filename': 'notes.txt' },
      body: Buffer.from('EGO_API_KEY=ck_test_value_1234567890\n'),
    })
  ).json()
  const hush = await post('/api/tasks', {
    title: 'hush',
    repos: ['api'],
    run: 'ask',
    prompt: 'set EGO_API_KEY={{secret:EGO_API_KEY}} in .env.dev',
    attachments: [envNote.path],
    secrets: [{ name: 'EGO_API_KEY', value: 'ck_test_value_1234567890' }],
  })
  assert.deepEqual(hush.secrets, ['EGO_API_KEY'], 'the task carries names only')
  await waitFor(hush.id, (t) => t.status === 'done', 'the secret task')
  await sleep(300) // the store's save is debounced
  const hushArt = path.join(root, 'data', 'tasks', hush.id)
  assert.equal(fs.readFileSync(path.join(hushArt, 'seen-env.txt'), 'utf8'), 'ck_test_value_1234567890', 'the value reaches the shell')
  assert.match(fs.readFileSync(path.join(hushArt, 'prompt.txt'), 'utf8'), /\$FLOW_SECRET_EGO_API_KEY/, 'and the prompt says where')
  assert.ok(!fs.readFileSync(path.join(root, 'data', 'tasks.json'), 'utf8').includes('ck_test_value'), 'never in tasks.json')
  assert.ok(!fs.readFileSync(path.join(root, 'data', 'logs', `${hush.id}.jsonl`), 'utf8').includes('ck_test_value'), 'never in the log')
  assert.equal(fs.readFileSync(envNote.path, 'utf8'), 'EGO_API_KEY={{secret:EGO_API_KEY}}\n', 'a text attachment is rewritten too')
  assert.equal(secrets.read(hush.id, 'EGO_API_KEY'), 'ck_test_value_1234567890')

  await post(`/api/tasks/${hush.id}/follow-up`, {
    request: 'and OTHER_TOKEN={{secret:OTHER_TOKEN}}',
    secrets: [{ name: 'OTHER_TOKEN', value: 'tok-abcdefgh12345' }],
  })
  const hushMore = await waitFor(hush.id, (t) => t.status === 'done' && t.phase === null, 'the secret follow-up')
  assert.deepEqual(hushMore.secrets, ['EGO_API_KEY', 'OTHER_TOKEN'], 'a follow-up adds to the names')

  // Edits only has no shell, so the prompt says the values cannot be used.
  const noShell = await post('/api/tasks', {
    title: 'noshell', repos: ['api'], run: 'ask', permissionMode: 'acceptEdits',
    prompt: 'set {{secret:EGO_API_KEY}}',
    secrets: [{ name: 'EGO_API_KEY', value: 'ck_test_value_1234567890' }],
  })
  await waitFor(noShell.id, (t) => t.status === 'done', 'the no-shell task')
  assert.match(fs.readFileSync(path.join(root, 'data', 'tasks', noShell.id, 'prompt.txt'), 'utf8'), /no shell/i)

  await fetch(`${base}/api/tasks/${hush.id}`, { method: 'DELETE' })
  await fetch(`${base}/api/tasks/${noShell.id}`, { method: 'DELETE' })
  assert.equal(secrets.read(hush.id, 'EGO_API_KEY'), null, 'deleting the task forgets its secrets')
  assert.equal(secrets.read(hush.id, 'OTHER_TOKEN'), null)
  // The guard: a diff that carries a kept value, or anything shaped like a
  // secret, does not get pushed — by the button or by the agent.
  const leaky = await post('/api/tasks', {
    title: 'leaky', repos: ['web'], run: 'ask', prompt: 'LEAKY',
    secrets: [{ name: 'EGO_API_KEY', value: 'ck_test_value_1234567890' }],
  })
  const leaked = await waitFor(leaky.id, (t) => t.status === 'done', 'the leaky task')
  const refusedPush = await fetch(`${base}/api/tasks/${leaky.id}/push`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repo: 'web' }),
  })
  assert.equal(refusedPush.status, 400, 'a diff with a secret in it is not pushed')
  assert.match((await refusedPush.json()).error, /leak\.txt:1/)
  const leakTree = leaked.trees[0]
  assert.throws(
    () => execFileSync(process.execPath, [path.join(here, 'guard-secrets.mjs'), leakTree.repoPath, leakTree.baseBranch, leakTree.branch], {
      env: { ...process.env, FLOW_SECRET_EGO_API_KEY: 'ck_test_value_1234567890' },
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
    (err) => err.status === 1 && /leak\.txt:1/.test(String(err.stderr)),
    'the guard the agent runs says the same, with the file and line',
  )
  await fetch(`${base}/api/tasks/${leaky.id}`, { method: 'DELETE' })

  // The form's way: it asks "keep these out of the transcript?" and, on yes,
  // sends the text as typed with hideSecrets. The server finds, keeps and
  // redacts, so the values never make a second trip.
  const cleanNote = await (
    await fetch(`${base}/api/uploads`, {
      method: 'POST', headers: { 'X-Filename': 'clean.txt' }, body: Buffer.from('nothing secret here\n'),
    })
  ).json()
  const scanned = await post('/api/secrets/scan', { text: 'nothing here', attachments: [cleanNote.path] })
  assert.deepEqual(scanned.found, [], 'a clean prompt and attachment find nothing')
  const rawNote = await (
    await fetch(`${base}/api/uploads`, {
      method: 'POST', headers: { 'X-Filename': 'raw.txt' }, body: Buffer.from('SMTP_TOKEN=abcdefgh12345678\n'),
    })
  ).json()
  const scanned2 = await post('/api/secrets/scan', { text: 'plain', attachments: [rawNote.path] })
  assert.deepEqual(scanned2.found.map((f) => f.name), ['SMTP_TOKEN'], 'attachments are scanned too')
  const hidden = await post('/api/tasks', {
    title: 'hidden', repos: ['api'], run: 'ask',
    prompt: 'set EGO_API_KEY=ck_test_value_1234567890 in .env.dev',
    attachments: [rawNote.path],
    hideSecrets: true,
  })
  assert.equal(hidden.prompt, 'set EGO_API_KEY={{secret:EGO_API_KEY}} in .env.dev')
  assert.deepEqual(hidden.secrets, ['EGO_API_KEY', 'SMTP_TOKEN'])
  assert.equal(fs.readFileSync(rawNote.path, 'utf8'), 'SMTP_TOKEN={{secret:SMTP_TOKEN}}\n')
  await waitFor(hidden.id, (t) => t.status === 'done', 'the hidden task')
  assert.equal(fs.readFileSync(path.join(root, 'data', 'tasks', hidden.id, 'seen-env.txt'), 'utf8'), 'ck_test_value_1234567890')
  assert.equal(secrets.read(hidden.id, 'SMTP_TOKEN'), 'abcdefgh12345678')
  await post(`/api/tasks/${hidden.id}/follow-up`, { request: 'also glpat-ABCDEFGHIJKLMNOPQRST', hideSecrets: true })
  const hiddenMore = await waitFor(hidden.id, (t) => t.status === 'done' && t.phase === null, 'the hidden follow-up')
  assert.ok(hiddenMore.log.some((l) => l.text === 'Follow-up: also {{secret:SECRET_1}}'), 'the follow-up is logged redacted')
  assert.deepEqual(hiddenMore.secrets, ['EGO_API_KEY', 'SMTP_TOKEN', 'SECRET_1'])
  await fetch(`${base}/api/tasks/${hidden.id}`, { method: 'DELETE' })
  console.log('ok: secrets are named on the task, valued only in the shell, and forgotten with it,\n' +
    '    and a diff that carries one is refused by the push button and by the guard')

  // Per-repo config: where prod is, and how to watch its deploy. The Jenkins
  // token goes to the keychain, and never comes back out through the API.
  const cfg0 = await (await fetch(`${base}/api/repos/config?repo=api`)).json()
  assert.deepEqual(cfg0, { prodBranch: 'prod', jenkins: null, hasJenkinsToken: false })
  const putCfg = await fetch(`${base}/api/repos/config?repo=api`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prodBranch: 'release', jenkins: { url: 'http://j', job: 'api-prod', user: 'ci' }, jenkinsToken: 't' }),
  })
  assert.ok(putCfg.ok, 'config saved')
  const cfg1 = await (await fetch(`${base}/api/repos/config?repo=api`)).json()
  assert.deepEqual(cfg1, { prodBranch: 'release', jenkins: { url: 'http://j', job: 'api-prod', user: 'ci' }, hasJenkinsToken: true })
  assert.equal(secrets.read('repo:' + path.join(repos, 'api'), 'JENKINS_TOKEN'), 't')
  assert.ok(!fs.readFileSync(path.join(root, 'data', 'repos.json'), 'utf8').includes('"t"'), 'the token is not in the file')
  const badCfg = await fetch(`${base}/api/repos/config?repo=nope`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}' })
  assert.equal(badCfg.status, 400)
  secrets.forget('repo:' + path.join(repos, 'api'), ['JENKINS_TOKEN'])
  console.log('ok: a repo remembers its prod branch and Jenkins job, with the token in the keychain')

  // Prompts: every one the agents are told is listed, editable, and reset-able.
  // An override that names a placeholder the prompt is not given is refused.
  const promptList = await (await fetch(`${base}/api/prompts`)).json()
  assert.equal(promptList.length, 14)
  const answerEntry = promptList.find((p) => p.name === 'answer')
  assert.ok(answerEntry.default.includes('What the human asked'))
  assert.equal(answerEntry.custom, null)
  assert.deepEqual(answerEntry.placeholders, ['preamble', 'prompt', 'workDir', 'titleAsk'])
  assert.ok(answerEntry.about.length > 10)
  const putPrompt = (text) => fetch(`${base}/api/prompts/answer`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }),
  })
  const badPrompt = await putPrompt('hello {{nope}}')
  assert.equal(badPrompt.status, 400)
  assert.match((await badPrompt.json()).error, /nope/)
  for (const v of ['v1', 'v2', 'v3']) assert.ok((await putPrompt(`OVERRIDE ${v} {{preamble}}\n\n## What the human asked\n\n{{prompt}}`)).ok)
  assert.ok((await putPrompt('OVERRIDE v4 {{preamble}}\n\n## What the human asked\n\n{{prompt}}')).ok)
  const history = await (await fetch(`${base}/api/prompts/answer/history`)).json()
  assert.deepEqual(history.map((h) => h.text.slice(0, 11)), ['OVERRIDE v3', 'OVERRIDE v2', 'OVERRIDE v1'], 'the last three saves, newest first')
  const told = await post('/api/tasks', { title: 'told', repos: ['api'], run: 'ask', prompt: 'plain question' })
  await waitFor(told.id, (t) => t.status === 'done', 'the overridden run')
  assert.match(fs.readFileSync(path.join(root, 'data', 'tasks', told.id, 'prompt.txt'), 'utf8'), /^OVERRIDE v4 You are running/, 'the agent gets the override')
  assert.equal((await fetch(`${base}/api/prompts/answer`, { method: 'DELETE' })).status, 200)
  const afterReset = (await (await fetch(`${base}/api/prompts`)).json()).find((p) => p.name === 'answer')
  assert.equal(afterReset.custom, null, 'reset drops the override')
  const told2 = await post('/api/tasks', { title: 'told2', repos: ['api'], run: 'ask', prompt: 'plain question' })
  await waitFor(told2.id, (t) => t.status === 'done', 'the default run')
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'data', 'tasks', told2.id, 'prompt.txt'), 'utf8'), /OVERRIDE/)
  assert.equal((await fetch(`${base}/api/prompts/nothing`)).status, 404)
  console.log('ok: prompts are listed, overridden with a check, kept three deep, and reset')

  // The document route: no worktree, the repos there to read, the output in
  // a folder of its own under the task.
  const docRun = (await (await fetch(`${base}/api/state`)).json()).options.runs.find((r) => r.value === 'doc')
  assert.ok(docRun, 'the route is offered')
  assert.equal(docRun.label, 'Document')
  const doc = await post('/api/tasks', { title: 'estimate', repos: ['api'], run: 'doc', prompt: 'estimate the migration' })
  const written = await waitFor(doc.id, (t) => t.status === 'done' || t.status === 'failed', 'the document run')
  assert.equal(written.status, 'done', `document run failed: ${written.error}`)
  assert.deepEqual(written.trees, [], 'no branches')
  assert.ok(!fs.existsSync(path.join(root, 'data', 'worktrees', doc.id)), 'no worktree')
  assert.ok(written.root.endsWith(`${path.sep}work`), 'runs in the task folder')
  const workDir = path.join(root, 'data', 'tasks', doc.id, 'work')
  assert.equal(fs.readFileSync(path.join(workDir, 'seen-cwd.txt'), 'utf8'), fs.realpathSync(workDir))
  assert.match(fs.readFileSync(path.join(workDir, 'estimate.md'), 'utf8'), /three days/)
  const docPrompt = fs.readFileSync(path.join(root, 'data', 'tasks', doc.id, 'prompt.txt'), 'utf8')
  assert.match(docPrompt, new RegExp(path.join(repos, 'api').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'the repo is named, to read')
  assert.match(docPrompt, /do not modify\s+anything under/i)
  const docArgv = JSON.parse(fs.readFileSync(path.join(root, 'data', 'tasks', doc.id, 'argv.json'), 'utf8'))
  assert.ok(docArgv.includes(path.join(repos, 'api')), 'and reachable: --add-dir for each repo')
  assert.equal((await fetch(`${base}/api/tasks/${doc.id}/git`)).status, 200)
  assert.deepEqual(await (await fetch(`${base}/api/tasks/${doc.id}/git`)).json(), [], 'nothing to land')
  // Its output: listed newest first, readable, capped, and nothing outside it.
  const out1 = await (await fetch(`${base}/api/tasks/${doc.id}/output`)).json()
  assert.deepEqual(out1.files.map((f) => f.name).sort(), ['estimate.md', 'seen-cwd.txt'])
  assert.equal(out1.truncated, false)
  assert.ok(out1.files.every((f) => typeof f.bytes === 'number' && typeof f.mtime === 'number'))
  const estimate = await fetch(`${base}/api/tasks/${doc.id}/output/estimate.md`)
  assert.equal(estimate.status, 200)
  assert.match(estimate.headers.get('content-type'), /^text\/markdown/)
  assert.match(await estimate.text(), /three days/)
  assert.equal((await fetch(`${base}/api/tasks/${doc.id}/output/%2e%2e%2fprompt.txt`)).status, 400, 'no reaching out of work/')
  assert.equal((await fetch(`${base}/api/tasks/${doc.id}/output/nothing.md`)).status, 404)
  for (let i = 0; i < 205; i++) fs.writeFileSync(path.join(workDir, `f${String(i).padStart(3, '0')}.txt`), 'x')
  const out2 = await (await fetch(`${base}/api/tasks/${doc.id}/output`)).json()
  assert.equal(out2.files.length, 200, 'capped')
  assert.equal(out2.truncated, true, 'and says so')
  assert.equal(written.hasOutput, undefined, 'the flag is for the other routes')

  // A plain-route task is told where a document goes, and one that wrote one
  // is offered the Document route: the switch only changes the route.
  assert.match(fs.readFileSync(path.join(root, 'data', 'tasks', told2.id, 'prompt.txt'), 'utf8'), /work/, 'the answer prompt names the work folder')
  assert.equal((await (await fetch(`${base}/api/tasks/${told2.id}`)).json()).hasOutput, false)
  fs.mkdirSync(path.join(root, 'data', 'tasks', told2.id, 'work'), { recursive: true })
  fs.writeFileSync(path.join(root, 'data', 'tasks', told2.id, 'work', 'notes.md'), '# notes')
  assert.equal((await (await fetch(`${base}/api/tasks/${told2.id}`)).json()).hasOutput, true)
  const badSwitch = await fetch(`${base}/api/tasks/${told2.id}/run`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ run: 'quick' }) })
  assert.equal(badSwitch.status, 400)
  const switched = await fetch(`${base}/api/tasks/${told2.id}/run`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ run: 'doc' }) })
  assert.equal(switched.status, 200)
  const nowDoc = await (await fetch(`${base}/api/tasks/${told2.id}`)).json()
  assert.equal(nowDoc.run, 'doc')
  assert.ok(nowDoc.root && !nowDoc.root.endsWith('work'), 'the worktree stays until dropped')
  assert.deepEqual((await (await fetch(`${base}/api/tasks/${told2.id}/output`)).json()).files.map((f) => f.name), ['notes.md'])
  console.log('ok: the document route writes a file, checks nothing out, and can read the repos,\n' +
    '    its output is listed and served from work/ only, and a plain task that wrote one can switch')

  // ---- From here on the server is restarted; nothing above may follow. ----

  // A crash mid-run used to fail the task, and the only way on was to prompt
  // again from the last message. The run has a session; keep it and continue it.
  const napping = await post('/api/tasks', { title: 'nap', repos: ['api'], prompt: 'SLEEPY', run: 'ask' })
  const napPid = path.join(root, 'data', 'tasks', napping.id, 'pid')
  for (let i = 0; i < 100 && !fs.existsSync(napPid); i++) await sleep(100)
  await waitFor(napping.id, (t) => t.lastSession?.id, 'the session to be reported')
  await restart({ FLOW_AUTO_RESUME: '0' })
  try { process.kill(Number(fs.readFileSync(napPid, 'utf8')), 'SIGKILL') } catch {} // the orphan

  let woke = await (await fetch(`${base}/api/tasks/${napping.id}`)).json()
  assert.equal(woke.status, 'interrupted', 'a run cut off by a restart is interrupted, not failed: ' + woke.error + ' ' + JSON.stringify(woke.lastSession))
  assert.equal(woke.lastSession.phase, 'answer')
  assert.match(woke.error || '', /interrupted/i)

  const hadSession = woke.lastSession.id
  await post(`/api/tasks/${napping.id}/resume`)
  woke = await waitFor(napping.id, (t) => t.status === 'done', 'the resumed run to finish')
  const resumedWith = path.join(root, 'data', 'tasks', napping.id, 'resumed.txt')
  assert.ok(fs.existsSync(resumedWith), 'continuing must call the CLI with --resume')
  assert.equal(fs.readFileSync(resumedWith, 'utf8'), hadSession, 'and hand it the session it had')
  assert.notEqual(woke.lastSession.id, hadSession, 'the continued run reports a session of its own, kept too')

  // By default the app picks interrupted work up on launch without being asked.
  // And a session the CLI refuses is run again fresh, saying so.
  const nap2 = await post('/api/tasks', { title: 'nap2', repos: ['api'], prompt: 'SLEEPY', run: 'ask' })
  const nap2Pid = path.join(root, 'data', 'tasks', nap2.id, 'pid')
  for (let i = 0; i < 100 && !fs.existsSync(nap2Pid); i++) await sleep(100)
  await waitFor(nap2.id, (t) => t.lastSession?.id, 'the second session to be reported')
  await restart({ STUB_REFUSE_RESUME: '1' })
  try { process.kill(Number(fs.readFileSync(nap2Pid, 'utf8')), 'SIGKILL') } catch {}
  const rerun = await waitFor(nap2.id, (t) => t.status === 'done', 'auto-resume to finish')
  assert.ok(
    rerun.log.some((l) => l.text === 'resume refused; running the phase again'),
    'a refused session falls back to a fresh run and says so',
  )
  assert.ok(!fs.existsSync(path.join(root, 'data', 'tasks', nap2.id, 'resumed.txt')))
  assert.ok(rerun.log.some((l) => l.text === 'napped already, carrying on'), 'the fresh run completed the phase')

  // "tiếp tục" on a task that has a session continues it rather than opening a new run.
  await restart()
  await post(`/api/tasks/${napping.id}/follow-up`, { request: 'tiếp tục' })
  const carried = await waitFor(napping.id, (t) => t.status === 'done' && t.phase === null, 'continue to finish')
  assert.equal(fs.readFileSync(resumedWith, 'utf8'), woke.lastSession.id, '"tiếp tục" resumes the last session')
  assert.ok(carried.log.some((l) => l.text === 'picked up where I was'))

  // A machine that slept does not kill the agent, but the CLI's connection may
  // not survive it. After a sleep, a run that has gone quiet counts as
  // interrupted too. The thresholds are tunable so the test can be quick.
  await restart({ FLOW_WATCHDOG_MS: '200', FLOW_SLEEP_JUMP_MS: '0', FLOW_SILENT_MS: '500' })
  const dozy = await post('/api/tasks', { title: 'dozy', repos: ['api'], prompt: 'SLEEPY', run: 'ask' })
  const dozyPid = path.join(root, 'data', 'tasks', dozy.id, 'pid')
  for (let i = 0; i < 100 && !fs.existsSync(dozyPid); i++) await sleep(100)
  const dozed = await waitFor(dozy.id, (t) => t.status === 'interrupted', 'the watchdog to notice')
  assert.ok(dozed.lastSession?.id, 'the session survives the interruption')
  let dozyGone = false
  for (let i = 0; i < 70; i++) {
    try { process.kill(Number(fs.readFileSync(dozyPid, 'utf8')), 0) } catch { dozyGone = true; break }
    await sleep(100)
  }
  assert.ok(dozyGone, 'the stalled agent is stopped, not left running blind')

  // Dropping the worktree of an interrupted task is allowed, and continuing it
  // checks the branch back out before the session resumes.
  await restart({ FLOW_AUTO_RESUME: '0' })
  await fetch(`${base}/api/tasks/${dozy.id}/worktree`, { method: 'DELETE' }).then((r) => assert.ok(r.ok, 'drop allowed'))
  assert.equal((await (await fetch(`${base}/api/tasks/${dozy.id}`)).json()).root, null)
  await post(`/api/tasks/${dozy.id}/resume`)
  const back = await waitFor(dozy.id, (t) => t.status === 'done', 'the dropped task to resume')
  assert.ok(back.root && fs.existsSync(back.root), 'the worktree is back on disk')
  assert.equal(fs.readFileSync(path.join(root, 'data', 'tasks', dozy.id, 'resumed.txt'), 'utf8'), dozed.lastSession.id)

  // What is already in the data from before: a one-off script moves it.
  const old = await post('/api/tasks', {
    title: 'old', repos: ['api'], run: 'ask', prompt: 'use EGO_API_KEY=ck_test_value_1234567890 please',
  })
  await waitFor(old.id, (t) => t.status === 'done', 'the old-style task')
  fs.appendFileSync(path.join(root, 'data', 'logs', `${old.id}.jsonl`),
    JSON.stringify({ t: Date.now(), kind: 'text', text: 'ok I used ck_test_value_1234567890' }) + '\n')
  await sleep(300)
  server.kill('SIGKILL')
  await sleep(300)
  const migration = execFileSync(process.execPath, [path.join(here, '..', 'scripts', 'redact-existing.mjs')], {
    env: { ...process.env, FLOW_DATA: path.join(root, 'data') }, encoding: 'utf8',
  })
  assert.match(migration, /rotate these: EGO_API_KEY/)
  assert.ok(!fs.readFileSync(path.join(root, 'data', 'tasks.json'), 'utf8').includes('ck_test_value'))
  assert.ok(!fs.readFileSync(path.join(root, 'data', 'logs', `${old.id}.jsonl`), 'utf8').includes('ck_test_value'))
  server = startServer({ FLOW_AUTO_RESUME: '0' })
  await up()
  const migrated = await (await fetch(`${base}/api/tasks/${old.id}`)).json()
  assert.equal(migrated.prompt, 'use EGO_API_KEY={{secret:EGO_API_KEY}} please')
  assert.deepEqual(migrated.secrets, ['EGO_API_KEY'])
  assert.equal(secrets.read(old.id, 'EGO_API_KEY'), 'ck_test_value_1234567890')
  await fetch(`${base}/api/tasks/${old.id}`, { method: 'DELETE' })

  console.log(
    'ok: a restart mid-run leaves the task interrupted and resume continues its session,\n' +
    '    what was already in the data is moved to the keychain by the one-off script,\n' +
    '    a run gone quiet after a sleep is interrupted and stopped, a dropped worktree is rebuilt on resume,\n' +
    '    interrupted work resumes on launch, a refused session re-runs fresh out loud,\n' +
    '    and "tiếp tục" continues the last session',
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
