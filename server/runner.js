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
const CLAUDE_BIN = process.env.FLOW_CLAUDE_BIN || 'claude'
const WIN = process.platform === 'win32'
const ASK_SCRIPT = path.join(import.meta.dirname, 'ask.mjs')

// These three end up on a command line, which on Windows goes through cmd.exe,
// so they are allowlisted rather than trusted. Each list is the CLI's own enum;
// '' means "leave the flag off and let the CLI's own default stand".
export const MODELS = ['', 'fable', 'opus', 'sonnet', 'haiku']
export const EFFORTS = ['', 'low', 'medium', 'high', 'xhigh', 'max']
export const MODES = ['bypassPermissions', 'acceptEdits', 'auto', 'dontAsk', 'plan', 'manual']

// MODES is the security allowlist. These are the two that make sense with
// nobody at a keyboard, so they are what the form offers; the rest stay
// reachable through FLOW_PERMISSION_MODE.
export const MODE_CHOICES = [
  { value: 'bypassPermissions', label: 'Full access', hint: 'Runs anything inside its worktree without asking.' },
  { value: 'acceptEdits', label: 'Edits only', hint: 'Can write files. Anything needing a shell is denied, so tests will not run.' },
]

function pick(value, allowed, fallback, what) {
  const v = (value ?? '').trim()
  if (v === '' && fallback !== undefined) return fallback
  if (!allowed.includes(v)) throw new Error(`${what} must be one of: ${allowed.filter(Boolean).join(', ')}`)
  return v
}

export const DEFAULTS = {
  model: pick(process.env.FLOW_MODEL, MODELS, ''),
  effort: pick(process.env.FLOW_EFFORT, EFFORTS, ''),
  permissionMode: pick(process.env.FLOW_PERMISSION_MODE, MODES, 'bypassPermissions'),
}

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

