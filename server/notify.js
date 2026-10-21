import { execFile } from 'node:child_process'

// argv form, so a task title containing quotes cannot break out into AppleScript.
const OSASCRIPT = [
  'on run argv',
  'display notification (item 1 of argv) with title (item 2 of argv) sound name (item 3 of argv)',
  'end run',
]

// Windows PowerShell has no argv for inline scripts, so the text goes through
// the environment instead of the command line. The AppID is the documented
// shim that lets a script raise a toast without registering an app.
const POWERSHELL = `
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime] > $null
$xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent(
  [Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$nodes = $xml.GetElementsByTagName('text')
$nodes.Item(0).AppendChild($xml.CreateTextNode($env:FLOW_N_TITLE)) > $null
$nodes.Item(1).AppendChild($xml.CreateTextNode($env:FLOW_N_BODY)) > $null
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier(
  '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'
).Show([Windows.UI.Notifications.ToastNotification]::new($xml))
`

const ignore = () => {}

function osascript(title, message, urgent) {
  const script = OSASCRIPT.flatMap((line) => ['-e', line])
  execFile('osascript', [...script, '--', message, title, urgent ? 'Basso' : 'Glass'], ignore)
}

function mac(title, message, urgent, url) {
  // An osascript notification belongs to Script Editor, so clicking it opens
  // Script Editor. terminal-notifier can point the click somewhere useful, so
  // it is tried first and osascript is the fallback when it is not installed.
  const args = ['-title', title, '-message', message, '-group', 'agent-flow']

  // Started by the app, the click belongs to the app. Opening the URL instead
  // put a browser on screen showing the same thing the window behind it was
  // already showing.
  const app = process.env.FLOW_ACTIVATE
  if (app) args.push('-activate', app)
  else if (url) args.push('-open', url)
  if (urgent) args.push('-sound', 'Basso')
  execFile('terminal-notifier', args, (err) => {
    // Any failure, not just a missing binary: terminal-notifier exits 3 when
    // its own notification permission has been turned off, and shows nothing
    // when it does. The fallback is worth having because of that, even though
    // an osascript notification belongs to Script Editor and opens it when
    // clicked.
    if (err) osascript(title, message, urgent)
  })
}

/**
 * Desktop notification, best effort. This is the fallback for when no browser
 * tab is connected; a connected tab raises its own, which focuses the right
 * task when clicked. A machine with no notification daemon is a normal way to
 * run this, so failures here are swallowed.
 */
export function notify(title, message, { urgent = false, url = '' } = {}) {
  if (process.env.FLOW_NOTIFY === 'off') return

  if (process.platform === 'darwin') return mac(title, message, urgent, url)

  if (process.platform === 'win32') {
    return void execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', POWERSHELL],
      { env: { ...process.env, FLOW_N_TITLE: title, FLOW_N_BODY: message } },
      ignore,
    )
  }

  // Linux and the other unixes: libnotify, which every desktop session ships.
  execFile('notify-send', ['-u', urgent ? 'critical' : 'normal', title, message], ignore)
}
