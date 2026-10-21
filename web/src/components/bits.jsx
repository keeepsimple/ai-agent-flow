import { useCallback, useEffect, useRef, useState } from 'react'
import { IconCheck, IconChevronDown, IconFileText, IconX } from '@tabler/icons-react'
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

/** 20, 26.3k, 753k, 7.4M. Tight enough to sit in a column. */
export const tokens = (n) => {
  if (!n) return '0'
  if (n < 1000) return String(n)
  if (n < 1e6) return `${(n / 1000).toFixed(n < 100_000 ? 1 : 0)}k`
  return `${(n / 1e6).toFixed(1)}M`
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
  //
  // The primary button is the only thing on the page allowed to glow, and it
  // glows in the accent's own hue. Its shadow goes with it when it is
  // disabled, otherwise a dead control keeps claiming to be the live one.
  primary:
    'bg-accent text-on-accent font-semibold border border-transparent shadow-accent ' +
    'hover:shadow-accent-lift hover:brightness-110 ' +
    'disabled:bg-selected disabled:text-faint disabled:border-line disabled:shadow-none',
  ghost: 'border border-line-strong bg-input text-ink shadow-e1 hover:border-ghost hover:bg-selected',
  quiet: 'border border-line bg-transparent text-ink-3 hover:border-line-strong hover:bg-raised hover:text-ink',
  subtle: 'border border-line-strong bg-selected text-ink shadow-e1 hover:border-ghost hover:brightness-125',
  danger: 'border border-bad/40 bg-transparent text-bad hover:border-bad/70 hover:bg-bad/10',
}

export function Button({ variant = 'ghost', className = '', as: As = 'button', ...props }) {
  return (
    <As
      {...(As === 'button' ? { type: 'button' } : {})}
      className={`inline-flex h-9 cursor-pointer items-center gap-2 rounded-full px-4 text-[13px]
                  no-underline transition-all duration-200 ease-smooth
                  hover:-translate-y-px active:translate-y-px active:duration-75
                  disabled:pointer-events-none disabled:translate-y-0 disabled:opacity-100
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
                  whitespace-nowrap no-underline transition-all duration-200 ease-smooth active:scale-[0.97]
                  ${active
                    ? 'border-accent/50 bg-accent/10 text-accent shadow-[0_0_16px_-6px_color-mix(in_srgb,var(--color-accent)_70%,transparent)]'
                    : 'border-line bg-transparent text-ink-3 hover:border-line-strong hover:bg-raised hover:text-ink'}
                  ${mono ? 'font-mono' : ''} ${className}`}
      {...props}
    />
  )
}

/**
 * A chip that opens its own list: numbered, with the current one ticked. Opens
 * upward because the things that use it sit at the foot of a pane.
 */
