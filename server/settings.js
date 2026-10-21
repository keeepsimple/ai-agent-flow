// App-wide settings that are not per repo: the cost line, the phone. Kept at
// <data>/settings.json; the Telegram token goes to the keychain, never here.
import fs from 'node:fs'
import path from 'node:path'
import * as secrets from './secrets.js'

const DATA = process.env.FLOW_DATA || path.join(import.meta.dirname, '..', 'data')
const FILE = path.join(DATA, 'settings.json')
export const TELEGRAM_OWNER = `app:telegram@${DATA}`

const DEFAULTS = { costWarnUsd: 20, telegram: { chatId: '' } }

const load = () => {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch { return {} }
}

export function get() {
  const saved = load()
  return {
    costWarnUsd: typeof saved.costWarnUsd === 'number' ? saved.costWarnUsd : DEFAULTS.costWarnUsd,
    telegram: { chatId: String(saved.telegram?.chatId || '') },
    hasTelegramToken: secrets.read(TELEGRAM_OWNER, 'TOKEN') !== null,
  }
}

/** Just the cost line: read on every run result, so no keychain call here. */
export function costLine() {
  const saved = load()
  return typeof saved.costWarnUsd === 'number' ? saved.costWarnUsd : DEFAULTS.costWarnUsd
}

export function set({ costWarnUsd, telegram, telegramToken } = {}) {
  const saved = load()
  if (costWarnUsd !== undefined) {
    if (typeof costWarnUsd !== 'number' || !(costWarnUsd >= 0)) throw new Error('costWarnUsd must be a number, 0 for none')
    saved.costWarnUsd = costWarnUsd
  }
  if (telegram !== undefined) saved.telegram = { chatId: String(telegram?.chatId || '').trim() }
  fs.mkdirSync(DATA, { recursive: true })
  fs.writeFileSync(FILE, JSON.stringify(saved, null, 2))
  if (telegramToken !== undefined) {
    if (telegramToken) secrets.keep(TELEGRAM_OWNER, 'TOKEN', String(telegramToken))
    else secrets.forget(TELEGRAM_OWNER, ['TOKEN'])
  }
  return get()
}
