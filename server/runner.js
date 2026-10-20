import fs from 'node:fs'
import path from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { DATA, tasks, artifactDir, emit, update, log } from './store.js'
import { PHASES, GATES, PHASE_LABEL, buildPrompt } from './prompts.js'
import { notify } from './notify.js'

export const PORT = Number(process.env.FLOW_PORT || 7777)
export const REPO_ROOT = process.env.FLOW_REPO_ROOT || path.resolve(import.meta.dirname, '..', '..')
const MAX_CONCURRENT = Number(process.env.FLOW_MAX_CONCURRENT || 3)
const PERMISSION_MODE = process.env.FLOW_PERMISSION_MODE || 'bypassPermissions'

const children = new Map() // taskId -> ChildProcess
const gateWaiters = new Map() // taskId -> resolve(feedbackOrNull)
const questionWaiters = new Map() // questionId -> resolve(answer)
const queue = []
let running = 0

const git = (cwd, ...args) =>
  execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

export function listRepos() {
  return fs
    .readdirSync(REPO_ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(REPO_ROOT, e.name, '.git')))
    .map((e) => e.name)
    .sort()
}

const slugify = (s) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'task'

export function createTask({ title, prompt, repo, autoApprove = false, model = '' }) {
  if (!title?.trim()) throw new Error('title is required')
  if (!prompt?.trim()) throw new Error('prompt is required')
  if (!listRepos().includes(repo)) throw new Error(`unknown repo: ${repo}`)

  const id = randomUUID().slice(0, 8)
  const task = {
    id,
    title: title.trim(),
    prompt: prompt.trim(),
    repo,
    model,
    autoApprove,
    status: 'queued',
    phase: null,
    phases: Object.fromEntries(PHASES.map((p) => [p, { status: 'pending' }])),
    questions: [],
    cost: 0,
    turns: 0,
    createdAt: Date.now(),
  }
  tasks[id] = task
  emit(task)
  queue.push(id)
  pump()
  return task
}

function pump() {
  while (running < MAX_CONCURRENT && queue.length) {
    const task = tasks[queue.shift()]
    if (!task || task.status !== 'queued') continue
    running++
    runTask(task).finally(() => {
      running--
      pump()
    })
  }
}

function setupWorktree(task) {
  const repoPath = path.join(REPO_ROOT, task.repo)
  const branch = task.branch || `flow/${slugify(task.title)}-${task.id}`
  const worktree = path.join(DATA, 'worktrees', `${task.repo}-${task.id}`)

  // Pin the diff base to a sha: the branch it forked from keeps moving.
  const baseRef = task.baseRef || git(repoPath, 'rev-parse', 'HEAD')
  let baseBranch = task.baseBranch || 'HEAD (detached)'
  if (!task.baseBranch) {
    try { baseBranch = git(repoPath, 'symbolic-ref', '--short', 'HEAD') } catch {}
  }

  let exists = false
  try { git(repoPath, 'rev-parse', '--verify', branch); exists = true } catch {}
  // Dropping a worktree leaves its branch behind, so a retry has to reuse it.
  if (exists) git(repoPath, 'worktree', 'add', worktree, branch)
  else git(repoPath, 'worktree', 'add', '-b', branch, worktree, baseRef)

  const dir = artifactDir(task.id)
  fs.mkdirSync(dir, { recursive: true })
  const askScript = path.join(dir, 'ask')
  fs.writeFileSync(
    askScript,
    `#!/bin/sh
# Ask the human a question and block until they answer in the Agent Flow UI.
[ -z "$1" ] && { echo 'usage: ask "question"' >&2; exit 2; }
exec curl -sS --max-time 86400 -X POST "$FLOW_URL/api/tasks/$FLOW_TASK_ID/ask" \\
  -H 'Content-Type: text/plain' --data-binary "$1"
`,
    { mode: 0o755 },
  )

  update(task.id, { branch, worktree, baseRef, baseBranch, artifactDir: dir, askScript })
}

