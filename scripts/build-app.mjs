/**
 * Build a double-clickable macOS app around the same server `npm start` runs.
 *
 * Two things this buys that the web mode cannot:
 *
 *   - It is its own app in System Settings > Privacy & Security, so Full Disk
 *     Access can be granted to *it* rather than to whichever terminal you
 *     happened to start the server from.
 *   - It carries its own Node, so the machine it runs on needs none.
 *
 * The Node it carries is downloaded from nodejs.org, not copied from this
 * machine: a Homebrew node links against a dozen Homebrew dylibs and would
 * die on the first machine without them. The official build is self-contained,
 * and this checks that before shipping it.
 *
 *   node scripts/build-app.mjs [--node-version v24.21.0] [--out dist]
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const ROOT = path.resolve(import.meta.dirname, '..')
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : process.argv[i + 1]
}

const VERSION = arg('node-version', process.version)
const OUT = path.resolve(ROOT, arg('out', 'dist'))
const APP = path.join(OUT, 'Agent Flow.app')
const CACHE = path.join(ROOT, 'build')
const ARCH = process.arch === 'arm64' ? 'arm64' : 'x64'
const SLUG = `node-${VERSION}-darwin-${ARCH}`

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...opts })

if (process.platform !== 'darwin') {
  console.error('This builds a macOS .app. On Linux and Windows, run the web mode.')
  process.exit(1)
}

/** The official tarball, verified against the release SHASUMS before it is opened. */
async function node() {
  const binary = path.join(CACHE, SLUG, 'bin', 'node')
  if (fs.existsSync(binary)) return binary

  const file = `${SLUG}.tar.gz`
  const base = `https://nodejs.org/dist/${VERSION}`
  console.log(`downloading ${file}`)

  const sums = await (await fetch(`${base}/SHASUMS256.txt`)).text()
  const want = sums.split('\n').find((line) => line.endsWith(` ${file}`))?.split(/\s+/)[0]
  if (!want) throw new Error(`${VERSION} has no ${file}; pick a version nodejs.org actually published`)

  const res = await fetch(`${base}/${file}`)
  if (!res.ok) throw new Error(`could not download ${file}: ${res.status}`)
  const bytes = Buffer.from(await res.arrayBuffer())

  const got = crypto.createHash('sha256').update(bytes).digest('hex')
  if (got !== want) throw new Error(`checksum mismatch for ${file}: expected ${want}, got ${got}`)

  fs.mkdirSync(CACHE, { recursive: true })
  const tarball = path.join(CACHE, file)
  fs.writeFileSync(tarball, bytes)
  run('tar', ['-xzf', tarball, '-C', CACHE])
  fs.rmSync(tarball, { force: true })
  return binary
}

/** A binary that needs anything outside /usr/lib is a binary that travels badly. */
function selfContained(binary) {
  const borrowed = run('otool', ['-L', binary])
    .split('\n')
    .slice(1)
    .map((line) => line.trim().split(' ')[0])
    .filter(Boolean)
    .filter((lib) => !lib.startsWith('/usr/lib/') && !lib.startsWith('/System/'))
  if (borrowed.length) {
    throw new Error(`that node borrows libraries it will not find elsewhere:\n  ${borrowed.join('\n  ')}`)
  }
}

const PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Agent Flow</string>
  <key>CFBundleDisplayName</key><string>Agent Flow</string>
  <key>CFBundleIdentifier</key><string>dev.agentflow.app</string>
  <key>CFBundleVersion</key><string>1.0</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>agent-flow</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
</dict>
</plist>
`

// exec, not a background child: the process LaunchServices started has to stay
// the process that runs the server, or macOS hangs Full Disk Access on the
// wrong thing.
//
// A GUI app inherits almost no PATH, so git and claude have to be found here.
// Whatever already runs the web mode is tried first.
const LAUNCHER = `#!/bin/sh
set -e
HERE=$(cd "$(dirname "$0")/.." && pwd)
PORT="\${FLOW_PORT:-7777}"

if curl -fsS -o /dev/null -m 1 "http://127.0.0.1:$PORT/api/state" 2>/dev/null; then
  open "http://127.0.0.1:$PORT"
  exit 0
fi

export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
export FLOW_DATA="\${FLOW_DATA:-$HOME/Library/Application Support/Agent Flow}"
export FLOW_REPO_ROOT="\${FLOW_REPO_ROOT:-$HOME}"
export FLOW_OPEN=1
mkdir -p "$FLOW_DATA"
exec "$HERE/Resources/node" "$HERE/Resources/app/server/index.js"
`

async function build() {
  if (!fs.existsSync(path.join(ROOT, 'web', 'dist', 'index.html'))) {
    console.log('building the UI first')
    run('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit' })
  }

  const binary = await node()
  selfContained(binary)

  fs.rmSync(APP, { recursive: true, force: true })
  const macos = path.join(APP, 'Contents', 'MacOS')
  const res = path.join(APP, 'Contents', 'Resources')
  fs.mkdirSync(macos, { recursive: true })
  fs.mkdirSync(path.join(res, 'app'), { recursive: true })

  fs.writeFileSync(path.join(APP, 'Contents', 'Info.plist'), PLIST)
  fs.writeFileSync(path.join(macos, 'agent-flow'), LAUNCHER, { mode: 0o755 })
  fs.copyFileSync(binary, path.join(res, 'node'))
  fs.chmodSync(path.join(res, 'node'), 0o755)

  // Only what the server reads at run time. No node_modules: the server has no
  // dependencies, and the UI's are already baked into web/dist.
  fs.cpSync(path.join(ROOT, 'server'), path.join(res, 'app', 'server'), { recursive: true })
  fs.cpSync(path.join(ROOT, 'web', 'dist'), path.join(res, 'app', 'web', 'dist'), { recursive: true })
  fs.rmSync(path.join(res, 'app', 'server', 'test.js'), { force: true })
  fs.rmSync(path.join(res, 'app', 'server', 'browser.test.js'), { force: true })

  // Ad-hoc signing gives the bundle the stable identity Full Disk Access is
  // remembered against. It changes on every rebuild, so the grant has to be
  // renewed when you rebuild.
  run('codesign', ['--force', '--deep', '--sign', '-', APP], { stdio: 'inherit' })

  const size = run('du', ['-sh', APP]).split('\t')[0]
  console.log(`\n${APP}  (${size})`)
  console.log('Move it to /Applications, then grant it Full Disk Access.')
}

build().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
