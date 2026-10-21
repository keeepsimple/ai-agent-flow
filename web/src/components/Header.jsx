import { IconChevronDown, IconGitBranch } from '@tabler/icons-react'
import { Button, Chip } from './bits.jsx'
import { ACCENTS, useAccent } from '../accent.js'
import { to } from '../router.js'

export function Mark({ size = 26 }) {
  return (
    <span
      style={{ width: size, height: size }}
      className="flex shrink-0 items-center justify-center rounded-[8px] bg-accent
                 bg-[linear-gradient(145deg,color-mix(in_srgb,white_22%,var(--color-accent)),var(--color-accent))]
                 text-on-accent shadow-accent"
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
          style={{
            background: option.value,
            boxShadow: accent === option.value ? `0 0 12px -2px ${option.value}` : undefined,
          }}
          className={`size-3.5 cursor-pointer rounded-full transition-all duration-200 ease-smooth
                      ${accent === option.value
                        ? 'scale-110 ring-2 ring-ink/70 ring-offset-2 ring-offset-panel'
                        : 'opacity-50 hover:scale-110 hover:opacity-100'}`}
        />
      ))}
    </div>
  )
}

export default function Header({ active, task, repoLabel, onRepos, reposOpen, children }) {
  const repos = repoLabel || task?.repos?.join(' + ') || 'repos'

  return (
    <header
      className="relative z-20 flex h-14 shrink-0 items-center gap-3 border-b border-line px-4
                 bg-[linear-gradient(to_bottom,var(--color-selected),var(--color-panel))]
                 shadow-[inset_0_1px_0_rgb(255_255_255/0.05),0_1px_0_rgb(0_0_0/0.5),0_8px_24px_-16px_rgb(0_0_0/0.9)]"
    >
      <a
        href={to.sessions()}
        className="group flex items-center gap-2.5 text-[15px] font-semibold tracking-[-0.01em] text-ink no-underline"
      >
        <span className="transition-transform duration-300 ease-smooth group-hover:scale-105">
          <Mark />
        </span>
        Tern
      </a>
      <span className="text-dim" aria-hidden="true">/</span>

      {onRepos ? (
        <Chip
          active={reposOpen}
          onClick={onRepos}
          aria-expanded={reposOpen}
          title="Choose which repos a new task runs in"
          className="max-w-[16rem]"
        >
          <span className="truncate">{repos}</span>
          <IconChevronDown
            size={12}
            className={`shrink-0 transition-transform duration-200 ease-smooth ${reposOpen ? 'rotate-180' : ''}`}
          />
        </Chip>
      ) : (
        <Chip as="span" className="max-w-[16rem] cursor-default">
          <span className="truncate">{repos}</span>
        </Chip>
      )}

      {task?.trees?.[0] && (
        <span className="hidden min-w-0 xl:block">
          <Chip as="span" mono className="max-w-[22rem] cursor-default">
            <IconGitBranch size={13} className="shrink-0" />
            <span className="truncate">{task.trees[0].branch}</span>
          </Chip>
        </span>
      )}

      <nav
        aria-label="Primary"
        className="ml-2 flex shrink-0 gap-0.5 rounded-full border border-line/70 bg-page/40 p-[3px]"
      >
        {NAV.map(([key, label]) => {
          const href = key === 'sessions' ? to.sessions() : task ? to[key](task.id) : null
          const current = key === active
          const className = `rounded-full px-3.5 py-1.5 text-[13px] no-underline transition-all duration-200 ease-smooth ${
            current
              ? 'bg-selected text-ink shadow-e1'
              : 'text-muted hover:bg-raised hover:text-ink'
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
