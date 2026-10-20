import { useEffect, useMemo, useRef, useState } from 'react'
import { IconChevronDown, IconSearch, IconX } from '@tabler/icons-react'
import { Button, Field, ImageStrip, inputClass, usePastedImages } from './bits.jsx'

const named = (v) => v || 'default'

function RepoPicker({ all, picked, setPicked }) {
  const [query, setQuery] = useState('')
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? all.filter((r) => r.toLowerCase().includes(q)) : all
  }, [all, query])

  const toggle = (repo) =>
    setPicked((prev) => (prev.includes(repo) ? prev.filter((r) => r !== repo) : [...prev, repo]))

  return (
    <div className="flex flex-col gap-2">
      {picked.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {picked.map((repo) => (
            <li key={repo}>
              <button
                type="button"
                onClick={() => toggle(repo)}
                className="flex cursor-pointer items-center gap-1 rounded-md border border-accent/40 bg-accent/10
                           py-1 pr-1.5 pl-2 font-mono text-[11px] text-accent transition-colors duration-150
                           hover:border-accent/70"
              >
                {repo}
                <IconX size={11} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="relative">
        <IconSearch size={13} className="absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-faint" />
        <input
          className={`${inputClass} pl-7`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Filter ${all.length} repos`}
        />
      </div>

      <ul className="grid max-h-40 grid-cols-2 gap-x-2 overflow-y-auto">
        {shown.map((repo) => {
          const on = picked.includes(repo)
          return (
            <li key={repo}>
              <button
                type="button"
                onClick={() => toggle(repo)}
                className={`flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1 text-left
                            font-mono text-[11.5px] transition-colors duration-150
                            ${on ? 'text-accent' : 'text-ink-dim hover:bg-surface-3 hover:text-ink'}`}
              >
                <span
                  className={`flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border
                              ${on ? 'border-accent bg-accent text-surface' : 'border-line-strong'}`}
                >
                  {on && <span className="text-[9px] leading-none">✓</span>}
                </span>
                <span className="truncate">{repo}</span>
              </button>
            </li>
          )
        })}
        {!shown.length && <li className="px-2 py-1 text-[11.5px] text-ink-faint">Nothing matches.</li>}
      </ul>
    </div>
  )
}

export default function NewTask({ repos, options, defaults, onCreate, onClose }) {
  const [title, setTitle] = useState('')
  const [picked, setPicked] = useState(repos.slice(0, 1))
  const [prompt, setPrompt] = useState('')
  const [model, setModel] = useState(defaults.model)
  const [effort, setEffort] = useState(defaults.effort)
  const [permissionMode, setPermissionMode] = useState(defaults.permissionMode)
  const [autoApprove, setAutoApprove] = useState(false)
  const [run, setRun] = useState('full')
  const [showOptions, setShowOptions] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const shots = usePastedImages()
  const first = useRef(null)

  useEffect(() => {
    first.current?.focus()
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const ready = prompt.trim() && picked.length

  const submit = async (e) => {
    e?.preventDefault()
    if (!ready || busy) return
    setBusy(true)
    setError(null)
    try {
      await onCreate({
        title, repos: picked, prompt, images: shots.paths, run, model, effort, permissionMode, autoApprove,
      })
      onClose()
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  const mode = options.modes.find((m) => m.value === permissionMode)
  const chosenRun = options.runs.find((r) => r.value === run)

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-surface/80 p-6 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <form
        onSubmit={submit}
        onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && submit(e)}
        className="my-auto w-full max-w-2xl rounded-lg border border-line bg-surface-2 shadow-2xl"
      >
        <header className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-[14px] font-semibold text-ink">New task</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="cursor-pointer text-ink-faint transition-colors duration-150 hover:text-ink"
          >
            <IconX size={16} />
          </button>
        </header>

        <div className="flex flex-col gap-4 px-5 py-4">
          <Field label="Title" hint="Optional. Leave it blank and the agent names the task once it has read the code.">
            <input
              ref={first}
              className={inputClass}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Mirror discount target names into the mobile payload"
            />
          </Field>

          <Field
            label="What to do"
            hint="Write it as you would to a colleague. Paste a screenshot or a Figma frame straight in."
            error={shots.error}
          >
            <textarea
              className={`${inputClass} min-h-[140px] resize-y leading-relaxed`}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onPaste={shots.onPaste}
              placeholder="get-discounts should return the targeted product and collection names, capped at 5, fail-soft if Shopify is down."
            />
          </Field>
          <ImageStrip images={shots.images} onRemove={shots.remove} />

          <Field label="How far to go">
            <div className="grid grid-cols-2 gap-2">
              {options.runs.map((option) => {
                const on = option.value === run
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setRun(option.value)}
                    className={`rounded-md border px-3 py-2 text-left transition-colors duration-150
                                ${on ? 'border-accent bg-accent/10' : 'border-line hover:border-line-strong'}`}
                  >
                    <span className={`block text-[12.5px] font-medium ${on ? 'text-accent' : 'text-ink'}`}>
                      {option.label}
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-ink-faint">{option.hint}</span>
                  </button>
                )
              })}
            </div>
          </Field>

          <Field
            label={`Repos · ${picked.length} selected`}
            hint={
              picked.length > 1
                ? 'Each gets its own worktree, branch and commits. The spec will have to say which deploys first.'
                : 'Tick more than one when a feature genuinely spans repos.'
            }
          >
            <RepoPicker all={repos} picked={picked} setPicked={setPicked} />
          </Field>

          <div className="border-t border-line pt-3">
            <button
              type="button"
              onClick={() => setShowOptions((v) => !v)}
              className="flex w-full cursor-pointer items-center gap-2 text-left text-[11px]
                         tracking-wide text-ink-dim uppercase transition-colors duration-150 hover:text-ink"
            >
              <IconChevronDown
                size={13}
                className={`transition-transform duration-200 ${showOptions ? '' : '-rotate-90'}`}
              />
              How it runs
              {!showOptions && (
                <span className="font-mono text-[10px] normal-case text-ink-faint">
                  {model || defaults.cliModel || 'default'} · {named(effort)} · {mode?.label.toLowerCase()}
                  {autoApprove ? ' · unattended' : ''}
                </span>
              )}
            </button>

            {showOptions && (
              <div className="mt-3 flex flex-col gap-3">
                <div className="grid grid-cols-3 gap-3">
                  <Field label="Model">
                    <select className={inputClass} value={model} onChange={(e) => setModel(e.target.value)}>
                      {options.models.map((m) => (
                        <option key={m} value={m}>
                          {m || (defaults.cliModel ? `default (${defaults.cliModel})` : 'default')}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Effort">
                    <select className={inputClass} value={effort} onChange={(e) => setEffort(e.target.value)}>
                      {options.efforts.map((v) => <option key={v} value={v}>{named(v)}</option>)}
                    </select>
                  </Field>
                  <Field label="Permissions">
                    <select
                      className={inputClass}
                      value={permissionMode}
                      onChange={(e) => setPermissionMode(e.target.value)}
                    >
                      {options.modes.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                    </select>
                  </Field>
                </div>
                <p className="text-[11px] text-ink-faint">{mode?.hint}</p>

                <button
                  type="button"
                  onClick={() => setAutoApprove((v) => !v)}
                  className="flex cursor-pointer items-start gap-2 text-left"
                >
                  <span
                    className={`mt-0.5 flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border
                                ${autoApprove ? 'border-accent bg-accent text-surface' : 'border-line-strong'}`}
                  >
                    {autoApprove && <span className="text-[9px] leading-none">✓</span>}
                  </span>
                  <span>
                    <span className={`block text-[12px] ${autoApprove ? 'text-accent' : 'text-ink'}`}>
                      Run unattended
                    </span>
                    <span className="block text-[11px] text-ink-faint">
                      {run === 'quick'
                        ? 'No questions: where it would have asked you, it decides and writes down the assumption.'
                        : 'No gates and no questions: where it would have asked you, it decides and writes down the assumption.'}
                    </span>
                  </span>
                </button>
              </div>
            )}
          </div>

          {error && <p className="text-[11px] text-danger">{error}</p>}
        </div>

        <footer className="flex items-center gap-3 border-t border-line px-5 py-3">
          <Button variant="primary" type="submit" disabled={!ready || busy}>
            {busy ? 'Starting' : 'Start task'}
          </Button>
          <Button onClick={onClose}>Cancel</Button>
          <span className="ml-auto font-mono text-[10px] text-ink-faint">⌘↵ to start · esc to close</span>
        </footer>
      </form>
    </div>
  )
}
