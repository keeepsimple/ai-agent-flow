import {
  IconCircleCheck, IconAlertTriangle, IconPlayerPause, IconClock, IconX,
} from '@tabler/icons-react'

export const STATUS = {
  queued: { label: 'Queued', color: 'text-ink-faint', dot: 'bg-ink-faint', Icon: IconClock },
  running: { label: 'Running', color: 'text-accent', dot: 'bg-accent dot-live', Icon: null },
  awaiting_approval: { label: 'Needs approval', color: 'text-warn', dot: 'bg-warn dot-live', Icon: IconPlayerPause },
  awaiting_answer: { label: 'Needs an answer', color: 'text-warn', dot: 'bg-warn dot-live', Icon: IconAlertTriangle },
  done: { label: 'Done', color: 'text-accent', dot: 'bg-accent', Icon: IconCircleCheck },
  failed: { label: 'Failed', color: 'text-danger', dot: 'bg-danger', Icon: IconAlertTriangle },
  cancelled: { label: 'Cancelled', color: 'text-ink-faint', dot: 'bg-ink-faint', Icon: IconX },
}

export const statusOf = (s) => STATUS[s] || STATUS.queued

export function StatusDot({ status, className = '' }) {
  return <span className={`inline-block size-2 shrink-0 rounded-full ${statusOf(status).dot} ${className}`} />
}

export function ago(ts) {
  if (!ts) return ''
  const s = Math.round((Date.now() - ts) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}

export function duration(from, to) {
  if (!from) return ''
  const s = Math.round(((to || Date.now()) - from) / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

export function Button({ variant = 'ghost', className = '', ...props }) {
  const base =
    'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium ' +
    'transition-colors duration-150 cursor-pointer active:translate-y-px ' +
    'disabled:pointer-events-none disabled:opacity-40'
  const variants = {
    primary: 'bg-accent text-surface hover:bg-accent/85',
    ghost: 'border border-line text-ink-dim hover:border-line-strong hover:text-ink',
    danger: 'border border-danger/40 text-danger hover:bg-danger/10',
  }
  return <button type="button" className={`${base} ${variants[variant]} ${className}`} {...props} />
}

export function Field({ label, hint, error, children }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium tracking-wide text-ink-dim uppercase">{label}</span>
      {children}
      {hint && !error && <span className="text-[11px] text-ink-faint">{hint}</span>}
      {error && <span className="text-[11px] text-danger">{error}</span>}
    </label>
  )
}

export const inputClass =
  'w-full rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-[13px] text-ink ' +
  'placeholder:text-ink-faint focus:border-line-strong focus:outline-none'
