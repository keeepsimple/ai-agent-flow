import { useCallback, useState } from 'react'
import { IconX } from '@tabler/icons-react'
import { api } from '../api.js'

// Four columns on the Sessions board, in the order the artboard puts them:
// what is blocked on you is never below what is finished.
export const GROUPS = [
  { key: 'working', title: 'Working', dot: 'bg-accent', has: (t) => t.status === 'running' || t.status === 'queued' },
  {
    key: 'needs-you',
    title: 'Needs you',
    dot: 'bg-warn',
    has: (t) => ['awaiting_approval', 'awaiting_answer', 'failed'].includes(t.status),
  },
  { key: 'merged', title: 'Merged', dot: 'bg-ghost', has: (t) => Boolean(t.mergedAt) },
  { key: 'review', title: 'Ready for review', dot: 'bg-info', has: () => true },
]

export const STATUS = {
  queued: { label: 'Queued', tone: 'text-muted', dot: 'bg-muted' },
  running: { label: 'Working', tone: 'text-accent', dot: 'bg-accent dot-live ring-dot' },
  awaiting_approval: { label: 'Needs approval', tone: 'text-warn', dot: 'bg-warn dot-live' },
  awaiting_answer: { label: 'Needs an answer', tone: 'text-warn', dot: 'bg-warn dot-live' },
  done: { label: 'Done', tone: 'text-info', dot: 'bg-info' },
  failed: { label: 'Failed', tone: 'text-bad', dot: 'bg-bad' },
  cancelled: { label: 'Stopped', tone: 'text-ghost', dot: 'bg-ghost' },
}

export const statusOf = (s) => STATUS[s] || STATUS.queued

export function ago(ts) {
  if (!ts) return ''
  const s = Math.round((Date.now() - ts) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return `${Math.round(s / 86400)} d ago`
}

/** A length of time, in ms. */
export function span(ms) {
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

/** Elapsed between two stamps. Separate from span: a zero stamp is not a zero
 *  length, and passing one to the wrong one silently prints nothing. */
export function duration(from, to) {
  if (!from) return ''
  return span((to || Date.now()) - from)
}

export const bytes = (n) => {
  if (!n) return '0'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1)
  return `${(n / 1024 ** i).toFixed(i > 1 ? 1 : 0)} ${units[i]}`
}

/** +n −n, in the artboard's mono green/red pairing. */
export function Stat({ added, removed, className = '' }) {
  if (added == null) return null
  return (
    <span className={`font-mono text-xs whitespace-nowrap ${className}`}>
      <span className="text-ok">+{added}</span> <span className="text-bad">−{removed}</span>
    </span>
  )
}

const VARIANTS = {
  // Disabled fades to neutral rather than to a washed-out accent: a 40% lime
  // with 40% near-black on it is a muddy block with unreadable text, which
  // reads as broken instead of as unavailable.
  primary:
    'bg-accent text-on-accent font-semibold border border-transparent hover:bg-accent/90 ' +
    'disabled:bg-selected disabled:text-faint disabled:border-line',
  ghost: 'border border-line-strong bg-input text-ink hover:border-ghost',
  quiet: 'border border-line bg-transparent text-ink-3 hover:border-line-strong hover:text-ink',
  subtle: 'border border-line-strong bg-selected text-ink hover:border-ghost',
  danger: 'border border-bad/40 bg-transparent text-bad hover:bg-bad/10',
}

export function Button({ variant = 'ghost', className = '', as: As = 'button', ...props }) {
  return (
    <As
      {...(As === 'button' ? { type: 'button' } : {})}
      className={`inline-flex h-9 cursor-pointer items-center gap-2 rounded-full px-4 text-[13px]
                  no-underline transition-colors duration-150 active:translate-y-px
                  disabled:pointer-events-none disabled:opacity-100
                  ${variant === 'primary' ? '' : 'disabled:opacity-40'}
                  ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  )
}

/** The small bordered pill the artboards use for repo, model and mode. */
export function Chip({ mono = false, active = false, className = '', as: As = 'button', ...props }) {
  return (
    <As
      {...(As === 'button' ? { type: 'button' } : {})}
      className={`inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-xs
                  whitespace-nowrap no-underline transition-colors duration-150
                  ${active ? 'border-accent/50 bg-accent/10 text-accent' : 'border-line bg-transparent text-ink-3 hover:border-line-strong hover:text-ink'}
                  ${mono ? 'font-mono' : ''} ${className}`}
      {...props}
    />
  )
}

export function Eyebrow({ children, className = '' }) {
  return (
    <div className={`font-mono text-[11px] tracking-[0.06em] text-muted uppercase ${className}`}>{children}</div>
  )
}

export function Field({ label, hint, error, children }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs text-muted">{label}</span>
      {children}
      {hint && !error && <span className="text-[11px] text-muted">{hint}</span>}
      {error && <span className="text-[11px] text-bad">{error}</span>}
    </label>
  )
}

/**
 * One radius rule: anything you press is a pill, anything you type into or read
 * from keeps the artboard's soft corners. Mixing the two at random is what made
 * the control row read as a line of boxes.
 */

/**
 * A select shaped like the artboard's chips. Not inputClass with overrides:
 * that one is w-full, and Tailwind emits w-full after w-auto, so the override
 * loses no matter which order the classes are written in.
 */
export const selectChip =
  'h-8 cursor-pointer rounded-full border border-line bg-transparent pr-7 pl-3 text-xs text-ink-3 ' +
  'transition-colors duration-150 hover:border-line-strong hover:text-ink focus:outline-none ' +
  "appearance-none bg-no-repeat bg-[right_0.55rem_center] bg-[length:10px] bg-[image:var(--chevron)]"

export const inputClass =
  'w-full rounded-xl border border-line-strong bg-input px-3.5 py-2 text-[13px] text-ink ' +
  'placeholder:text-faint transition-colors duration-150 hover:border-ghost ' +
  'focus:border-accent/60 focus:outline-none appearance-none ' +
  "bg-no-repeat bg-[right_0.65rem_center] bg-[length:10px] " +
  "[&:is(select)]:pr-8 [&:is(select)]:bg-[image:var(--chevron)]"

/** Paste-to-attach for any textarea: the file uploads and we keep its path. */
export function usePastedImages() {
  const [images, setImages] = useState([])
  const [error, setError] = useState(null)

  const onPaste = useCallback(async (event) => {
    const files = [...(event.clipboardData?.items || [])]
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter(Boolean)
    if (!files.length) return
    event.preventDefault()
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

  return {
    images,
    paths: images.map((i) => i.path),
    onPaste,
    error,
    remove: useCallback((file) => setImages((prev) => prev.filter((i) => i.file !== file)), []),
    clear: useCallback(() => setImages([]), []),
  }
}

export function ImageStrip({ images, onRemove, size = 'h-14 w-20' }) {
  if (!images.length) return null
  return (
    <ul className="flex flex-wrap gap-2">
      {images.map((image) => (
        <li key={image.file} className="relative">
          <img
            src={`/api/uploads/${image.file}`}
            alt={`Attached ${image.file}`}
            className={`${size} rounded-lg border border-line object-cover`}
          />
          {onRemove && (
            <button
              type="button"
              onClick={() => onRemove(image.file)}
              aria-label={`Remove ${image.file}`}
              className="absolute -top-1.5 -right-1.5 cursor-pointer rounded-full border border-line bg-page
                         p-0.5 text-muted transition-colors duration-150 hover:text-ink"
            >
              <IconX size={11} />
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}
