// One end-to-end check of the whole machine: worktree, four phases, both
// approval gates, and the agent's blocking `ask`. Run: npm test
// `claude` is stubbed, so this costs nothing and needs no network.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, execFileSync } from 'node:child_process'

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

// Stub claude: emits stream-json, writes the artifact the phase is supposed to
// write, and blocks on `ask` once so the question path is exercised too.
fs.writeFileSync(
  path.join(bin, 'claude'),
  `#!/bin/sh
prompt=""
art=""
while [ $# -gt 0 ]; do
  case "$1" in
    -p) prompt="$2"; shift 2 ;;
    --add-dir) art="$2"; shift 2 ;;
    *) shift ;;
  esac
done
say() { printf '{"type":"assistant","message":{"content":[{"type":"text","text":"%s"}]}}\\n' "$1"; }
case "$prompt" in
  *"Phase: write the spec"*)   say "spec phase";   echo '# spec' > "$art/spec.md" ;;
  *"Phase: write the implementation plan"*) say "plan phase"; echo '# plan' > "$art/plan.md" ;;
  *"Phase: implement"*)
      answer=$("$art/ask" "ship the narrow version or the full one?")
      say "human said: $answer"
      echo stubbed > impl.txt
      git add -A && git -c user.email=t@e.com -c user.name=T commit -qm "impl"
      ;;
  *"Phase: review"*)           say "review phase"; echo '# review' > "$art/review.md" ;;
esac
printf '{"type":"result","subtype":"success","result":"ok","total_cost_usd":0.01,"num_turns":2}\\n'
`,
  { mode: 0o755 },
)

const server = spawn(process.execPath, [path.join(import.meta.dirname, 'index.js')], {
  env: {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
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
  fs.rmSync(root, { recursive: true, force: true })
}

if (failure) {
  console.error(failure)
  process.exit(1)
}
