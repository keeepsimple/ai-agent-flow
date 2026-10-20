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
            {task.worktree && !ACTIVE.has(task.status) && (
              <Button onClick={() => act(() => api.dropWorktree(task.id))}>
                <IconFolderOff size={13} /> Drop worktree
              </Button>
            )}
          </div>
        </div>

        {task.error && (
          <p className="mt-2 rounded-md border border-danger/40 bg-danger/5 px-2.5 py-1.5 text-[12px] text-danger">
            {task.error}
          </p>
        )}

        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 xl:grid-cols-6">
          <Meta label="Repo">{task.repo}</Meta>
          <Meta label="Branch">{task.branch || 'not created yet'}</Meta>
          <Meta label="Base">{task.baseBranch ? `${task.baseBranch} @ ${task.baseRef?.slice(0, 7)}` : '-'}</Meta>
          <Meta label="Cost">${(task.cost || 0).toFixed(3)} · {task.turns || 0} turns</Meta>
          <Meta label="Model">{task.model || 'default'} · {task.effort || 'default'}</Meta>
          <Meta label="Permissions">{task.permissionMode}</Meta>
        </div>

        {task.worktree && (
          <button
            type="button"
            onClick={() => navigator.clipboard?.writeText(task.worktree)}
            title="Copy worktree path"
            className="mt-2 flex w-full cursor-pointer items-center gap-2 rounded-md border border-line
                       bg-surface-2 px-2.5 py-1.5 text-left font-mono text-[11px] text-ink-dim
                       transition-colors duration-150 hover:border-line-strong hover:text-ink"
          >
            <IconSitemap size={13} className="shrink-0" />
            <span className="truncate">{task.worktree}</span>
            <IconCopy size={13} className="ml-auto shrink-0" />
          </button>
        )}
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
