import { useState } from 'react'
import { IconCopy, IconFolderOff, IconPlayerStop, IconRefresh, IconSitemap } from '@tabler/icons-react'
import { Button, StatusDot, ago, statusOf } from './bits.jsx'
import PhaseRail from './PhaseRail.jsx'
import Decision from './Decision.jsx'
import LogStream from './LogStream.jsx'
import { api } from '../api.js'

const DOCS = ['spec.md', 'plan.md', 'review.md']
const ACTIVE = new Set(['queued', 'running', 'awaiting_approval', 'awaiting_answer'])

function Meta({ label, children, mono = true }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] tracking-wide text-ink-faint uppercase">{label}</div>
      <div className={`truncate text-[12px] text-ink-dim ${mono ? 'font-mono' : ''}`}>{children}</div>
    </div>
  )
}

export default function TaskDetail({ task, onError }) {
  const [tab, setTab] = useState('stream')
  const status = statusOf(task.status)
  const act = (fn) => fn().catch((e) => onError(e.message))

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="border-b border-line px-4 py-3">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <StatusDot status={task.status} />
              <h1 className="truncate text-[15px] font-semibold text-ink">{task.title}</h1>
            </div>
            <p className={`mt-0.5 pl-4 text-[12px] ${status.color}`}>
              {status.label}
              {task.phase && ` · ${task.phase}`}
              <span className="text-ink-faint"> · updated {ago(task.updatedAt)}</span>
            </p>
          </div>

          <div className="flex shrink-0 gap-2">
            {ACTIVE.has(task.status) && (
              <Button variant="danger" onClick={() => act(() => api.cancel(task.id))}>
                <IconPlayerStop size={13} /> Stop
              </Button>
            )}
            {(task.status === 'failed' || task.status === 'cancelled') && (
              <Button onClick={() => act(() => api.retry(task.id))}>
                <IconRefresh size={13} /> Retry
              </Button>
            )}
            {task.root && !ACTIVE.has(task.status) && (
              <Button onClick={() => act(() => api.dropWorktree(task.id))}>
                <IconFolderOff size={13} /> Drop worktree{task.repos.length > 1 ? 's' : ''}
              </Button>
            )}
          </div>
        </div>

        {task.error && (
          <p className="mt-2 rounded-md border border-danger/40 bg-danger/5 px-2.5 py-1.5 text-[12px] text-danger">
            {task.error}
          </p>
        )}

        <div className="mt-3 flex flex-wrap gap-x-10 gap-y-2">
          <Meta label="Cost">${(task.cost || 0).toFixed(3)} · {task.turns || 0} turns</Meta>
          <Meta label="Model">{task.model || 'default'} · {task.effort || 'default'}</Meta>
          <Meta label="Permissions">{task.permissionMode}</Meta>
        </div>

        <ul className="mt-2 divide-y divide-line/60 rounded-md border border-line bg-surface-2">
          {(task.trees || task.repos.map((repo) => ({ repo }))).map((tree) => (
            <li key={tree.repo} className="grid grid-cols-[1fr_auto] items-center gap-3 px-2.5 py-1.5">
              <div className="flex min-w-0 items-center gap-2">
                <IconSitemap size={13} className="shrink-0 text-ink-faint" />
                <span className="shrink-0 font-mono text-[12px] text-ink">{tree.repo}</span>
                <span className="truncate font-mono text-[11px] text-ink-dim">
                  {tree.branch
                    ? `${tree.branch}  ·  from ${tree.baseBranch} @ ${tree.baseRef.slice(0, 7)}`
                    : 'worktree not created yet'}
                </span>
              </div>
              {tree.worktree && (
                <button
                  type="button"
                  onClick={() => navigator.clipboard?.writeText(tree.worktree)}
                  title={task.root ? tree.worktree : 'Worktree dropped. The branch is still there.'}
                  disabled={!task.root}
                  className="flex cursor-pointer items-center gap-1.5 font-mono text-[10px] text-ink-faint
                             transition-colors duration-150 hover:text-ink disabled:cursor-default
                             disabled:hover:text-ink-faint"
                >
                  {task.root ? <><IconCopy size={12} /> path</> : 'dropped'}
                </button>
              )}
            </li>
          ))}
        </ul>
      </header>

      <div className="border-b border-line px-4 py-3">
        <PhaseRail task={task} />
      </div>

      {(task.status === 'awaiting_approval' || task.status === 'awaiting_answer') && (
        <div className="border-b border-line px-4 py-3">
          <Decision
            task={task}
            onApprove={(approved, feedback) => api.approve(task.id, approved, feedback)}
            onAnswer={(questionId, answer) => api.answer(task.id, questionId, answer)}
          />
        </div>
      )}

      <nav className="flex items-center gap-1 border-b border-line px-3">
        {['stream', ...DOCS.filter((d) => task.docs?.[d])].map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`-mb-px cursor-pointer border-b-2 px-2.5 py-2 font-mono text-[11px] transition-colors duration-150
              ${tab === key ? 'border-accent text-ink' : 'border-transparent text-ink-faint hover:text-ink-dim'}`}
          >
            {key}
          </button>
        ))}
      </nav>

      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === 'stream' ? (
          <LogStream entries={task.log || []} live={task.status === 'running'} />
        ) : (
          <pre className="h-full overflow-auto px-4 py-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-ink-dim">
            {task.docs[tab]}
          </pre>
        )}
      </div>
    </div>
  )
}
