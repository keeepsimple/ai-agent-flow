import { IconInbox } from '@tabler/icons-react'
import { StatusDot, ago, statusOf } from './bits.jsx'

// Order matters: what is blocked on you comes first, every time.
const GROUPS = [
  { title: 'Waiting on you', has: (s) => s === 'awaiting_approval' || s === 'awaiting_answer', tone: 'text-warn' },
  { title: 'Working', has: (s) => s === 'running' || s === 'queued', tone: 'text-accent' },
  { title: 'Finished', has: () => true, tone: 'text-ink-faint' },
]

function Row({ task, selected, onSelect }) {
  const status = statusOf(task.status)
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(task.id)}
        className={`group relative w-full cursor-pointer py-2.5 pr-3 pl-4 text-left
                    transition-colors duration-150 ${selected ? 'bg-surface-3' : 'hover:bg-surface-2'}`}
      >
        <span
          className={`absolute inset-y-0 left-0 w-0.5 transition-colors duration-150
                      ${selected ? 'bg-accent' : 'bg-transparent'}`}
        />
        <span className="flex items-center gap-2">
          <StatusDot status={task.status} />
          <span className="truncate text-[13px] font-medium text-ink">{task.title}</span>
        </span>
        <span className="mt-1 flex items-center gap-2 pl-4 font-mono text-[10px] text-ink-faint">
          <span className="truncate">
            {task.repos.length > 2 ? `${task.repos.length} repos` : task.repos.join(' + ')}
          </span>
          <span className={status.color}>{task.phase || status.label.toLowerCase()}</span>
          <span className="ml-auto shrink-0">{ago(task.updatedAt || task.createdAt)}</span>
        </span>
      </button>
    </li>
  )
}

export default function TaskList({ tasks, selectedId, onSelect }) {
  if (tasks === null) {
    return (
      <ul>
        {[0, 1, 2].map((i) => (
          <li key={i} className="px-4 py-3">
            <div className="skeleton h-3 w-2/3 rounded" />
            <div className="skeleton mt-2 h-2 w-1/3 rounded" />
          </li>
        ))}
      </ul>
    )
  }

  if (!tasks.length) {
    return (
      <div className="flex flex-col items-center gap-2 px-6 py-16 text-center text-ink-faint">
        <IconInbox size={28} stroke={1.5} />
        <p className="text-[13px] text-ink-dim">No tasks yet.</p>
        <p className="text-[11px] leading-relaxed">
          Start one and it gets its own worktree, spec and plan before any code moves.
        </p>
      </div>
    )
  }

  const left = [...tasks]
  return (
    <div>
      {GROUPS.map((group) => {
        const mine = left.filter((t) => group.has(t.status))
        mine.forEach((t) => left.splice(left.indexOf(t), 1))
        if (!mine.length) return null
        return (
          <section key={group.title}>
            <h2
              className={`sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-surface/95
                          px-4 py-1.5 font-mono text-[10px] tracking-wide uppercase backdrop-blur ${group.tone}`}
            >
              {group.title}
              <span className="text-ink-faint">{mine.length}</span>
            </h2>
            <ul className="divide-y divide-line/40">
              {mine.map((task) => (
                <Row key={task.id} task={task} selected={task.id === selectedId} onSelect={onSelect} />
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