export function createTask({ title, prompt, repos, autoApprove = false, model, effort, permissionMode }) {
  if (!title?.trim()) throw new Error('title is required')
  if (!prompt?.trim()) throw new Error('prompt is required')
  const known = listRepos()
  const picked = [...new Set(Array.isArray(repos) ? repos : [repos])].filter(Boolean)
  if (!picked.length) throw new Error('pick at least one repo')
  for (const r of picked) if (!known.includes(r)) throw new Error(`unknown repo: ${r}`)

  const id = randomUUID().slice(0, 8)
  const task = {
    id,
    title: title.trim(),
    prompt: prompt.trim(),
    repos: picked,
    model: pick(model, MODELS, DEFAULTS.model, 'model'),
    effort: pick(effort, EFFORTS, DEFAULTS.effort, 'effort'),
    permissionMode: pick(permissionMode, MODES, DEFAULTS.permissionMode, 'permission mode'),
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

/**
 * One worktree per repo, all under data/worktrees/<taskId>/. A feature that
 * spans three repos gets three branches and three isolated checkouts, so every
 * repo still has something to roll back to.
 */
function setupWorktrees(task) {
  const base = path.join(DATA, 'worktrees', task.id)
  const branch = task.trees?.[0]?.branch || `flow/${slugify(task.title)}-${task.id}`

  const trees = task.repos.map((repo, i) => {
    const repoPath = path.join(REPO_ROOT, repo)
    const previous = task.trees?.[i]
    const worktree = path.join(base, repo)

    // Pin the diff base to a sha: the branch it forked from keeps moving.
    const baseRef = previous?.baseRef || git(repoPath, 'rev-parse', 'HEAD')
    let baseBranch = previous?.baseBranch || 'HEAD (detached)'
    if (!previous?.baseBranch) {
      try { baseBranch = git(repoPath, 'symbolic-ref', '--short', 'HEAD') } catch {}
    }

    let hasBranch = false
    try { git(repoPath, 'rev-parse', '--verify', branch); hasBranch = true } catch {}

    // A retry can land on a half-built set: some worktrees already there from
    // the attempt that failed, and branches left behind by a dropped checkout.
    if (!fs.existsSync(worktree)) {
      if (hasBranch) git(repoPath, 'worktree', 'add', worktree, branch)
      else git(repoPath, 'worktree', 'add', '-b', branch, worktree, baseRef)
    }
    return { repo, repoPath, worktree, branch, baseRef, baseBranch }
  })

  const dir = artifactDir(task.id)
  fs.mkdirSync(dir, { recursive: true })

  // With one repo, run inside it, so the CLI finds its CLAUDE.md the usual way.
  // With several, run one level up and let the prompt name each worktree.
  update(task.id, { trees, root: trees.length === 1 ? trees[0].worktree : base, artifactDir: dir })
}

async function runTask(task) {
  try {
    if (!task.root) setupWorktrees(task)
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

    const prompt = buildPrompt(phase, { ...task, askScript: ASK_SCRIPT, feedback })
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
  notify(`Done: ${task.title}`, `${task.repos.join(' + ')} · $${task.cost.toFixed(2)}`)
}

function fail(task, message) {
  update(task.id, { status: 'failed', error: message })
  notify(`Failed: ${task.title}`, message.slice(0, 180), { urgent: true })
}

function waitForApproval(task, phase) {
  update(task.id, { status: 'awaiting_approval', awaitingPhase: phase })
  notify(`Needs your call: ${task.title}`, `${PHASE_LABEL[phase]} is ready to review`, { urgent: true })
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
  notify(`Question: ${task.title}`, text.slice(0, 180), { urgent: true })
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
  killTree(children.get(id))
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

export function removeWorktrees(id) {
  const task = tasks[id]
  if (!task?.root) throw new Error('nothing to remove')
  if (task.status === 'running') throw new Error('task is still running')
  for (const tree of task.trees) {
    git(tree.repoPath, 'worktree', 'remove', '--force', tree.worktree)
  }
  fs.rmSync(path.join(DATA, 'worktrees', task.id), { recursive: true, force: true })
  // The branches stay. Dropping the checkout is not the same as throwing the
  // work away, and setupWorktrees knows how to pick them back up.
  update(id, { root: null, droppedAt: Date.now() })
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
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--permission-mode', task.permissionMode,
    '--add-dir', task.artifactDir,
  ]
  if (task.model) args.push('--model', task.model)
  if (task.effort) args.push('--effort', task.effort)
  // Nobody is at a keyboard to answer a permission prompt. Without this, a mode
  // that wants to ask would stall the phase instead of getting on with it.
  if (task.permissionMode !== 'bypassPermissions') args.push('--permission-prompts', 'none')
  if (process.env.FLOW_MAX_BUDGET_USD) args.push('--max-budget-usd', process.env.FLOW_MAX_BUDGET_USD)

  return new Promise((resolve, reject) => {
    // On Windows `claude` is a .cmd, which Node refuses to spawn directly, so it
    // goes through the shell. Nothing with a space reaches the command line
    // unquoted, and the prompt itself never touches it at all.
    const child = spawn(CLAUDE_BIN, WIN ? args.map(winQuote) : args, {
      cwd: task.root,
      shell: WIN,
      env: {
        ...process.env,
        FLOW_URL: `http://127.0.0.1:${PORT}`,
        FLOW_TASK_ID: task.id,
        FLOW_ARTIFACTS: task.artifactDir,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    children.set(task.id, child)
    child.stdin.on('error', () => {}) // the child can die before the prompt lands
    child.stdin.end(prompt, 'utf8')

    let buffer = ''
    let summary = ''
    let resultError = null
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
        if (msg.type === 'result') {
          summary = msg.result || ''
          // A budget cap or a refusal ends the run with exit code 0 and an
          // error result. Treat it as the failure it is.
          if (msg.is_error) resultError = summary || msg.subtype || 'claude reported an error'
        }
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
      if (resultError) return reject(new Error(`${task.phase}: ${resultError}`))
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

/**
 * On Windows the child is a cmd.exe wrapper, and killing it leaves the claude
 * process underneath still running. taskkill /T is what actually stops the tree.
 */
function killTree(child) {
  if (!child) return
  if (!WIN) return void child.kill('SIGTERM')
  // The process may have exited between the click and here, and taskkill
  // treats that as an error. Cancelling is still what the human asked for.
  try {
    execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  } catch {
    child.kill()
  }
}

/** Quote an argument for cmd.exe. Windows paths cannot contain a double quote. */
function winQuote(arg) {
  return /[\s&|<>^()]/.test(arg) ? `"${arg}"` : arg
}
