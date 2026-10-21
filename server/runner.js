import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { DATA, bus, sse, tasks, artifactDir, emit, update, log, save, flush, readLog } from './store.js'
import {
  resumePrompt,
  buildShipPrompt,
  RUNS, GATES, PHASE_LABEL, phasesFor, buildPrompt, buildCatchUpPrompt, buildFollowUpPrompt,
  buildMergePrompt,
} from './prompts.js'
import { UPLOADS, verify as verifyUpload } from './uploads.js'
import { notify } from './notify.js'
import { listRepos, resolveRepo } from './roots.js'
import * as devServer from './preview.js'
import { invalidate as forgetDiskSize } from './disk.js'
import * as browser from './browser.js'
import * as secrets from './secrets.js'
import * as repoConfig from './repo-config.js'
import * as settings from './settings.js'
import * as telegram from './telegram.js'
import { toPick, statusRow, targetsOf } from './git.js'

export const PORT = Number(process.env.FLOW_PORT || 7777)
export { listRepos, roots, addRoot, removeRoot, browse, DEFAULT_ROOT } from './roots.js'
export { options as shopifyOptions } from './preview.js'
const MAX_CONCURRENT = Number(process.env.FLOW_MAX_CONCURRENT || 3)
const CLAUDE_BIN = process.env.FLOW_CLAUDE_BIN || 'claude'
const WIN = process.platform === 'win32'
// The agent is handed the runtime running this server, not the word `node`.
// Whatever starts the server is by definition present; `node` on the agent's
// PATH is a separate bet, and on a machine that has no Node at all it is lost.
const NODE_BIN = process.execPath
const ASK_SCRIPT = path.join(import.meta.dirname, 'ask.mjs')
const PREVIEW_SCRIPT = path.join(import.meta.dirname, 'preview.mjs')
const GUARD_SCRIPT = path.join(import.meta.dirname, 'guard-secrets.mjs')
const HOOK_SCRIPT = path.join(import.meta.dirname, 'hook-reads.mjs')
// The settings every claude run gets: one hook that refuses bare shell reads.
const CLAUDE_SETTINGS = path.join(DATA, 'claude-settings.json')
function ensureSettings() {
  const wanted = JSON.stringify({
    hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: `"${NODE_BIN}" "${HOOK_SCRIPT}"` }] }] },
  }, null, 2)
  let current = null
  try { current = fs.readFileSync(CLAUDE_SETTINGS, 'utf8') } catch {}
  if (current !== wanted) {
    fs.mkdirSync(DATA, { recursive: true })
    fs.writeFileSync(CLAUDE_SETTINGS, wanted)
  }
  return CLAUDE_SETTINGS
}
// A setup or baseline command that never ends is cut here, said so, and the run starts anyway.
const SETUP_MAX_MS = Number(process.env.FLOW_SETUP_MAX_MS || 600_000)
const JENKINS_SCRIPT = path.join(import.meta.dirname, 'jenkins.mjs')

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
 * opens the task when clicked; when nothing watching can do that, the server
 * raises the desktop one itself.
 *
 * The test is whether anyone can raise one, not whether anyone is watching.
 * A tab that was never granted permission is watching and silent, and so is
 * the app's own window, which has no Notification API at all.
 */
function tell(task, title, body, urgent = false, { phone = true } = {}) {
  bus.emit('notify', { taskId: task.id, title, body, urgent })
  if (!sse.notifiers) notify(title, body, { urgent, url: `http://127.0.0.1:${PORT}/#${task.id}` })
  // On the phone the notification carries what the agent said last, so it can
  // be read there without opening the app.
  if (phone) telegram.send(withLastSaid(task, body ? `${title}\n${body}` : title))
}

/** The agent's last message, in full, under the notification's own lines. */
function lastSaid(task) {
  const said = readLog(task.id, 200).findLast((e) => e.kind === 'text')
  return String(said?.text || '').trim()
}
const withLastSaid = (task, head) => {
  const said = lastSaid(task)
  return said ? `${head}\n\n${said}` : head
}

// A reply on the phone answers the question it replies to.
telegram.configure({
  onCommand: (command, arg) => (command === 'status' ? progressText() : command === 'task' ? taskText(arg) : helpText()),
  onAnswer: ({ questionId, text }) => {
    // The question id is what counts; the task id in the message is only a label.
    const owner = Object.values(tasks).find((t) => (t.questions || []).some((q) => q.id === questionId && q.answer === null))
    if (!owner) throw new Error(`no open question ${questionId}`)
    return answerQuestion(owner.id, questionId, text)
  },
})

const children = new Map() // taskId -> ChildProcess
const lastHeard = new Map() // taskId -> when the agent last streamed anything
const scrubFor = new Map() // taskId -> [[value, placeholder]] while a run is live

/** Log for a live run: a kept value the agent let slip never reaches the file. */
function logRun(task, entry) {
  const pairs = scrubFor.get(task.id)
  if (pairs?.length && typeof entry.text === 'string') {
    let text = entry.text
    for (const [value, placeholder] of pairs) text = text.split(value).join(placeholder)
    entry = { ...entry, text }
  }
  return log(task.id, entry)
}
const stopped = (task) => ['cancelled', 'interrupted'].includes(tasks[task.id]?.status)
const gateWaiters = new Map() // taskId -> resolve(feedbackOrNull)
const questionWaiters = new Map() // questionId -> resolve(answer)
const queue = []
let running = 0

const quiet = (fn) => { try { return fn() } catch { return '' } }
const git = (cwd, ...args) =>
  execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

const firstLine = (text) => {
  const line = text.trim().split('\n')[0].trim()
  return line.length > 72 ? `${line.slice(0, 69)}...` : line
}

// Dropping every letter outside a-z turns "thay doi nut" into "thay-i-n-t".
// Splitting the accents off first leaves the letter behind; d-with-stroke is
// one character with nothing to split, so it is spelled out.
const slugify = (s) =>
  String(s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u0111\u0110]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
    .replace(/-$/, '') || 'task'

const hasRef = (repoPath, ref) => {
  try { git(repoPath, 'rev-parse', '--verify', '--quiet', ref); return true } catch { return false }
}

/**
 * The branch has to exist before anything has read the request, so its name is
 * slugged from the request itself, in whatever language that was written in.
 * Once the agent has named the task in English, move the branch to match.
 *
 * Nothing is pushed this early, so the old name has no life off this machine.
 * If something did push it, leave it: a name is not worth breaking a remote
 * over, and it is not worth failing a task over either.
 */
