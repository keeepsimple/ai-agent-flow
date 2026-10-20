import { duration } from './bits.jsx'

const PHASES = [
  ['spec', 'Spec'],
  ['plan', 'Plan'],
  ['implement', 'Implement'],
  ['review', 'Review'],
]

const TONE = {
  pending: 'border-line text-ink-faint',
  running: 'border-accent text-accent',
  done: 'border-accent/40 text-ink',
  failed: 'border-danger text-danger',
}

export default function PhaseRail({ task }) {
  return (
    <ol className="grid grid-cols-4 gap-2">
      {PHASES.map(([key, label]) => {
        const phase = task.phases?.[key] || { status: 'pending' }
        const gated = task.status === 'awaiting_approval' && task.awaitingPhase === key
        return (
          <li
            key={key}
            className={`rounded-md border-t-2 bg-surface-2 px-2.5 py-2 ${gated ? 'border-warn' : TONE[phase.status]}`}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[13px] font-medium">{label}</span>
              <span className="font-mono text-[10px] text-ink-faint">
                {phase.startedAt ? duration(phase.startedAt, phase.endedAt) : ''}
              </span>
            </div>
            <div className={`mt-0.5 text-[11px] ${gated ? 'text-warn' : 'text-ink-faint'}`}>
              {gated ? 'waiting on you' : phase.status}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
