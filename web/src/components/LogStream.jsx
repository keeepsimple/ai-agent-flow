import { useEffect, useRef, useState } from 'react'
import { IconTerminal2 } from '@tabler/icons-react'

const KIND = {
  text: { label: 'claude', tone: 'text-ink' },
  tool: { label: 'tool', tone: 'text-ink-dim' },
  error: { label: 'error', tone: 'text-danger' },
  stderr: { label: 'stderr', tone: 'text-warn' },
  result: { label: 'result', tone: 'text-accent' },
  question: { label: 'asked you', tone: 'text-warn' },
  answer: { label: 'you said', tone: 'text-accent' },
  decision: { label: 'you decided', tone: 'text-accent' },
}

const time = (t) => new Date(t).toTimeString().slice(0, 8)

export default function LogStream({ entries, live }) {
  const endRef = useRef(null)
  const [pinned, setPinned] = useState(true)

  useEffect(() => {
    if (pinned) endRef.current?.scrollIntoView({ block: 'end' })
  }, [entries.length, pinned])

  if (!entries.length) {
    return (
      <div className="flex flex-col items-center gap-2 py-16 text-ink-faint">
        <IconTerminal2 size={28} stroke={1.5} />
        <p className="text-[13px]">No output yet.</p>
        <p className="text-[11px]">The stream fills in as the agent works.</p>
      </div>
    )
  }

  return (
    <div
      className="h-full overflow-y-auto"
      onScroll={(e) => {
        const el = e.currentTarget
        setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 48)
      }}
    >
      <ul className="divide-y divide-line/60">
        {entries.map((entry, i) => {
          const kind = KIND[entry.kind] || KIND.text
          return (
            <li key={i} className="grid grid-cols-[64px_84px_1fr] gap-2 px-3 py-1.5 hover:bg-surface-2/60">
              <span className="font-mono text-[10px] leading-5 text-ink-faint">{time(entry.t)}</span>
              <span className={`font-mono text-[10px] leading-5 ${kind.tone}`}>
                {entry.kind === 'tool' ? entry.tool : kind.label}
              </span>
              <span className={`text-[12px] leading-5 whitespace-pre-wrap break-words ${kind.tone}`}>
                {entry.text}
                {entry.kind === 'result' && entry.cost != null && (
                  <span className={`font-mono text-[10px] text-ink-faint ${entry.text ? 'ml-2' : ''}`}>
                    phase done · ${entry.cost.toFixed(3)} · {entry.turns} turns
                  </span>
                )}
              </span>
            </li>
          )
        })}
      </ul>
      {live && (
        <div className="flex items-center gap-2 px-3 py-2">
          <span className="dot-live inline-block size-1.5 rounded-full bg-accent" />
          <span className="skeleton h-3 w-56 rounded" />
        </div>
      )}
      <div ref={endRef} />
    </div>
  )
}
