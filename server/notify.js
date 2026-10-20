import { execFile } from 'node:child_process'

// argv form, so a task title containing quotes cannot break out into AppleScript.
const SCRIPT = [
  'on run argv',
  'display notification (item 1 of argv) with title (item 2 of argv) sound name (item 3 of argv)',
  'end run',
]

export function notify(title, message, { sound = 'Glass' } = {}) {
  if (process.platform !== 'darwin' || process.env.FLOW_NOTIFY === 'off') return
  const args = SCRIPT.flatMap((l) => ['-e', l])
  execFile('osascript', [...args, '--', message, title, sound], () => {})
}
