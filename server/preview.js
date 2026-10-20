import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { log } from './store.js'

/**
 * Running the app so it can be looked at.
 *
 * `shopify app dev` rewrites the app's URLs on the Partner dashboard, so which
 * app it points at is the whole safety question. This never guesses: the
 * config has to be named in FLOW_SHOPIFY_CONFIG, and what that resolves to is
 * logged before anything starts.
 */
const CONFIG = process.env.FLOW_SHOPIFY_CONFIG || ''
const STORE = process.env.FLOW_SHOPIFY_STORE || ''
const READY_MS = Number(process.env.FLOW_SHOPIFY_TIMEOUT_MS || 240_000)

const running = new Map() // worktree -> { child, url, output }

export const isShopifyApp = (dir) => fs.existsSync(path.join(dir, 'shopify.app.toml'))

/** What the named config actually points at, so it is on the record. */
export function target(dir, config = CONFIG) {
  const file = path.join(dir, `shopify.app.${config}.toml`)
  if (!fs.existsSync(file)) return null
  const text = fs.readFileSync(file, 'utf8')
  const read = (key) => text.match(new RegExp(`^${key}\\s*=\\s*"([^"]+)"`, 'm'))?.[1] || null
  return { file, name: read('name'), clientId: read('client_id'), appUrl: read('application_url') }
}

const PREVIEW = [
  /(https:\/\/\S+\/admin\/oauth\/redirect_from_cli\S*)/,
  /Preview URL:\s*(\S+)/i,
]

export function status(worktree) {
  const live = running.get(worktree)
  return live ? { running: true, url: live.url } : { running: false, url: null }
}

export function stop(worktree) {
  const live = running.get(worktree)
  if (!live) return false
  running.delete(worktree)
  try { process.kill(-live.child.pid, 'SIGTERM') } catch { live.child.kill('SIGTERM') }
  return true
}

export function stopAll() {
  for (const worktree of [...running.keys()]) stop(worktree)
}

/**
 * Start the dev server for a worktree, or hand back the one already up.
 * Resolves once the preview URL has been printed.
 */
export function start(taskId, worktree) {
  const live = running.get(worktree)
  if (live?.url) return Promise.resolve({ url: live.url, reused: true })
  if (live) return live.ready

  if (!isShopifyApp(worktree)) throw new Error('this repo has no shopify.app.toml')
  if (!CONFIG) {
    throw new Error(
      'set FLOW_SHOPIFY_CONFIG to the config `shopify app dev` may repoint, ' +
        'e.g. ego-mobile-builder-dev. It rewrites that app\'s URLs, so it is never guessed.',
    )
  }
  const app = target(worktree)
  if (!app) throw new Error(`no shopify.app.${CONFIG}.toml in this worktree`)

  log(taskId, {
    kind: 'text',
    text:
      `Starting \`shopify app dev\` against **${app.name}** (\`${app.clientId}\`).\n` +
      `Its app URL will be repointed at a tunnel, away from ${app.appUrl}.`,
  })

  const args = [
    'app', 'dev',
    '--config', CONFIG,
    '--no-input', // fail instead of asking something nobody is there to answer
    '--no-update',
    '--no-color',
    ...(STORE ? ['--store', STORE] : []),
  ]

  const child = spawn('shopify', args, {
    cwd: worktree,
    env: { ...process.env, FORCE_COLOR: '0', CI: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  })

  const entry = { child, url: null, output: '' }
  running.set(worktree, entry)

  entry.ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      stop(worktree)
      reject(new Error(`shopify app dev printed no preview URL in ${Math.round(READY_MS / 1000)}s`))
    }, READY_MS)

    const read = (chunk) => {
      const text = String(chunk)
      entry.output = (entry.output + text).slice(-20_000)
      if (entry.url) return
      for (const pattern of PREVIEW) {
        const found = text.match(pattern)
        if (!found) continue
        entry.url = found[1]
        clearTimeout(timer)
        log(taskId, { kind: 'text', text: `The app is up: ${entry.url}` })
        resolve({ url: entry.url, reused: false })
        return
      }
    }

    child.stdout.on('data', read)
    child.stderr.on('data', read)
    child.on('error', (err) => {
      clearTimeout(timer)
      running.delete(worktree)
      reject(new Error(`could not start shopify: ${err.message}`))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      running.delete(worktree)
      if (!entry.url) {
        const tail = entry.output.trim().split('\n').slice(-6).join('\n')
        reject(new Error(`shopify app dev exited with ${code}\n${tail}`))
      }
    })
  })

  return entry.ready
}

for (const event of ['exit', 'SIGINT', 'SIGTERM']) process.on(event, stopAll)
