// Questions on the phone. A Telegram bot: questions, gates, finishes and cost
// lines go to one chat; a reply to a question message answers it. Token in the
// keychain, chat id in settings, nothing else to install.
import { randomBytes } from 'node:crypto'
import * as settings from './settings.js'
import * as secrets from './secrets.js'

const API = process.env.FLOW_TELEGRAM_API || 'https://api.telegram.org'
let token = null
let chatId = ''
let offset = 0
let running = false
let onAnswer = null
let onCommand = null

export function configure({ onAnswer: answer, onCommand: command }) {
  onAnswer = answer
  onCommand = command
  reload()
}

/** The commands the bot answers, shown in Telegram's menu. */
export const COMMANDS = [
  { command: 'status', description: 'What is running and what is waiting on you' },
  { command: 'task', description: 'One task in detail: /task <id>' },
  { command: 'help', description: 'What the bot can do' },
]

/** Re-read settings and the keychain; start polling when both are there. */
export function reload() {
  const s = settings.get()
  chatId = s.telegram.chatId
  const next = secrets.read(settings.TELEGRAM_OWNER, 'TOKEN')
  if (next !== token) offset = 0 // another bot's updates start from the top
  token = next
  if (enabled()) {
    // Best effort: the menu is a convenience, its absence breaks nothing.
    fetch(`${API}/bot${token}/setMyCommands`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ commands: COMMANDS }),
    }).catch(() => {})
    if (!running) loop()
  }
}

export const enabled = () => Boolean(token && chatId)

/** One Bot API call; the result, or null on any failure. */
async function call(method, body) {
  try {
    const r = await fetch(`${API}/bot${token}/${method}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    })
    return r.ok ? ((await r.json()).result ?? true) : null
  } catch {
    return null
  }
}

// Telegram refuses a message over 4096 characters. Long text is sent as
// several messages; past KEEP of them, the rest waits behind a Show more
// button, so a long report does not flood the chat.
export const CHUNK = 3800
export const KEEP = 3
const pending = new Map() // key -> { parts, from, at }

/** Split on paragraph, then line, then word; a run with no spaces is cut where it must be. */
export function chunks(text, size = CHUNK) {
  const out = []
  let rest = String(text || '')
  while (rest.length > size) {
    let cut = rest.lastIndexOf('\n\n', size)
    if (cut < size / 2) cut = rest.lastIndexOf('\n', size)
    if (cut < size / 2) cut = rest.lastIndexOf(' ', size)
    if (cut < size / 2) cut = size
    out.push(rest.slice(0, cut).trimEnd())
    rest = rest.slice(cut).replace(/^\s+/, '')
  }
  out.push(rest)
  return out
}

async function sendBatch(parts, from) {
  const end = Math.min(parts.length, from + KEEP)
  let ok = true
  for (let i = from; i < end; i++) {
    let markup
    if (i === end - 1 && end < parts.length) {
      const key = randomBytes(4).toString('hex')
      pending.set(key, { parts, from: end, at: Date.now() })
      // Kept in memory for a day, at most fifty: a button older than that says so.
      for (const [k, v] of pending) if (pending.size > 50 || Date.now() - v.at > 86_400_000) pending.delete(k)
      markup = { inline_keyboard: [[{ text: `Show more (${parts.length - end} more)`, callback_data: `more:${key}` }]] }
    }
    if (!(await call('sendMessage', { chat_id: chatId, text: parts[i], ...(markup ? { reply_markup: markup } : {}) }))) ok = false
  }
  return ok
}

/**
 * Send text of any length. A question carries its "Q task/qid:" line on every
 * part, so replying to any of them answers it.
 */
export async function send(text, { taskId, questionId } = {}) {
  if (!enabled()) return null
  const prefix = questionId ? `Q ${taskId}/${questionId}: ` : ''
  const parts = chunks(text, CHUNK - prefix.length)
  const labelled = parts.map((p, i) => prefix + p + (parts.length > 1 ? `\n— ${i + 1}/${parts.length}` : ''))
  return sendBatch(labelled, 0)
}

/** A tap on Show more: acknowledge it, drop the spent button, send the next batch. */
async function more({ more: key, callbackId, messageId }) {
  await call('answerCallbackQuery', { callback_query_id: callbackId })
  if (messageId) await call('editMessageReplyMarkup', { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } })
  const kept = pending.get(key)
  if (!kept) return send('That message is no longer kept; open the task in the app, or /task <id>.')
  pending.delete(key)
  return sendBatch(kept.parts, kept.from)
}

/**
 * What one update means. Pure, so it can be tested without a bot: a reply to
 * a question message, or a message that starts with the question id, answers
 * that question; anything else gets a hint back.
 */
export function handleUpdate(update, forChat = null) {
  const cb = update?.callback_query
  if (cb) {
    if (forChat && String(cb.message?.chat?.id) !== String(forChat)) return null
    const key = /^more:([0-9a-f]{8})$/.exec(cb.data || '')
    return key ? { more: key[1], callbackId: cb.id, messageId: cb.message?.message_id } : null
  }
  const m = update?.message
  if (!m || typeof m.text !== 'string') return null
  // Only the configured chat: anyone else who finds the bot is ignored outright.
  if (forChat && String(m.chat?.id) !== String(forChat)) return null
  const said = m.text.trim()
  // Commands: progress, one task, help. A bot suffix (/status@name) is fine.
  const slash = /^\/(\w+)(?:@\S+)?(?:\s+([\s\S]*))?$/.exec(said)
  if (slash) {
    const name = slash[1].toLowerCase()
    const arg = (slash[2] || '').trim()
    if (name === 'status' || name === 's' || name === 'progress') return { command: 'status', arg: '' }
    if (name === 'task' || name === 't') return { command: 'task', arg }
    return { command: 'help', arg: '' }
  }
  if (/^(tiến độ|tien do|status)$/i.test(said)) return { command: 'status', arg: '' }
  // A reply counts only when it replies to something the bot itself said: a
  // quoted question line typed by hand is not a question.
  const quoted = m.reply_to_message?.from?.is_bot ? /Q ([0-9a-f]{8})\/([0-9a-f]{8}):/.exec(m.reply_to_message.text || '') : null
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
        if (!r.ok) {
          // A wrong token, a webhook set elsewhere, another poller: not a reason to hammer.
          await sleep(3000)
          continue
        }
        updates = (await r.json()).result || []
      } catch {
        await sleep(3000)
        continue
      }
      for (const u of updates) {
        offset = u.update_id + 1
        const out = handleUpdate(u, chatId)
        if (out?.more) {
          await more(out)
        } else if (out?.command) {
          let reply
          try { reply = await onCommand?.(out.command, out.arg) } catch (err) { reply = `Could not answer that: ${err.message}` }
          if (reply) await send(reply)
        } else if (out?.answered) {
          try { await onAnswer?.(out.answered) } catch (err) { await send(`Could not answer: ${err.message}`) }
        } else if (out?.hint) {
          await send('Reply to a question message to answer it, or send /status to see what is running.')
        }
      }
    }
  } finally {
    running = false
  }
}
