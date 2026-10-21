// Things that look like secrets, found on the way into a task so they can be
// kept out of the transcript. The rules are deliberately few and legible; the
// test file is the list of what must and must not trip them.
//
// detect(text) -> [{ name, value, spans: [{ start, end }] }], one per distinct value.
// redact(text, found) -> text with every span replaced by {{secret:NAME}}.

const NAMED = /(?<![A-Za-z0-9_])(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*(?:_KEY|_TOKEN|_SECRET|_PASSWORD))[ \t]*[=:][ \t]*(["']?)([^\s"']{8,})\2/gi
const WRAPPED = /<<([^<>\n]+)>>/g
const PREFIXED = /\b((?:ck_|sk_|ghp_|glpat-|xoxb-|AKIA)[A-Za-z0-9._-]{16,})/g
const SHAPED = /[A-Za-z0-9+/=]{40,}/g

const HEX40 = /^[0-9a-f]{40}$/i
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const mixed = (v) => /[a-z]/.test(v) && /[A-Z]/.test(v) && /[0-9]/.test(v)

export function detect(text) {
  const found = new Map() // value -> { name, value, spans }
  const taken = [] // spans already claimed by an earlier rule

  const claim = (start, end, value, name = null) => {
    if (taken.some((s) => start < s.end && end > s.start)) return
    taken.push({ start, end })
    let entry = found.get(value)
    if (!entry) {
      entry = { name, value, spans: [] }
      found.set(value, entry)
    } else if (name && !entry.name) {
      entry.name = name
    }
    entry.spans.push({ start, end })
  }

  for (const m of text.matchAll(NAMED)) {
    const value = m[3]
    const start = m.index + m[0].lastIndexOf(value)
    claim(start, start + value.length, value, m[1].toUpperCase())
  }
  for (const m of text.matchAll(WRAPPED)) claim(m.index, m.index + m[0].length, m[1].trim())
  for (const m of text.matchAll(PREFIXED)) claim(m.index, m.index + m[1].length, m[1])
  for (const m of text.matchAll(SHAPED)) {
    const v = m[0]
    if (HEX40.test(v) || UUID.test(v) || !mixed(v)) continue
    claim(m.index, m.index + v.length, v)
  }

  // Order by first appearance, and number the unnamed ones in that order, so
  // SECRET_1 is the first one a reader meets.
  const out = [...found.values()]
    .map((e) => ({ ...e, spans: e.spans.sort((a, b) => a.start - b.start) }))
    .sort((a, b) => a.spans[0].start - b.spans[0].start)
  let unnamed = 0
  for (const e of out) if (!e.name) e.name = `SECRET_${++unnamed}`
  return out
}

export function redact(text, found) {
  const spans = found.flatMap((f) => f.spans.map((s) => ({ ...s, name: f.name })))
  spans.sort((a, b) => b.start - a.start)
  let out = text
  for (const s of spans) out = out.slice(0, s.start) + `{{secret:${s.name}}}` + out.slice(s.end)
  return out
}

export function placeholderNames(text) {
  return [...new Set([...text.matchAll(/\{\{secret:([A-Za-z0-9_]+)\}\}/g)].map((m) => m[1]))]
}

// ---- Keeping values -------------------------------------------------------
//
// macOS: the login keychain, through the `security` CLI the way the file
// dialogs already go through osascript. One generic-password item per
// (taskId, name). Elsewhere: a JSON file per task that only this user can
// read, since Windows has no built-in CLI that reads a credential back.

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
const DATA = process.env.FLOW_DATA || path.join(import.meta.dirname, '..', 'data')
const MAC = process.platform === 'darwin'
const SERVICE = (name) => `agentflow:${name}`
const FILE = (owner) => path.join(DATA, 'secrets', `${owner.replace(/[^A-Za-z0-9_.:-]/g, '_')}.json`)

const sec = (...args) =>
  execFileSync('security', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })

const readFile = (owner) => {
  try { return JSON.parse(fs.readFileSync(FILE(owner), 'utf8')) } catch { return {} }
}
const writeFile = (owner, values) => {
  const file = FILE(owner)
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  if (Object.keys(values).length === 0) {
    fs.rmSync(file, { force: true })
    return
  }
  fs.writeFileSync(file, JSON.stringify(values), { mode: 0o600 })
  fs.chmodSync(file, 0o600)
}

export function keep(owner, name, value) {
  if (MAC) {
    sec('add-generic-password', '-U', '-a', owner, '-s', SERVICE(name), '-w', value)
    return
  }
  writeFile(owner, { ...readFile(owner), [name]: value })
}

export function read(owner, name) {
  if (MAC) {
    try { return sec('find-generic-password', '-a', owner, '-s', SERVICE(name), '-w').replace(/\n$/, '') } catch { return null }
  }
  return readFile(owner)[name] ?? null
}

export function forget(owner, names) {
  if (MAC) {
    for (const name of names) {
      try { sec('delete-generic-password', '-a', owner, '-s', SERVICE(name)) } catch {}
    }
    return
  }
  const values = readFile(owner)
  for (const name of names) delete values[name]
  writeFile(owner, values)
}

/** The environment a run for `task` gets: FLOW_SECRET_<NAME> for every name it keeps. */
export function env(task) {
  const out = {}
  for (const name of task.secrets || []) {
    const value = read(task.id, name)
    if (value !== null) out[`FLOW_SECRET_${name}`] = value
  }
  return out
}

// ---- The guard ------------------------------------------------------------

/**
 * Lines a diff adds that carry a kept value or anything shaped like a secret.
 * `diff` is `git diff base...branch` text; `values` are the kept values.
 * Returns [{ file, line }] in diff order.
 */
export function scanDiff(diff, values = []) {
  const hits = []
  let file = null
  let line = 0
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('+++ ')) {
      file = raw.slice(4).replace(/^b\//, '')
      continue
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(raw)
    if (hunk) {
      line = Number(hunk[1]) - 1
      continue
    }
    if (raw.startsWith('-') || raw.startsWith('\\')) continue
    line++
    if (!raw.startsWith('+') || !file) continue
    const text = raw.slice(1)
    if (values.some((v) => v && text.includes(v)) || detect(text).length) hits.push({ file, line })
  }
  return hits
}

// ---- Several sources at once ---------------------------------------------

export const TEXT_ATTACHMENT = /\.(txt|md|env|json|csv|log|diff|patch|yml|yaml|toml|ini)$/i

/**
 * Detect across several texts (the prompt and its text attachments) with one
 * numbering and one name per value, and redact each of them.
 * texts: [{ key, text }] -> { secrets: [{ name, value }], texts: { key: redacted } }
 */
export function hide(texts) {
  const byValue = new Map()
  let unnamed = 0
  const out = {}
  for (const { key, text } of texts) {
    const found = detect(text)
    for (const f of found) {
      const known = byValue.get(f.value)
      if (known) {
        f.name = known
      } else {
        if (/^SECRET_\d+$/.test(f.name)) f.name = `SECRET_${++unnamed}`
        byValue.set(f.value, f.name)
      }
    }
    out[key] = redact(text, found)
  }
  return { secrets: [...byValue].map(([value, name]) => ({ name, value })), texts: out }
}
