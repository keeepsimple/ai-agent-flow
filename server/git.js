import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { tasks, update } from './store.js'

const git = (cwd, ...args) =>
  execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

const count = (cwd, range) => {
  try { return Number(git(cwd, 'rev-list', '--count', range)) } catch { return null }
}
const quiet = (fn) => { try { return fn() } catch { return null } }

/**
 * What shipping this branch would involve, per repo. Everything here is a read:
 * the buttons it drives are the only things that write.
 */
function statusOf(tree) {
  // Everything is read through the repo and the branch name, never the
  // worktree: dropping a checkout does not throw the branch away, and the work
  // on it stays shippable.
  const upstream = quiet(() => git(tree.repoPath, 'rev-parse', '--abbrev-ref', `${tree.branch}@{u}`))
  const remote = quiet(() => git(tree.repoPath, 'remote').split('\n')[0]) || null
  const current = quiet(() => git(tree.repoPath, 'symbolic-ref', '--short', 'HEAD'))
  const dirty = quiet(() => git(tree.repoPath, 'status', '--porcelain')) !== ''

  // Merging happens in the main checkout, which is the human's own working
  // copy. Only offer it when that will not surprise them.
  let blocked = null
  if (current !== tree.baseBranch) blocked = `${tree.repo} is on ${current}, not ${tree.baseBranch}`
  else if (dirty) blocked = `${tree.repo} has uncommitted changes`

  return {
    repo: tree.repo,
    branch: tree.branch,
    base: tree.baseBranch,
    // What merging would actually bring in. Counting from the sha it forked
    // from would never fall to zero, so a merged branch would keep asking to be
    // merged again. The fork point is the fallback for a detached base.
    ahead:
      count(tree.repoPath, `${tree.baseBranch}..${tree.branch}`) ??
      count(tree.repoPath, `${tree.baseRef}..${tree.branch}`) ??
      0,
    unpushed: upstream ? count(tree.repoPath, `${upstream}..${tree.branch}`) ?? 0 : null,
    upstream,
    remote,
    mergeBlockedBy: blocked,
  }
}

export function status(id) {
  const task = tasks[id]
  if (!task?.trees) return []
  return task.trees.map(statusOf)
}

function treesOf(id, repo) {
  const task = tasks[id]
  if (!task?.trees?.length) throw new Error('this task has no branches yet')
  const trees = repo ? task.trees.filter((t) => t.repo === repo) : task.trees
  if (!trees.length) throw new Error(`unknown repo: ${repo}`)
  return trees
}

export function push(id, repo) {
  const done = []
  for (const tree of treesOf(id, repo)) {
    const remote = quiet(() => git(tree.repoPath, 'remote').split('\n')[0])
    if (!remote) throw new Error(`${tree.repo} has no remote to push to`)
    git(tree.repoPath, 'push', '-u', remote, `${tree.branch}:${tree.branch}`)
    done.push(`${tree.repo} -> ${remote}/${tree.branch}`)
  }
  update(id, { shippedAt: Date.now() })
  return done
}

export function merge(id, repo) {
  const done = []
  for (const tree of treesOf(id, repo)) {
    const blocked = statusOf(tree).mergeBlockedBy
    if (blocked) throw new Error(blocked)
    // Plain merge, so it fast-forwards when it can. The branch stays put either
    // way; nothing here deletes it.
    git(tree.repoPath, 'merge', tree.branch)
    done.push(`${tree.repo}: ${tree.branch} -> ${tree.baseBranch}`)
  }
  update(id, { mergedAt: Date.now() })
  return done
}
