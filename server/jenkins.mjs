#!/usr/bin/env node
// The deploy watcher the ship run calls after pushing prod:
//     node jenkins.mjs <jenkinsUrl> <jobName>
// Auth from FLOW_JENKINS_USER / FLOW_JENKINS_TOKEN. Waits for a build newer
// than the one it finds first (the push has only just happened), then for it
// to finish. Exit 0 on SUCCESS; 1 otherwise, with the console tail; 2 when no
// new build appears in time or the wait runs out.
const [url, job] = process.argv.slice(2)
if (!url || !job) {
  console.error('usage: jenkins.mjs <jenkinsUrl> <jobName>')
  process.exit(2)
}
const POLL_MS = Number(process.env.FLOW_JENKINS_POLL_MS || 15_000)
const START_MS = Number(process.env.FLOW_JENKINS_START_MS || 120_000)
const MAX_MS = Number(process.env.FLOW_JENKINS_MAX_MS || 30 * 60_000)
const auth = process.env.FLOW_JENKINS_USER
  ? { Authorization: 'Basic ' + Buffer.from(`${process.env.FLOW_JENKINS_USER}:${process.env.FLOW_JENKINS_TOKEN || ''}`).toString('base64') }
  : {}
const jobUrl = `${url.replace(/\/+$/, '')}/job/${encodeURIComponent(job)}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function last() {
  let res
  try { res = await fetch(`${jobUrl}/lastBuild/api/json`, { headers: auth }) } catch (err) { throw new Error(`could not reach Jenkins: ${err.message}`) }
  if (!res.ok) throw new Error(`${res.status} from ${jobUrl}/lastBuild/api/json`)
  return res.json()
}

/** A Jenkins that stops answering mid-watch is 'could not tell', never 'failed'. */
const poll = () => last().catch((err) => { console.log(`lost Jenkins while watching: ${err.message}`); process.exit(2) })

const first = await poll()
const seen = first.number
console.log(`last build before the push: #${seen}${first.building ? ' (still running)' : ''}`)

const started = Date.now()
let build = first
// A build already running when we look is the one before the push, not ours.
while (build.number === seen) {
  if (Date.now() - started > START_MS) {
    console.log(`no new build started on ${job} within ${Math.round(START_MS / 1000)}s; check the job's triggers`)
    process.exit(2)
  }
  await sleep(POLL_MS)
  build = await poll()
}
console.log(`watching #${build.number}`)
while (build.building) {
  if (Date.now() - started > MAX_MS) {
    console.log(`#${build.number} is still running after ${Math.round(MAX_MS / 60_000)} min; giving up on the wait, not on the build`)
    process.exit(2)
  }
  await sleep(POLL_MS)
  build = await poll()
}
console.log(`#${build.number}: ${build.result}`)
if (build.result === 'SUCCESS') process.exit(0)
const text = await fetch(`${jobUrl}/${build.number}/consoleText`, { headers: auth }).then((r) => r.text()).catch(() => '')
const tail = text.trim().split('\n').slice(-60).join('\n')
if (tail) console.log(`--- last lines of the console ---\n${tail}`)
process.exit(1)
