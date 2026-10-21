import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import { captureWith } from './browser-capture.js'
import { DATA } from './store.js'

/**
 * A Chrome the tool owns, with its own profile, so a session signed in once
 * keeps working.
 *
 * It cannot be the browser you already have open: that one was started without
 * a debugging port, the flag cannot be added to a running process, and Chrome
 * refuses the flag outright on its default directory. So this is a second
 * profile — but it starts as a copy of the session in yours, so in practice
 * there is nothing to log into.
 *
 * No automation dependency: Node speaks CDP over its own WebSocket.
 */
const PROFILE = path.join(DATA, 'chrome')
const PORT = Number(process.env.FLOW_BROWSER_PORT || 9344)
const BASE = `http://127.0.0.1:${PORT}`

const USER_DATA = {
  darwin: path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome'),
  linux: path.join(os.homedir(), '.config', 'google-chrome'),
  win32: path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'User Data'),
}

// Everything a signed-in session is made of, and nothing else: no history, no
// cache, no extensions, no passwords beyond what a site already set.
const SESSION_FILES = ['Cookies', 'Network/Cookies', 'Local Storage', 'Preferences']

const CHROME = [
  process.env.FLOW_CHROME_BIN,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean)

const binary = () => CHROME.find((p) => fs.existsSync(p))

let child = null
let seeding = null // the last result, so ensure() can report it on a later call

/**
 * Copy the session out of the Chrome you already use, so the first page this
 * opens is already signed in.
 *
 * It has to be a copy. Chrome refuses a debugging port on its own default
 * directory, and the Chrome you have open is holding that directory anyway, so
 * the tool's browser can never *be* yours — only start from where yours is.
 *
 * Done once, when the tool's profile is still empty. After that the copy has
 * its own life: signing out here does not sign you out there, and a session
 * you renew there does not come back across on its own.
 */
