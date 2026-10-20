import { useCallback, useEffect, useState } from 'react'
import {
  IconArrowMerge, IconCloudUpload, IconCopy, IconExternalLink, IconSitemap, IconSparkles,
} from '@tabler/icons-react'

// GitLab's own vocabulary, mapped onto what the eye needs: is it fine, is it
// broken, or is it still going.
const PIPELINE = {
  success: ['text-accent', 'passed'],
  failed: ['text-danger', 'failed'],
  running: ['text-warn', 'running'],
  pending: ['text-warn', 'pending'],
  created: ['text-ink-faint', 'queued'],
  canceled: ['text-ink-faint', 'cancelled'],
  skipped: ['text-ink-faint', 'skipped'],
  manual: ['text-ink-faint', 'manual'],
  none: ['text-ink-faint', 'no pipeline'],
}

function Pipeline({ state }) {
  if (!state) return null
  if (state.status === 'unavailable') {
    return (
      <span title={state.reason} className="font-mono text-[10px] text-ink-faint">
        CI unavailable
      </span>
    )
  }
  const [tone, label] = PIPELINE[state.status] || ['text-ink-faint', state.status]
  const live = state.status === 'running' || state.status === 'pending'
  const body = (
    <>
      <span className={`inline-block size-1.5 rounded-full ${tone.replace('text-', 'bg-')} ${live ? 'dot-live' : ''}`} />
      CI {label}
    </>
  )
  return state.url ? (
    <a
      href={state.url}
      target="_blank"
      rel="noreferrer"
      title={`Pipeline for ${state.sha}`}
      className={`inline-flex cursor-pointer items-center gap-1.5 font-mono text-[10px] ${tone} hover:underline`}
    >
      {body}
    </a>
  ) : (
    <span className={`inline-flex items-center gap-1.5 font-mono text-[10px] ${tone}`}>{body}</span>
  )
}
import { Button } from './bits.jsx'
import { api } from '../api.js'

function Ship({ task, state, onChanged, onError }) {
  const [busy, setBusy] = useState('')

  const run = async (what, call) => {
    setBusy(what)
    try {
      await call()
      await onChanged()
    } catch (err) {
      onError(err.message)
    } finally {
      setBusy('')
    }
  }

  if (!state) return <span className="font-mono text-[10px] text-ink-faint">nothing to ship yet</span>

  const pushed = state.unpushed === 0
  const stale = state.behind > 0
  const merged = state.ahead === 0 && state.produced > 0
  // The base branch carries the merge, so it is the thing left to publish.
  const openMr = state.reviewUrl && state.upstream && (
    <a
      href={state.reviewUrl}
      target="_blank"
      rel="noreferrer"
      title={state.reviewUrl}
      className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5
                 text-xs font-medium text-ink-dim transition-colors duration-150
                 hover:border-line-strong hover:text-ink"
    >
      <IconExternalLink size={13} /> Open MR
    </a>
  )

  const pushBase = state.baseUnpushed > 0 && (
    <Button
      disabled={!!busy}
      title={`git push ${state.remote} ${state.base}`}
      onClick={() => run('push-base', () => api.push(task.id, state.repo, true))}
    >
      <IconCloudUpload size={13} />
      {busy === 'push-base' ? 'Pushing' : `Push ${state.base}`}
      <span className="text-ink-faint">({state.baseUnpushed})</span>
    </Button>
  )

  if (state.ahead === 0) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10px] text-ink-faint">
          {merged ? `${state.produced} commits · already in ${state.base}` : 'nothing to ship yet'}
        </span>
        <Pipeline state={state.pipeline} />
        {openMr}
        {pushBase}
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-mono text-[10px] text-ink-faint">
        {state.ahead} commit{state.ahead === 1 ? '' : 's'}
        {state.upstream ? (pushed ? ' · pushed' : ` · ${state.unpushed} unpushed`) : ' · never pushed'}
        {stale && <span className="text-warn"> · {state.behind} behind {state.base}</span>}
      </span>
      {stale && (
        <Button
          disabled={!!busy || !task.root}
          title={
            task.root
              ? `Merge ${state.base} into ${state.branch} in the worktree and let an agent resolve the conflicts. Your own checkout is not touched.`
              : 'The worktree was dropped, so there is nowhere to do the merge'
          }
          onClick={() => run('catch-up', () => api.catchUp(task.id, state.repo))}
        >
          <IconSparkles size={13} /> {busy === 'catch-up' ? 'Catching up' : `Catch up with ${state.base}`}
        </Button>
      )}
      <Button
        disabled={!!busy || !state.remote || pushed}
        title={state.remote ? `git push -u ${state.remote} ${state.branch}` : 'This repo has no remote'}
        onClick={() => run('push', () => api.push(task.id, state.repo))}
      >
        <IconCloudUpload size={13} /> {busy === 'push' ? 'Pushing' : 'Push'}
      </Button>
      <Button
        disabled={!!busy || !!state.mergeBlockedBy || stale}
        title={
          state.mergeBlockedBy ||
          (stale
            ? `${state.base} has moved on. Catch up first so this is a fast-forward.`
            : `git merge ${state.branch} into ${state.base}`)
        }
        onClick={() => run('merge', () => api.merge(task.id, state.repo))}
      >
        <IconArrowMerge size={13} /> {busy === 'merge' ? 'Merging' : `Merge into ${state.base}`}
      </Button>
      <Pipeline state={state.pipeline} />
      {openMr}
      {pushBase}
      {state.mergeBlockedBy ? (
        <span className="font-mono text-[10px] text-warn">{state.mergeBlockedBy}</span>
      ) : stale ? (
        <span className="font-mono text-[10px] text-ink-faint">catch up first, then it fast-forwards</span>
      ) : state.uncommitted > 0 ? (
        <span className="font-mono text-[10px] text-ink-faint">
          {state.uncommitted} uncommitted, none in this merge
        </span>
      ) : null}
    </div>
  )
}

export default function RepoRows({ task, onError }) {
  // Git state is not pushed over the stream, and it changes under us: an agent
  // commits, a catch-up finishes, or the human does something in a terminal.
  // Holding a snapshot from the last button click froze the row until a reload.
  const [git, setGit] = useState(task.git || [])
  const trees = task.trees || task.repos.map((repo) => ({ repo }))

  const refresh = useCallback(
    () => api.gitState(task.id).then(setGit).catch(() => {}),
    [task.id],
  )

  useEffect(() => {
    refresh()
    // Each poll runs a handful of git commands per repo, and on a large repo
    // the working-tree scan is not free. Watch closely while an agent is
    // committing; idle, nothing moves unless the human moves it.
    const id = setInterval(refresh, task.status === 'running' ? 5000 : 20_000)
    return () => clearInterval(id)
  }, [task.status, refresh])

  const state = git

  return (
    <ul className="mt-2 divide-y divide-line/60 rounded-md border border-line bg-surface-2">
      {trees.map((tree) => (
        <li key={tree.repo} className="px-2.5 py-2">
          <div className="flex items-center gap-3">
            <div className="flex min-w-0 flex-1 items-center gap-2">
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
                className="flex shrink-0 cursor-pointer items-center gap-1.5 font-mono text-[10px] text-ink-faint
                           transition-colors duration-150 hover:text-ink disabled:cursor-default"
              >
                {task.root ? <><IconCopy size={12} /> path</> : 'dropped'}
              </button>
            )}
          </div>
          {tree.branch && (
            <div className="mt-1.5 pl-5">
              <Ship
                task={task}
                state={state.find((s) => s.repo === tree.repo)}
                onChanged={refresh}
                onError={onError}
              />
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}
