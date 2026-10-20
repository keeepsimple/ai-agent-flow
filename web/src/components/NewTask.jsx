import { useState } from 'react'
import { Button, Field, inputClass } from './bits.jsx'

const named = (v) => v || 'default'

export default function NewTask({ repos, options, defaults, onCreate, onClose }) {
  const [title, setTitle] = useState('')
  const [repo, setRepo] = useState(repos[0] || '')
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
      await onCreate({ title, repo, prompt, model, effort, permissionMode, autoApprove })
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

      <Field label="Repo" hint="One repo per task. Work that spans two needs two tasks.">
        <select className={inputClass} value={repo} onChange={(e) => setRepo(e.target.value)} required>
          {repos.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </Field>

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
