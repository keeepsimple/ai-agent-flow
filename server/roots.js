import fs from 'node:fs'
import { execFile } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { DATA } from './store.js'

const FILE = path.join(DATA, 'roots.json')

/** The folder the tool started life pointed at, still the default. */
export const DEFAULT_ROOT =
  process.env.FLOW_REPO_ROOT || path.resolve(import.meta.dirname, '..', '..')

const read = () => {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'))
  } catch {
    return [DEFAULT_ROOT]
  }
}
const write = (list) => fs.writeFileSync(FILE, JSON.stringify(list, null, 2))

/** ~ and a trailing slash are how a human types a path. */
export function expand(given) {
  const trimmed = String(given || '').trim().replace(/\/+$/, '')
  if (!trimmed) throw new Error('give a folder path')
  return path.resolve(trimmed.startsWith('~') ? path.join(os.homedir(), trimmed.slice(1)) : trimmed)
}

export const roots = () => read()

const isRepo = (dir) => fs.existsSync(path.join(dir, '.git'))

/**
 * Every repo under every root. A root that is itself a repo counts as one,
 * which is the normal case when you point at a single project rather than a
 * folder of them.
 */
export function listRepos() {
  const seen = new Map()
  for (const root of read()) {
    if (!fs.existsSync(root)) continue
    const found = isRepo(root)
      ? [root]
      : fs
          .readdirSync(root, { withFileTypes: true })
          .filter((e) => e.isDirectory() && isRepo(path.join(root, e.name)))
          .map((e) => path.join(root, e.name))
    for (const repoPath of found) {
      if (!seen.has(repoPath)) seen.set(repoPath, { name: path.basename(repoPath), path: repoPath, root })
    }
  }
  return [...seen.values()].sort((a, b) => a.root.localeCompare(b.root) || a.name.localeCompare(b.name))
}

/**
 * A repo as the human named it: a full path, or a bare name when that name is
 * unique across the roots. Two roots holding a repo of the same name is the
 * one case that cannot be guessed, so it is refused by name.
 */
export function resolveRepo(given) {
  const all = listRepos()
  const wanted = String(given || '').trim()
  if (!wanted) throw new Error('pick at least one repo')

  const byPath = all.find((r) => r.path === expand(wanted))
  if (byPath) return byPath

  const byName = all.filter((r) => r.name === wanted)
  if (byName.length === 1) return byName[0]
  if (byName.length > 1) {
    throw new Error(
      `"${wanted}" exists in ${byName.length} folders (${byName.map((r) => r.root).join(', ')}). Use its full path.`,
    )
  }
  throw new Error(`unknown repo: ${wanted}`)
}

export function addRoot(given) {
  const dir = expand(given)
  if (!fs.existsSync(dir)) throw new Error(`no such folder: ${dir}`)
  if (!fs.statSync(dir).isDirectory()) throw new Error(`not a folder: ${dir}`)

  const list = read()
  if (list.includes(dir)) throw new Error('that folder is already here')

  // A folder with nothing to work on is a typo, not a workspace.
  const next = [...list, dir]
  write(next)
  if (!listRepos().some((r) => r.root === dir)) {
    write(list)
    throw new Error(`no git repo in ${dir}, or directly inside it`)
  }
  return next
}

export function removeRoot(given) {
  const dir = expand(given)
  const next = read().filter((r) => r !== dir)
  if (!next.length) throw new Error('keep at least one folder')
  write(next)
  return next
}

// A browser cannot hand over a real folder path: webkitdirectory only exposes
// the names inside, and the File System Access API hands back a handle. The
// server runs on the same machine as the browser, so it asks the OS instead.
const PICKERS = {
  darwin: ['osascript', ['-e', 'POSIX path of (choose folder with prompt "Pick a repo, or a folder of repos")']],
  linux: ['zenity', ['--file-selection', '--directory', '--title=Pick a repo, or a folder of repos']],
  win32: [
    'powershell.exe',
    [
      '-NoProfile', '-STA', '-Command',
      'Add-Type -AssemblyName System.Windows.Forms;' +
        '$d = New-Object System.Windows.Forms.FolderBrowserDialog;' +
        'if ($d.ShowDialog() -eq "OK") { $d.SelectedPath }',
    ],
  ],
}

/** Open the OS folder chooser. Resolves to null when the human cancels. */
export function browse() {
  const picker = PICKERS[process.platform]
  if (!picker) throw new Error(`no folder picker on ${process.platform}; type the path instead`)

  return new Promise((resolve, reject) => {
    execFile(picker[0], picker[1], { timeout: 180_000 }, (err, stdout, stderr) => {
      const chosen = String(stdout || '').trim()
      if (chosen) return resolve(expand(chosen))
      if (!err) return resolve(null)

      if (err.code === 'ENOENT') {
        return reject(new Error(`${picker[0]} is not installed, so type the path instead`))
      }

      // Walking away from the dialog is not a failure. AppleScript says -128,
      // zenity exits 1, and a dialog that gets killed says nothing at all.
      const said = String(stderr || '').trim()
      if (err.killed || err.signal || /cancel|-128/i.test(said)) return resolve(null)

      // Never echo the command: it is a page of AppleScript nobody asked for.
      reject(new Error(said.split('\n')[0] || `the folder picker exited with ${err.code}`))
    })
  })
}
