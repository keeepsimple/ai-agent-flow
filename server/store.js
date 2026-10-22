import fs from 'node:fs'
import path from 'node:path'
import { isBareRead } from './hook-reads.mjs'
import { EventEmitter } from 'node:events'

export const DATA = process.env.FLOW_DATA || path.join(import.meta.dirname, '..', 'data')
const TASKS_FILE = path.join(DATA, 'tasks.json')

fs.mkdirSync(path.join(DATA, 'logs'), { recursive: true })
fs.mkdirSync(path.join(DATA, 'tasks'), { recursive: true })
fs.mkdirSync(path.join(DATA, 'worktrees'), { recursive: true })

export const bus = new EventEmitter()
bus.setMaxListeners(0)

// How many browser tabs are watching. A connected tab raises its own clickable
// notification, so the server only falls back to a desktop one when nobody is.
// `clients` is who is watching; `notifiers` is who will actually raise a
// notification. They are not the same number: a tab that was never granted
// permission, and the app's own window, which has no Notification API at all,
// watch without being able to tell anyone.
export const sse = { clients: 0, notifiers: 0 }

/** @type {Record<string, any>} */
export const tasks = fs.existsSync(TASKS_FILE)
  ? JSON.parse(fs.readFileSync(TASKS_FILE, 'utf8'))
  : {}

// A process that died mid-run left its task claiming to be alive, and anything
// that was blocked waiting on a human lost the promise it was blocked on. Say
// so instead of showing a spinner or an approval button that cannot work.
const STALE = {
  queued: 'Server restarted before this task started',
  awaiting_approval: 'Server restarted while waiting for your decision. Retry to pick up from the next phase.',
  awaiting_answer: 'Server restarted while waiting for your answer. Retry to re-run this phase.',
}
for (const t of Object.values(tasks)) {
  // Worktrees made before setup existed were prepared by hand; do not redo them.
  if (t.root && t.prepared === undefined) t.prepared = t.root
  // A run that had a session is not lost: it was interrupted, and the session
  // can be continued. Only a run that never got that far is a plain failure.
  if (t.status === 'running') {
    if (t.lastSession?.id) {
      t.status = 'interrupted'
      t.interruptedAt = Date.now()
      t.error = 'Interrupted by a restart while this was running. Continue picks up the session.'
    } else {
      t.status = 'failed'
      t.error = 'Server restarted while this phase was running'
    }
  } else if (STALE[t.status]) {
    t.error = STALE[t.status]
    t.status = 'failed'
  }
}

let writeTimer = null
export function save() {
  clearTimeout(writeTimer)
  writeTimer = setTimeout(flush, 120)
}

/**
 * Write now rather than in a moment. The debounce is there so a busy phase
 * does not rewrite the file on every log line, but a process that exits
 * inside that window loses whatever it last decided: a worktree dropped and
 * then forgotten leaves a task claiming a checkout that is not there.
 */
export function flush() {
  clearTimeout(writeTimer)
  writeTimer = null
  fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2))
}

export function artifactDir(id) {
  return path.join(DATA, 'tasks', id)
}

export function emit(task) {
  if (soonTask?.id === task.id) soonTask = null
  task.updatedAt = Date.now()
  save()
  bus.emit('task', task)
}

/**
 * The same, for a number nobody reads to the millisecond. Token and cost
 * updates arrive with every message the CLI emits, and each one was a task
 * event that rebuilt every client's whole board. Held back to one a second;
 * a real change — a status, a phase, a question — still goes out at once
 * through `emit`, and takes the pending one with it.
 */
let soonTimer = null
let soonTask = null

export function emitSoon(task) {
  soonTask = task
  if (soonTimer) return
  soonTimer = setTimeout(() => {
    soonTimer = null
    const pending = soonTask
    soonTask = null
    // A task deleted inside the window has no row left to update.
    if (pending && tasks[pending.id]) emit(pending)
  }, 1000)
}

export function update(id, patch) {
  const task = tasks[id]
  if (!task) return null
  Object.assign(task, patch)
  emit(task)
  return task
}

export function log(id, entry) {
  const line = { t: Date.now(), ...entry }
  fs.appendFileSync(path.join(DATA, 'logs', `${id}.jsonl`), JSON.stringify(line) + '\n')
  bus.emit('log', { id, entry: line })
  return line
}

/** How the agent spent its tool calls: shell reads are the ones worth seeing. */
export function toolMix(log) {
  const mix = { bash: 0, shellReads: 0, read: 0, edit: 0 }
  for (const e of log) {
    if (e.kind !== 'tool') continue
    if (e.tool === 'Bash') {
      mix.bash++
      if (isBareRead(e.text)) mix.shellReads++
    } else if (e.tool === 'Read' || e.tool === 'Grep' || e.tool === 'Glob') mix.read++
    else if (e.tool === 'Edit' || e.tool === 'Write' || e.tool === 'MultiEdit') mix.edit++
  }
  return mix
}

export function readLog(id, limit = 600) {
  const file = path.join(DATA, 'logs', `${id}.jsonl`)
  if (!fs.existsSync(file)) return []
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
  return lines.slice(-limit).map((l) => {
    try { return JSON.parse(l) } catch { return { t: Date.now(), kind: 'text', text: l } }
  })
}

export function artifact(id, name) {
  const file = path.join(artifactDir(id), name)
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null
}

save()
