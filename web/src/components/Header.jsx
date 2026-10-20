import { IconChevronDown, IconGitBranch } from '@tabler/icons-react'
import { Button, Chip } from './bits.jsx'
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

export default function Header({ active, task, repoLabel, children }) {
  return (
    <header
      className="flex min-h-14 flex-wrap items-center gap-3 border-b border-line bg-panel px-4 py-2"
    >
      <a href={to.sessions()} className="flex items-center gap-2.5 text-[15px] font-semibold text-ink no-underline">
        <Mark />
        Tern
      </a>
      <span className="text-dim" aria-hidden="true">/</span>

      <Chip as="span" className="cursor-default">
        {repoLabel || task?.repos?.join(' + ') || 'repos'}
        <IconChevronDown size={12} className="text-muted" />
      </Chip>

      {task?.trees?.[0] && (
        <Chip as="span" mono className="cursor-default">
          <IconGitBranch size={13} />
          {task.trees[0].branch}
        </Chip>
      )}

      <nav aria-label="Primary" className="ml-2 flex flex-wrap gap-0.5">
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
      {children}
    </header>
  )
}

export { Button }
