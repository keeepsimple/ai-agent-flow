import { useEffect, useRef, useState } from 'react'
import {
  IconAlertTriangle, IconArrowDown, IconCheck, IconChevronDown, IconFile, IconPencil,
  IconSearch, IconTerminal2,
} from '@tabler/icons-react'
import { Mark } from './Header.jsx'
import Markdown from './Markdown.jsx'
import { AttachStrip, Button, duration } from './bits.jsx'

const TOOL_ICON = [
  [/grep|glob|search/i, IconSearch],
  [/read|notebook/i, IconFile],
  [/edit|write|multiedit/i, IconPencil],
]
const iconFor = (tool) => (TOOL_ICON.find(([re]) => re.test(tool || ''))?.[1]) || IconTerminal2

function ToolRow({ entry, running = false }) {
  const Icon = iconFor(entry.tool)
  const edited = /edit|write/i.test(entry.tool || '')
  return (
    <div
      className={`flex min-h-9 items-center gap-2.5 rounded-xl border bg-raised px-3 text-left shadow-e1
                  transition-colors duration-200 ease-smooth
                  ${running
                    ? 'border-accent/50 text-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.05),0_0_18px_-8px_color-mix(in_srgb,var(--color-accent)_80%,transparent)]'
                    : edited ? 'border-accent/40 text-ink' : 'border-line text-ink-3'}`}
    >
      {running ? (
        <span className="ring-dot size-2 shrink-0 rounded-full bg-accent dot-live" />
      ) : (
        <Icon size={14} className={edited ? 'text-accent' : 'text-muted'} />
      )}
      <span className="shrink-0 text-[13px]">{entry.tool}</span>
      <span className="truncate font-mono text-xs text-muted" title={entry.text}>{entry.text}</span>
    </div>
  )
}

/**
 * A failure is worth seeing, but a dozen lines of sed complaining is the same
 * wall as a dozen tool calls. Show the first few and let it open.
 */
function Spill({ entry }) {
  const [open, setOpen] = useState(false)
  const lines = entry.text.split('\n')
  const long = lines.length > 5
  const shown = open || !long ? entry.text : lines.slice(0, 5).join('\n')

  return (
    <div className="flex flex-col gap-1">
      <pre
        className={`m-0 overflow-x-auto rounded-xl border border-line bg-page px-3 py-2 font-mono
                    text-xs leading-relaxed whitespace-pre-wrap
                    ${entry.kind === 'error' ? 'text-bad' : 'text-warn'}`}
      >
        {shown}
      </pre>
      {long && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex cursor-pointer items-center gap-1.5 self-start text-xs text-muted
                     transition-colors duration-150 hover:text-ink"
        >
          <IconChevronDown size={12} className={open ? '' : '-rotate-90'} />
          {open ? 'Show less' : `${lines.length - 5} more lines`}
        </button>
      )}
    </div>
  )
}

/** Bash x7 - Read x2 - Agent, most used first. */
function summarise(items) {
  const counts = new Map()
  for (const item of items) counts.set(item.tool, (counts.get(item.tool) || 0) + 1)
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([tool, n]) => (n > 1 ? `${tool} ×${n}` : tool))
    .join(' · ')
}

/**
 * A run of tool calls is scenery: twenty of them push what the agent actually
 * said off the screen. Collapsed to a line, with whatever is running right now
 * left showing, because that is the part worth watching.
 */
