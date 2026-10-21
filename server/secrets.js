// Things that look like secrets, found on the way into a task so they can be
// kept out of the transcript. The rules are deliberately few and legible; the
// test file is the list of what must and must not trip them.
//
// detect(text) -> [{ name, value, spans: [{ start, end }] }], one per distinct value.
// redact(text, found) -> text with every span replaced by {{secret:NAME}}.

const NAMED = /^[ \t]*(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*(?:_KEY|_TOKEN|_SECRET|_PASSWORD))[ \t]*[=:][ \t]*(["']?)([^\s"']{8,})\2[ \t]*$/gim
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
