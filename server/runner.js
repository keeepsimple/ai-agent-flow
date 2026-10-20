import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { DATA, bus, sse, tasks, artifactDir, emit, update, log } from './store.js'
import {
  RUNS, GATES, PHASE_LABEL, phasesFor, buildPrompt, buildCatchUpPrompt, buildFollowUpPrompt,
} from './prompts.js'
import { UPLOADS, verify as verifyUpload } from './uploads.js'
import { notify } from './notify.js'
import { listRepos, resolveRepo } from './roots.js'
import * as devServer from './preview.js'
import * as browser from './browser.js'

export const PORT = Number(process.env.FLOW_PORT || 7777)
export { listRepos, roots, addRoot, removeRoot, browse, DEFAULT_ROOT } from './roots.js'
export { options as shopifyOptions } from './preview.js'
const MAX_CONCURRENT = Number(process.env.FLOW_MAX_CONCURRENT || 3)
const CLAUDE_BIN = process.env.FLOW_CLAUDE_BIN || 'claude'
const WIN = process.platform === 'win32'
const ASK_SCRIPT = path.join(import.meta.dirname, 'ask.mjs')
const PREVIEW_SCRIPT = path.join(import.meta.dirname, 'preview.mjs')

// These three end up on a command line, which on Windows goes through cmd.exe,
// so they are allowlisted rather than trusted. Each list is the CLI's own enum;
// '' means "leave the flag off and let the CLI's own default stand".
export const MODELS = ['', 'fable', 'opus', 'sonnet', 'haiku']
export const EFFORTS = ['', 'low', 'medium', 'high', 'xhigh', 'max']
export const MODES = ['bypassPermissions', 'acceptEdits', 'auto', 'dontAsk', 'plan', 'manual']
export const RUN_VALUES = RUNS.map((r) => r.value)
export { RUNS }

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

/** What the CLI will pick when we pass no --model, so "default" can say so. */
function cliDefaultModel() {
  if (process.env.ANTHROPIC_MODEL) return process.env.ANTHROPIC_MODEL
  const settings = path.join(os.homedir(), '.claude', 'settings.json')
  try {
    return JSON.parse(fs.readFileSync(settings, 'utf8')).model || ''
  } catch {
    return ''
  }
}

export const DEFAULTS = {
  model: pick(process.env.FLOW_MODEL, MODELS, ''),
  effort: pick(process.env.FLOW_EFFORT, EFFORTS, ''),
  permissionMode: pick(process.env.FLOW_PERMISSION_MODE, MODES, 'bypassPermissions'),
  cliModel: cliDefaultModel(),
}

/**
 * Tell the human. A watching tab gets it over SSE and raises a notification that
 * opens the task when clicked; with no tab open the server raises the desktop
 * one itself, so closing the browser does not mean missing the end of a run.
 */
function tell(task, title, body, urgent = false) {
  bus.emit('notify', { taskId: task.id, title, body, urgent })
  if (!sse.clients) notify(title, body, { urgent, url: `http://127.0.0.1:${PORT}/#${task.id}` })
}

const children = new Map() // taskId -> ChildProcess
const gateWaiters = new Map() // taskId -> resolve(feedbackOrNull)
const questionWaiters = new Map() // questionId -> resolve(answer)
const queue = []
let running = 0

const git = (cwd, ...args) =>
  execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

const firstLine = (text) => {
  const line = text.trim().split('\n')[0].trim()
  return line.length > 72 ? `${line.slice(0, 69)}...` : line
}

const slugify = (s) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'task'

