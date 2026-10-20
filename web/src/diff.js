/**
 * Unified patch into renderable lines, with both line numbers. Pure, no JSX, so
 * it can be checked from node.
 *
 * ponytail: no word-level highlighting and no rename detection. git already
 * told us what changed; this only has to place it on screen.
 */
export function parsePatch(patch) {
  const out = []
  let oldNo = 0
  let newNo = 0

  for (const text of String(patch || '').split('\n')) {
    // The file header is noise once the filename is in the row above.
    if (/^(diff --git|index |new file|deleted file|similarity|rename|--- |\+\+\+ )/.test(text)) continue

    const hunk = text.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/)
    if (hunk) {
      oldNo = Number(hunk[1])
      newNo = Number(hunk[2])
      out.push({ type: 'hunk', text, context: hunk[3].trim() })
      continue
    }
    if (!out.length) continue // anything before the first hunk is still header

    if (text.startsWith('+')) out.push({ type: 'add', text: text.slice(1), newNo: newNo++ })
    else if (text.startsWith('-')) out.push({ type: 'del', text: text.slice(1), oldNo: oldNo++ })
    else if (text.startsWith('\\')) out.push({ type: 'note', text: text.slice(2) })
    else out.push({ type: 'ctx', text: text.slice(1), oldNo: oldNo++, newNo: newNo++ })
  }
  return out
}
