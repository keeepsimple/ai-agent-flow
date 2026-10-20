import { IconChevronDown, IconGitBranch } from '@tabler/icons-react'
import { Button, Chip } from './bits.jsx'
import { ACCENTS, useAccent } from '../accent.js'
import { to } from '../router.js'

export function Mark({ size = 26 }) {
  return (
    <span
      style={{ width: size, height: size }}
      className="flex items-center justify-center rounded-[7px] bg-accent text-on-accent"
    >
      <svg
        width={size * 0.58}
        height={size * 0.58}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="m8 7-5 5 5 5M16 7l5 5-5 5" />
      </svg>
    </span>
  )
}

const NAV = [
  ['sessions', 'Sessions'],
  ['workspace', 'Workspace'],
  ['review', 'Review'],
]

/** The artboards make the accent a prop with four options. This is that prop. */
export function AccentPicker() {
  const [accent, setAccent] = useAccent()
  return (
    <div role="group" aria-label="Accent colour" className="flex items-center gap-1">
      {ACCENTS.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => setAccent(option.value)}
          aria-label={option.name}
          aria-pressed={accent === option.value}
          title={option.name}
          style={{ background: option.value }}
          className={`size-3.5 cursor-pointer rounded-full transition-[box-shadow] duration-150
                      ${accent === option.value ? 'ring-2 ring-ink/70 ring-offset-2 ring-offset-panel' : 'opacity-60 hover:opacity-100'}`}
        />
      ))}
    </div>
  )
}

export default function Header({ active, task, repoLabel, children }) {
  return (
    <header
      className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-panel px-4"
    >
      <a href={to.sessions()} className="flex items-center gap-2.5 text-[15px] font-semibold text-ink no-underline">
        <Mark />
        Tern
      </a>
      <span className="text-dim" aria-hidden="true">/</span>

      <Chip as="span" className="max-w-[16rem] cursor-default">
        <span className="truncate">{repoLabel || task?.repos?.join(' + ') || 'repos'}</span>
        <IconChevronDown size={12} className="shrink-0 text-muted" />
      </Chip>

      {task?.trees?.[0] && (
        <span className="hidden min-w-0 xl:block">
          <Chip as="span" mono className="max-w-[22rem] cursor-default">
            <IconGitBranch size={13} className="shrink-0" />
            <span className="truncate">{task.trees[0].branch}</span>
          </Chip>
        </span>
      )}

      <nav aria-label="Primary" className="ml-2 flex shrink-0 gap-0.5">
        {NAV.map(([key, label]) => {
          const href = key === 'sessions' ? to.sessions() : task ? to[key](task.id) : null
          const current = key === active
          const className = `rounded-lg px-3 py-2 text-[13px] no-underline transition-colors duration-150 ${
            current ? 'bg-selected text-ink' : 'text-muted hover:text-ink'
          }`
          return href ? (
            <a key={key} href={href} className={className} aria-current={current ? 'page' : undefined}>
              {label}
            </a>
          ) : (
            <span key={key} className={`${className} cursor-not-allowed opacity-40`}>{label}</span>
          )
        })}
      </nav>

      <div className="flex-1" />
      <div className="flex shrink-0 items-center gap-3">{children}</div>
    </header>
  )
}

export { Button }
