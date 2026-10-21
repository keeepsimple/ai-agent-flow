#!/usr/bin/env node
// One-off: find secrets already sitting in tasks.json and the logs, move them
// to the keychain under their task, and rewrite the files with {{secret:NAME}}.
// Run with the server stopped: FLOW_DATA=<data dir> node scripts/redact-existing.mjs
import fs from 'node:fs'
import path from 'node:path'
import { hide, keep } from '../server/secrets.js'

const DATA = process.env.FLOW_DATA || path.join(import.meta.dirname, '..', 'data')
const tasksFile = path.join(DATA, 'tasks.json')
const tasks = JSON.parse(fs.readFileSync(tasksFile, 'utf8'))
const rotate = []

for (const task of Object.values(tasks)) {
  const logFile = path.join(DATA, 'logs', `${task.id}.jsonl`)
  // The log is JSON lines: redact the text of each entry, not the raw file,
  // or an escaped newline rides along inside a value.
  const lines = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').split('\n') : []
  const entries = lines.map((l) => { try { return JSON.parse(l) } catch { return null } })
  const texts = [{ key: 'prompt', text: task.prompt || '' }]
  entries.forEach((e, i) => { if (e && typeof e.text === 'string') texts.push({ key: `log:${i}`, text: e.text, wrapped: false }) })
  const { secrets, texts: out } = hide(texts)
  if (!secrets.length) continue

  for (const { name, value } of secrets) keep(task.id, name, value)
  let logChanged = false
  entries.forEach((e, i) => {
    if (e && out[`log:${i}`] !== undefined && out[`log:${i}`] !== e.text) { e.text = out[`log:${i}`]; logChanged = true }
  })
  const where = [task.prompt !== out.prompt ? 'prompt' : null, logChanged ? 'log' : null]
  task.prompt = out.prompt
  task.secrets = [...new Set([...(task.secrets || []), ...secrets.map((s) => s.name)])]
  if (logChanged) fs.writeFileSync(logFile, lines.map((l, i) => (entries[i] ? JSON.stringify(entries[i]) : l)).join('\n'))
  console.log(`${task.id}: moved ${secrets.map((s) => s.name).join(', ')} (${where.filter(Boolean).join(', ')})`)
  rotate.push(...secrets.map((s) => `${s.name} (${task.id})`))
}

fs.writeFileSync(tasksFile, JSON.stringify(tasks, null, 2))
if (rotate.length) {
  console.log(`\nThese have already been in a model's context. rotate these: ${rotate.join(', ')}`)
} else {
  console.log('nothing to move')
}
