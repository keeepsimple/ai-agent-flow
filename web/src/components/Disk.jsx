import { useEffect, useState } from 'react'
import { IconDatabase, IconX } from '@tabler/icons-react'
import { Button, statusOf } from './bits.jsx'
import { api } from '../api.js'

export const size = (bytes) => {
  if (!bytes) return '0'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** i).toFixed(i > 1 ? 1 : 0)} ${units[i]}`
}

export default function Disk({ onClose, onError }) {
  const [usage, setUsage] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = () => api.disk().then(setUsage).catch((e) => onError(e.message))
  useEffect(load, []) // eslint-disable-line react-hooks/exhaustive-deps

  const prune = async () => {
    setBusy(true)
    try {
      setUsage((await api.prune()).usage)
    } catch (err) {
      onError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const reclaimable = usage?.tasks.filter((t) => t.reclaimable) || []

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-surface/80 p-6 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="my-auto w-full max-w-xl rounded-lg border border-line bg-surface-2 shadow-2xl">
        <header className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-[14px] font-semibold text-ink">Worktrees on disk</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="cursor-pointer text-ink-faint transition-colors duration-150 hover:text-ink"
          >
            <IconX size={16} />
          </button>
        </header>

        {!usage ? (
          <div className="space-y-2 px-5 py-4">
            {[0, 1, 2].map((i) => <div key={i} className="skeleton h-4 w-full rounded" />)}
          </div>
        ) : (
          <>
            <p className="border-b border-line px-5 py-3 text-[12px] leading-relaxed text-ink-dim">
              A worktree shares the repo's history but keeps its own{' '}
              <code className="font-mono text-ink-faint">node_modules</code>, pods and build output.
              Dropping one frees that space and leaves its branch and commits alone.
            </p>

            <ul className="max-h-72 divide-y divide-line/60 overflow-y-auto">
              {usage.tasks.map((task) => (
                <li key={task.id} className="flex items-center gap-3 px-5 py-2">
                  <span className={`size-2 shrink-0 rounded-full ${statusOf(task.status).dot}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] text-ink">{task.title}</span>
                    <span className="block truncate font-mono text-[10px] text-ink-faint">
                      {task.repos.join(' + ')} · {task.status}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-[11px] text-ink-dim">{size(task.bytes)}</span>
                </li>
              ))}
              {usage.orphans.map((name) => (
                <li key={name} className="flex items-center gap-3 px-5 py-2">
                  <span className="size-2 shrink-0 rounded-full bg-warn" />
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-warn">
                    {name} · no task owns this any more
                  </span>
                </li>
              ))}
              {!usage.tasks.length && !usage.orphans.length && (
                <li className="px-5 py-6 text-center text-[12px] text-ink-faint">Nothing on disk.</li>
              )}
            </ul>

            <footer className="flex items-center gap-3 border-t border-line px-5 py-3">
              <Button
                variant="primary"
                disabled={busy || (!reclaimable.length && !usage.orphans.length)}
                onClick={prune}
              >
                {busy
                  ? 'Dropping'
                  : `Drop ${reclaimable.length + usage.orphans.length} finished (${size(usage.reclaimable)})`}
              </Button>
              <Button onClick={load}>Recount</Button>
              <span className="ml-auto flex items-center gap-1.5 font-mono text-[10px] text-ink-faint">
                <IconDatabase size={12} /> {size(usage.total)} total
              </span>
            </footer>
          </>
        )}
      </div>
    </div>
  )
}
