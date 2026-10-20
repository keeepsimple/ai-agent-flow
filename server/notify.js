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

/**
 * Desktop notification, best effort. A machine without a notification daemon
 * (a headless Linux box, say) is a normal way to run this, so a failure here
 * is swallowed rather than surfaced.
 */
export function notify(title, message, { urgent = false } = {}) {
  if (process.env.FLOW_NOTIFY === 'off') return
  const done = () => {}

  if (process.platform === 'darwin') {
    const script = OSASCRIPT.flatMap((line) => ['-e', line])
    const sound = urgent ? 'Basso' : 'Glass'
    return void execFile('osascript', [...script, '--', message, title, sound], done)
  }

  if (process.platform === 'win32') {
    return void execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', POWERSHELL],
      { env: { ...process.env, FLOW_N_TITLE: title, FLOW_N_BODY: message } },
      done,
    )
  }

  // Linux and the other unixes: libnotify, which every desktop session ships.
  execFile('notify-send', ['-u', urgent ? 'critical' : 'normal', title, message], done)
}
