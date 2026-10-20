import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { tasks, update } from './store.js'

const git = (cwd, ...args) =>
  execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

const count = (cwd, range) => {
  try { return Number(git(cwd, 'rev-list', '--count', range)) } catch { return null }
}
const quiet = (fn) => { try { return fn() } catch { return null } }
const lines = (text) => (text || '').split('\n').filter(Boolean)

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

  // Merging happens in the main checkout, which is the human's own working
  // copy. Uncommitted work there is only a problem when the merge touches the
  // same files; git merges happily around everything else, and refusing on any
  // dirty file at all blocks the normal case of having unrelated work open.
  const uncommitted = [
    ...lines(quiet(() => git(tree.repoPath, 'diff', '--name-only', 'HEAD'))),
    ...lines(quiet(() => git(tree.repoPath, 'ls-files', '--others', '--exclude-standard'))),
  ]
  const touched = lines(quiet(() => git(tree.repoPath, 'diff', '--name-only', `${tree.baseBranch}...${tree.branch}`)))
  const clash = uncommitted.filter((file) => touched.includes(file))

  let blocked = null
  if (current !== tree.baseBranch) blocked = `${tree.repo} is on ${current}, not ${tree.baseBranch}`
  else if (clash.length) {
    blocked = `uncommitted work in ${clash.slice(0, 3).join(', ')}${clash.length > 3 ? ` and ${clash.length - 3} more` : ''}`
  }

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
    uncommitted: uncommitted.length,
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
    try {
      git(tree.repoPath, 'merge', tree.branch)
    } catch (err) {
      throw new Error(`${tree.repo}: ${String(err.stderr || err.message).trim().split('\n')[0]}`)
    }
    done.push(`${tree.repo}: ${tree.branch} -> ${tree.baseBranch}`)
  }
  update(id, { mergedAt: Date.now() })
  return done
}
