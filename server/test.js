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
  git(repo, 'add', '.')
  git(repo, 'commit', '-qm', 'init')
}
// Only 'web' gets a remote, so the no-remote path stays covered by 'api'.
git('web', 'remote', 'add', 'origin', origin)
git('web', 'push', '-q', '-u', 'origin', 'main')

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
    fs.writeFileSync(path.join(where, 'fix.txt'), 'fixed the build')
    execFileSync('git', ['-C', where, 'add', '-A'])
    execFileSync('git', ['-C', where, '-c', 'user.email=t@e.com', '-c', 'user.name=T', 'commit', '-qm', 'fix build'])
  }
  say('reproduced it, fixed it, checks pass')
} else if (prompt.includes('into this branch')) {
  // Catch-up run: do the merge for real, in the worktree we were started in.
  execFileSync('git', ['-c', 'user.email=t@e.com', '-c', 'user.name=T', 'merge', 'main'])
  say('merged main in')
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

  const badRun = await fetch(`${base}/api/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repos: ['api'], prompt: 'x', run: 'whatever' }),
  })
  assert.equal(badRun.status, 400, 'an unknown run shape should be refused')

  const quiet = await post('/api/tasks', { repos: ['api'], prompt: 'just do it, nobody is watching', autoApprove: true })
  assert.equal(quiet.title, 'just do it, nobody is watching', 'the prompt stands in until the agent names it')
  assert.equal(quiet.namedByHuman, false)
  let quietTask = await waitFor(quiet.id, (t) => t.status === 'done' || t.status === 'failed', 'the quiet run')
  assert.equal(quietTask.status, 'done', `unattended run stalled: ${quietTask.error}`)
  assert.equal(quietTask.title, 'Named by the agent', 'the spec phase should have renamed it')
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
  const refused = await fetch(`${base}/api/tasks/${created.id}/merge`, {
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

  await post(`/api/tasks/${created.id}/merge`, {})
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
    '    cancel kills a SIGTERM-ignoring tree, late ask cannot revive a dead task,\n' +
    '    push needs a remote, merge refuses a clashing edit and lands on a clean base,\n' +
    '    catch-up merges the base in from the worktree without touching the checkout,\n' +
    '    push covers the task branch and the base branch after it is merged,\n' +
    '    unattended answers its own questions and the agent names an untitled task,\n' +
    '    a quick run skips spec and plan but still reviews itself,\n' +
    '    a finished task takes a follow-up on the same branches,\n' +
    '    an attached log reaches the prompt and a binary in a .log is refused,\n' +
    '    the diff is readable from the app and an enormous file is only described,\n' +
    '    reclaiming worktree space never reclaims the work,\n' +
    '    a second folder can be added and an ambiguous repo name is refused,\n' +
    '    running the app refuses until the config it may repoint is named,\n' +
    '    and the configs offered come from the repo, paired with their dev stores',
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
