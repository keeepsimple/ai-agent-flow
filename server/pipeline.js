import { execFile } from 'node:child_process'

/**
 * The CI result for a branch, read through the glab CLI so no token has to live
 * in this tool or its config. Run once, per host:
 *
 *     glab auth login --hostname gitlab.abcsoft.vn
 *
 * FLOW_GITLAB_TOKEN is honoured as an override for a machine without glab.
 *
 * Lookups are cached and refreshed in the background: the row that shows this
 * is polled every few seconds, and a slow network must not make it stutter.
 */
const TTL = 20_000
const cache = new Map()

function glab(host, route) {
  return new Promise((resolve, reject) => {
    const env = process.env.FLOW_GITLAB_TOKEN
      ? { ...process.env, GITLAB_TOKEN: process.env.FLOW_GITLAB_TOKEN }
      : process.env
    execFile(
      'glab',
      ['api', '--hostname', host, route],
      { env, timeout: 15_000, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(String(stderr || err.message).trim().split('\n')[0]))
        try {
          resolve(JSON.parse(stdout))
        } catch {
          reject(new Error('glab returned something that is not JSON'))
        }
      },
    )
  })
}

/** host and project path out of a remote URL, for GitLab remotes only. */
export function gitlabTarget(remoteUrl) {
  if (!remoteUrl) return null
  const match = remoteUrl.match(/^(?:git@([^:]+):|https?:\/\/(?:[^@]*@)?([^/]+)\/)(.+?)(?:\.git)?$/)
  if (!match) return null
  const host = match[1] || match[2]
  if (host.includes('github')) return null
  return { host, project: encodeURIComponent(match[3]) }
}

async function load(key, target, branch) {
  try {
    const [pipeline] = await glab(
      target.host,
      `projects/${target.project}/pipelines?ref=${encodeURIComponent(branch)}&per_page=1`,
    )
    cache.set(key, {
      at: Date.now(),
      value: pipeline
        ? {
            status: pipeline.status,
            url: pipeline.web_url,
            sha: pipeline.sha?.slice(0, 7),
            updatedAt: pipeline.updated_at,
          }
        : { status: 'none' },
    })
  } catch (err) {
    // Not signed in for this host is the common case and deserves the fix, not
    // a stack trace.
    const unavailable = /401|unauthor|not logged|authentication/i.test(err.message)
      ? `glab is not signed in to ${target.host}. Run: glab auth login --hostname ${target.host}`
      : err.message
    cache.set(key, { at: Date.now(), value: { status: 'unavailable', reason: unavailable } })
  }
}

/** Cached pipeline state. Returns null until the first lookup has landed. */
export function pipelineFor(remoteUrl, branch) {
  const target = gitlabTarget(remoteUrl)
  if (!target) return null

  const key = `${target.host}/${target.project}#${branch}`
  const hit = cache.get(key)
  if (!hit || Date.now() - hit.at > TTL) {
    cache.set(key, { at: Date.now(), value: hit?.value ?? null }) // claim the slot, do not stampede
    load(key, target, branch)
  }
  return hit?.value ?? null
}
