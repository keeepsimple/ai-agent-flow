import { useEffect, useRef, useState } from 'react'
import { IconTerminal2 } from '@tabler/icons-react'
import Markdown from './Markdown.jsx'

// Tool calls are scenery: one dim line each. Prose, questions and answers are
// the things you actually read, so they get room and a left rule.
const SPOKEN = {
  text: { label: 'claude', rule: 'border-line-strong', tone: 'text-ink-dim' },
  error: { label: 'error', rule: 'border-danger/60', tone: 'text-danger' },
  stderr: { label: 'stderr', rule: 'border-warn/60', tone: 'text-warn' },
  question: { label: 'asked you', rule: 'border-warn', tone: 'text-ink' },
  answer: { label: 'you answered', rule: 'border-accent', tone: 'text-ink' },
  decision: { label: 'you decided', rule: 'border-accent', tone: 'text-ink' },
}

const time = (t) => new Date(t).toTimeString().slice(0, 8)

function Entry({ entry }) {
  if (entry.kind === 'tool') {
    return (
      <li className="flex items-baseline gap-3 py-[3px] font-mono text-[11px]">
        <span className="w-14 shrink-0 text-right text-ink-faint/70">{entry.tool}</span>
        <span className="truncate text-ink-faint" title={entry.text}>{entry.text}</span>
      </li>
    )
  }

  if (entry.kind === 'result') {
    return (
      <li className="flex items-center gap-2 py-2">
        <span className="h-px flex-1 bg-line" />
        <span className="font-mono text-[10px] whitespace-nowrap text-ink-faint">
          {entry.text ? `${entry.text.slice(0, 80)} · ` : ''}
          ${entry.cost?.toFixed(3)} · {entry.turns} turns
        </span>
        <span className="h-px flex-1 bg-line" />
      </li>
    )
  }

  const spoken = SPOKEN[entry.kind] || SPOKEN.text
  const plain = entry.kind === 'error' || entry.kind === 'stderr'
  return (
    <li className={`my-2 border-l-2 pl-3 ${spoken.rule}`}>
      <div className="mb-0.5 flex items-baseline gap-2 font-mono text-[10px] text-ink-faint">
        <span className={spoken.tone}>{spoken.label}</span>
        <span>{time(entry.t)}</span>
      </div>
      {plain ? (
        <p className={`font-mono text-[11px] leading-relaxed whitespace-pre-wrap ${spoken.tone}`}>{entry.text}</p>
      ) : (
        <Markdown source={entry.text} className={spoken.tone} />
      )}
    </li>
  )
}

export default function LogStream({ entries, live }) {
  const endRef = useRef(null)
  const [pinned, setPinned] = useState(true)

  useEffect(() => {
    if (pinned) endRef.current?.scrollIntoView({ block: 'end' })
  }, [entries.length, pinned])

  if (!entries.length) {
    return (
      <div className="flex flex-col items-center gap-2 py-20 text-ink-faint">
        <IconTerminal2 size={28} stroke={1.5} />
        <p className="text-[13px]">No output yet.</p>
        <p className="text-[11px]">The stream fills in as the agent works.</p>
      </div>
    )
  }

  return (
    <div
      className="h-full overflow-y-auto px-4 py-2"
      onScroll={(e) => {
        const el = e.currentTarget
        setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 48)
      }}
    >
      <ul className="mx-auto max-w-4xl">
        {entries.map((entry, i) => <Entry key={i} entry={entry} />)}
      </ul>
      {live && (
        <div className="mx-auto flex max-w-4xl items-center gap-2 py-2 pl-3">
          <span className="dot-live inline-block size-1.5 rounded-full bg-accent" />
          <span className="skeleton h-3 w-48 rounded" />
        </div>
      )}
      <div ref={endRef} />
    </div>
  )
}
