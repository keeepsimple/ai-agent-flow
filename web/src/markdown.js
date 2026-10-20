/**
 * Split markdown into blocks. Pure, no JSX, so it can be checked from node.
 *
 * Just enough for what an agent writes: headings, fenced code, lists, quotes.
 * Inline marks (bold, italic, code) are left in the text for the renderer.
 *
 * ponytail: flat lists and no links. Tables are here because an agent reporting
 * what it ran writes them constantly, and raw pipes are unreadable.
 */
export function blocks(source) {
  const lines = String(source || '').split('\n')
  const out = []
  let paragraph = []
  let list = null

  const endParagraph = () => {
    if (!paragraph.length) return
    out.push({ type: 'p', text: paragraph.join(' ') })
    paragraph = []
  }
  const endBlock = () => {
    endParagraph()
    if (!list) return
    out.push({ type: 'ul', items: list })
    list = null
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (line.startsWith('```')) {
      endBlock()
      const code = []
      for (i++; i < lines.length && !lines[i].startsWith('```'); i++) code.push(lines[i])
      out.push({ type: 'code', text: code.join('\n') })
      continue
    }

    // | a | b |  followed by  |---|---|  is a table, and only then.
    const cells = (row) => row.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
    if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] || '')) {
      endBlock()
      const head = cells(line)
      const rows = []
      for (i += 2; i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]); i++) rows.push(cells(lines[i]))
      i-- // the loop's own i++ takes the line after the table
      out.push({ type: 'table', head, rows })
      continue
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/)
    if (heading) {
      endBlock()
      out.push({ type: 'h', level: heading[1].length, text: heading[2] })
      continue
    }

    const item = line.match(/^\s*(?:[-*]|\d+\.)\s+(.*)$/)
    if (item) {
      endParagraph()
      list = list || []
      list.push(item[1])
      continue
    }

    // An indented line under a list item continues that item rather than
    // starting something new.
    if (list && /^\s+\S/.test(line)) {
      list[list.length - 1] += ` ${line.trim()}`
      continue
    }

    if (line.startsWith('>')) {
      endBlock()
      out.push({ type: 'quote', text: line.replace(/^>\s?/, '') })
      continue
    }

    if (!line.trim()) {
      endBlock()
      continue
    }

    // Consecutive non-blank lines are one paragraph, the way markdown means
    // them. Emitting one per source line turns a wrapped sentence into three.
    if (list) endBlock()
    paragraph.push(line.trim())
  }
  endBlock()
  return out
}

/**
 * Split a line into plain text and inline marks, in order.
 *
 * Code first, so a URL inside backticks stays code. The `[text](url)` form has
 * to be matched before the bare URL: otherwise the bare pattern eats the URL
 * out of the middle of the link and leaves the brackets behind as text.
 */
export const INLINE =
  /(`[^`]+`|\[[^\]\n]+\]\(https?:\/\/[^\s)]+\)|https?:\/\/[^\s<>]+|\*\*[^*]+\*\*|\*[^*\n]+\*)/g

/** A bare URL swallows the sentence's punctuation, so hand that back as text. */
export function url(part) {
  const md = part.match(/^\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)$/)
  if (md) return { href: md[2], text: md[1], trail: '' }
  if (!/^https?:\/\//.test(part)) return null
  const trail = part.match(/[.,;:!?)\]]+$/)?.[0] || ''
  const href = part.slice(0, part.length - trail.length)
  return { href, text: href, trail }
}