function renameBranches(task) {
  const wanted = `flow/${slugify(task.title)}-${task.id}`
  for (const tree of task.trees || []) {
    if (tree.branch === wanted) continue
    try {
      if (hasRef(tree.repoPath, wanted)) continue
      if (hasRef(tree.repoPath, `refs/remotes/origin/${tree.branch}`)) continue
      git(tree.repoPath, 'branch', '-m', tree.branch, wanted)
      tree.branch = wanted
    } catch (err) {
      log(task.id, { kind: 'stderr', text: `kept the branch name ${tree.branch}: ${err.message}` })
    }
  }
}

/**
 * Keep the values the human chose to keep out of the transcript, and rewrite
 * any text attachment that still carries one. Returns the names.
 */
function keepSecrets(id, given, attached) {
  const kept = []
  for (const { name, value } of given || []) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name || '')) throw new Error(`bad secret name: ${name}`)
    if (!value) throw new Error(`secret ${name} has no value`)
    secrets.keep(id, name, value)
    kept.push(name)
  }
  if (!kept.length) return kept
  for (const file of attached) {
    if (!secrets.TEXT_ATTACHMENT.test(file)) continue
    const text = fs.readFileSync(file, 'utf8')
    let out = text
    for (const { name, value } of given) out = out.split(value).join(`{{secret:${name}}}`)
    if (out !== text) fs.writeFileSync(file, out)
  }
  return kept
}

/** The prompt and the text attachments, as texts to scan together. */
function sources(prompt, attached) {
  return [
    { key: 'prompt', text: prompt },
    ...attached
      .filter((f) => secrets.TEXT_ATTACHMENT.test(f))
      .map((f) => ({ key: f, text: fs.readFileSync(f, 'utf8') })),
  ]
}

/** What in this prompt and these attachments looks like a secret: names and where, never values. */
export function scanSecrets(prompt, attachments) {
  const attached = attachments.map(verifyUpload)
  const found = []
  for (const { key, text } of sources(prompt, attached)) {
    for (const f of secrets.detect(text)) {
      found.push({ name: f.name, count: f.spans.length, where: key === 'prompt' ? 'prompt' : path.basename(key) })
    }
  }
  return found
}

/**
 * hideSecrets: find them here, keep them, and carry on with the redacted
 * texts, so the values never make a second trip through the client.
 */
function hideIn(prompt, attached, existing = []) {
  const start = Math.max(0, ...existing.map((n) => Number((/^SECRET_(\d+)$/.exec(n) || [])[1] || 0)))
  const { secrets: found, texts } = secrets.hide(sources(prompt, attached), { start })
  for (const [key, text] of Object.entries(texts)) if (key !== 'prompt') fs.writeFileSync(key, text)
  return { prompt: texts.prompt, secrets: found }
}

export function createTask({
  title, prompt, repos, attachments = [], images = [], autoApprove = false, run, model, effort,
  permissionMode, shopify, secrets: given = [], hideSecrets = false,
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
  if (hideSecrets) {
    const hid = hideIn(prompt, attached)
    prompt = hid.prompt
    given = [...given, ...hid.secrets]
  }
  const kept = keepSecrets(id, given, attached)
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
    secrets: kept,
    // Which app config and store `shopify app dev` may use for this task.
    shopify: shopify?.config ? { config: shopify.config, store: shopify.store || '' } : null,
    model: pick(model, MODELS, DEFAULTS.model, 'model'),
    effort: pick(effort, EFFORTS, DEFAULTS.effort, 'effort'),
    permissionMode: pick(permissionMode, MODES, DEFAULTS.permissionMode, 'permission mode'),
    autoApprove,
    status: 'queued',
    phase: null,
    // Nothing chosen is a choice: the plain route, not the full ceremony.
    run: pick(run, RUN_VALUES, 'ask', 'run'),
    phases: Object.fromEntries(
      phasesFor(pick(run, RUN_VALUES, 'ask', 'run')).map((p) => [p, { status: 'pending' }]),
    ),
    questions: [],
    cost: 0,
    turns: 0,
    createdAt: Date.now(),
  }
  // The document route checks nothing out: it works in a folder under the
  // task, with the repos reachable to read.
  if (task.run === 'doc') {
    const work = path.join(artifactDir(id), 'work')
    fs.mkdirSync(work, { recursive: true })
    task.root = work
    task.artifactDir = artifactDir(id)
    task.trees = []
    task.readPaths = task.repoPaths
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

/** Generated, gitignored files the checkout has and a fresh worktree does not. */
function copyFromCheckout(task, tree, paths) {
  const copied = []
  for (const p of paths || []) {
    const from = path.join(tree.repoPath, p)
    const to = path.join(tree.worktree, p)
    if (!fs.existsSync(from)) continue
    fs.mkdirSync(path.dirname(to), { recursive: true })
    fs.cpSync(from, to, { recursive: true, force: true })
    copied.push(p)
  }
  if (copied.length) log(task.id, { kind: 'text', text: `Copied from the checkout: ${copied.join(', ')}` })
  return copied
}

/** A shell command in the worktree, logged like a tool call, capped so it cannot hang the task. */
function runCommand(task, cwd, cmd, label) {
  log(task.id, { kind: 'tool', tool: label, text: cmd })
  return new Promise((resolve) => {
    const child = spawn(WIN ? 'cmd.exe' : 'sh', WIN ? ['/c', cmd] : ['-c', cmd], {
      cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'], detached: !WIN,
    })
    children.set(task.id, child)
    let out = ''
    const take = (d) => { out += d; if (out.length > 200_000) out = out.slice(-100_000) }
    child.stdout.on('data', take)
    child.stderr.on('data', take)
    let capped = false
    const timer = setTimeout(() => { capped = true; killTree(child) }, SETUP_MAX_MS)
    const finish = (code, tail) => {
      clearTimeout(timer)
      if (children.get(task.id) === child) children.delete(task.id)
      resolve({ code, tail, capped })
    }
    child.on('error', (err) => finish(-1, err.message))
    child.on('close', (code) => finish(code, out.trim().split('\n').slice(-40).join('\n')))
  })
}

const capWords = () => (SETUP_MAX_MS >= 60_000 ? `${Math.round(SETUP_MAX_MS / 60_000)} min` : `${Math.round(SETUP_MAX_MS / 1000)} s`)

/**
 * What the repo says a worktree needs, once per checkout: the setup command,
 * then the checks run once at base so a failure that was already there is
 * known before the agent starts and never mistaken for its own.
 */
async function prepareWorktrees(task) {
  if (!task.trees?.length || task.prepared === task.root) return
  const needed = task.trees.some((t) => { const c = repoConfig.get(t.repoPath); return c.setup || (c.checks.length && !task.baseline?.[t.repo]) })
  if (!needed) return update(task.id, { prepared: task.root })
  // Visible while it runs: a ten-minute install that reads as "queued" is a mystery.
  const before = { status: task.status, phase: task.phase }
  update(task.id, { status: 'running', phase: 'setup' })
  try {
    await prepareEach(task)
  } finally {
    if (!stopped(task)) update(task.id, before)
  }
}

async function prepareEach(task) {
  for (const tree of task.trees) {
    const cfg = repoConfig.get(tree.repoPath)
    if (cfg.setup) {
      const r = await runCommand(task, tree.worktree, cfg.setup, 'Setup')
      update(task.id, { setupResult: { ...(task.setupResult || {}), [tree.repo]: { cmd: cfg.setup, code: r.code, capped: r.capped } } })
      if (r.capped) log(task.id, { kind: 'error', text: `setup capped at ${capWords()} for ${tree.repo}; the run starts anyway` })
      else if (r.code !== 0) log(task.id, { kind: 'error', text: `setup exited ${r.code} for ${tree.repo}:\n${r.tail}` })
      else if (r.tail) log(task.id, { kind: 'text', text: r.tail })
      if (stopped(task)) return
    }
    if (cfg.checks.length && !task.baseline?.[tree.repo] && quiet(() => git(tree.worktree, 'rev-parse', 'HEAD')).trim() !== tree.baseRef) {
      // Checks run on the branch tip would be the branch's failures, labelled as base's.
      log(task.id, { kind: 'text', text: `Baseline skipped for ${tree.repo}: the worktree is past its base, so the checks were not run as a baseline.` })
      update(task.id, { baseline: { ...(task.baseline || {}), [tree.repo]: null } })
      continue
    }
    if (cfg.checks.length && !task.baseline?.[tree.repo]) {
      const dir = path.join(task.artifactDir, 'baseline', tree.repo)
      fs.mkdirSync(dir, { recursive: true })
      const results = []
      for (let n = 0; n < cfg.checks.length; n++) {
        const cmd = cfg.checks[n]
        const r = await runCommand(task, tree.worktree, cmd, 'Baseline')
        fs.writeFileSync(path.join(dir, `${n}.txt`), `$ ${cmd}\nexit ${r.capped ? 'capped' : r.code}\n${r.tail}\n`)
        results.push({ cmd, code: r.capped ? null : r.code })
        if (stopped(task)) return
      }
      update(task.id, { baseline: { ...(task.baseline || {}), [tree.repo]: results }, baselineAt: Date.now() })
      const red = results.filter((x) => x.code !== 0)
      log(task.id, {
        kind: 'text',
        text: `Baseline for ${tree.repo}: ${red.length} of ${results.length} checks red at base` +
          (red.length ? ` (${red.map((x) => `${x.cmd} → exit ${x.code ?? 'capped'}`).join('; ')})` : ''),
      })
    }
  }
  update(task.id, { prepared: task.root })
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
    const tree = { repo, repoPath, worktree, branch, baseRef, baseBranch }
    copyFromCheckout(task, tree, repoConfig.get(repoPath).copy)
    return tree
  })

  const dir = artifactDir(task.id)
  fs.mkdirSync(dir, { recursive: true })

  // With one repo, run inside it, so the CLI finds its CLAUDE.md the usual way.
  // With several, run one level up and let the prompt name each worktree.
  forgetDiskSize()
  update(task.id, {
    trees,
    root: trees.length === 1 ? trees[0].worktree : base,
    artifactDir: dir,
    droppedAt: null,
  })
}

