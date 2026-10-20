import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { tasks, update } from './store.js'
import { pipelineFor } from './pipeline.js'

const git = (cwd, ...args) =>
  execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    // A real diff is bigger than the 1 MB default, and hitting that throws
    // rather than truncating.
    maxBuffer: 64 * 1024 * 1024,
  }).trim()

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
  const remoteUrl = remote ? quiet(() => git(tree.repoPath, 'remote', 'get-url', remote)) : null

  // Merging locally leaves the base branch ahead of its own remote. Without
  // this the tool walks you to 'merged' and then abandons the last step.
  const baseUpstream = quiet(() => git(tree.repoPath, 'rev-parse', '--abbrev-ref', `${tree.baseBranch}@{u}`))
  const baseUnpushed = baseUpstream
    ? count(tree.repoPath, `${baseUpstream}..${tree.baseBranch}`) ?? 0
    : null
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
  if (current !== tree.baseBranch) {
    // symbolic-ref gives nothing on a detached HEAD, and "is on null" reads
    // like a crash rather than a state.
    blocked = `${tree.repo} is on ${current || 'a detached HEAD'}, not ${tree.baseBranch}`
  }
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
    // What the base has that this branch does not. While this is above zero the
    // merge is not a fast-forward and can still conflict.
    behind: count(tree.repoPath, `${tree.branch}..${tree.baseBranch}`) ?? 0,
    // Commits the task produced, counted from where it forked. Unlike `ahead`
    // this never falls back to zero, so it tells a merged branch apart from one
    // that never committed anything.
    produced: count(tree.repoPath, `${tree.baseRef}..${tree.branch}`) ?? 0,
    unpushed: upstream ? count(tree.repoPath, `${upstream}..${tree.branch}`) ?? 0 : null,
    upstream,
    remote,
    reviewUrl: reviewUrl(remoteUrl, tree.branch, tree.baseBranch),
    // Only once the branch is on the remote is there anything for CI to run.
    pipeline: upstream ? pipelineFor(remoteUrl, tree.branch) : null,
    baseUpstream,
    baseUnpushed,
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

export function push(id, repo, { base = false } = {}) {
  const done = []
  for (const tree of treesOf(id, repo)) {
    const remote = quiet(() => git(tree.repoPath, 'remote').split('\n')[0])
    if (!remote) throw new Error(`${tree.repo} has no remote to push to`)
    const ref = base ? tree.baseBranch : tree.branch
    // No force, ever. If the remote has moved on, git says so and we pass that
    // along rather than deciding on the human's behalf.
    try {
      git(tree.repoPath, 'push', '-u', remote, `${ref}:${ref}`)
    } catch (err) {
      throw new Error(`${tree.repo}: ${String(err.stderr || err.message).trim().split('\n').pop()}`)
    }
    done.push(`${tree.repo} -> ${remote}/${ref}`)
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

// One generated file can be longer than everything a human wants to read. Show
// its shape and stop, rather than choking the page on a lockfile.
const MAX_FILE_BYTES = 60_000

/** Where to open a merge request for this branch, if the host is one we know. */
export function reviewUrl(remoteUrl, branch, base) {
  if (!remoteUrl) return null
  // git@host:group/repo.git and https://host/group/repo.git both reduce to the
  // same host plus path.
  const match = remoteUrl.match(/^(?:git@([^:]+):|https?:\/\/(?:[^@]*@)?([^/]+)\/)(.+?)(?:\.git)?$/)
  if (!match) return null
  const host = match[1] || match[2]
  const repoPath = match[3]
  const query = `?merge_request%5Bsource_branch%5D=${encodeURIComponent(branch)}` +
    `&merge_request%5Btarget_branch%5D=${encodeURIComponent(base)}`
  const refPath = (ref) => ref.split('/').map(encodeURIComponent).join('/')
  return host.includes('github')
    ? `https://${host}/${repoPath}/compare/${refPath(base)}...${refPath(branch)}?expand=1`
    : `https://${host}/${repoPath}/-/merge_requests/new${query}`
}

/** The actual change, per repo, split into files. */
export function diff(id) {
  const task = tasks[id]
  if (!task?.trees) return []

  return task.trees.map((tree) => {
    const range = `${tree.baseRef}...${tree.branch}`
    const numstat = lines(quiet(() => git(tree.repoPath, 'diff', '--numstat', range)))
    const counts = new Map()
    for (const row of numstat) {
      const [added, removed, file] = row.split('\t')
      counts.set(file, { added: Number(added) || 0, removed: Number(removed) || 0, binary: added === '-' })
    }

    const patch = quiet(() => git(tree.repoPath, 'diff', range)) || ''
    const files = patch
      .split(/^diff --git /m)
      .filter(Boolean)
      .map((chunk) => {
        const body = `diff --git ${chunk}`
        // b/<path> is the name after any rename, which is the one to show.
        const path = body.match(/^diff --git a\/.* b\/(.*)$/m)?.[1] || 'unknown'
        const count = counts.get(path) || { added: 0, removed: 0 }
        return {
          path,
          ...count,
          patch: body.length > MAX_FILE_BYTES ? null : body,
          bytes: body.length,
        }
      })

    return { repo: tree.repo, branch: tree.branch, base: tree.baseBranch, files }
  })
}
