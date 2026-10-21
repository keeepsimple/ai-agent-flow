/**
 * Package the desktop app: a Flutter window with the Node server inside it.
 *
 * The window is native — Skia, not a web view — and one Dart source builds it
 * for both macOS and Windows. The server it carries is the same one
 * `npm start` runs, with its own Node, so the machine it lands on needs none.
 *
 * Flutter desktop does not cross-compile: run this on the platform you want
 * the app for.
 *
 *   node scripts/build-app.mjs [--node-version v24.21.0] [--out dist]
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const ROOT = path.resolve(import.meta.dirname, '..')
const DESKTOP = path.join(ROOT, 'desktop')
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : process.argv[i + 1]
}

const VERSION = arg('node-version', process.version)
const OUT = path.resolve(ROOT, arg('out', 'dist'))
const CACHE = path.join(ROOT, 'build')
const MAC = process.platform === 'darwin'
const ARCH = process.arch === 'arm64' ? 'arm64' : 'x64'
const SLUG = MAC ? `node-${VERSION}-darwin-${ARCH}` : `node-${VERSION}-win-x64`

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...opts })

if (!MAC && process.platform !== 'win32') {
  console.error('Packaged builds are macOS and Windows. On Linux, run the web mode.')
  process.exit(1)
}

try {
  run('flutter', ['--version'])
} catch {
  console.error('The window is built with Flutter: https://docs.flutter.dev/get-started/install')
  process.exit(1)
}

/** The official build, verified against the release SHASUMS before it is opened. */
async function node() {
  const binary = MAC
    ? path.join(CACHE, SLUG, 'bin', 'node')
    : path.join(CACHE, SLUG, 'node.exe')
  if (fs.existsSync(binary)) return binary

  const file = `${SLUG}${MAC ? '.tar.gz' : '.zip'}`
  const base = `https://nodejs.org/dist/${VERSION}`
  console.log(`downloading ${file}`)

  const sums = await (await fetch(`${base}/SHASUMS256.txt`)).text()
  const want = sums.split('\n').find((line) => line.endsWith(` ${file}`))?.split(/\s+/)[0]
  if (!want) throw new Error(`${VERSION} has no ${file}; pick a version nodejs.org published`)

  const res = await fetch(`${base}/${file}`)
  if (!res.ok) throw new Error(`could not download ${file}: ${res.status}`)
  const bytes = Buffer.from(await res.arrayBuffer())

  const got = crypto.createHash('sha256').update(bytes).digest('hex')
  if (got !== want) throw new Error(`checksum mismatch for ${file}: expected ${want}, got ${got}`)

  fs.mkdirSync(CACHE, { recursive: true })
  const archive = path.join(CACHE, file)
  fs.writeFileSync(archive, bytes)
  // bsdtar reads both, and ships with macOS and with Windows 10 and later.
  run('tar', ['-xf', archive, '-C', CACHE])
  fs.rmSync(archive, { force: true })
  return binary
}

/**
 * A runtime that borrows a library it will not find elsewhere travels badly,
 * which is exactly what a Homebrew node does. Checked here rather than on the
 * machine that ends up with the app.
 */
function selfContained(binary) {
  if (!MAC) return
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

/** The server, and nothing that only the checkout needs. */
function carry(into, binary) {
  fs.mkdirSync(into, { recursive: true })
  fs.copyFileSync(binary, path.join(into, MAC ? 'node' : 'node.exe'))
  if (MAC) fs.chmodSync(path.join(into, 'node'), 0o755)

  fs.cpSync(path.join(ROOT, 'server'), path.join(into, 'server'), { recursive: true })
  for (const test of ['test.js', 'browser.test.js']) {
    fs.rmSync(path.join(into, 'server', test), { force: true })
  }
  // The web UI rides along, so the same server still answers a browser.
  const web = path.join(ROOT, 'web', 'dist')
  if (fs.existsSync(web)) fs.cpSync(web, path.join(into, 'web', 'dist'), { recursive: true })
}

/**
 * Sign the bundle, because the signature is the identity macOS remembers a
 * permission against.
 *
 * Ad-hoc is the default and costs nothing, but its identity is the hash of
 * the bundle, so every rebuild is a different app and Full Disk Access has to
 * be granted again. Signing with a real certificate keeps the identity fixed
 * across rebuilds, and the grant with it.
 *
 * The entitlements have to be handed over here too: re-signing without them
 * silently drops the ones Flutter applied at build time.
 *
 * No hardened runtime: it is needed to notarise, not to keep a permission,
 * and turning it on is not something this can check from here.
 */
function sign(app) {
  const identity = process.env.FLOW_SIGN_IDENTITY || arg('sign', '-')
  const entitlements = path.join(DESKTOP, 'macos', 'Runner', 'Release.entitlements')

  run('codesign', [
    '--force', '--deep', '--sign', identity,
    '--entitlements', entitlements,
    app,
  ], { stdio: 'inherit' })

  if (identity === '-') {
    console.log(
      '\nSigned ad-hoc, so Full Disk Access has to be granted again after every\n' +
        'build. To keep it, sign with a certificate you already have:\n' +
        '  security find-identity -v -p codesigning\n' +
        '  FLOW_SIGN_IDENTITY="Apple Development: you (TEAMID)" npm run app',
    )
  }
}

async function build() {
  if (!fs.existsSync(path.join(ROOT, 'web', 'dist', 'index.html'))) {
    run('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit' })
  }

  const binary = await node()
  selfContained(binary)

  run('flutter', ['build', MAC ? 'macos' : 'windows', '--release'], {
    cwd: DESKTOP,
    stdio: 'inherit',
  })

  fs.mkdirSync(OUT, { recursive: true })
  if (MAC) {
    const built = path.join(DESKTOP, 'build/macos/Build/Products/Release/Agent Flow.app')
    const app = path.join(OUT, 'Agent Flow.app')
    fs.rmSync(app, { recursive: true, force: true })
    // ditto, not a plain copy: a framework is held together by symlinks, and
    // flattening them leaves a bundle codesign refuses to seal.
    run('ditto', [built, app])
    carry(path.join(app, 'Contents', 'Resources', 'flow'), binary)

    sign(app)
    console.log(`\n${app}  (${run('du', ['-sh', app]).split('\t')[0]})`)
    console.log('Move it to /Applications, then grant it Full Disk Access.')
  } else {
    const built = path.join(DESKTOP, 'build/windows/x64/runner/Release')
    const app = path.join(OUT, 'Agent Flow')
    fs.rmSync(app, { recursive: true, force: true })
    fs.cpSync(built, app, { recursive: true })
    carry(path.join(app, 'flow'), binary)
    console.log(`\n${app}\\Agent Flow.exe`)
  }
}

build().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
