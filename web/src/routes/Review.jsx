import { useEffect, useState } from 'react'
import {
  IconAlertTriangle, IconArrowMerge, IconArrowUp, IconCheck, IconCloudUpload, IconExternalLink, IconSparkles,
} from '@tabler/icons-react'
import Header from '../components/Header.jsx'
import DiffLines from '../components/DiffLines.jsx'
import FileList from '../components/FileList.jsx'
import Markdown from '../components/Markdown.jsx'
import { Button, Stat, inputClass, span } from '../components/bits.jsx'
import { api } from '../api.js'
import { to } from '../router.js'

const PIPELINE = {
  success: ['text-ok', 'Pipeline passed'],
  failed: ['text-bad', 'Pipeline failed'],
  running: ['text-warn', 'Pipeline running'],
  pending: ['text-warn', 'Pipeline pending'],
}

function Check({ ok, warn, children, aside }) {
  return (
    <div
      className={`flex min-h-9 items-center gap-2.5 rounded-lg border px-2.5 text-[13px]
                  ${warn ? 'border-warn-line bg-warn-bg' : 'border-line bg-input'}`}
    >
      <span className={warn ? 'text-warn' : ok ? 'text-ok' : 'text-muted'}>
        {warn ? <IconAlertTriangle size={14} /> : <IconCheck size={14} stroke={2.4} />}
      </span>
      {children}
      {aside && <span className="ml-auto font-mono text-xs text-muted">{aside}</span>}
    </div>
  )
}

