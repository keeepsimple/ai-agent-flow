import { useState } from 'react'
import { Button, Field, inputClass } from './bits.jsx'

const named = (v) => v || 'default'

export default function NewTask({ repos, options, defaults, onCreate, onClose }) {
  const [title, setTitle] = useState('')
  const [picked, setPicked] = useState(repos.slice(0, 1))
  const [prompt, setPrompt] = useState('')
  const [model, setModel] = useState(defaults.model)
  const [effort, setEffort] = useState(defaults.effort)
  const [permissionMode, setPermissionMode] = useState(defaults.permissionMode)
  const [autoApprove, setAutoApprove] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await onCreate({ title, repos: picked, prompt, model, effort, permissionMode, autoApprove })
      onClose()
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  const mode = options.modes.find((m) => m.value === permissionMode)

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 border-b border-line bg-surface-2 p-3">
      <Field label="Title">
        <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} required
          placeholder="Mirror discount target names into the mobile payload" />
      </Field>

      <Field
        label={`Repos · ${picked.length} of ${repos.length}`}
        hint={
          picked.length > 1
            ? 'Each one gets its own worktree, branch and commits. The spec will have to say which deploys first.'
            : 'Tick more than one when a feature genuinely spans repos.'
        }
      >
        <div className="max-h-44 overflow-y-auto rounded-md border border-line bg-surface">
          {repos.map((r) => (
            <label
              key={r}
              className="flex cursor-pointer items-center gap-2 px-2.5 py-1 text-[12px]
                         transition-colors duration-150 hover:bg-surface-3"
            >
              <input
                type="checkbox"
                className="accent-accent"
                checked={picked.includes(r)}
                onChange={(e) =>
                  setPicked((prev) => (e.target.checked ? [...prev, r] : prev.filter((x) => x !== r)))
                }
              />
              <span className="font-mono text-ink-dim">{r}</span>
            </label>
          ))}
        </div>
      </Field>
      <div className="-mt-2 flex gap-3 text-[11px]">
        <button type="button" onClick={() => setPicked(repos)} className="cursor-pointer text-ink-faint hover:text-ink">
          Whole directory
        </button>
        <button type="button" onClick={() => setPicked([])} className="cursor-pointer text-ink-faint hover:text-ink">
          Clear
        </button>
      </div>

      <Field label="What to do" hint="Write it as you would to a colleague. The spec phase turns this into a real spec.">
        <textarea className={`${inputClass} min-h-[110px] resize-y`} value={prompt} required
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="get-discounts should return the targeted product and collection names, capped at 5, fail-soft if Shopify is down." />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Model">
          <select className={inputClass} value={model} onChange={(e) => setModel(e.target.value)}>
            {options.models.map((m) => <option key={m} value={m}>{named(m)}</option>)}
          </select>
        </Field>
        <Field label="Effort" hint="How hard it thinks per turn.">
          <select className={inputClass} value={effort} onChange={(e) => setEffort(e.target.value)}>
            {options.efforts.map((v) => <option key={v} value={v}>{named(v)}</option>)}
          </select>
        </Field>
      </div>

      <Field label="Permissions" hint={mode?.hint}>
        <select className={inputClass} value={permissionMode} onChange={(e) => setPermissionMode(e.target.value)}>
          {options.modes.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
      </Field>

      <label className="flex cursor-pointer items-start gap-2">
        <input type="checkbox" className="mt-0.5 accent-accent" checked={autoApprove}
          onChange={(e) => setAutoApprove(e.target.checked)} />
        <span>
          <span className="block text-[12px] text-ink">Run unattended</span>
          <span className="block text-[11px] text-ink-faint">Skip the spec and plan gates and go straight through.</span>
        </span>
      </label>

      {error && <p className="text-[11px] text-danger">{error}</p>}

      <div className="flex gap-2">
        <Button variant="primary" type="submit" disabled={busy}>{busy ? 'Starting' : 'Start task'}</Button>
        <Button onClick={onClose}>Cancel</Button>
      </div>
    </form>
  )
}
