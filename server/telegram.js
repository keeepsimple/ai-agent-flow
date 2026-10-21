// Questions on the phone. A Telegram bot: questions, gates, finishes and cost
// lines go to one chat; a reply to a question message answers it. Token in the
// keychain, chat id in settings, nothing else to install.
import * as settings from './settings.js'
import * as secrets from './secrets.js'

const API = process.env.FLOW_TELEGRAM_API || 'https://api.telegram.org'
let token = null
let chatId = ''
let offset = 0
let running = false
let onAnswer = null

export function configure({ onAnswer: cb }) {
  onAnswer = cb
  reload()
}

/** Re-read settings and the keychain; start polling when both are there. */
export function reload() {
  const s = settings.get()
  chatId = s.telegram.chatId
  token = secrets.read(settings.TELEGRAM_OWNER, 'TOKEN')
  if (enabled() && !running) loop()
}

export const enabled = () => Boolean(token && chatId)

export async function send(text, { taskId, questionId } = {}) {
  if (!enabled()) return null
  const body = { chat_id: chatId, text: questionId ? `Q ${taskId}/${questionId}: ${text}` : text }
  try {
    const r = await fetch(`${API}/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    })
    return r.ok
  } catch {
    return false
  }
}

/**
 * What one update means. Pure, so it can be tested without a bot: a reply to
 * a question message, or a message that starts with the question id, answers
 * that question; anything else gets a hint back.
 */
export function handleUpdate(update) {
  const m = update?.message
  if (!m || typeof m.text !== 'string') return null
  const quoted = /Q ([0-9a-f]{8})\/([0-9a-f]{8}):/.exec(m.reply_to_message?.text || '')
  if (quoted) return { answered: { taskId: quoted[1], questionId: quoted[2], text: m.text.trim() } }
  const lead = /^([0-9a-f]{8})\s+([\s\S]+)$/.exec(m.text.trim())
  if (lead) return { answered: { taskId: null, questionId: lead[1], text: lead[2].trim() } }
  return { hint: true }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function loop() {
  running = true
  try {
    while (enabled()) {
      let updates = []
      try {
        const r = await fetch(`${API}/bot${token}/getUpdates?offset=${offset}&timeout=20`)
        updates = (await r.json()).result || []
      } catch {
        await sleep(3000)
        continue
      }
      for (const u of updates) {
        offset = u.update_id + 1
        const out = handleUpdate(u)
        if (out?.answered) {
          try { await onAnswer?.(out.answered) } catch (err) { await send(`Could not answer: ${err.message}`) }
        } else if (out?.hint) {
          await send('Reply to a question message to answer it, or start your message with the question id.')
        }
      }
    }
  } finally {
    running = false
  }
}
