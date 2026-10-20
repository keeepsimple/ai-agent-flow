import { useEffect, useRef, useState } from 'react'
import {
  IconAlertTriangle, IconCheck, IconFile, IconPencil, IconSearch, IconTerminal2,
} from '@tabler/icons-react'
import { Mark } from './Header.jsx'
import Markdown from './Markdown.jsx'
import { duration } from './bits.jsx'

const TOOL_ICON = [
  [/grep|glob|search/i, IconSearch],
  [/read|notebook/i, IconFile],
  [/edit|write|multiedit/i, IconPencil],
]
const iconFor = (tool) => (TOOL_ICON.find(([re]) => re.test(tool || ''))?.[1]) || IconTerminal2

function ToolRow({ entry }) {
  const Icon = iconFor(entry.tool)
  const edited = /edit|write/i.test(entry.tool || '')
  return (
    <div
      className={`flex min-h-9 items-center gap-2.5 rounded-lg border bg-raised px-3 text-left
                  ${edited ? 'border-accent/40 text-ink' : 'border-line text-ink-3'}`}
    >
      <Icon size={14} className={edited ? 'text-accent' : 'text-muted'} />
      <span className="shrink-0 text-[13px]">{entry.tool}</span>
      <span className="truncate font-mono text-xs text-muted" title={entry.text}>{entry.text}</span>
    </div>
  )
}

/** The task's phases, as the plan checklist the artboard shows. */
function Plan({ task }) {
  const entries = Object.entries(task.phases || {})
  if (!entries.length) return null
  return (
    <ol className="m-0 flex list-none flex-col gap-2 rounded-xl border border-line bg-raised p-3.5 text-[13px]">
      {entries.map(([key, phase]) => {
        const done = phase.status === 'done'
        const running = phase.status === 'running'
        const failed = phase.status === 'failed'
        return (
          <li key={key} className={`flex items-center gap-2.5 ${done || !running ? 'text-muted' : ''}`}>
            <span className="flex size-4 items-center justify-center">
              {done ? (
                <IconCheck size={16} className="text-ok" stroke={2.4} />
              ) : failed ? (
                <IconAlertTriangle size={14} className="text-bad" />
              ) : running ? (
                <span className="ring-dot size-2 rounded-full bg-accent" />
              ) : (
                <span className="size-2.5 rounded-full border-[1.5px] border-faint" />
              )}
            </span>
            <span className={done ? 'line-through' : running ? 'text-ink' : ''}>
              {key[0].toUpperCase() + key.slice(1)}
            </span>
            <span className="ml-auto font-mono text-[11px] text-muted">
              {phase.startedAt ? duration(phase.startedAt, phase.endedAt) : phase.status}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

export default function Conversation({ task, children }) {
  const scroller = useRef(null)
  const [pinned, setPinned] = useState(true)
  const log = task.log || []

  useEffect(() => {
    // Set scrollTop rather than scrollIntoView: that one walks every scrollable
    // ancestor, and an overflow-hidden one still moves when script asks, which
    // pushed the whole header off the top of the window.
    if (pinned && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight
  }, [log.length, pinned])

  // Tool calls cluster; keep runs of them in one bordered stack like the artboard.
  const blocks = []
  for (const entry of log) {
    const last = blocks.at(-1)
    if (entry.kind === 'tool' && last?.kind === 'tools') last.items.push(entry)
    else if (entry.kind === 'tool') blocks.push({ kind: 'tools', items: [entry] })
    else blocks.push({ kind: entry.kind, entry })
  }

  return (
    <div
      ref={scroller}
      className="min-h-0 flex-1 overflow-y-auto"
      onScroll={(e) => {
        const el = e.currentTarget
        setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 60)
      }}
    >
      <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4 px-6 py-5">
        <div className="max-w-[85%] self-end rounded-xl border border-line-strong bg-selected px-3.5 py-3">
          {task.prompt}
        </div>

        <div className="flex items-center gap-2 text-xs text-muted">
          <Mark size={20} />
          Tern · {task.model || 'default'}
        </div>

        <Plan task={task} />

        {blocks.map((block, i) => {
          if (block.kind === 'tools') {
            return (
              <div key={i} className="flex flex-col gap-1.5">
                {block.items.map((item, j) => <ToolRow key={j} entry={item} />)}
              </div>
            )
          }
          const { entry } = block
          if (entry.kind === 'result') {
            return (
              <div key={i} className="flex items-center gap-3 text-muted">
                <span className="h-px flex-1 bg-line" />
                <span className="font-mono text-[11px] whitespace-nowrap">
                  ${entry.cost?.toFixed(3)} · {entry.turns} turns
                </span>
                <span className="h-px flex-1 bg-line" />
              </div>
            )
          }
          if (entry.kind === 'error' || entry.kind === 'stderr') {
            return (
              <pre
                key={i}
                className={`m-0 overflow-x-auto rounded-lg border border-line bg-page px-3 py-2 font-mono
                            text-xs leading-relaxed whitespace-pre-wrap
                            ${entry.kind === 'error' ? 'text-bad' : 'text-warn'}`}
              >
                {entry.text}
              </pre>
            )
          }
          if (entry.kind === 'question' || entry.kind === 'answer' || entry.kind === 'decision') {
            const mine = entry.kind !== 'question'
            return (
              <div
                key={i}
                className={`rounded-xl border px-3.5 py-3 text-[13px]
                            ${mine ? 'border-line-strong bg-selected self-end max-w-[85%]' : 'border-warn-line bg-warn-bg'}`}
              >
                <div className={`mb-1 text-xs ${mine ? 'text-muted' : 'text-warn'}`}>
                  {entry.kind === 'question' ? 'Tern asked you' : 'You'}
                </div>
                {entry.text}
              </div>
            )
          }
          return <Markdown key={i} source={entry.text} className="text-ink-2" />
        })}

        {task.status === 'running' && (
          <div className="flex items-center gap-2.5">
            <span className="ring-dot size-2 rounded-full bg-accent dot-live" />
            <span className="skeleton h-3 w-44 rounded" />
          </div>
        )}

        {children}
      </div>
    </div>
  )
}
