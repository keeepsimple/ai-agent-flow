import { useEffect, useState } from 'react'
import { IconBellOff, IconDatabase, IconPlus, IconX } from '@tabler/icons-react'
import { api, useFlow } from './api.js'
import { Button } from './components/bits.jsx'
import TaskList from './components/TaskList.jsx'
import NewTask from './components/NewTask.jsx'
import TaskDetail from './components/TaskDetail.jsx'
import Disk, { size } from './components/Disk.jsx'

const NEEDS_YOU = new Set(['awaiting_approval', 'awaiting_answer'])

export default function App() {
  const flow = useFlow()
  const [composing, setComposing] = useState(() => location.hash === '#new')
  const [showDisk, setShowDisk] = useState(false)
  const [onDisk, setOnDisk] = useState(null)

  useEffect(() => {
    // One number, read when the page opens and after a clean-up. Counting it is
    // a filesystem walk over gigabytes; it does not belong on a poll.
    if (!showDisk) api.disk().then((u) => setOnDisk(u.total)).catch(() => {})
  }, [showDisk])
  const waiting = (flow.tasks || []).filter((t) => NEEDS_YOU.has(t.status)).length
  const active = (flow.tasks || []).filter((t) => t.status === 'running').length

  return (
    <div className="grid h-full grid-cols-1 lg:grid-cols-[340px_1fr]">
      <aside className="flex min-h-0 flex-col border-r border-line">
        <header className="flex items-center gap-2 border-b border-line px-3 py-2.5">
          <h1 className="text-[13px] font-semibold tracking-tight text-ink">Agent Flow</h1>
          {(active > 0 || waiting > 0) && (
            <span className="font-mono text-[10px] text-ink-faint">
              {active > 0 && `${active} running`}
              {active > 0 && waiting > 0 && ' · '}
              {waiting > 0 && <span className="text-warn">{waiting} waiting</span>}
            </span>
          )}
          {flow.notifications === 'default' && (
            <button
              type="button"
              onClick={flow.askForNotifications}
              title="Let this tab notify you. Clicking a notification opens the task."
              className="ml-auto cursor-pointer text-ink-faint transition-colors duration-150 hover:text-ink"
            >
              <IconBellOff size={14} />
            </button>
          )}
          {flow.notifications === 'denied' && (
            <span
              title="Notifications are blocked for this site. Allow them in your browser settings."
              className="ml-auto text-ink-faint"
            >
              <IconBellOff size={13} />
            </span>
          )}
          <span
            title={flow.live ? 'Connected to the server' : 'Disconnected from the server'}
            className={`inline-block size-1.5 shrink-0 rounded-full
                        ${flow.notifications === 'granted' || flow.notifications === 'unsupported' ? 'ml-auto' : ''}
                        ${flow.live ? 'bg-accent' : 'bg-danger'}`}
          />
          <Button variant="primary" onClick={() => setComposing((v) => !v)} className="ml-1">
            <IconPlus size={13} /> New
          </Button>
        </header>


        <div className="min-h-0 flex-1 overflow-y-auto">
          <TaskList tasks={flow.tasks} selectedId={flow.selectedId} onSelect={flow.select} />
        </div>

        <footer className="flex items-center gap-2 border-t border-line px-3 py-2 font-mono text-[10px] text-ink-faint">
          <span className="truncate">{flow.repoRoot}</span>
          {onDisk > 0 && (
            <button
              type="button"
              onClick={() => setShowDisk(true)}
              title="Worktrees on disk"
              className="ml-auto flex shrink-0 cursor-pointer items-center gap-1 transition-colors duration-150 hover:text-ink"
            >
              <IconDatabase size={11} /> {size(onDisk)}
            </button>
          )}
        </footer>
      </aside>

      <main className="min-h-0 overflow-hidden">
        {flow.detail ? (
          <TaskDetail task={flow.detail} onError={flow.setError} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center">
            <p className="text-[14px] text-ink-dim">Pick a task on the left, or start a new one.</p>
            <p className="max-w-md text-[12px] leading-relaxed text-ink-faint">
              Every task gets its own git worktree. It writes a spec, then a plan, and stops for your
              approval at both before any code moves. You get a notification when it needs you or finishes.
            </p>
          </div>
        )}
      </main>

      {composing && flow.options && (
        <NewTask
          repos={flow.repos}
          options={flow.options}
          defaults={flow.defaults}
          onClose={() => setComposing(false)}
          onCreate={async (payload) => {
            const task = await api.create(payload)
            flow.select(task.id)
          }}
        />
      )}

      {showDisk && <Disk onClose={() => setShowDisk(false)} onError={flow.setError} />}

      {flow.error && (
        <div
          role="alert"
          className="fixed bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-md
                     border border-danger/50 bg-surface-2 px-3 py-2 text-[12px] text-danger shadow-lg"
        >
          <span>{flow.error}</span>
          <button type="button" onClick={() => flow.setError(null)} className="cursor-pointer text-ink-faint hover:text-ink">
            <IconX size={14} />
          </button>
        </div>
      )}
    </div>
  )
}
