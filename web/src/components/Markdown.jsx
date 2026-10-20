import { blocks, INLINE, url } from '../markdown.js'

// React nodes, never innerHTML: agent output can carry no markup into this page.
function inline(text, key) {
  return text.split(INLINE).filter(Boolean).map((part, i) => {
    const id = `${key}-${i}`
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={id} className="rounded bg-surface-3 px-1 py-px font-mono text-[0.92em] text-accent">
          {part.slice(1, -1)}
        </code>
      )
    }
    const link = url(part)
    if (link) {
      return (
        <span key={id}>
          <a
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent underline decoration-accent/40 underline-offset-2
                       transition-colors duration-150 hover:decoration-accent"
          >
            {link.text}
          </a>
          {link.trail}
        </span>
      )
    }
    if (part.startsWith('**')) return <strong key={id} className="font-semibold text-ink">{part.slice(2, -2)}</strong>
    if (part.startsWith('*')) return <em key={id}>{part.slice(1, -1)}</em>
    return part
  })
}

const HEADING = ['text-[15px]', 'text-[14px]', 'text-[13px]', 'text-[12.5px]']

export default function Markdown({ source, className = '' }) {
  return (
    <div className={`text-[12.5px] leading-[1.65] break-words text-ink-dim ${className}`}>
      {blocks(source).map((block, i) => {
        if (block.type === 'h') {
          return (
            <h3
              key={i}
              className={`mt-4 mb-1.5 font-semibold text-ink first:mt-0
                          ${HEADING[Math.min(block.level, HEADING.length) - 1]}`}
            >
              {inline(block.text, i)}
            </h3>
          )
        }
        if (block.type === 'ul') {
          return (
            <ul key={i} className="my-2 space-y-1 pl-5">
              {block.items.map((item, j) => (
                <li
                  key={j}
                  className="relative before:absolute before:-left-3.5 before:text-ink-faint before:content-['·']"
                >
                  {inline(item, `${i}-${j}`)}
                </li>
              ))}
            </ul>
          )
        }
        if (block.type === 'table') {
          return (
            <div key={i} className="my-2 overflow-x-auto rounded-lg border border-line">
              <table className="w-full border-collapse text-[12px]">
                <thead>
                  <tr className="bg-raised">
                    {block.head.map((cell, j) => (
                      <th key={j} className="border-b border-line px-2.5 py-1.5 text-left font-medium text-ink">
                        {inline(cell, `${i}h${j}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, r) => (
                    <tr key={r} className="border-b border-line/60 last:border-b-0">
                      {row.map((cell, j) => (
                        <td key={j} className="px-2.5 py-1.5 align-top">{inline(cell, `${i}r${r}c${j}`)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
        if (block.type === 'code') {
          return (
            <pre
              key={i}
              className="my-2 overflow-x-auto rounded-md border border-line bg-surface px-3 py-2
                         font-mono text-[11px] leading-relaxed text-ink-dim"
            >
              {block.text}
            </pre>
          )
        }
        if (block.type === 'quote') {
          return (
            <p key={i} className="my-2 border-l-2 border-line-strong pl-3 text-ink-faint">
              {inline(block.text, i)}
            </p>
          )
        }
        return <p key={i} className="my-2">{inline(block.text, i)}</p>
      })}
    </div>
  )
}
