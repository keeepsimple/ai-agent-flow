import { useMemo, useState } from 'react'
import {
  IconArrowRight, IconFolderOpen, IconFolderPlus, IconPaperclip, IconSearch, IconX,
} from '@tabler/icons-react'
import {
  AttachStrip, Button, Chip, GROUPS, Stat, ago, inputClass, selectChip, useAttachments,
} from '../components/bits.jsx'
import Header, { AccentPicker } from '../components/Header.jsx'
import { api } from '../api.js'
import { go, to } from '../router.js'

const named = (v) => v || 'default'

function NewTask({ flow, onError }) {
  const { repos, options, defaults } = flow
  const [prompt, setPrompt] = useState('')
  // Repos are picked by path: two folders can hold repos of the same name.
  const [picked, setPicked] = useState(repos.slice(0, 1).map((r) => r.path))
  const [folder, setFolder] = useState('')
  const [adding, setAdding] = useState(false)
  const [showRepos, setShowRepos] = useState(false)
  const [filter, setFilter] = useState('')
  const [run, setRun] = useState('full')
  const [model, setModel] = useState(defaults.model)
  const [effort, setEffort] = useState(defaults.effort)
  const [permissionMode, setPermissionMode] = useState(defaults.permissionMode)
  const [autoApprove, setAutoApprove] = useState(false)
  const [busy, setBusy] = useState(false)
  const attach = useAttachments()

  const byRoot = useMemo(() => {
    const q = filter.trim().toLowerCase()
    const matching = q ? repos.filter((r) => r.name.toLowerCase().includes(q)) : repos
    const groups = new Map()
    for (const repo of matching) {
      if (!groups.has(repo.root)) groups.set(repo.root, [])
      groups.get(repo.root).push(repo)
    }
    return [...groups.entries()]
  }, [repos, filter])

  const addFolder = async (given) => {
    const path = (given ?? folder).trim()
    if (!path || adding) return
    setAdding(true)
    try {
      const result = await api.addRoot(path)
      flow.setRoots(result.roots)
      flow.setRepos(result.repos)
      setFolder('')
    } catch (err) {
      onError(err.message)
    } finally {
      setAdding(false)
    }
  }

  // The browser cannot hand over a folder path, so the server opens the OS
  // picker; it is the same machine.
  const browseFolder = async () => {
    if (adding) return
    setAdding(true)
    try {
      const { path, cancelled } = await api.browseRoot()
      if (!cancelled) await addFolder(path)
    } catch (err) {
      onError(err.message)
    } finally {
      setAdding(false)
    }
  }

  const dropFolder = async (root) => {
    try {
      const result = await api.removeRoot(root)
      flow.setRoots(result.roots)
      flow.setRepos(result.repos)
      setPicked((prev) => prev.filter((p) => !p.startsWith(`${root}/`) && p !== root))
    } catch (err) {
      onError(err.message)
    }
  }

  const start = async () => {
    if (!prompt.trim() || !picked.length || busy) return
    setBusy(true)
    try {
      const task = await api.create({
        prompt, repos: picked, attachments: attach.paths, run, model, effort, permissionMode, autoApprove,
      })
      go(to.workspace(task.id))
    } catch (err) {
      onError(err.message)
      setBusy(false)
    }
  }

  const select = (value, set, list, render) => (
    <select
      value={value}
      onChange={(e) => set(e.target.value)}
      className={selectChip}
    >
      {list.map(render)}
    </select>
  )

  return (
    <div
      onDrop={attach.onDrop}
      onDragOver={attach.onDragOver}
      onDragLeave={attach.onDragLeave}
      className={`flex flex-col gap-2.5 rounded-2xl border bg-input p-4 transition-colors duration-150
                  focus-within:border-accent/60 focus-within:ring-2 focus-within:ring-accent/15
                  ${attach.dragging ? 'border-accent ring-2 ring-accent/25' : 'border-line-strong'}`}
    >
      <label htmlFor="task" className="text-xs text-muted">New task</label>
      <textarea
        id="task"
        rows={2}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onPaste={attach.onPaste}
        onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && start()}
        placeholder="e.g. get-discounts should return targeted product and collection names, capped at 5"
        className="field-bare w-full resize-none border-0 bg-transparent text-[15px] outline-none placeholder:text-faint"
      />
      <AttachStrip files={attach.files} onRemove={attach.remove} size="h-12 w-16" />
      {attach.error && <span className="text-[11px] text-bad">{attach.error}</span>}
      {attach.picker}

      <div className="flex flex-wrap items-center gap-2">
        <Chip onClick={attach.pick} title="Attach a screenshot, a log, a diff">
          <IconPaperclip size={13} />
          Attach
        </Chip>

        <Chip
          active={showRepos}
          onClick={() => setShowRepos((v) => !v)}
          mono
          className={showRepos ? '' : 'border-line-strong bg-input text-ink'}
        >
          {picked.length === 1 ? picked[0].split('/').pop() : `${picked.length} repos`}
        </Chip>

        <span className="h-5 w-px bg-line" aria-hidden="true" />

        {select(run, setRun, options.runs, (r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        {select(model, setModel, options.models, (m) => (
          <option key={m} value={m}>{m || (defaults.cliModel ? `default (${defaults.cliModel})` : 'default')}</option>
        ))}
        {select(effort, setEffort, options.efforts, (v) => <option key={v} value={v}>{named(v)} effort</option>)}
        {select(permissionMode, setPermissionMode, options.modes, (m) => (
          <option key={m.value} value={m.value}>{m.label}</option>
        ))}
        <span className="h-5 w-px bg-line" aria-hidden="true" />

        <Chip
          active={autoApprove}
          onClick={() => setAutoApprove((v) => !v)}
          title={
            autoApprove
              ? 'No gates and no questions: it decides and writes down the assumption'
              : 'Stops at the gates, and asks you when it needs a decision'
          }
        >
          <span className={`size-1.5 rounded-full ${autoApprove ? 'bg-accent' : 'bg-faint'}`} />
          {autoApprove ? 'Unattended' : 'Ask me'}
        </Chip>
        <div className="flex-1" />
        <Button variant="primary" disabled={busy || !prompt.trim() || !picked.length} onClick={start}>
          {busy ? 'Starting' : 'Start agent'} <IconArrowRight size={14} />
        </Button>
      </div>

      {showRepos && (
        <div className="flex flex-col gap-2 border-t border-line pt-3">
          <div className="relative">
            <IconSearch size={13} className="absolute top-1/2 left-2.5 -translate-y-1/2 text-muted" />
            <input
              className={`${inputClass} pl-7`}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={`Filter ${repos.length} repos`}
            />
          </div>
          <div className="max-h-56 overflow-y-auto">
            {byRoot.map(([root, list]) => (
              <div key={root} className="mb-2">
                <div className="flex items-center gap-2 px-2 py-1">
                  <span className="truncate font-mono text-[11px] text-muted" title={root}>{root}</span>
                  {flow.roots.length > 1 && (
                    <button
                      type="button"
                      onClick={() => dropFolder(root)}
                      aria-label={`Stop watching ${root}`}
                      className="cursor-pointer text-faint transition-colors duration-150 hover:text-bad"
                    >
                      <IconX size={11} />
                    </button>
                  )}
                </div>
                <ul className="grid grid-cols-2 gap-x-3 lg:grid-cols-3">
                  {list.map((repo) => {
                    const on = picked.includes(repo.path)
                    return (
                      <li key={repo.path}>
                        <button
                          type="button"
                          onClick={() =>
                            setPicked((prev) =>
                              on ? prev.filter((p) => p !== repo.path) : [...prev, repo.path])
                          }
                          className={`flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1 text-left
                                      font-mono text-xs transition-colors duration-150
                                      ${on ? 'text-accent' : 'text-ink-3 hover:bg-selected hover:text-ink'}`}
                        >
                          <span
                            className={`flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border
                                        ${on ? 'border-accent bg-accent text-on-accent' : 'border-line-strong'}`}
                          >
                            {on && <span className="text-[9px] leading-none">✓</span>}
                          </span>
                          <span className="truncate" title={repo.path}>{repo.name}</span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
            {!byRoot.length && <p className="px-2 text-xs text-muted">Nothing matches.</p>}
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
            <Button disabled={adding} onClick={browseFolder}>
              <IconFolderOpen size={14} /> {adding ? 'Adding' : 'Choose a folder'}
            </Button>
            <span className="text-xs text-muted">or type a path</span>
            <div className="relative min-w-48 flex-1">
              <IconFolderPlus size={13} className="absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
              <input
                className={`${inputClass} pl-8`}
                value={folder}
                onChange={(e) => setFolder(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addFolder()}
                placeholder="~/Documents/something"
              />
            </div>
            <Button disabled={adding || !folder.trim()} onClick={() => addFolder()}>Add</Button>
          </div>
        </div>
      )}
    </div>
  )
}

function Card({ task }) {
  const phases = Object.entries(task.phases || {})
  const done = phases.filter(([, p]) => p.status === 'done').length
  const asking = task.questions?.find((q) => q.id === task.openQuestionId)
  const attention = ['awaiting_approval', 'awaiting_answer', 'failed'].includes(task.status)
  const merged = Boolean(task.mergedAt)
  const working = task.status === 'running' || task.status === 'queued'

  return (
    <a
      href={merged ? to.review(task.id) : to.workspace(task.id)}
      className={`flex flex-col gap-2.5 rounded-xl border p-3.5 no-underline transition-colors duration-150
        ${attention
          ? 'border-warn-line bg-warn-bg text-ink'
          : merged
            ? 'border-line-dim bg-panel text-ink-3 hover:border-line'
            : working
              ? 'border-accent/35 bg-input text-ink hover:border-accent/60'
              : 'border-line bg-input text-ink hover:border-line-strong'}`}
    >
      <div className="line-clamp-2 font-medium break-words">{task.title}</div>

      {!merged && task.trees?.[0] && (
        <div className="truncate font-mono text-xs text-muted" title={task.trees[0].branch}>
          {task.trees[0].branch}
        </div>
      )}

      {asking ? (
        <div className="line-clamp-2 text-[13px] text-warn">Asks: “{asking.text}”</div>
      ) : task.status === 'failed' ? (
        <div className="line-clamp-2 text-[13px] text-bad">{task.error}</div>
      ) : working ? (
        <div className="text-xs text-ink-3">{task.phase}…</div>
      ) : null}

      {working && phases.length > 0 && (
        <div className="h-[3px] rounded-sm bg-line">
          <div
            className="h-[3px] rounded-sm bg-accent transition-[width] duration-500"
            style={{ width: `${Math.round((done / phases.length) * 100)}%` }}
          />
        </div>
      )}

      <div className="flex items-center justify-between gap-2 text-xs text-muted">
        <span>
          {merged
            ? `Merged ${ago(task.mergedAt)}`
            : working
              ? `${done} of ${phases.length} steps`
              : `${task.status === 'failed' ? 'Failed' : 'Done'} ${ago(task.updatedAt)}`}
        </span>
        {task.stat ? <Stat added={task.stat.added} removed={task.stat.removed} /> : null}
      </div>
    </a>
  )
}

const FILTERS = [
  ['all', 'All', () => true],
  ['active', 'Active', (t) => !['done', 'failed', 'cancelled'].includes(t.status)],
  ['finished', 'Finished', (t) => ['done', 'failed', 'cancelled'].includes(t.status)],
]

export default function Sessions({ flow }) {
  const [filter, setFilter] = useState('all')
  const tasks = flow.tasks || []
  const visible = tasks.filter(FILTERS.find(([k]) => k === filter)[2])

  const columns = []
  const left = [...visible]
  for (const group of GROUPS) {
    const mine = left.filter(group.has)
    mine.forEach((t) => left.splice(left.indexOf(t), 1))
    if (mine.length) columns.push({ ...group, tasks: mine })
  }

  return (
    <>
      <Header
        active="sessions"
        repoLabel={
          flow.roots.length === 1
            ? flow.roots[0].split('/').pop()
            : `${flow.roots.length} folders`
        }
      >
        <span className="font-mono text-xs text-muted">
          {tasks.length} task{tasks.length === 1 ? '' : 's'} ·{' '}
          ${tasks.reduce((n, t) => n + (t.cost || 0), 0).toFixed(2)}
        </span>
        {flow.notifications === 'default' && (
          <Chip onClick={flow.askForNotifications}>Notify me</Chip>
        )}
        <AccentPicker />
      </Header>

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[1360px] flex-col gap-6 px-6 pt-8 pb-12">
        <div>
          <h1 className="m-0 text-[28px] font-semibold tracking-[-0.02em]">Sessions</h1>
          <p className="mt-1 mb-0 text-muted">
            Each agent works in its own worktree and branch. You review before anything merges.
          </p>
        </div>

        {flow.options && flow.defaults ? (
          <NewTask flow={flow} onError={flow.setError} />
        ) : (
          <div className="skeleton h-32 rounded-[14px]" />
        )}

        <div
          role="tablist"
          aria-label="Filter sessions"
          className="flex gap-1 self-start rounded-full border border-line bg-input p-[3px]"
        >
          {FILTERS.map(([key, label, match]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={filter === key}
              onClick={() => setFilter(key)}
              className={`h-8 cursor-pointer rounded-full px-3.5 text-[13px] transition-colors duration-150
                          ${filter === key ? 'bg-line text-ink' : 'text-muted hover:text-ink'}`}
            >
              {label} <span className="text-muted">{tasks.filter(match).length}</span>
            </button>
          ))}
        </div>

        {flow.tasks === null ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-28 rounded-xl" />)}
          </div>
        ) : !columns.length ? (
          <p className="py-16 text-center text-muted">
            Nothing here yet. Describe a change above and an agent takes it from there.
          </p>
        ) : (
          <div className="grid items-start gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {columns.map((group) => (
              <section key={group.key} className="flex flex-col gap-2.5">
                <div className="flex items-center gap-2 px-1 text-[13px] font-medium">
                  <span className={`size-2 rounded-full ${group.dot}`} />
                  {group.title}
                  <span className="font-normal text-muted">{group.tasks.length}</span>
                </div>
                {group.tasks.map((task) => <Card key={task.id} task={task} />)}
              </section>
            ))}
          </div>
        )}
        </div>
      </main>
    </>
  )
}
