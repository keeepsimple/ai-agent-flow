#!/usr/bin/env node
// The guard the agent runs before it pushes: node guard-secrets.mjs <repo> <base> <branch>
// Reads the kept values from FLOW_SECRET_* in its own environment and refuses
// a diff that carries one of them, or anything shaped like a secret. Exits 1
// with file:line on stderr; 0 when the diff is clean.
import { execFileSync } from 'node:child_process'
import { scanDiff } from './secrets.js'

const [repo, base, branch] = process.argv.slice(2)
if (!repo || !base || !branch) {
  console.error('usage: guard-secrets.mjs <repoPath> <base> <branch>')
  process.exit(2)
}
const values = Object.entries(process.env)
  .filter(([k]) => k.startsWith('FLOW_SECRET_'))
  .map(([, v]) => v)
// The task's own commits only (first-parent, no merges): a token that came in
// from the base is the base's problem, not a reason to stop this push.
const diff = execFileSync('git', ['-C', repo, 'log', '--first-parent', '--no-merges', '-p', '--format=', `${base}..${branch}`], { encoding: 'utf8', maxBuffer: 64 << 20 })
const hits = scanDiff(diff, values)
if (hits.length) {
  console.error('this diff carries something that looks like a secret; do not push it:')
  for (const h of hits) console.error(`  ${h.file}:${h.line}`)
  process.exit(1)
}
console.log('no secrets in the diff')
