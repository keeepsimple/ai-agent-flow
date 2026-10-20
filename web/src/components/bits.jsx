import { useCallback, useState } from 'react'
import {
  IconCircleCheck, IconAlertTriangle, IconPlayerPause, IconClock, IconX,
} from '@tabler/icons-react'
import { api } from '../api.js'

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

/**
 * Paste-to-attach for any textarea. The file goes to the server straight away
 * and what we keep is the path the agent will read it from.
 */
export function usePastedImages() {
  const [images, setImages] = useState([])
  const [error, setError] = useState(null)

  const onPaste = useCallback(async (event) => {
    const files = [...(event.clipboardData?.items || [])]
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter(Boolean)
    if (!files.length) return
    event.preventDefault() // otherwise the filename lands in the textarea
    setError(null)
    for (const file of files) {
      try {
        const saved = await api.upload(file)
        setImages((prev) => [...prev, saved])
      } catch (err) {
        setError(err.message)
      }
    }
  }, [])

  const remove = useCallback((file) => setImages((prev) => prev.filter((i) => i.file !== file)), [])
  const clear = useCallback(() => setImages([]), [])
  const paths = images.map((i) => i.path)

  return { images, paths, onPaste, remove, clear, error }
}

export function ImageStrip({ images, onRemove, size = 'h-16 w-24' }) {
  if (!images.length) return null
  return (
    <ul className="flex flex-wrap gap-2">
      {images.map((image) => (
        <li key={image.file} className="relative">
          <img
            src={`/api/uploads/${image.file}`}
            alt={`Attached image ${image.file}`}
            className={`${size} rounded-md border border-line object-cover`}
          />
          {onRemove && (
            <button
              type="button"
              onClick={() => onRemove(image.file)}
              aria-label={`Remove ${image.file}`}
              className="absolute -top-1.5 -right-1.5 cursor-pointer rounded-full border border-line
                         bg-surface p-0.5 text-ink-dim transition-colors duration-150 hover:text-ink"
            >
              <IconX size={11} />
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}
