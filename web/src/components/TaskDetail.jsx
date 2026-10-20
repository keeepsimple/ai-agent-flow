import { useState } from 'react'
import { IconFolderOff, IconPlayerStop, IconRefresh } from '@tabler/icons-react'
import { Button, ImageStrip, StatusDot, ago, statusOf } from './bits.jsx'
import Markdown from './Markdown.jsx'
import RepoRows from './RepoRows.jsx'
import PhaseRail from './PhaseRail.jsx'
import Decision from './Decision.jsx'
import Diff from './Diff.jsx'
import FollowUp from './FollowUp.jsx'
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
  // Deep link the tab too, so a review can be linked to, not just a task.
  const [tab, setTab] = useState(() => location.hash.split('/')[1] || 'stream')
  const openTab = (key) => {
    setTab(key)
    location.hash = key === 'stream' ? task.id : `${task.id}/${key}`
  }
  const status = statusOf(task.status)
  const act = (fn) => fn().catch((e) => onError(e.message))

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="border-b border-line px-4 py-3">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <StatusDot status={task.status} />
              <h1 className="truncate text-[17px] font-semibold tracking-tight text-ink">{task.title}</h1>
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

        <RepoRows task={task} onError={onError} />
      </header>

      {task.images?.length > 0 && (
        <div className="border-b border-line px-4 py-2">
          <ImageStrip
            images={task.images.map((p) => ({ file: p.split('/').pop() }))}
            size="h-12 w-20"
          />
        </div>
      )}

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
        {['stream', ...(task.trees ? ['diff'] : []), ...DOCS.filter((d) => task.docs?.[d])].map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => openTab(key)}
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
        ) : tab === 'diff' ? (
          <Diff taskId={task.id} />
        ) : (
          <div className="h-full overflow-auto px-4 py-4">
            <Markdown source={task.docs[tab]} className="mx-auto max-w-3xl" />
          </div>
        )}
      </div>

      {!ACTIVE.has(task.status) && <FollowUp task={task} onError={onError} />}
    </div>
  )
}