export function Picker({ value, options, label, onPick, title, className = '' }) {
  const [open, setOpen] = useState(false)
  const box = useRef(null)

  useEffect(() => {
    if (!open) return
    const away = (e) => !box.current?.contains(e.target) && setOpen(false)
    const key = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', key)
    }
  }, [open])

  return (
    <div ref={box} className={`relative ${className}`}>
      <Chip active={open} onClick={() => setOpen((v) => !v)} title={title} aria-expanded={open}>
        {label(value)}
        <IconChevronDown
          size={12}
          className={`shrink-0 transition-transform duration-200 ease-smooth ${open ? 'rotate-180' : ''}`}
        />
      </Chip>

      {open && (
        <ul
          role="listbox"
          className="animate-rise absolute right-0 bottom-full z-30 mb-2 flex min-w-[13rem] list-none
                     flex-col gap-0.5 rounded-xl border border-line-strong bg-raised p-1.5 shadow-e3"
        >
          {options.map((option, i) => (
            <li key={option}>
              <button
                type="button"
                role="option"
                aria-selected={option === value}
                onClick={() => {
                  setOpen(false)
                  if (option !== value) onPick(option)
                }}
                className={`flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5
                            text-left text-[13px] transition-colors duration-150
                            ${option === value ? 'bg-selected text-ink' : 'text-ink-3 hover:bg-selected/60 hover:text-ink'}`}
              >
                <span className="w-3 shrink-0 font-mono text-[11px] text-faint">{i + 1}</span>
                <span className="flex-1 truncate">{label(option)}</span>
                {option === value && <IconCheck size={13} className="shrink-0 text-accent" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
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
  'transition-colors duration-200 ease-smooth hover:border-line-strong hover:bg-raised hover:text-ink ' +
  'focus:outline-none ' +
  "appearance-none bg-no-repeat bg-[right_0.55rem_center] bg-[length:10px] bg-[image:var(--chevron)]"

// A thing you press is raised and catches light on its top edge; a thing you
// type into is sunk and catches shadow there instead. That one inversion is
// what tells the two apart before the pointer ever arrives.
export const inputClass =
  'w-full rounded-xl border border-line-strong bg-input px-3.5 py-2 text-[13px] text-ink ' +
  'shadow-[inset_0_1px_2px_rgb(0_0_0/0.35)] ' +
  'placeholder:text-faint transition-all duration-200 ease-smooth hover:border-ghost ' +
  'focus:border-accent/60 focus:shadow-[inset_0_1px_2px_rgb(0_0_0/0.35),0_0_0_3px_color-mix(in_srgb,var(--color-accent)_15%,transparent)] ' +
  'focus:outline-none appearance-none ' +
  "bg-no-repeat bg-[right_0.65rem_center] bg-[length:10px] " +
  "[&:is(select)]:pr-8 [&:is(select)]:bg-[image:var(--chevron)]"

/**
 * Attaching a file, by whichever route the human reaches for: paste it, drop it
 * on the box, or pick it. All three end at the same upload.
 */
export function useAttachments() {
  const [files, setFiles] = useState([])
  const [error, setError] = useState(null)
  const [dragging, setDragging] = useState(false)
  const input = useRef(null)

  const take = useCallback(async (list) => {
    if (!list.length) return
    setError(null)
    for (const file of list) {
      try {
        const saved = await api.upload(file)
        setFiles((prev) => [...prev, saved])
      } catch (err) {
        setError(`${file.name}: ${err.message}`)
      }
    }
  }, [])

  const onPaste = useCallback(
    (event) => {
      const list = [...(event.clipboardData?.items || [])]
        .filter((item) => item.kind === 'file')
        .map((item) => item.getAsFile())
        .filter(Boolean)
      if (!list.length) return
      event.preventDefault() // otherwise the filename lands in the textarea
      take(list)
    },
    [take],
  )

  const onDrop = useCallback(
    (event) => {
      event.preventDefault()
      setDragging(false)
      take([...(event.dataTransfer?.files || [])])
    },
    [take],
  )

  const onDragOver = useCallback((event) => {
    if (!event.dataTransfer?.types?.includes('Files')) return
    event.preventDefault()
    setDragging(true)
  }, [])

  const onDragLeave = useCallback((event) => {
    if (event.currentTarget.contains(event.relatedTarget)) return
    setDragging(false)
  }, [])

  const picker = (
    <input
      ref={input}
      type="file"
      multiple
      className="hidden"
      onChange={(event) => {
        take([...event.target.files])
        event.target.value = '' // so picking the same file twice still fires
      }}
    />
  )

  return {
    files,
    paths: files.map((f) => f.path),
    error,
    dragging,
    picker,
    pick: () => input.current?.click(),
    onPaste,
    onDrop,
    onDragOver,
    onDragLeave,
    remove: useCallback((file) => setFiles((prev) => prev.filter((f) => f.file !== file)), []),
    clear: useCallback(() => setFiles([]), []),
  }
}

/** Images show themselves; anything else shows its name. */
export function AttachStrip({ files, onRemove, size = 'h-14 w-20' }) {
  if (!files.length) return null
  return (
    <ul className="flex flex-wrap gap-2">
      {files.map((file) => {
        const label = file.name || file.file
        return (
          <li key={file.file} className="relative">
            {file.kind === 'text' ? (
              <span
                className="flex h-9 max-w-52 items-center gap-2 rounded-xl border border-line bg-raised
                           px-3 font-mono text-xs text-ink-3"
              >
                <IconFileText size={13} className="shrink-0 text-muted" />
                <span className="truncate" title={label}>{label}</span>
              </span>
            ) : (
              <img
                src={`/api/uploads/${file.file}`}
                alt={`Attached ${label}`}
                className={`${size} rounded-xl border border-line object-cover`}
              />
            )}
            {onRemove && (
              <button
                type="button"
                onClick={() => onRemove(file.file)}
                aria-label={`Remove ${label}`}
                className="absolute -top-1.5 -right-1.5 cursor-pointer rounded-full border border-line bg-page
                           p-0.5 text-muted transition-colors duration-150 hover:text-ink"
              >
                <IconX size={11} />
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )
}
