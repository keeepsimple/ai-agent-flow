// What a repo needs for Ship: the name of its prod branch, and the Jenkins job
// that deploys it. Kept at <data>/repos.json by repo path; the Jenkins token
// goes to the keychain under 'repo:<path>' and never into the file.
import fs from 'node:fs'
import path from 'node:path'
import * as secrets from './secrets.js'

const DATA = process.env.FLOW_DATA || path.join(import.meta.dirname, '..', 'data')
const FILE = path.join(DATA, 'repos.json')

const load = () => {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch { return {} }
}

export const owner = (repoPath) => `repo:${repoPath}`

export function get(repoPath) {
  const saved = load()[repoPath] || {}
  const jenkins = saved.jenkins?.url && saved.jenkins?.job
    ? { url: saved.jenkins.url, job: saved.jenkins.job, user: saved.jenkins.user || '' }
    : null
  return {
    prodBranch: saved.prodBranch || 'prod',
    jenkins,
    hasJenkinsToken: secrets.read(owner(repoPath), 'JENKINS_TOKEN') !== null,
    landTarget: saved.landTarget || null,
    // What a fresh worktree needs: a command to run in it, files to bring
    // over from the checkout (generated, gitignored), and the repo's gate.
    setup: saved.setup || '',
    smoke: saved.smoke || '',
    copy: Array.isArray(saved.copy) ? saved.copy : [],
    checks: Array.isArray(saved.checks) ? saved.checks : [],
  }
}

export function set(repoPath, { prodBranch, jenkins, jenkinsToken, landTarget, setup, copy, checks, smoke } = {}) {
  const all = load()
  const mine = all[repoPath] || {}
  if (setup !== undefined) mine.setup = String(setup || '').trim()
  if (smoke !== undefined) mine.smoke = String(smoke || '').trim()
  if (copy !== undefined) {
    const list = (Array.isArray(copy) ? copy : []).map((p) => String(p).trim()).filter(Boolean)
    for (const p of list) {
      const parts = p.split(/[\\/]/)
      if (path.isAbsolute(p) || parts.includes('..') || parts[0] === '.git' || p === '.' || p === './') throw new Error(`copy paths must stay inside the repo and never be the repo itself: ${p}`)
    }
    mine.copy = list
  }
  if (checks !== undefined) mine.checks = (Array.isArray(checks) ? checks : []).map((c) => String(c).trim()).filter(Boolean)
  if (landTarget !== undefined) mine.landTarget = landTarget || null
  if (prodBranch !== undefined) {
    if (!/^[A-Za-z0-9._\/-]+$/.test(prodBranch || '')) throw new Error('bad branch name')
    mine.prodBranch = prodBranch
  }
  if (jenkins !== undefined) {
    mine.jenkins = jenkins && jenkins.url ? { url: String(jenkins.url).replace(/\/+$/, ''), job: String(jenkins.job || ''), user: String(jenkins.user || '') } : null
  }
  all[repoPath] = mine
  fs.mkdirSync(DATA, { recursive: true })
  fs.writeFileSync(FILE, JSON.stringify(all, null, 2))
  if (jenkinsToken !== undefined) {
    if (jenkinsToken) secrets.keep(owner(repoPath), 'JENKINS_TOKEN', String(jenkinsToken))
    else secrets.forget(owner(repoPath), ['JENKINS_TOKEN'])
  }
  return get(repoPath)
}

/** The environment Ship's Jenkins watcher needs, or nothing when none is configured. */
export function jenkinsEnv(repoPath) {
  const { jenkins } = get(repoPath)
  const token = secrets.read(owner(repoPath), 'JENKINS_TOKEN')
  if (!jenkins) return {}
  return {
    FLOW_JENKINS_URL: jenkins.url,
    FLOW_JENKINS_JOB: jenkins.job,
    FLOW_JENKINS_USER: jenkins.user,
    ...(token ? { FLOW_JENKINS_TOKEN: token } : {}),
  }
}