async function runTask(task) {
  try {
    if (!task.worktree) setupWorktree(task)
  } catch (err) {
    log(task.id, { kind: 'error', text: `worktree setup failed: ${err.message}` })
    return fail(task, err.message)
  }

  let feedback = null
  for (const phase of PHASES) {
    if (task.status === 'cancelled') return
    if (task.phases[phase].status === 'done') continue

    update(task.id, { status: 'running', phase, error: null })
    task.phases[phase] = { status: 'running', startedAt: Date.now() }
    emit(task)

    const prompt = buildPrompt(phase, {
      ...task,
      repo: path.join(REPO_ROOT, task.repo),
      feedback,
    })
    feedback = null

    let result
    try {
      result = await runClaude(task, prompt)
    } catch (err) {
      task.phases[phase] = { ...task.phases[phase], status: 'failed', endedAt: Date.now() }
      return fail(task, err.message)
    }
    if (task.status === 'cancelled') return

    task.phases[phase] = {
      status: 'done',
      startedAt: task.phases[phase].startedAt,
      endedAt: Date.now(),
      summary: result.summary,
    }
    emit(task)

    if (GATES[phase] && !task.autoApprove) {
      const decision = await waitForApproval(task, phase)
      if (decision === null) return // cancelled or rejected
      feedback = decision || null
    }
  }

  update(task.id, { status: 'done', phase: null })
  notify(`Done: ${task.title}`, `${task.repo} · ${task.branch} · $${task.cost.toFixed(2)}`)
}

function fail(task, message) {
  update(task.id, { status: 'failed', error: message })
  notify(`Failed: ${task.title}`, message.slice(0, 180), { sound: 'Basso' })
}

function waitForApproval(task, phase) {
  update(task.id, { status: 'awaiting_approval', awaitingPhase: phase })
  notify(`Needs your call: ${task.title}`, `${PHASE_LABEL[phase]} is ready to review`, { sound: 'Submarine' })
  return new Promise((resolve) => gateWaiters.set(task.id, resolve))
}

export function approve(id, { approved, feedback = '' }) {
  const resolve = gateWaiters.get(id)
  if (!resolve) throw new Error('task is not waiting for approval')
  gateWaiters.delete(id)
  const task = tasks[id]
  log(id, {
    kind: 'decision',
    text: approved
      ? `Approved ${PHASE_LABEL[task.awaitingPhase]}${feedback ? ` with feedback: ${feedback}` : ''}`
      : `Rejected ${PHASE_LABEL[task.awaitingPhase]}${feedback ? `: ${feedback}` : ''}`,
  })
  if (!approved) {
    update(id, { status: 'cancelled', awaitingPhase: null, error: feedback || 'Rejected at gate' })
    resolve(null)
    return task
  }
  update(id, { status: 'running', awaitingPhase: null })
  resolve(feedback)
  return task
}

export function askQuestion(id, text) {
  const task = tasks[id]
  if (!task) throw new Error('unknown task')
  const question = { id: randomUUID().slice(0, 8), text, askedAt: Date.now(), answer: null }
  task.questions.push(question)
  update(id, { status: 'awaiting_answer' })
  log(id, { kind: 'question', text })
  notify(`Question: ${task.title}`, text.slice(0, 180), { sound: 'Submarine' })
  return new Promise((resolve) => questionWaiters.set(question.id, resolve))
}

export function answerQuestion(id, questionId, answer) {
  const resolve = questionWaiters.get(questionId)
  if (!resolve) throw new Error('that question is no longer waiting')
  questionWaiters.delete(questionId)
  const task = tasks[id]
  const question = task.questions.find((q) => q.id === questionId)
  question.answer = answer
  question.answeredAt = Date.now()
  log(id, { kind: 'answer', text: answer })
  update(id, { status: 'running' })
  resolve(answer)
  return task
}

export function cancel(id) {
  const task = tasks[id]
  if (!task) throw new Error('unknown task')
  update(id, { status: 'cancelled', phase: null, awaitingPhase: null })
  children.get(id)?.kill('SIGTERM')
  // Anything blocked on this task has to be let go, or the HTTP request that is
  // holding a question open never gets a response.
  gateWaiters.get(id)?.(null)
  gateWaiters.delete(id)
  for (const q of task.questions) {
    if (q.answer === null && questionWaiters.has(q.id)) {
      questionWaiters.get(q.id)('Task cancelled by the human. Stop now.')
      questionWaiters.delete(q.id)
    }
  }
  return task
}