function seed() {
  const target = path.join(PROFILE, 'Default')
  const already = SESSION_FILES.some((f) => fs.existsSync(path.join(target, f)))
  if (already) return (seeding = { seeded: false, why: 'the browser already has a profile' })

  const source = process.env.FLOW_CHROME_USER_DATA || USER_DATA[process.platform]
  const name = process.env.FLOW_CHROME_PROFILE || 'Default'
  const from = source && path.join(source, name)
  if (!from || !fs.existsSync(from)) {
    return (seeding = { seeded: false, why: `no Chrome profile to copy at ${from || 'this platform'}` })
  }

  try {
    fs.mkdirSync(target, { recursive: true })
    const copied = []
    for (const file of SESSION_FILES) {
      const src = path.join(from, ...file.split('/'))
      if (!fs.existsSync(src)) continue
      fs.cpSync(src, path.join(target, ...file.split('/')), { recursive: true })
      copied.push(file)
    }
    // Linux and Windows keep the cookie key here. macOS keeps it in the
    // keychain, where this Chrome can reach it already.
    const state = path.join(source, 'Local State')
    if (fs.existsSync(state)) fs.cpSync(state, path.join(PROFILE, 'Local State'))
    if (!copied.length) return (seeding = { seeded: false, why: `nothing to copy from ${from}` })
    return (seeding = { seeded: true, from, copied })
  } catch (err) {
    // macOS keeps this folder behind Full Disk Access, and it is the terminal
    // running this server that needs it, not Chrome.
    const why =
      err.code === 'EPERM' || err.code === 'EACCES'
        ? `macOS blocks reading ${from}. Give Full Disk Access to the app running this server ` +
          '(System Settings > Privacy & Security > Full Disk Access), then delete data/chrome and press it again.'
        : `could not copy the Chrome profile: ${err.message}`
    fs.rmSync(target, { recursive: true, force: true })
    // Worth saying out loud: the human asked for their own session and did not
    // get it. Having no Chrome to copy from is not in that class.
    return (seeding = { seeded: false, blocked: true, why })
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function alive() {
  try {
    const res = await fetch(`${BASE}/json/version`, { signal: AbortSignal.timeout(1500) })
    return res.ok
  } catch {
    return false
  }
}

/**
 * Is the Chrome you actually use readable from here? That is the whole of the
 * Full Disk Access question, and the only way to answer it is to try.
 */
function canReadYourChrome() {
  const source = process.env.FLOW_CHROME_USER_DATA || USER_DATA[process.platform]
  const name = process.env.FLOW_CHROME_PROFILE || 'Default'
  if (!source) return null
  try {
    fs.readdirSync(path.join(source, name))
    return true
  } catch (err) {
    return err.code === 'EPERM' || err.code === 'EACCES' ? false : null
  }
}

/**
 * Bring the window back. A Chrome whose last window was closed is still
 * running, so starting it again does nothing and the button looks dead.
 */
async function raise() {
  try {
    const targets = await (await fetch(`${BASE}/json/list`)).json()
    const page = targets.find((t) => t.type === 'page')
    if (page) {
      await fetch(`${BASE}/json/activate/${page.id}`)
      return 'raised'
    }
  } catch {
    // Fall through: opening a tab is the other way to get a window back.
  }
  try {
    await fetch(`${BASE}/json/new?about:blank`, { method: 'PUT' })
    return 'opened a tab'
  } catch {
    return null
  }
}

/** Start the tool's Chrome if it is not already up. Visible, so you can log in. */
export async function ensure({ headless = false } = {}) {
  if (await alive()) {
    return { url: BASE, started: false, did: await raise(), yourChrome: canReadYourChrome(), ...seeding }
  }

  const bin = binary()
  if (!bin) throw new Error('no Chrome found; set FLOW_CHROME_BIN to its path')
  fs.mkdirSync(PROFILE, { recursive: true })
  const from = seed()

  child = spawn(
    bin,
    [
      `--user-data-dir=${PROFILE}`,
      `--remote-debugging-port=${PORT}`,
      '--no-first-run',
      '--no-default-browser-check',
      ...(headless ? ['--headless=new'] : []),
      'about:blank',
    ],
    { stdio: 'ignore', detached: true },
  )
  child.unref()

  for (let i = 0; i < 40; i++) {
    if (await alive()) return { url: BASE, started: true, yourChrome: canReadYourChrome(), ...from }
    await sleep(250)
  }
  throw new Error('Chrome started but never opened its debugging port')
}

export function close() {
  if (!child?.pid) return
  try { process.kill(-child.pid, 'SIGTERM') } catch { child.kill('SIGTERM') }
  child = null
}

/** One CDP conversation, on its own socket. */
async function talk(target, run) {
  const ws = new WebSocket(target)
  await new Promise((ok, bad) => {
    ws.addEventListener('open', ok, { once: true })
    ws.addEventListener('error', () => bad(new Error('could not open the CDP socket')), { once: true })
  })
  let id = 0
  const send = (method, params = {}) =>
    new Promise((ok, bad) => {
      const mine = ++id
      const timer = setTimeout(() => bad(new Error(`${method} timed out`)), 60_000)
      const on = (event) => {
        const message = JSON.parse(event.data)
        if (message.id !== mine) return
        clearTimeout(timer)
        ws.removeEventListener('message', on)
        message.error ? bad(new Error(`${method}: ${message.error.message}`)) : ok(message.result)
      }
      ws.addEventListener('message', on)
      ws.send(JSON.stringify({ id: mine, method, params }))
    })
  try {
    return await run(send)
  } finally {
    ws.close()
  }
}

/**
 * Open a page in that Chrome and report what is there: a screenshot for the
 * agent to read, and the text, which is what it can actually search.
 */
export async function visit(url, shotPath, { settleMs = 2500 } = {}) {
  await ensure()

  const tab = await (await fetch(`${BASE}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json()
  try {
    return await talk(tab.webSocketDebuggerUrl, async (send) => {
      await send('Page.enable')
      await sleep(settleMs) // an embedded admin finishes loading well after onload

      const read = await send('Runtime.evaluate', {
        expression:
          'JSON.stringify({ title: document.title, url: location.href,' +
          ' text: document.body ? document.body.innerText.slice(0, 20000) : "" })',
        returnByValue: true,
      })
      const page = JSON.parse(read.result.value)

      const shot = await captureWith(send)
      fs.mkdirSync(path.dirname(shotPath), { recursive: true })
      fs.writeFileSync(shotPath, Buffer.from(shot.data, 'base64'))

      return { ...page, screenshot: shotPath }
    })
  } finally {
    await fetch(`${BASE}/json/close/${tab.id}`).catch(() => {})
  }
}

export const profile = () => PROFILE

/** The copy step on its own, for the check that does not want a browser. */
export const seedForTest = () => seed()

/** Forget the copy, so the next start takes a fresh one. */
export function reset() {
  close()
  fs.rmSync(PROFILE, { recursive: true, force: true })
  seeding = null
}