function ToolGroup({ items, live }) {
  const [open, setOpen] = useState(false)
  const earlier = live ? items.slice(0, -1) : items
  const current = live ? items.at(-1) : null

  if (open || items.length === 1) {
    return (
      <div className="flex flex-col gap-1.5">
        {items.length > 1 && (
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="flex cursor-pointer items-center gap-1.5 self-start text-xs text-muted
                       transition-colors duration-150 hover:text-ink"
          >
            <IconChevronDown size={12} />
            Hide {items.length} steps
          </button>
        )}
        {items.map((item, i) => (
          <ToolRow key={i} entry={item} running={live && i === items.length - 1} />
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      {earlier.length > 0 && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          title="Show every step"
          className="flex min-h-9 cursor-pointer items-center gap-2.5 rounded-xl border border-line
                     bg-raised px-3 text-left shadow-e1 transition-all duration-200 ease-smooth
                     hover:border-line-strong hover:bg-selected"
        >
          <IconChevronDown size={12} className="-rotate-90 shrink-0 text-muted" />
          <span className="shrink-0 text-[13px] text-ink-3">
            {earlier.length} step{earlier.length === 1 ? '' : 's'}
          </span>
          <span className="truncate font-mono text-xs text-muted">{summarise(earlier)}</span>
        </button>
      )}
      {current && <ToolRow entry={current} running />}
    </div>
  )
}

/** The task's phases, as the plan checklist the artboard shows. */
function Plan({ task }) {
  const entries = Object.entries(task.phases || {})
  if (!entries.length) return null
  return (
    <ol className="m-0 flex list-none flex-col gap-2 rounded-xl border border-line bg-raised p-3.5 text-[13px] shadow-e1">
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

  const toBottom = () => {
    const el = scroller.current
    if (!el) return
    el.scrollTo({
      top: el.scrollHeight,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    })
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
    <div
      ref={scroller}
      className="min-h-0 flex-1 overflow-y-auto"
      onScroll={(e) => {
        const el = e.currentTarget
        setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 60)
      }}
    >
      <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4 px-6 py-5">
        <div
          className="max-w-[85%] self-end rounded-2xl rounded-br-md border border-line-strong bg-selected
                     px-4 py-3 text-[14px] break-words shadow-e2"
        >
          {task.prompt}
        </div>

        {/* `images` is what attachments were called before text files counted. */}
        {(task.attachments || task.images || []).length > 0 && (
          <div className="self-end">
            <AttachStrip
              files={(task.attachments || task.images).map((p) => {
                const file = p.split('/').pop()
                return { file, name: file.replace(/^[0-9a-f]{8}-/, ''), kind: /\.(png|jpe?g|gif|webp)$/i.test(file) ? 'image' : 'text' }
              })}
              size="h-14 w-20"
            />
          </div>
        )}

        <div className="flex items-center gap-2 text-xs text-muted">
          <Mark size={20} />
          <span className="font-medium text-ink-3">Tern</span>
          <span className="font-mono text-[11px]">{task.model || 'default'}</span>
        </div>

        <Plan task={task} />

        {blocks.map((block, i) => {
          if (block.kind === 'tools') {
            // Only the final run can still be in flight.
            const live = task.status === 'running' && i === blocks.length - 1
            return <ToolGroup key={i} items={block.items} live={live} />
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
            return <Spill key={i} entry={entry} />
          }
          if (entry.kind === 'question' || entry.kind === 'answer' || entry.kind === 'decision') {
            const mine = entry.kind !== 'question'
            return (
              <div
                key={i}
                className={`rounded-2xl border px-4 py-3 text-[13px] break-words shadow-e2
                            ${mine
                              ? 'border-line-strong bg-selected self-end max-w-[85%] rounded-br-md'
                              : 'border-warn-line bg-warn-bg rounded-bl-md'}`}
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

        {task.status === 'running' && blocks.at(-1)?.kind !== 'tools' && (
          <div className="flex items-center gap-2.5">
            <span className="ring-dot size-2 rounded-full bg-accent dot-live" />
            <span className="skeleton h-3 w-44 rounded" />
          </div>
        )}

        {children}
      </div>
    </div>

      {/* Only while there is something below to go back to. */}
      {!pinned && (
        <Button
          variant="subtle"
          onClick={toBottom}
          title="Jump to the newest message"
          className="animate-rise absolute right-5 bottom-4 h-8 px-3.5"
        >
          <IconArrowDown size={14} /> Latest
        </Button>
      )}
    </div>
  )
}