export function retry(id) {
  const task = tasks[id]
  if (!task) throw new Error('unknown task')
  if (task.status === 'running' || task.status === 'queued') {
    throw new Error(`task is already ${task.status}`)
  }
  for (const p of PHASES) {
    if (task.phases[p].status === 'failed') task.phases[p] = { status: 'pending' }
  }
  update(id, { status: 'queued', error: null })
  queue.push(id)
  pump()
  return task
}

export function removeWorktree(id) {
  const task = tasks[id]
  if (!task?.worktree) throw new Error('nothing to remove')
  if (task.status === 'running') throw new Error('task is still running')
  execFileSync('git', ['-C', path.join(REPO_ROOT, task.repo), 'worktree', 'remove', '--force', task.worktree])
  update(id, { worktree: null })
  return task
}

/** Short, readable one-liner for a tool call, for the log stream. */
function describeTool(name, input = {}) {
  const pick =
    input.command ||
    input.file_path ||
    input.pattern ||
    input.description ||
    input.path ||
    input.url ||
    (input.prompt ? String(input.prompt).split('\n')[0] : '') ||
    ''
  const text = String(pick).replace(/\s+/g, ' ').trim()
  return text.length > 280 ? text.slice(0, 280) + '…' : text
}

function runClaude(task, prompt) {
  const args = [
    '-p', prompt,
    '--output-format', 'stream-json',
    '--verbose',
    '--permission-mode', PERMISSION_MODE,
    '--add-dir', task.artifactDir,
  ]
  if (task.model) args.push('--model', task.model)
  if (process.env.FLOW_MAX_BUDGET_USD) args.push('--max-budget-usd', process.env.FLOW_MAX_BUDGET_USD)

  return new Promise((resolve, reject) => {
    const child = spawn('claude', args, {
      cwd: task.worktree,
      env: {
        ...process.env,
        FLOW_URL: `http://127.0.0.1:${PORT}`,
        FLOW_TASK_ID: task.id,
        FLOW_ARTIFACTS: task.artifactDir,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    children.set(task.id, child)

    let buffer = ''
    let summary = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      buffer += chunk
      const lines = buffer.split('\n')
      buffer = lines.pop()
      for (const line of lines) {
        if (!line.trim()) continue
        let msg
        try { msg = JSON.parse(line) } catch { log(task.id, { kind: 'text', text: line }); continue }
        const entry = toLogEntry(task, msg)
        if (entry) log(task.id, entry)
        if (msg.type === 'result') summary = msg.result || ''
      }
    })

    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => {
      const text = chunk.trim()
      if (text) log(task.id, { kind: 'stderr', text })
    })

    child.on('error', (err) => {
      children.delete(task.id)
      reject(new Error(`could not start claude: ${err.message}`))
    })

    child.on('close', (code) => {
      children.delete(task.id)
      if (task.status === 'cancelled') return resolve({ summary })
      if (code === 0) return resolve({ summary })
      reject(new Error(`claude exited with code ${code} during ${task.phase}`))
    })
  })
}

function toLogEntry(task, msg) {
  if (msg.type === 'assistant') {
    // One assistant message can carry prose and several tool calls. Log each in
    // order here and return nothing, so the stream stays chronological.
    for (const block of msg.message?.content || []) {
      if (block.type === 'text' && block.text.trim()) log(task.id, { kind: 'text', text: block.text })
      if (block.type === 'tool_use') log(task.id, { kind: 'tool', tool: block.name, text: describeTool(block.name, block.input) })
    }
    return null
  }
  if (msg.type === 'user') {
    const err = (msg.message?.content || []).find((b) => b.type === 'tool_result' && b.is_error)
    if (!err) return null
    const text = typeof err.content === 'string' ? err.content : JSON.stringify(err.content)
    return { kind: 'error', text: text.slice(0, 600) }
  }
  if (msg.type === 'result') {
    task.cost = +(task.cost + (msg.total_cost_usd || 0)).toFixed(4)
    task.turns += msg.num_turns || 0
    emit(task)
    return {
      kind: 'result',
      text: msg.result || msg.subtype || '',
      cost: msg.total_cost_usd,
      turns: msg.num_turns,
    }
  }
  return null
}
