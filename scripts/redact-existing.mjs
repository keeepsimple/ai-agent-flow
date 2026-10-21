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
  const log = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : ''
  const { secrets, texts } = hide([{ key: 'prompt', text: task.prompt || '' }, { key: 'log', text: log, wrapped: false }])
  if (!secrets.length) continue

  for (const { name, value } of secrets) keep(task.id, name, value)
  const where = [task.prompt !== texts.prompt ? 'prompt' : null, log !== texts.log ? 'log' : null]
  task.prompt = texts.prompt
  task.secrets = [...new Set([...(task.secrets || []), ...secrets.map((s) => s.name)])]
  if (log !== texts.log) fs.writeFileSync(logFile, texts.log)
  console.log(`${task.id}: moved ${secrets.map((s) => s.name).join(', ')} (${where.filter(Boolean).join(', ')})`)
  rotate.push(...secrets.map((s) => `${s.name} (${task.id})`))
}

fs.writeFileSync(tasksFile, JSON.stringify(tasks, null, 2))
if (rotate.length) {
  console.log(`\nThese have already been in a model's context. rotate these: ${rotate.join(', ')}`)
} else {
  console.log('nothing to move')
}
