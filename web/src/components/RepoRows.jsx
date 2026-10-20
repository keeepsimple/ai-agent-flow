import { useState } from 'react'
import { IconArrowMerge, IconCloudUpload, IconCopy, IconSitemap, IconSparkles } from '@tabler/icons-react'
import { Button } from './bits.jsx'
import { api } from '../api.js'

function Ship({ task, state, onDone, onError }) {
  const [busy, setBusy] = useState('')

  const run = async (what, call) => {
    setBusy(what)
    try {
      const result = await call()
      if (result?.git) onDone(result)
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
  const [git, setGit] = useState(null)
  const state = git || task.git || []
  const trees = task.trees || task.repos.map((repo) => ({ repo }))

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
                onDone={(result) => setGit(result.git)}
                onError={onError}
              />
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}
