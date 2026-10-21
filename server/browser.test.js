// Check that the tool's browser starts from the Chrome profile you already use.
// Chrome is never launched here: the part worth checking is which files cross
// and which do not. Run: npm test
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-browser-'))
const source = path.join(root, 'chrome-user-data')
const profile = path.join(source, 'Profile 2')

fs.mkdirSync(path.join(profile, 'Network'), { recursive: true })
fs.mkdirSync(path.join(profile, 'Local Storage', 'leveldb'), { recursive: true })
fs.mkdirSync(path.join(profile, 'Cache'), { recursive: true })
fs.writeFileSync(path.join(profile, 'Network', 'Cookies'), 'SQLite format 3')
fs.writeFileSync(path.join(profile, 'Local Storage', 'leveldb', '000003.log'), 'tokens')
fs.writeFileSync(path.join(profile, 'Preferences'), '{}')
fs.writeFileSync(path.join(profile, 'History'), 'every page you have ever opened')
fs.writeFileSync(path.join(profile, 'Cache', 'data_0'), 'megabytes')
fs.writeFileSync(path.join(source, 'Local State'), '{"os_crypt":{}}')

process.env.FLOW_DATA = path.join(root, 'data')
process.env.FLOW_CHROME_USER_DATA = source
process.env.FLOW_CHROME_PROFILE = 'Profile 2'

const browser = await import('./browser.js')
const target = path.join(browser.profile(), 'Default')

// ensure() would launch Chrome, so the copy is driven through reset(), which
// is the same code path the first start takes.
browser.reset()
const { seeded, copied } = browser.seedForTest()

assert.equal(seeded, true, 'the profile you already use is the one it starts from')
assert.deepEqual(
  copied.sort(),
  ['Cookies', 'Local Storage', 'Network/Cookies', 'Preferences'].filter((f) =>
    fs.existsSync(path.join(profile, ...f.split('/'))),
  ).sort(),
  'and only the files a session is made of',
)

assert.ok(fs.existsSync(path.join(target, 'Network', 'Cookies')), 'cookies crossed')
assert.equal(
  fs.readFileSync(path.join(target, 'Local Storage', 'leveldb', '000003.log'), 'utf8'),
  'tokens',
  'local storage crossed whole, not just its folder',
)
assert.ok(fs.existsSync(path.join(browser.profile(), 'Local State')), 'and the key file beside it')

assert.ok(!fs.existsSync(path.join(target, 'History')), 'browsing history did not')
assert.ok(!fs.existsSync(path.join(target, 'Cache')), 'nor the cache')

const again = browser.seedForTest()
assert.equal(again.seeded, false, 'a profile that already exists is never overwritten')
assert.match(again.why, /already has a profile/)
assert.ok(!again.blocked, 'and that is not something to interrupt anyone about')

browser.reset()
process.env.FLOW_CHROME_USER_DATA = path.join(root, 'not-here')
const missing = browser.seedForTest()
assert.equal(missing.seeded, false, 'no Chrome to copy from is a reason, not a crash')
assert.match(missing.why, /no Chrome profile to copy/)
assert.ok(!missing.blocked, 'nor is having no Chrome to copy from')

// The temp folder is left to the OS: importing browser.js pulls in the store,
// which has a debounced save still to come, and deleting the folder out from
// under it turns a passing check into a crash.
console.log('ok  browser: the session is copied from your own Chrome, the history is not')

// A screenshot of a window that was put away: bring it back, set a viewport,
// and try once more before giving up with both attempts named.
const { captureWith } = await import('./browser-capture.js')
{
  const calls = []
  let attempt = 0
  const send = async (method, params) => {
    calls.push(method)
    if (method === 'Browser.getWindowForTarget') return { windowId: 7 }
    if (method === 'Page.captureScreenshot') {
      attempt++
      if (attempt === 1) throw new Error('Cannot take screenshot with 0 width')
      return { data: 'iVBOR' }
    }
    return {}
  }
  const shot = await captureWith(send)
  assert.equal(shot.data, 'iVBOR')
  assert.ok(calls.includes('Browser.setWindowBounds'), 'the window is brought back to a normal size')
  assert.ok(calls.includes('Emulation.setDeviceMetricsOverride'), 'and a viewport is forced')
  assert.ok(calls.includes('Page.bringToFront'))
  assert.equal(calls.filter((c) => c === 'Page.captureScreenshot').length, 2, 'retried once')
}
{
  let attempt = 0
  const send = async (method) => {
    if (method === 'Browser.getWindowForTarget') return { windowId: 7 }
    if (method === 'Page.captureScreenshot') { attempt++; throw new Error(attempt === 1 ? 'Cannot take screenshot with 0 width' : 'Target crashed') }
    return {}
  }
  await assert.rejects(captureWith(send), /screenshot failed twice: Cannot take screenshot with 0 width \/ Target crashed/)
  assert.equal(attempt, 2, 'exactly one retry, whatever the second error says')
}
{
  // A crashed tab on the first try is retried once too, not looped.
  let attempt = 0
  const send = async (method) => {
    if (method === 'Browser.getWindowForTarget') throw new Error('no window')
    if (method === 'Page.captureScreenshot') { attempt++; throw new Error('Target crashed') }
    return {}
  }
  await assert.rejects(captureWith(send), /failed twice/)
  assert.equal(attempt, 2)
}
console.log('ok: a hidden window is brought back before the screenshot, and the retry is one')
