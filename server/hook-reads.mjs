#!/usr/bin/env node
// A Claude Code PreToolUse hook: a bare file read through the shell (cat,
// sed -n, head, tail) costs a whole turn and reads worse than the Read tool.
// Refuse it with the reason; let everything else through, including a
// pipeline, a redirection, or a chain, which are not reads.
import { realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const BARE = /^\s*(?:(?:cat|head|tail|less|more|bat)(?:\s+-[A-Za-z0-9]+)*|sed\s+-n(?:\s+-[A-Za-z]+)*)\s+[^|;&<>]+$/

export function isBareRead(command) {
  const c = String(command || '')
  if (/[|;&<>]/.test(c)) return false
  return BARE.test(c)
}

const isMain = (() => {
  try { return realpathSync(process.argv[1] || '') === realpathSync(new URL(import.meta.url).pathname) } catch { return false }
})()

if (isMain) {
  let input = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (d) => { input += d })
  process.stdin.on('end', () => {
    let event = {}
    try { event = JSON.parse(input) } catch {}
    if (event.tool_name === 'Bash' && isBareRead(event.tool_input?.command)) {
      process.stderr.write('Read files with the Read tool, not the shell. Use Read for a file, Grep to search, and the shell only for commands.\n')
      process.exit(2)
    }
    process.exit(0)
  })
}
