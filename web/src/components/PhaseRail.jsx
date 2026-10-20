import { IconCheck, IconHandStop, IconX } from '@tabler/icons-react'
import { duration } from './bits.jsx'

const LABEL = { spec: 'Spec', plan: 'Plan', implement: 'Implement', review: 'Review' }

export default function PhaseRail({ task }) {
  // Which phases a task has is its own business: a quick run skips the writing.
  const phases = Object.keys(task.phases || {})
  return (
    <ol className="flex items-start">
      {phases.map((key, i) => {
        const label = LABEL[key] || key
        const phase = task.phases?.[key] || { status: 'pending' }
        const gated = task.status === 'awaiting_approval' && task.awaitingPhase === key
        const done = phase.status === 'done' && !gated
        const running = phase.status === 'running'
        const failed = phase.status === 'failed'

        const ring = gated
          ? 'border-warn bg-warn/15 text-warn'
          : failed
            ? 'border-danger bg-danger/15 text-danger'
            : running
              ? 'border-accent bg-accent/15 text-accent'
              : done
                ? 'border-accent/50 bg-accent/10 text-accent'
                : 'border-line bg-surface-2 text-ink-faint'

        return (
          <li key={key} className="flex flex-1 items-start">
            <div className="flex min-w-0 flex-col items-center gap-1.5 px-1">
              <span
                className={`flex size-6 items-center justify-center rounded-full border text-[10px]
                            font-semibold transition-colors duration-200 ${ring}
                            ${running ? 'shadow-[0_0_0_4px_rgba(34,197,94,0.1)]' : ''}`}
              >
                {gated ? <IconHandStop size={12} /> : failed ? <IconX size={12} /> : done ? <IconCheck size={13} /> : i + 1}
              </span>
              <span className={`text-[12px] font-medium ${running || gated ? 'text-ink' : 'text-ink-dim'}`}>
                {label}
              </span>
              <span className="font-mono text-[10px] text-ink-faint">
                {gated ? 'waiting on you' : phase.startedAt ? duration(phase.startedAt, phase.endedAt) : phase.status}
              </span>
            </div>
            {i < phases.length - 1 && (
              <span
                className={`mt-3 h-px flex-1 transition-colors duration-300
                            ${done ? 'bg-accent/40' : 'bg-line'}`}
              />
            )}
          </li>
        )
      })}
    </ol>
  )
}