export function createTask({
  title, prompt, repos, attachments = [], images = [], autoApprove = false, run, model, effort,
  permissionMode, shopify,
}) {
  if (!prompt?.trim()) throw new Error('prompt is required')
  // Repos can live under more than one folder now, so what the human picked is
  // resolved to a real path before anything is created from it.
  const wanted = [...new Set(Array.isArray(repos) ? repos : [repos])].filter(Boolean)
  if (!wanted.length) throw new Error('pick at least one repo')
  const picked = wanted.map(resolveRepo)
  // `images` is what the field was called before text files could be attached.
  const attached = [...attachments, ...images].map(verifyUpload)

  const id = randomUUID().slice(0, 8)
  // A title is optional: with none, the first line of the prompt stands in
  // until the spec phase has read the code and can name the work properly.
  const named = Boolean(title?.trim())
  const task = {
    id,
    title: named ? title.trim() : firstLine(prompt),
    namedByHuman: named,
    prompt: prompt.trim(),
    repos: picked.map((r) => r.name),
    repoPaths: picked.map((r) => r.path),
    attachments: attached,
    // Which app config and store `shopify app dev` may use for this task.
    shopify: shopify?.config ? { config: shopify.config, store: shopify.store || '' } : null,
    model: pick(model, MODELS, DEFAULTS.model, 'model'),
    effort: pick(effort, EFFORTS, DEFAULTS.effort, 'effort'),
    permissionMode: pick(permissionMode, MODES, DEFAULTS.permissionMode, 'permission mode'),
    autoApprove,
    status: 'queued',
    phase: null,
    run: pick(run, RUN_VALUES, 'full', 'run'),
    phases: Object.fromEntries(
      phasesFor(pick(run, RUN_VALUES, 'full', 'run')).map((p) => [p, { status: 'pending' }]),
    ),
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
    // Older tasks stored only a name, back when every repo sat under one root.
    const repoPath = task.repoPaths?.[i] || resolveRepo(repo).path
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
  for (const phase of phasesFor(task.run)) {
    if (task.status === 'cancelled') return
    if (task.phases[phase].status === 'done') continue

    update(task.id, { status: 'running', phase, error: null })
    task.phases[phase] = { status: 'running', startedAt: Date.now() }
    emit(task)

    const prompt = buildPrompt(phase, {
      ...task,
      askScript: ASK_SCRIPT,
      previewScript: task.trees?.some((t) => devServer.isShopifyApp(t.worktree)) ? PREVIEW_SCRIPT : null,
      needsTitle: phase === phasesFor(task.run)[0],
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
    if (phase === phasesFor(task.run)[0] && !task.namedByHuman) {
      const written = fs.existsSync(path.join(task.artifactDir, 'title.txt'))
        ? fs.readFileSync(path.join(task.artifactDir, 'title.txt'), 'utf8').trim()
        : ''
      // The branch keeps the name it was created with; only the label changes.
      if (written) task.title = firstLine(written)
    }
    emit(task)

    if (GATES[phase] && !task.autoApprove) {
      const decision = await waitForApproval(task, phase)
      if (decision === null) return // cancelled or rejected
      feedback = decision || null
    }
  }

  update(task.id, { status: 'done', phase: null })
  tell(task, `Done: ${task.title}`, `${task.repos.join(' + ')} · $${task.cost.toFixed(2)}`)
}

function fail(task, message) {
  update(task.id, { status: 'failed', error: message })
  tell(task, `Failed: ${task.title}`, message.slice(0, 180), true)
}

function waitForApproval(task, phase) {
  update(task.id, { status: 'awaiting_approval', awaitingPhase: phase })
  tell(task, `Needs your call: ${task.title}`, `${PHASE_LABEL[phase]} is ready to review`, true)
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

const ALIVE = new Set(['running', 'awaiting_approval', 'awaiting_answer'])

const NOBODY_HOME =
  'Nobody is available: this task was started to run unattended. Do not ask again. ' +
  'Make the call you judge best, and write down what you assumed and why in the ' +
  'document for this phase so it can be checked later.'

export function askQuestion(id, text) {
  const task = tasks[id]
  if (!task) throw new Error('unknown task')
  // Unattended means nobody is watching. Blocking on a question there is not
  // caution, it is a run that sits dead until someone happens to look.
  if (task.autoApprove) {
    log(id, { kind: 'question', text })
    log(id, { kind: 'answer', text: NOBODY_HOME })
    task.questions.push({
      id: randomUUID().slice(0, 8),
      text,
      askedAt: Date.now(),
      answer: NOBODY_HOME,
      answeredAt: Date.now(),
      unattended: true,
    })
    emit(task)
    return Promise.resolve(NOBODY_HOME)
  }
  // An agent that outlived its cancellation must not be able to revive the task
  // by asking something. Tell it to stop instead.
  if (!ALIVE.has(task.status)) {
    throw new Error(`this task is ${task.status}. Stop what you are doing and exit.`)
  }
  const question = { id: randomUUID().slice(0, 8), text, askedAt: Date.now(), answer: null }
  task.questions.push(question)
  // Name the live one. A question left behind by a run that died keeps
  // answer === null for ever, and the UI used to offer the oldest of those.
  update(id, { status: 'awaiting_answer', openQuestionId: question.id })
  log(id, { kind: 'question', text })
  tell(task, `Question: ${task.title}`, text.slice(0, 180), true)
  return new Promise((resolve) => questionWaiters.set(question.id, resolve))
}

export function answerQuestion(id, questionId, answer) {
  const resolve = questionWaiters.get(questionId)
  if (!resolve) {
    // Almost always the server restarted and took the waiting request with it.
    // Say which, because "no longer waiting" on its own explains nothing.
    const status = tasks[id]?.status
    throw new Error(
      status && status !== 'awaiting_answer'
        ? `this task is ${status} now, so nobody is waiting for that answer` +
          (tasks[id].error ? `: ${tasks[id].error}` : '')
        : 'nobody is waiting for that answer any more',
    )
  }
  questionWaiters.delete(questionId)
  const task = tasks[id]
  const question = task.questions.find((q) => q.id === questionId)
  question.answer = answer
  question.answeredAt = Date.now()
  log(id, { kind: 'answer', text: answer })
  update(id, { status: 'running', openQuestionId: null })
  resolve(answer)
  return task
}

/**
 * One agent run outside the four phases, on a task that has already finished.
 * The task goes back to whatever it was when the run ends, so a follow-up on a
 * done task leaves it done rather than inventing a state for it.
 */
function sideRun(task, label, prompt, cwd, finished) {
  const previous = task.status
  update(task.id, { status: 'running', phase: label, error: null })

  runClaude(task, prompt, cwd)
    .then(() => {
      if (tasks[task.id].status === 'cancelled') return
      update(task.id, { status: previous, phase: null })
      tell(task, finished, task.repos.join(' + '))
    })
    .catch((err) => {
      if (tasks[task.id].status === 'cancelled') return
      fail(task, `${label}: ${err.message}`)
    })

  return task
}

function readyForSideRun(id) {
  const task = tasks[id]
  if (!task) throw new Error('unknown task')
  if (task.status === 'running' || task.status === 'queued') throw new Error('this task is already running')
  if (!task.root) throw new Error('the worktree was dropped, so there is nothing to work on')
  return task
}

/**
 * Pull the base branch into the task's branch and let an agent resolve whatever
 * that turns up. It runs in the worktree, never in the human's own checkout, so
 * a resolution they dislike costs them a branch and nothing else. Afterwards the
 * merge into the base is a fast-forward, which cannot conflict.
 */
export function catchUp(id, repo) {
  const task = readyForSideRun(id)
  const tree = task.trees?.find((t) => t.repo === repo)
  if (!tree) throw new Error(`unknown repo: ${repo}`)

  return sideRun(
    task,
    `catching up with ${tree.baseBranch}`,
    buildCatchUpPrompt(tree, task),
    tree.worktree,
    `Caught up: ${task.title}`,
  )
}

/**
 * Keep working on a finished task: the build broke, the fix was not quite it,
 * one more thing. Same worktrees, same branches, no new task to lose the
 * context of what this already is.
 */
export function followUp(id, request) {
  const task = readyForSideRun(id)
  if (!request?.trim()) throw new Error('say what you want changed')

  log(id, { kind: 'decision', text: `Follow-up: ${request.trim()}` })
  return sideRun(
    task,
    'follow-up',
    buildFollowUpPrompt({ ...task, askScript: ASK_SCRIPT, request: request.trim() }),
    task.root,
    `Follow-up done: ${task.title}`,
  )
}

/**
 * Start the app for this task and, when asked for a path, look at it.
 * The dev server belongs to the worktree, so a second call reuses it.
 */
export async function preview(id, where = '') {
  const task = tasks[id]
  if (!task) throw new Error('unknown task')
  if (!task.root) throw new Error('the worktree was dropped, so there is nothing to run')

  const tree = task.trees?.find((t) => devServer.isShopifyApp(t.worktree)) || task.trees?.[0]
  if (!tree) throw new Error('this task has no worktree')

  const { url, reused } = await devServer.start(id, tree.worktree, task.shopify || {})
  if (!reused) update(id, { previewUrl: url })
  if (!where) return { url }

  const shot = path.join(task.artifactDir, 'shots', `${Date.now()}.png`)
  const full = where.startsWith('http') ? where : new URL(where, url).toString()
  log(id, { kind: 'tool', tool: 'Preview', text: full })
  return browser.visit(full, shot)
}

export function cancel(id) {
  const task = tasks[id]
  if (!task) throw new Error('unknown task')
  update(id, { status: 'cancelled', phase: null, awaitingPhase: null, openQuestionId: null })
  for (const tree of task.trees || []) devServer.stop(tree.worktree)
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
  for (const p of phasesFor(task.run)) {
    if (task.phases[p].status === 'failed') task.phases[p] = { status: 'pending' }
  }
  update(id, { status: 'queued', error: null, openQuestionId: null })
  queue.push(id)
  pump()
  return task
}

export function removeWorktrees(id) {
  const task = tasks[id]
  if (!task?.root) throw new Error('nothing to remove')
  // Status alone is not enough: cancelling does not instantly stop the process,
  // and pulling the worktree out from under a live agent is how it goes strange.
  if (children.has(id)) throw new Error('the agent is still shutting down, try again in a moment')
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

function runClaude(task, prompt, cwd = task.root) {
  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--permission-mode', task.permissionMode,
    '--add-dir', task.artifactDir,
    '--add-dir', UPLOADS,
  ]
  if (task.model) args.push('--model', task.model)
  if (task.effort) args.push('--effort', task.effort)
  // Nobody is at a keyboard to answer a permission prompt. Without this, a mode
  // that wants to ask would stall the phase instead of getting on with it.
  if (task.permissionMode !== 'bypassPermissions') args.push('--permission-prompts', 'none')

  return new Promise((resolve, reject) => {
    // On Windows `claude` is a .cmd, which Node refuses to spawn directly, so it
    // goes through the shell. Nothing with a space reaches the command line
    // unquoted, and the prompt itself never touches it at all.
    const child = spawn(CLAUDE_BIN, WIN ? args.map(winQuote) : args, {
      cwd,
      shell: WIN,
      env: {
        ...process.env,
        FLOW_URL: `http://127.0.0.1:${PORT}`,
        FLOW_TASK_ID: task.id,
        FLOW_ARTIFACTS: task.artifactDir,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      // Own process group, so cancelling can signal the agent's whole tree.
      // SIGTERM to the claude pid alone leaves it running.
      detached: !WIN,
    })
    children.set(task.id, child)
    child.stdin.on('error', () => {}) // the child can die before the prompt lands
    child.stdin.end(prompt, 'utf8')

    let buffer = ''
    let summary = ''
    let resultError = null
    // The final result repeats the last thing the model said. Remember it so the
    // stream does not print the same paragraphs twice at the end of every phase.
    const seen = { lastText: '' }
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      buffer += chunk
      const lines = buffer.split('\n')
      buffer = lines.pop()
      for (const line of lines) {
        if (!line.trim()) continue
        let msg
        try { msg = JSON.parse(line) } catch { log(task.id, { kind: 'text', text: line }); continue }
        const entry = toLogEntry(task, msg, seen)
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

function toLogEntry(task, msg, seen) {
  if (msg.type === 'assistant') {
    // One assistant message can carry prose and several tool calls. Log each in
    // order here and return nothing, so the stream stays chronological.
    for (const block of msg.message?.content || []) {
      if (block.type === 'text' && block.text.trim()) {
        seen.lastText = block.text
        log(task.id, { kind: 'text', text: block.text })
      }
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
    const result = msg.result || (msg.subtype === 'success' ? '' : msg.subtype || '')
    return {
      kind: 'result',
      text: result === seen.lastText ? '' : result,
      cost: msg.total_cost_usd,
      turns: msg.num_turns,
    }
  }
  return null
}

/**
 * Stop the agent and everything it started. The process may already be gone by
 * the time a human gets to the button, so every step here tolerates that.
 *
 * SIGTERM to the claude pid on its own is not enough: it leaves the agent alive,
 * which is how a cancelled task once came back to life and asked a question.
 */
function killTree(child) {
  if (!child?.pid) return
  if (WIN) {
    // On Windows the child is a cmd.exe wrapper; /T is what reaches underneath.
    try {
      execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    } catch {
      child.kill()
    }
    return
  }
  const signal = (sig) => {
    try { process.kill(-child.pid, sig) } catch { try { child.kill(sig) } catch {} }
  }
  signal('SIGTERM')
  // SIGTERM is a request. Give it a moment, then stop asking.
  setTimeout(() => { if (!child.killed || child.exitCode === null) signal('SIGKILL') }, 3000).unref()
}

// A detached child outlives its parent, so the server has to take them with it
// rather than leave paid agents running against worktrees nobody is watching.
for (const event of ['exit', 'SIGINT', 'SIGTERM']) {
  process.on(event, () => {
    for (const child of children.values()) killTree(child)
    if (event !== 'exit') process.exit(0)
  })
}

/** Quote an argument for cmd.exe. Windows paths cannot contain a double quote. */
function winQuote(arg) {
  return /[\s&|<>^()]/.test(arg) ? `"${arg}"` : arg
}
