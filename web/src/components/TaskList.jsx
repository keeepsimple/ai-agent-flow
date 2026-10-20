import { IconInbox } from '@tabler/icons-react'
import { StatusDot, ago, statusOf } from './bits.jsx'

const NEEDS_YOU = new Set(['awaiting_approval', 'awaiting_answer'])

export default function TaskList({ tasks, selectedId, onSelect }) {
  if (tasks === null) {
    return (
      <ul className="divide-y divide-line/60">
        {[0, 1, 2].map((i) => (
          <li key={i} className="px-3 py-3">
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
        <p className="text-[11px]">Start one and it gets its own worktree, spec and plan before any code moves.</p>
      </div>
    )
  }

  return (
    <ul className="divide-y divide-line/60">
      {tasks.map((task) => {
        const selected = task.id === selectedId
        const attention = NEEDS_YOU.has(task.status)
        return (
          <li key={task.id}>
            <button
              type="button"
              onClick={() => onSelect(task.id)}
              className={`w-full cursor-pointer px-3 py-2.5 text-left transition-colors duration-150
                ${selected ? 'bg-surface-3' : 'hover:bg-surface-2'}
                ${attention && !selected ? 'bg-warn/5' : ''}`}
            >
              <div className="flex items-center gap-2">
                <StatusDot status={task.status} />
                <span className="truncate text-[13px] font-medium text-ink">{task.title}</span>
              </div>
              <div className="mt-1 flex items-center gap-2 pl-4 font-mono text-[10px] text-ink-faint">
                <span className="truncate">{task.repo}</span>
                <span className={statusOf(task.status).color}>
                  {task.phase || statusOf(task.status).label.toLowerCase()}
                </span>
                <span className="ml-auto shrink-0">{ago(task.updatedAt || task.createdAt)}</span>
              </div>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