export default function Review({ task, flow }) {
  const [repos, setRepos] = useState([])
  const [git, setGit] = useState(task.git || [])
  const [selected, setSelected] = useState(null)
  const [followUp, setFollowUp] = useState('')
  const [busy, setBusy] = useState('')

  useEffect(() => {
    api.diff(task.id).then(setRepos).catch(() => {})
  }, [task.id, task.status])

  const refreshGit = () => api.gitState(task.id).then(setGit).catch(() => {})
  useEffect(() => {
    refreshGit()
    const id = setInterval(refreshGit, task.status === 'running' ? 5000 : 20_000)
    return () => clearInterval(id)
  }, [task.id, task.status]) // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (what, fn) => {
    setBusy(what)
    try {
      await fn()
      await refreshGit()
    } catch (err) {
      flow.setError(err.message)
    } finally {
      setBusy('')
    }
  }

  const files = repos.flatMap((r) => r.files.map((f) => ({ ...f, repo: r.repo, key: `${r.repo}:${f.path}` })))
  const open = files.find((f) => f.key === selected) || files[0]
  const added = files.reduce((n, f) => n + f.added, 0)
  const removed = files.reduce((n, f) => n + f.removed, 0)
  const spent = Object.values(task.phases || {}).reduce(
    (n, p) => n + (p.startedAt && p.endedAt ? p.endedAt - p.startedAt : 0), 0,
  )
  const primary = git[0]

  return (
    <>
      <Header active="review" task={task} />

      <div className="flex flex-wrap items-center gap-4 border-b border-line px-6 py-4">
        <div className="min-w-0 flex-[1_1_420px]">
          <h1 className="m-0 truncate text-[22px] font-semibold tracking-[-0.01em]">{task.title}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2.5 text-[13px] text-muted">
            {task.trees?.map((tree) => (
              <span key={tree.repo} className="flex items-center gap-2">
                <span className="rounded bg-selected px-1.5 py-px font-mono text-xs text-ink-3">{tree.branch}</span>
                <span aria-hidden="true">→</span>
                <span className="rounded bg-selected px-1.5 py-px font-mono text-xs text-ink-3">{tree.baseBranch}</span>
              </span>
            ))}
            <span>{files.length} files</span>
            <Stat added={added} removed={removed} />
            <span>
              {task.model || 'default'} · {span(spent)} · ${(task.cost || 0).toFixed(2)}
            </span>
          </div>
        </div>

        <Button as="a" href={to.workspace(task.id)}>Open in workspace</Button>
        {primary?.behind > 0 && (
          <Button
            variant="subtle"
            disabled={!!busy || !task.root}
            onClick={() => act('catch-up', () => api.catchUp(task.id, primary.repo))}
          >
            <IconSparkles size={14} />
            {busy === 'catch-up' ? 'Catching up' : `Catch up with ${primary.base}`}
          </Button>
        )}
        {primary && primary.unpushed !== 0 && (
          <Button
            variant="subtle"
            disabled={!!busy || !primary.remote}
            onClick={() => act('push', () => api.push(task.id, primary.repo))}
          >
            <IconCloudUpload size={14} /> {busy === 'push' ? 'Pushing' : 'Push'}
          </Button>
        )}
        {primary?.reviewUrl && primary.upstream && (
          <Button as="a" variant="subtle" href={primary.reviewUrl} target="_blank" rel="noreferrer">
            <IconExternalLink size={14} /> Open MR
          </Button>
        )}
        <Button
          variant="primary"
          disabled={!!busy || !primary || !!primary.mergeBlockedBy || primary.behind > 0 || primary.ahead === 0}
          title={primary?.mergeBlockedBy || (primary?.behind > 0 ? 'Catch up first so this is a fast-forward' : '')}
          onClick={() => act('merge', () => api.merge(task.id, primary.repo))}
        >
          <IconArrowMerge size={14} />
          {busy === 'merge' ? 'Merging' : `Merge into ${primary?.base || 'base'}`}
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-wrap">
        <aside
          aria-label="Changed files"
          className="box-border min-h-0 flex-[1_1_240px] overflow-y-auto border-r border-line bg-panel px-2 py-3.5"
        >
          <FileList
            repos={repos}
            selected={open?.key}
            onSelect={setSelected}
            aside={`${files.length} files`}
          />
        </aside>

        <main className="box-border min-h-0 min-w-0 flex-[999_1_560px] overflow-y-auto p-4">
          {open ? (
            <div className="overflow-hidden rounded-xl border border-line bg-page">
              <div className="flex flex-wrap items-center gap-2.5 border-b border-line bg-raised px-3.5 py-2.5 font-mono text-xs">
                <span className="text-ink">{open.repo}/{open.path}</span>
                <Stat added={open.added} removed={open.removed} />
              </div>
              {open.patch ? (
                <DiffLines patch={open.patch} />
              ) : (
                <p className="px-4 py-3 text-xs text-muted">
                  {(open.bytes / 1024).toFixed(0)} KB of changes, too much to read here.
                </p>
              )}
            </div>
          ) : (
            <p className="py-16 text-center text-muted">Nothing has changed on these branches.</p>
          )}
        </main>

        <aside
          aria-label="Summary and checks"
          className="box-border flex min-h-0 flex-[1_1_320px] flex-col gap-5 overflow-y-auto border-l border-line bg-panel p-4"
        >
          <section>
            <h2 className="m-0 mb-2 text-[13px] font-semibold">What the agent changed</h2>
            {task.docs?.['review.md'] ? (
              <Markdown source={task.docs['review.md']} className="text-[13px] text-ink-3" />
            ) : task.docs?.['spec.md'] ? (
              <Markdown source={task.docs['spec.md']} className="text-[13px] text-ink-3" />
            ) : (
              <p className="m-0 text-[13px] text-muted">No spec or review was written for this one.</p>
            )}
          </section>

          <section>
            <h2 className="m-0 mb-2 text-[13px] font-semibold">Checks</h2>
            <div className="flex flex-col gap-1.5">
              {git.map((repo) => {
                const [tone, label] = PIPELINE[repo.pipeline?.status] || []
                return (
                  <div key={repo.repo} className="flex flex-col gap-1.5">
                    {repo.pipeline?.status === 'unavailable' ? (
                      <Check ok={false} aside={repo.repo}>
                        <span className="text-muted" title={repo.pipeline.reason}>CI unavailable</span>
                      </Check>
                    ) : label ? (
                      <Check ok={repo.pipeline.status === 'success'} warn={repo.pipeline.status === 'failed'} aside={repo.repo}>
                        {repo.pipeline.url ? (
                          <a href={repo.pipeline.url} target="_blank" rel="noreferrer" className={`${tone} no-underline hover:underline`}>
                            {label}
                          </a>
                        ) : (
                          <span className={tone}>{label}</span>
                        )}
                      </Check>
                    ) : null}
                    {repo.mergeBlockedBy && (
                      <Check warn aside={repo.repo}><span className="text-warn">{repo.mergeBlockedBy}</span></Check>
                    )}
                    {repo.behind > 0 && (
                      <Check warn aside={repo.repo}>
                        <span className="text-warn">{repo.behind} behind {repo.base}</span>
                      </Check>
                    )}
                    {repo.baseUnpushed > 0 && (
                      <Check warn aside={repo.repo}>
                        <button
                          type="button"
                          onClick={() => act('push-base', () => api.push(task.id, repo.repo, true))}
                          className="cursor-pointer text-warn hover:underline"
                        >
                          {repo.base} is {repo.baseUnpushed} ahead of its remote. Push it.
                        </button>
                      </Check>
                    )}
                  </div>
                )
              })}
              {!git.length && <p className="m-0 text-[13px] text-muted">No branches yet.</p>}
            </div>
          </section>

          <section className="mt-auto">
            <label htmlFor="followup" className="mb-1.5 block text-xs text-muted">
              Ask the agent for a follow-up
            </label>
            <div className="flex gap-2">
              <input
                id="followup"
                value={followUp}
                onChange={(e) => setFollowUp(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && followUp.trim() &&
                  act('follow-up', () => api.followUp(task.id, followUp).then(() => setFollowUp('')))}
                placeholder="e.g. the build is broken, fix it"
                className={`${inputClass} min-w-0 flex-1`}
              />
              <button
                type="button"
                aria-label="Send"
                disabled={!!busy || !followUp.trim() || !task.root}
                onClick={() => act('follow-up', () => api.followUp(task.id, followUp).then(() => setFollowUp('')))}
                className="flex size-[38px] flex-none cursor-pointer items-center justify-center rounded-lg
                           bg-accent text-on-accent disabled:opacity-30"
              >
                <IconArrowUp size={16} stroke={2.4} />
              </button>
            </div>
          </section>
        </aside>
      </div>
    </>
  )
}
