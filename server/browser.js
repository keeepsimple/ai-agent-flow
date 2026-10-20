import fs from 'node:fs'
import path from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import { DATA } from './store.js'

/**
 * A Chrome the tool owns, with its own profile, so a session signed in once
 * keeps working.
 *
 * It cannot be the browser you already have open: that one was started without
 * a debugging port, and the flag cannot be added to a running process. Chrome
 * also ignores the flag entirely on the default profile, which is the point of
 * that rule. So this is a second, dedicated profile you log into once.
 *
 * No automation dependency: Node speaks CDP over its own WebSocket.
 */
const PROFILE = path.join(DATA, 'chrome')
const PORT = Number(process.env.FLOW_BROWSER_PORT || 9344)
const BASE = `http://127.0.0.1:${PORT}`

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function alive() {
  try {
    const res = await fetch(`${BASE}/json/version`, { signal: AbortSignal.timeout(1500) })
    return res.ok
  } catch {
    return false
  }
}

/** Start the tool's Chrome if it is not already up. Visible, so you can log in. */
export async function ensure({ headless = false } = {}) {
  if (await alive()) return { url: BASE, started: false }

  const bin = binary()
  if (!bin) throw new Error('no Chrome found; set FLOW_CHROME_BIN to its path')
  fs.mkdirSync(PROFILE, { recursive: true })

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
    if (await alive()) return { url: BASE, started: true }
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

      const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
      fs.mkdirSync(path.dirname(shotPath), { recursive: true })
      fs.writeFileSync(shotPath, Buffer.from(shot.data, 'base64'))

      return { ...page, screenshot: shotPath }
    })
  } finally {
    await fetch(`${BASE}/json/close/${tab.id}`).catch(() => {})
  }
}

export const profile = () => PROFILE