async function runTask(task) {
  try {
    if (task.run === 'doc') fs.mkdirSync(task.root, { recursive: true })
    else if (!task.root) setupWorktrees(task)
  } catch (err) {
    log(task.id, { kind: 'error', text: `worktree setup failed: ${err.message}` })
    return fail(task, err.message)
  }
  try {
    await prepareWorktrees(task)
  } catch (err) {
    log(task.id, { kind: 'error', text: `worktree preparation failed: ${err.message}` })
    return fail(task, err.message)
  }
  if (stopped(task)) return

  let feedback = null
  for (const phase of phasesFor(task.run)) {
    if (stopped(task)) return
    if (task.phases[phase].status === 'done') continue

    update(task.id, { status: 'running', phase, error: null })
    task.phases[phase] = { status: 'running', startedAt: Date.now() }
    emit(task)

    const prompt = buildPrompt(phase, {
      ...task,
      node: NODE_BIN,
      askScript: ASK_SCRIPT,
      previewScript: task.trees?.some((t) => devServer.isShopifyApp(t.worktree)) ? PREVIEW_SCRIPT : null,
      needsTitle: phase === phasesFor(task.run)[0],
      feedback,
    })
    feedback = null

    let result
    try {
      result = await runPhase(task, phase, prompt)
    } catch (err) {
      task.phases[phase] = { ...task.phases[phase], status: 'failed', endedAt: Date.now() }
      return fail(task, err.message)
    }
    if (stopped(task)) return

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
      if (written) {
        task.title = firstLine(written)
        renameBranches(task)
      }
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
  drain(task.id)
}

function fail(task, message) {
  update(task.id, { status: 'failed', error: message })
  tell(task, `Failed: ${task.title}`, message.slice(0, 180), true)
  // A message queued behind a failure is usually about the failure.
  drain(task.id)
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

const CONTINUE = /^(tiếp tục|continue|carry on)[.!]?$/iu
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
  tell(task, `Question: ${task.title}`, text.slice(0, 180), true, { phone: false })
  // What it said before asking goes first, as context; the question last, so
  // it is the message at the bottom of the chat to reply to.
  const before = lastSaid(task)
  ;(async () => {
    if (before && before !== text.trim()) await telegram.send(`${task.title} — before the question:\n\n${before}`)
    await telegram.send(text, { taskId: id, questionId: question.id })
  })()
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
/**
 * One phase run. A task carrying `resumeFrom` for this phase continues that
 * session instead; a session the CLI will not continue (expired, CLI updated)
 * exits without streaming anything, and then the phase runs fresh, out loud.
 */
async function runPhase(task, phase, prompt) {
  const meta = { kind: 'phase', phase }
  const from = task.resumeFrom
  if (from) update(task.id, { resumeFrom: null })
  if (from?.kind !== 'phase' || from.phase !== phase) return runClaude(task, prompt, task.root, { meta })

  try {
    return await runClaude(task, resumePrompt(), task.root, { meta, resume: from.id })
  } catch (err) {
    if (err.streamed || stopped(task)) throw err
    log(task.id, { kind: 'text', text: 'resume refused; running the phase again' })
    return runClaude(task, prompt, task.root, { meta })
  }
}

function sideRun(task, label, prompt, cwd, finished, opts = {}) {
  const previous = task.status
  // The previous run's session is not this run's: a restart during setup must
  // not continue it in place of what was just asked for.
  update(task.id, { status: 'running', phase: label, error: null, lastSession: null })

  const { after, outcome, ...runOpts } = opts
  prepareWorktrees(task)
    .then(() => (stopped(task) ? null : runClaude(task, prompt, cwd, { ...runOpts, meta: { kind: 'side', label } })))
    .then(() => {
      if (stopped(task)) return
      update(task.id, { status: previous, phase: null })
      // The outcome is checked, not assumed: the agent may have stopped at a
      // guard, a failing check or a refused push and still exited cleanly.
      let outcome = null
      if (opts.outcome) {
        try { outcome = opts.outcome() } catch (err) { outcome = { ok: false, line: `Could not check the outcome: ${err.message}`, title: finished } }
        log(task.id, { kind: 'decision', text: outcome.line })
      }
      tell(task, outcome ? outcome.title : finished, task.repos.join(' + '), outcome ? !outcome.ok : false)
      if (opts.after && (!outcome || outcome.ok)) {
        try { opts.after(); return } catch (err) {
          log(task.id, { kind: 'error', text: `could not go on: ${err.message}` })
          tell(task, `Could not go on: ${task.title}`, err.message.slice(0, 180), true)
        }
      }
      drain(task.id)
    })
    .catch((err) => {
      if (stopped(task)) return
      fail(task, `${label}: ${err.message}`)
    })

  return task
}

function readyForSideRun(id) {
  const task = tasks[id]
  if (!task) throw new Error('unknown task')
  if (task.status === 'running' || task.status === 'queued') throw new Error('this task is already running')
  // A dropped worktree means the checkout was reclaimed, not that the work is
  // gone: the branches are still there. Check them out again and carry on,
  // rather than making someone undo the tidying by hand.
  if (!task.root) setupWorktrees(task)
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
    buildCatchUpPrompt(tree, { ...task, node: NODE_BIN, askScript: ASK_SCRIPT }),
    tree.worktree,
    `Caught up: ${task.title}`,
  )
}

/**
 * Land this branch on its base, agent-driven.
 *
 * The plain merge refuses whenever the base has moved, which is most of the
 * time, and then it is on you to catch up and come back. This does both in
 * one run, in the worktree, and stops rather than guessing when the checkout
 * is somewhere it should not be touched.
 */
export function mergeViaAgent(id, repo, { target, then } = {}) {
  const task = readyForSideRun(id)
  const tree = task.trees?.find((t) => t.repo === repo)
  if (!tree) throw new Error(`unknown repo: ${repo}`)
  target = String(target || tree.baseBranch).trim()
  if (then && then !== 'ship') throw new Error(`unknown follow-on: ${then}`)
  if (!/^[A-Za-z0-9][A-Za-z0-9._\/-]*$/.test(target)) throw new Error(`not a branch name: ${target}`)
  // A branch that exists somewhere, or at least a name git would accept: the
  // push creates a new one, which is a thing people ask for (a release branch).
  if (!targetsOf(tree).includes(target)) {
    try { git(tree.repoPath, 'check-ref-format', '--branch', target) } catch { throw new Error(`not a branch name: ${target}`) }
  }
  if (target === tree.branch) throw new Error('that is the task branch itself')
  repoConfig.set(tree.repoPath, { landTarget: target === tree.baseBranch ? null : target })

  const hasRemote = Boolean(quiet(() => git(tree.repoPath, 'remote')).split('\n')[0])
  log(id, {
    kind: 'decision',
    text: `Push ${tree.branch}, open a merge request, then land on ${target}`,
  })
  return sideRun(
    task,
    `landing on ${target}`,
    buildMergePrompt(tree, { ...task, target, hasRemote, node: NODE_BIN, askScript: ASK_SCRIPT, guardScript: GUARD_SCRIPT }),
    tree.worktree,
    `Landed on ${target}: ${task.title}`,
    {
      // What actually happened, checked rather than assumed: is the branch on the target now?
      outcome: () => {
        const ref = quiet(() => git(tree.repoPath, 'rev-parse', '--verify', '--quiet', `origin/${target}`)) ? `origin/${target}` : target
        const left = Number(quiet(() => git(tree.repoPath, 'rev-list', '--count', `${ref}..${tree.branch}`)).trim() || '0')
        return left === 0
          ? { ok: true, line: `Landed on ${target}`, title: `Landed on ${target}: ${task.title}` }
          : { ok: false, line: `Landing on ${target} stopped: ${left} commit${left === 1 ? '' : 's'} still not on ${target}`, title: `Landing on ${target} stopped: ${task.title}` }
      },
      // One click, two runs: when the landing really landed, ship the same repo.
      ...(then === 'ship' ? { after: () => shipViaAgent(id, repo) } : {}),
    },
  )
}

/**
 * Send whatever was typed while the agent was busy.
 *
 * Run after anything that ends a run, including one that failed: a message
 * queued behind a failure is usually about the failure.
 */
function drain(id) {
  const task = tasks[id]
  if (!task?.queued?.length) return
  if (task.status === 'running' || task.status === 'queued') return

  const waiting = task.queued
  update(id, { queued: [] })
  // One run for everything that piled up, in the order it was typed: three
  // separate agent runs for three sentences is three times the price and
  // loses the thread between them.
  followUp(id, waiting.join('\n\n'), { logged: true })
}

/**
 * Ship to prod: the task's commits, cherry-picked onto the prod branch in a
 * worktree of their own, by an agent, then pushed and watched. Refused when
 * the branch has not landed on its base yet, when the repo has no prod
 * branch, and when there is nothing left to pick.
 */
export function shipViaAgent(id, repo) {
  const task = readyForSideRun(id)
  const tree = task.trees?.find((t) => t.repo === repo)
  if (!tree) throw new Error(`unknown repo: ${repo}`)

  const { prodBranch, jenkins, smoke } = repoConfig.get(tree.repoPath)
  try { git(tree.repoPath, 'fetch', '-q', 'origin', prodBranch) } catch {} // no remote, or offline: the local branch is what there is
  const { exists, shas } = toPick(tree, prodBranch)
  if (!exists) throw new Error(`${repo} has no ${prodBranch} branch`)
  if (statusRow(tree).ahead > 0) throw new Error(`land ${tree.branch} on ${tree.baseBranch} first`)
  if (!shas.length) throw new Error(`nothing left to pick onto ${prodBranch}: every commit of this task is already there`)

  const prodWorktree = path.join(DATA, 'worktrees', task.id, `${repo}-prod`)
  if (!fs.existsSync(prodWorktree)) {
    // git refuses one branch in two worktrees. An earlier task's prod
    // worktree is scratch once its ship ended: take it down, never the
    // person's own checkout.
    const real = (p) => { try { return fs.realpathSync(p) } catch { return p } } // /var vs /private/var on macOS
    const ours = real(path.join(DATA, 'worktrees')) + path.sep
    const listed = quiet(() => git(tree.repoPath, 'worktree', 'list', '--porcelain')).split('\n\n')
    for (const block of listed) {
      const where = (/^worktree (.+)$/m.exec(block) || [])[1]
      const onBranch = (/^branch refs\/heads\/(.+)$/m.exec(block) || [])[1]
      if (where && onBranch === prodBranch && real(where).startsWith(ours) && real(where) !== real(prodWorktree)) {
        // Whose is it? A task still shipping keeps its worktree; a ship that
        // ended left scratch behind.
        const owner = real(where).slice(ours.length).split(path.sep)[0]
        const theirs = tasks[owner]
        if (theirs && (['running', 'queued', 'awaiting_approval', 'awaiting_answer'].includes(theirs.status) || children.has(owner))) {
          throw new Error(`task ${owner} (${theirs.title}) is shipping to ${prodBranch} right now; wait for it`)
        }
        try { git(tree.repoPath, 'worktree', 'remove', '--force', where) } catch {}
      }
    }
    git(tree.repoPath, 'worktree', 'add', prodWorktree, prodBranch)
  }
  forgetDiskSize()

  log(id, {
    kind: 'decision',
    text: `Ship to ${prodBranch}: cherry-pick ${shas.length} commit${shas.length === 1 ? '' : 's'} of ${tree.branch} onto ${prodBranch}, push it${jenkins ? `, and watch ${jenkins.job}` : ''}`,
  })
  return sideRun(
    task,
    `shipping to ${prodBranch}`,
    buildShipPrompt(tree, {
      ...task, prodBranch, shas, prodWorktree, jenkins, smoke,
      node: NODE_BIN, askScript: ASK_SCRIPT, guardScript: GUARD_SCRIPT, jenkinsScript: JENKINS_SCRIPT,
    }),
    prodWorktree,
    `Shipped to ${prodBranch}: ${task.title}`,
    {
      env: repoConfig.jenkinsEnv(tree.repoPath),
      outcome: () => {
        try { git(tree.repoPath, 'fetch', '-q', 'origin', prodBranch) } catch {}
        const left = toPick(tree, prodBranch).shas.length
        return left === 0
          ? { ok: true, line: `Shipped to ${prodBranch}`, title: `Shipped to ${prodBranch}: ${task.title}` }
          : { ok: false, line: `Shipping to ${prodBranch} stopped: ${left} commit${left === 1 ? '' : 's'} still to pick`, title: `Shipping to ${prodBranch} stopped: ${task.title}` }
      },
    },
  )
}

/**
 * Keep working on a finished task: the build broke, the fix was not quite it,
 * one more thing. Same worktrees, same branches, no new task to lose the
 * context of what this already is.
 */
/**
 * Switch the model part-way through a conversation.
 *
 * The CLI args are rebuilt on every spawn, so this lands on the next run and
 * never on the one in flight: there is no way to reach a process that is
 * already talking, and pretending otherwise would be the lie. It goes in the
 * transcript because reading a conversation later and wondering why the
 * answers changed shape is exactly the question this has to answer.
 */
/** Same as the model: read fresh at every spawn, so it lands on the next run. */
export function setEffort(id, effort) {
  const task = tasks[id]
  if (!task) throw new Error('unknown task')
  const next = pick(effort, EFFORTS, DEFAULTS.effort, 'effort')
  if (next === (task.effort || '')) return task
  log(id, { kind: 'decision', text: `Effort: ${task.effort || 'default'} \u2192 ${next || 'default'}` })
  return update(id, { effort: next })
}

function queueOf(id) {
  const task = tasks[id]
  if (!task) throw new Error('unknown task')
  return [...(task.queued || [])]
}

/** Reword something still waiting in line. */
export function editQueued(id, index, request) {
  const queue = queueOf(id)
  if (!(index >= 0 && index < queue.length)) throw new Error('that is no longer in the queue')
  const text = String(request ?? '').trim()
  if (!text) throw new Error('say what you want changed')
  queue[index] = text
  return update(id, { queued: queue })
}

/** Take it out of the line before the run that would have picked it up. */
export function dropQueued(id, index) {
  const queue = queueOf(id)
  if (!(index >= 0 && index < queue.length)) throw new Error('that is no longer in the queue')
  queue.splice(index, 1)
  return update(id, { queued: queue })
}

export function setModel(id, model) {
  const task = tasks[id]
  if (!task) throw new Error('unknown task')
  const next = pick(model, MODELS, DEFAULTS.model, 'model')
  if (next === (task.model || '')) return task
  log(id, { kind: 'decision', text: `Model: ${task.model || 'default'} \u2192 ${next || 'default'}` })
  return update(id, { model: next })
}

export function followUp(id, request, { secrets: given = [], hideSecrets = false, logged = false } = {}) {
  if (!request?.trim()) throw new Error('say what you want changed')

  // Busy is not a reason to lose what someone just typed. It waits in line
  // and goes as soon as the run in front of it is done.
  const busy = tasks[id]
  if (!busy) throw new Error('unknown task')
  if (hideSecrets) {
    const hid = hideIn(request, [], busy.secrets || [])
    request = hid.prompt
    given = [...given, ...hid.secrets]
  }
  if (given?.length) {
    const kept = keepSecrets(id, given, [])
    update(id, { secrets: [...new Set([...(busy.secrets || []), ...kept])] })
  }
  if (busy.status === 'running' || busy.status === 'queued') {
    update(id, { queued: [...(busy.queued || []), request.trim()] })
    log(id, { kind: 'decision', text: request.trim() })
    return busy
  }

  const task = readyForSideRun(id)

  // "Continue" means continue: the same session, not a new run told the story again.
  if (CONTINUE.test(request.trim()) && task.lastSession?.id) {
    if (!logged) log(id, { kind: 'decision', text: request.trim() })
    return sideRun(task, 'follow-up', resumePrompt(), task.lastSession.cwd || task.root, `Follow-up done: ${task.title}`, {
      resume: task.lastSession.id,
    })
  }

  if (!logged) log(id, { kind: 'decision', text: request.trim() })
  return sideRun(
    task,
    'follow-up',
    buildFollowUpPrompt({ ...task, node: NODE_BIN, askScript: ASK_SCRIPT, request: request.trim() }),
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

  // Stop means stop, including the things waiting their turn. Said out loud,
  // because a message that quietly evaporates is worse than one refused.
  if (task.queued?.length) {
    log(id, { kind: 'decision', text: `Dropped ${task.queued.length} queued message(s) on cancel` })
  }
  update(id, {
    status: 'cancelled',
    phase: null,
    awaitingPhase: null,
    openQuestionId: null,
    queued: [],
  })
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

/**
 * Throw the whole task away: its conversation, its documents, its checkout.
 * The branches are left alone, because they are the work and this is not the
 * button for discarding that.
 */
export function remove(id) {
  const task = tasks[id]
  if (!task) throw new Error('unknown task')
  if (task.status === 'running' || task.status === 'queued') throw new Error('stop the task first')
  if (children.has(id)) throw new Error('the agent is still shutting down, try again in a moment')

  if (task.root) {
    try {
      removeWorktrees(id)
    } catch (err) {
      throw new Error(`could not remove the worktree: ${err.message}`)
    }
  }

  fs.rmSync(artifactDir(id), { recursive: true, force: true })
  fs.rmSync(path.join(DATA, 'logs', `${id}.jsonl`), { force: true })
  secrets.forget(id, task.secrets || [])

  // The pictures that were sent with it belong to the conversation, so they
  // go with it. Dropping a worktree leaves them alone: the conversation is
  // still there and still shows them.
  const uploads = path.resolve(DATA, 'uploads')
  for (const file of [...(task.attachments || []), ...(task.images || [])]) {
    const full = path.resolve(file)
    // Only inside the uploads folder, so a stored path cannot reach out.
    if (full.startsWith(`${uploads}${path.sep}`)) fs.rmSync(full, { force: true })
  }
  delete tasks[id]
  bus.emit('task', { id, removed: true })
  save()

  return { id, branches: (task.trees || []).map((t) => `${t.repo}/${t.branch}`) }
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

  // A run that failed during a follow-up leaves every phase done: the failure
  // was not in one. Retrying walked straight past all of them and announced
  // that the task had finished, which it had, hours ago.
  if (phasesFor(task.run).every((p) => task.phases[p].status === 'done')) {
    throw new Error(
      'every phase of this task already finished, so there is nothing to run again. ' +
        'Ask for what you want in the box at the bottom instead.',
    )
  }

  update(id, { status: 'queued', error: null, openQuestionId: null })
  queue.push(id)
  pump()
  return task
}

/**
 * Continue an interrupted run in the session it had, so the agent keeps what it
 * knew instead of being told the story again from the last message.
 */
export function resume(id) {
  const task = tasks[id]
  if (!task) throw new Error('unknown task')
  if (task.status !== 'interrupted') throw new Error('this task was not interrupted')
  if (!task.lastSession?.id) throw new Error('no session to continue; retry instead')

  log(id, { kind: 'decision', text: 'Continuing the interrupted session' })
  if (!task.root) setupWorktrees(task)
  if (task.lastSession.kind === 'side') {
    // A side run started from a finished task; that is what it goes back to.
    update(id, { status: 'done', error: null })
    return sideRun(task, task.lastSession.label, resumePrompt(), task.lastSession.cwd, `Done: ${task.title}`, {
      resume: task.lastSession.id,
    })
  }
  update(id, { status: 'queued', error: null, resumeFrom: task.lastSession })
  queue.push(id)
  pump()
  return task
}

/** Files a task produced under <artifacts>/work, newest first, capped. */
export function output(id, { cap = 200 } = {}) {
  const task = tasks[id]
  if (!task) throw new Error('unknown task')
  const dir = path.join(task.artifactDir || artifactDir(id), 'work')
  let names = []
  try { names = fs.readdirSync(dir) } catch { return { files: [], truncated: false } }
  const files = names
    .map((name) => {
      try {
        const st = fs.statSync(path.join(dir, name))
        return st.isFile() ? { name, bytes: st.size, mtime: st.mtimeMs } : null
      } catch { return null }
    })
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime)
  return { files: files.slice(0, cap), truncated: files.length > cap }
}

/** One produced file, by name only: nothing outside work/ is reachable. */
export function outputFile(id, name) {
  const task = tasks[id]
  if (!task) throw new Error('unknown task')
  if (!name || name !== path.basename(name) || name.startsWith('.')) {
    throw Object.assign(new Error('a file name, not a path'), { status: 400 })
  }
  const file = path.join(task.artifactDir || artifactDir(id), 'work', name)
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw Object.assign(new Error('no such file'), { status: 404 })
  return file
}

/** A plain task that produced a document is offered the Document route: only the route changes. */
export function switchRun(id, run) {
  const task = tasks[id]
  if (!task) throw new Error('unknown task')
  if (run !== 'doc') throw new Error('only a switch to the Document route is offered')
  if (task.status === 'running' || task.status === 'queued') throw new Error('wait for the run to finish')
  update(id, { run: 'doc', readPaths: task.repoPaths, phases: { ...task.phases, write: { status: 'done' } } })
  return task
}

/**
 * A file the conversation named, found inside the task: its worktrees, its
 * artifacts, its work folder, its repos. Bare names are looked up among the
 * tracked files of each worktree. Nothing outside those folders resolves,
 * whatever the name says.
 */
export function resolveFile(id, name) {
  const task = tasks[id]
  if (!task) throw new Error('unknown task')
  const given = String(name || '').trim()
  if (!given) throw new Error('no file name')
  const dir = task.artifactDir || artifactDir(id)
  const homes = [
    ...(task.trees || []).map((t) => t.worktree),
    task.root,
    path.join(dir, 'work'),
    dir,
    ...(task.repoPaths || []),
  ].filter((h, i, all) => h && all.indexOf(h) === i)
  const inside = (file) => homes.some((h) => file === h || file.startsWith(h + path.sep))

  const direct = path.isAbsolute(given) ? [given] : homes.map((h) => path.resolve(h, given))
  for (const file of direct) {
    if (inside(file) && fs.existsSync(file)) return file
  }
  const base = path.basename(given)
  for (const home of homes) {
    let listed = ''
    try { listed = execFileSync('git', ['-C', home, 'ls-files', '--', `*/${base}`, base], { encoding: 'utf8', maxBuffer: 32 << 20 }) } catch { continue }
    const hit = listed.split('\n').find((f) => f && path.basename(f) === base)
    if (hit) {
      const file = path.resolve(home, hit)
      if (inside(file) && fs.existsSync(file)) return file
    }
  }
  throw Object.assign(new Error(`no file called ${given} in this task`), { status: 404 })
}

/** Show the file where it lives: Finder, Explorer, or the folder it is in. */
export function reveal(id, name) {
  const file = resolveFile(id, name)
  if (process.env.FLOW_REVEAL !== 'off') {
    const [cmd, args] = process.platform === 'darwin'
      ? ['open', ['-R', file]]
      : WIN ? ['explorer', [`/select,${file}`]] : ['xdg-open', [path.dirname(file)]]
    spawn(cmd, args, { stdio: 'ignore', detached: true }).unref()
  }
  return { path: file }
}

// ---- Progress, as text for the phone --------------------------------------

const LIVE = ['running', 'queued', 'awaiting_answer', 'awaiting_approval', 'interrupted']
const WAITING = ['awaiting_answer', 'awaiting_approval', 'interrupted']

const sentence = (text, cap = 140) => {
  const flat = String(text || '').replace(/^[#>*\-\s]+/gm, '').replace(/\s+/g, ' ').trim()
  const first = (/^.*?[.!?](?=\s|$)/.exec(flat) || [flat])[0]
  return first.length > cap ? `${first.slice(0, cap)}…` : first
}

const ago = (ms) => {
  const m = Math.floor(ms / 60000)
  return m < 1 ? '<1m' : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`
}

const where = (task) => ({
  running: PHASE_LABEL[task.phase] || task.phase || 'running',
  queued: 'queued',
  awaiting_answer: 'question for you',
  awaiting_approval: `your call: ${PHASE_LABEL[task.awaitingPhase] || task.awaitingPhase}`,
  interrupted: 'interrupted',
  done: 'done',
  failed: 'failed',
  cancelled: 'cancelled',
}[task.status] || task.status)

/** What the agent did last: its last sentence, or the tool it is on while running. */
function didOf(task, entries) {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]
    if (e.kind === 'text') return sentence(e.text)
    if (e.kind === 'tool' && task.status === 'running') return `${e.tool} ${sentence(e.text, 100)}`
  }
  return null
}

/** What it needs from the person: the open question, the gate, or a continue. */
function needsOf(task) {
  if (task.status === 'awaiting_answer') {
    const q = (task.questions || []).find((x) => x.id === task.openQuestionId) || (task.questions || []).findLast((x) => x.answer === null)
    if (q) return sentence(q.text, 300)
  }
  if (task.status === 'awaiting_approval') return `${PHASE_LABEL[task.awaitingPhase] || task.awaitingPhase} is ready for you to approve`
  if (task.status === 'interrupted') return 'continue it, or retry'
  return null
}

/** /status: every task that is live, the ones waiting on the person first. */
export function progressText() {
  const live = Object.values(tasks).filter((t) => LIVE.includes(t.status))
  if (!live.length) {
    const last = Object.values(tasks).filter((t) => t.status === 'done').sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0]
    return last ? `Nothing running.\nLast done: ${last.title} (${last.id}), ${ago(Date.now() - (last.updatedAt || last.createdAt))} ago.` : 'Nothing running.'
  }
  const waiting = live.filter((t) => WAITING.includes(t.status))
  const working = live.filter((t) => !WAITING.includes(t.status))
  const head = [
    working.length ? `${working.length} running` : null,
    waiting.length ? `${waiting.length} waiting on you` : null,
  ].filter(Boolean).join(' · ')
  const lines = [head]
  for (const task of [...waiting, ...working]) {
    const icon = task.status === 'running' ? '▶' : task.status === 'queued' ? '…' : '⏸'
    lines.push('', `${icon} ${task.title} (${task.id})`)
    lines.push(`   ${where(task)} · ${ago(Date.now() - task.createdAt)} · $${(task.cost || 0).toFixed(2)}`)
    const needs = needsOf(task)
    if (needs) lines.push(`   needs: ${needs}`)
    const did = didOf(task, readLog(task.id, 40))
    if (did) lines.push(`   did: ${did}`)
  }
  lines.push('', 'Details: /task <id>')
  return lines.join('\n')
}

/** /task <id>: one task, found by the start of its id. */
export function taskText(prefix) {
  const want = String(prefix || '').trim().toLowerCase()
  if (!want) return 'Which one? /task <id>, the id is in /status.'
  const hits = Object.values(tasks).filter((t) => t.id.startsWith(want))
  if (!hits.length) return `No task matches ${want}.`
  if (hits.length > 1) return `${hits.length} tasks match ${want}:\n${hits.map((t) => `${t.id} · ${t.title}`).join('\n')}`
  const task = hits[0]
  const entries = readLog(task.id, 200).filter((e) => ['text', 'tool', 'question', 'answer', 'decision', 'error'].includes(e.kind))
  const mark = { text: '•', tool: '$', question: '?', answer: '→', decision: '#', error: '!' }
  const lines = [
    `${task.id} · ${task.title}`,
    `${where(task)} · ${(task.repos || []).join(' + ')} · ${ago(Date.now() - task.createdAt)} · $${(task.cost || 0).toFixed(2)}`,
  ]
  const needs = needsOf(task)
  if (needs) lines.push(`needs: ${needs}`)
  lines.push('', 'Latest:')
  for (const e of entries.slice(-8)) {
    const body = e.kind === 'tool' ? `${e.tool} ${sentence(e.text, 120)}` : sentence(e.text, 200)
    lines.push(`${mark[e.kind]} ${body}`)
  }
  return lines.join('\n')
}

function helpText() {
  return [
    'Agent Flow on your phone:',
    '/status — what is running and what is waiting on you',
    '/task <id> — one task in detail (the id is in /status)',
    'Reply to a question message to answer it.',
  ].join('\n')
}

/** The cost line from settings: crossed once, said once, in the conversation and as a notification. */
function warnOnCost(task) {
  const line = settings.costLine()
  if (!line || task.costWarnedAt === line || !(task.cost >= line)) return
  update(task.id, { costWarned: true, costWarnedAt: line })
  log(task.id, { kind: 'decision', text: `Cost passed $${line}: this task is at $${task.cost.toFixed(2)}` })
  tell(task, `Cost passed $${line}: ${task.title}`, `at $${task.cost.toFixed(2)}`, true)
}

/** On launch: pick every interrupted task back up, unless told to leave them for the button. */
export function resumeInterrupted() {
  if (process.env.FLOW_AUTO_RESUME === '0') return []
  const picked = Object.values(tasks).filter((t) => t.status === 'interrupted' && t.lastSession?.id)
  for (const task of picked) {
    try { resume(task.id) } catch (err) { log(task.id, { kind: 'error', text: `could not continue: ${err.message}` }) }
  }
  return picked.map((t) => t.id)
}

/** Stop a run whose agent is not coming back, keeping the session so it can be continued. */
export function markInterrupted(id, why) {
  const task = tasks[id]
  if (!task || task.status !== 'running') return
  log(id, { kind: 'error', text: why })
  update(id, { status: 'interrupted', interruptedAt: Date.now(), phase: null, error: why })
  killTree(children.get(id))
}

// The machine sleeping does not kill the agent, but the CLI's connection often
// does not survive it. A tick that arrives far later than scheduled means a
// sleep happened; after one, a run that has been quiet for a while is treated
// as interrupted rather than left spinning until someone notices.
export const WATCHDOG_MS = Number(process.env.FLOW_WATCHDOG_MS || 60_000)
export const SLEEP_JUMP_MS = Number(process.env.FLOW_SLEEP_JUMP_MS || 180_000)
export const SILENT_MS = Number(process.env.FLOW_SILENT_MS || 600_000)
let lastTick = Date.now()
setInterval(() => {
  const now = Date.now()
  const slept = now - lastTick > WATCHDOG_MS + SLEEP_JUMP_MS
  lastTick = now
  if (!slept) return
  for (const [id, heard] of lastHeard) {
    if (now - heard > SILENT_MS && tasks[id]?.lastSession?.id) {
      markInterrupted(id, 'Interrupted: the machine slept and the agent went quiet. Continue picks up the session.')
    }
  }
}, WATCHDOG_MS).unref()

export function removeWorktrees(id) {
  const task = tasks[id]
  if (task && !task.trees?.length) throw new Error('a document task has no worktree; delete the task to remove its files')
  if (!task?.root) throw new Error('nothing to remove')
  // Status alone is not enough: cancelling does not instantly stop the process,
  // and pulling the worktree out from under a live agent is how it goes strange.
  if (children.has(id)) throw new Error('the agent is still shutting down, try again in a moment')
  if (task.status === 'running') throw new Error('task is still running')
  for (const tree of task.trees) {
    git(tree.repoPath, 'worktree', 'remove', '--force', tree.worktree)
    const prodWorktree = path.join(DATA, 'worktrees', task.id, `${tree.repo}-prod`)
    if (fs.existsSync(prodWorktree)) git(tree.repoPath, 'worktree', 'remove', '--force', prodWorktree)
  }
  fs.rmSync(path.join(DATA, 'worktrees', task.id), { recursive: true, force: true })
  // The branches stay. Dropping the checkout is not the same as throwing the
  // work away, and setupWorktrees knows how to pick them back up.
  update(id, { root: null, droppedAt: Date.now(), prepared: null })
  forgetDiskSize()
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

/**
 * `meta` says which run this is (phase or side run) so the session the CLI
 * reports can be remembered against it; `resume` continues that session
 * instead of starting a new one.
 */
function runClaude(task, prompt, cwd = task.root, { resume = null, meta = {}, env: extraEnv = {} } = {}) {
  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--permission-mode', task.permissionMode,
    '--add-dir', task.artifactDir,
    '--add-dir', UPLOADS,
    '--settings', ensureSettings(),
  ]
  if (resume) args.push('--resume', resume)
  for (const dir of task.readPaths || []) args.push('--add-dir', dir)
  if (task.model) args.push('--model', task.model)
  if (task.effort) args.push('--effort', task.effort)
  // Nobody is at a keyboard to answer a permission prompt. Without this, a mode
  // that wants to ask would stall the phase instead of getting on with it.
  if (task.permissionMode !== 'bypassPermissions') args.push('--permission-prompts', 'none')

  // Until this run reports its own session there is nothing to continue: a
  // restart now is a failure, not an interruption into the previous session.
  update(task.id, { lastSession: null })
  const kept = secrets.env(task)
  scrubFor.set(task.id, Object.entries(kept).map(([k, v]) => [v, `{{secret:${k.slice('FLOW_SECRET_'.length)}}}`]))

  return new Promise((resolve, reject) => {
    // On Windows `claude` is a .cmd, which Node refuses to spawn directly, so it
    // goes through the shell. Nothing with a space reaches the command line
    // unquoted, and the prompt itself never touches it at all.
    const child = spawn(CLAUDE_BIN, WIN ? args.map(winQuote) : args, {
      cwd,
      shell: WIN,
      env: {
        ...process.env,
        ...kept,
        ...extraEnv,
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
    lastHeard.set(task.id, Date.now())
    child.stdin.on('error', () => {}) // the child can die before the prompt lands
    child.stdin.end(prompt, 'utf8')

    let buffer = ''
    let summary = ''
    let resultError = null
    let streamed = 0
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
        try { msg = JSON.parse(line) } catch { logRun(task, { kind: 'text', text: line }); continue }
        if (msg.session_id && tasks[task.id]?.lastSession?.id !== msg.session_id) {
          update(task.id, { lastSession: { id: msg.session_id, ...meta, cwd, at: Date.now() } })
        }
        streamed++
        lastHeard.set(task.id, Date.now())
        const entry = toLogEntry(task, msg, seen)
        if (entry) logRun(task, entry)
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
      if (text) logRun(task, { kind: 'stderr', text })
    })

    child.on('error', (err) => {
      children.delete(task.id)
      reject(new Error(`could not start claude: ${err.message}`))
    })

    child.on('close', (code) => {
      children.delete(task.id)
      lastHeard.delete(task.id)
      scrubFor.delete(task.id)
      if (stopped(task)) return resolve({ summary })
      if (resultError) return reject(Object.assign(new Error(`${task.phase}: ${resultError}`), { streamed }))
      if (code === 0) return resolve({ summary })
      reject(Object.assign(new Error(`claude exited with code ${code} during ${task.phase}`), { streamed }))
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
        logRun(task, { kind: 'text', text: block.text })
      }
      if (block.type === 'tool_use') logRun(task, { kind: 'tool', tool: block.name, text: describeTool(block.name, block.input) })
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
    warnOnCost(task)
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
    flush()
    for (const child of children.values()) killTree(child)
    if (event !== 'exit') process.exit(0)
  })
}

/** Quote an argument for cmd.exe. Windows paths cannot contain a double quote. */
function winQuote(arg) {
  return /[\s&|<>^()]/.test(arg) ? `"${arg}"` : arg
}
