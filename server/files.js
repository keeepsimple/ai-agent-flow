import { execFileSync } from 'node:child_process'
import { resolveRepo } from './roots.js'

/**
 * Tracked files, for naming one to the agent.
 *
 * `git ls-files` rather than a walk: it is one process, it already knows what
 * is ignored, and node_modules is the reason you would never walk this.
 */
const CACHE = new Map()
const TTL = 15_000

function filesOf(repo) {
  const hit = CACHE.get(repo)
  if (hit && Date.now() - hit.at < TTL) return hit.files

  const { path: dir } = resolveRepo(repo)
  let files = []
  try {
    files = execFileSync('git', ['-C', dir, 'ls-files'], {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    })
      .split('\n')
      .filter(Boolean)
  } catch {
    // Not a repo, or a repo git cannot read: an empty list is the answer.
  }
  CACHE.set(repo, { at: Date.now(), files })
  return files
}

/**
 * Rank by where the match lands: the file's own name first, then its path.
 * Typing `discount` should not be answered with forty directories that happen
 * to contain the word.
 */
export function search(repos, query, limit = 20) {
  const needle = String(query || '').toLowerCase()
  const out = []

  for (const repo of repos) {
    for (const file of filesOf(repo)) {
      const lower = file.toLowerCase()
      const name = lower.slice(lower.lastIndexOf('/') + 1)
      let rank
      if (!needle) rank = 2
      else if (name.startsWith(needle)) rank = 0
      else if (name.includes(needle)) rank = 1
      else if (lower.includes(needle)) rank = 2
      else continue
      out.push({ repo, path: file, rank })
    }
  }

  return out
    .sort((a, b) => a.rank - b.rank || a.path.length - b.path.length)
    .slice(0, limit)
    .map(({ repo, path }) => ({ repo, path }))
}
