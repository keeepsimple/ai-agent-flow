import { useEffect, useState } from 'react'
import { IconPlayerStop, IconRefresh } from '@tabler/icons-react'
import Header from '../components/Header.jsx'
import Conversation from '../components/Conversation.jsx'
import Composer from '../components/Composer.jsx'
import Decision from '../components/Decision.jsx'
import DiffLines from '../components/DiffLines.jsx'
import FileList, { markOf } from '../components/FileList.jsx'
import { Button, Stat, duration, tokens } from '../components/bits.jsx'
import TaskActions from '../components/TaskActions.jsx'
import { api } from '../api.js'
import { to } from '../router.js'

const ACTIVE = new Set(['running', 'queued', 'awaiting_approval', 'awaiting_answer'])

export default function Workspace({ task, flow }) {
  const [repos, setRepos] = useState([])
  const [selected, setSelected] = useState(null)

  useEffect(() => {
    api.diff(task.id).then(setRepos).catch(() => {})
  }, [task.id, task.status, task.phase])

  const files = repos.flatMap((r) => r.files.map((f) => ({ ...f, repo: r.repo, key: `${r.repo}:${f.path}` })))
  const open = files.find((f) => f.key === selected) || files[0]
  const started = Object.values(task.phases || {}).find((p) => p.status === 'running')?.startedAt

  return (
    <>
      <Header active="workspace" task={task}>
        {ACTIVE.has(task.status) && (
          <span className="hidden items-center gap-2 text-xs text-ink-3 lg:inline-flex">
            <span className="ring-dot size-2 rounded-full bg-accent dot-live" />
            {task.phase} {started ? `· ${duration(started)}` : ''}
          </span>
        )}
        {ACTIVE.has(task.status) ? (
          <Button onClick={() => api.cancel(task.id).catch((e) => flow.setError(e.message))}>
            <IconPlayerStop size={14} /> Stop
          </Button>
        ) : (
          <Button onClick={() => api.retry(task.id).catch((e) => flow.setError(e.message))}>
            <IconRefresh size={14} /> Retry
          </Button>
        )}
        <TaskActions task={task} onError={flow.setError} />
        <Button variant="primary" as="a" href={to.review(task.id)}>Review changes</Button>
      </Header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside
          aria-label="Changed files"
          className="box-border min-h-0 flex-[1_1_220px] overflow-y-auto border-r border-line bg-panel px-2 py-3"
        >
          {/* Context fills while you read. The file list is where you go
              looking, so the one that changes under you sits above it. */}
          {task.context > 0 && (
            <div className="mb-4 border-b border-line px-2 pb-3.5">
              <div className="mb-2.5 font-mono text-[11px] tracking-[0.06em] text-muted uppercase">Context</div>
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-[17px] font-semibold text-ink">
                  {tokens(task.context)}
                  {task.contextWindow ? (
                    <span className="text-[13px] font-normal text-muted"> / {tokens(task.contextWindow)}</span>
                  ) : null}
                </span>
                {task.contextWindow ? (
                  <span className="font-mono text-xs text-muted">
                    {Math.round((task.context / task.contextWindow) * 100)}%
                  </span>
                ) : null}
              </div>
              {task.contextWindow ? (
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line-dim shadow-[inset_0_1px_1px_rgb(0_0_0/0.4)]">
                  <div
                    className={`h-1.5 rounded-full transition-[width] duration-700 ease-smooth ${
                      task.context / task.contextWindow > 0.85
                        ? 'bg-bad'
                        : task.context / task.contextWindow > 0.6
                          ? 'bg-warn'
                          : 'bg-accent'
                    }`}
                    style={{ width: `${Math.min(100, Math.round((task.context / task.contextWindow) * 100))}%` }}
                  />
                </div>
              ) : null}
              {task.io && (
                <dl className="m-0 mt-3 flex flex-col gap-1.5 text-xs">
                  {[
                    ['Input', task.io.input],
                    ['Cache read', task.io.cacheRead],
                    ['Cache write', task.io.cacheWrite],
                    ['Output', task.io.output],
                  ].map(([label, n]) => (
                    <div key={label} className="flex justify-between gap-3">
                      <dt className="text-muted">{label}</dt>
                      <dd className="m-0 font-mono text-ink-3">{tokens(n)}</dd>
                    </div>
                  ))}
                  <div className="mt-0.5 flex justify-between gap-3 border-t border-line pt-1.5">
                    <dt className="font-medium text-ink-3">Total I/O</dt>
                    <dd className="m-0 font-mono font-semibold text-ink">
                      {tokens(task.io.input + task.io.cacheRead + task.io.cacheWrite + task.io.output)}
                    </dd>
                  </div>
                </dl>
              )}
            </div>
          )}

          <FileList repos={repos} selected={open?.key} onSelect={setSelected} title="Explorer" />

          <div className="mt-5 border-t border-line px-2 pt-3.5">
            <div className="mb-2.5 font-mono text-[11px] tracking-[0.06em] text-muted uppercase">Run</div>
            <dl className="m-0 flex flex-col gap-2 text-xs">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-muted">Cost</dt>
                <dd className="m-0 font-mono text-[13px] text-ink">${(task.cost || 0).toFixed(3)}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-muted">Turns</dt>
                <dd className="m-0 font-mono text-[13px] text-ink">{task.turns || 0}</dd>
              </div>
              <div className="flex justify-between gap-3 text-muted">
                <dt className="shrink-0">Permissions</dt>
                <dd className="m-0 truncate text-ink-3">{task.permissionMode}</dd>
              </div>
              <div className="flex justify-between gap-3 text-muted">
                <dt className="shrink-0">Effort</dt>
                <dd className="m-0 truncate text-ink-3">{task.effort || 'default'}</dd>
              </div>
            </dl>
          </div>
        </aside>

        <section
          aria-label="Agent conversation"
          className="flex min-h-0 min-w-0 flex-[999_1_460px] flex-col border-r border-line"
        >
          <Conversation task={task}>
            <Decision task={task} onError={flow.setError} />
          </Conversation>
          <Composer task={task} flow={flow} onError={flow.setError} />
        </section>

        <section aria-label="Changes" className="flex min-h-0 min-w-0 flex-[1_1_540px] flex-col bg-panel">
          <div role="tablist" aria-label="Changed files" className="flex items-stretch overflow-x-auto border-b border-line">
            {files.slice(0, 6).map((file) => {
              const on = file.key === open?.key
              return (
                <button
                  key={file.key}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => setSelected(file.key)}
                  title={`${file.repo}/${file.path}`}
                  className={`flex h-10 shrink-0 cursor-pointer items-center gap-2 border-r border-line px-3.5
                              font-mono text-xs transition-colors duration-200 ease-smooth
                              ${on
                                ? 'border-b-2 border-b-accent bg-page text-ink'
                                : 'text-muted hover:bg-raised hover:text-ink'}`}
                >
                  {file.path.split('/').pop()}
                  <span className={markOf(file) === 'A' ? 'text-ok' : markOf(file) === 'D' ? 'text-bad' : 'text-warn'}>
                    {markOf(file)}
                  </span>
                </button>
              )
            })}
            <div className="flex-1" />
            {open && (
              <div className="flex items-center gap-2 px-3">
                <Stat added={open.added} removed={open.removed} />
              </div>
            )}
          </div>

          <div className="flex-1 overflow-auto bg-page">
            {open ? (
              open.patch ? (
                <DiffLines patch={open.patch} single />
              ) : (
                <p className="px-4 py-3 font-mono text-xs text-muted">
                  {(open.bytes / 1024).toFixed(0)} KB of changes, too much to read here.
                </p>
              )
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-1.5 px-6 text-center">
                <p className="m-0 text-sm text-ink-3">No changes yet</p>
                <p className="m-0 max-w-[36ch] text-[13px] text-muted">
                  Edits show up here as the agent makes them.
                </p>
              </div>
            )}
          </div>
        </section>
      </div>
    </>
  )
}
