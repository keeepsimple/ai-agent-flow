import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { DATA, tasks } from './store.js'

const ACTIVE = new Set(['running', 'queued', 'awaiting_approval', 'awaiting_answer'])
const ROOT = path.join(DATA, 'worktrees')

/**
 * A worktree is a full checkout: shared .git, but its own node_modules, Pods
 * and build output. One task ran to 1.1 GB here, and a Flutter repo is far
 * larger. This is what that costs and what is safe to reclaim.
 */
function bytesOf(dir) {
  if (!fs.existsSync(dir)) return 0
  try {
    // du is doing a filesystem walk either way; shelling out beats doing it in
    // JavaScript one readdir at a time.
    return Number(execFileSync('du', ['-sk', dir], { encoding: 'utf8' }).split('\t')[0]) * 1024
  } catch {
    return 0
  }
}

export function usage() {
  const entries = Object.values(tasks)
    .filter((task) => task.root)
    .map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      repos: task.repos,
      bytes: bytesOf(path.join(ROOT, task.id)),
      reclaimable: !ACTIVE.has(task.status),
    }))
    .sort((a, b) => b.bytes - a.bytes)

  // Anything under worktrees/ with no task left to own it.
  const known = new Set(Object.keys(tasks))
  const orphans = fs.existsSync(ROOT)
    ? fs.readdirSync(ROOT).filter((name) => !known.has(name))
    : []

  return {
    total: entries.reduce((n, e) => n + e.bytes, 0) + orphans.reduce((n, o) => n + bytesOf(path.join(ROOT, o)), 0),
    reclaimable: entries.filter((e) => e.reclaimable).reduce((n, e) => n + e.bytes, 0),
    tasks: entries,
    orphans,
  }
}

/** Drop the checkouts of finished tasks. Their branches are untouched. */
export function prune(removeWorktrees) {
  const dropped = []
  for (const entry of usage().tasks) {
    if (!entry.reclaimable) continue
    try {
      removeWorktrees(entry.id)
      dropped.push(entry.id)
    } catch (err) {
      // One repo refusing must not stop the rest from being reclaimed.
      dropped.push(`${entry.id}: ${err.message}`)
    }
  }
  for (const orphan of usage().orphans) {
    fs.rmSync(path.join(ROOT, orphan), { recursive: true, force: true })
    dropped.push(`${orphan} (orphan)`)
  }
  return dropped
}
