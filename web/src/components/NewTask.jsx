import { useState } from 'react'
import { Button, Field, inputClass } from './bits.jsx'

export default function NewTask({ repos, onCreate, onClose }) {
  const [title, setTitle] = useState('')
  const [repo, setRepo] = useState(repos[0] || '')
  const [prompt, setPrompt] = useState('')
  const [model, setModel] = useState('')
  const [autoApprove, setAutoApprove] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await onCreate({ title, repo, prompt, model, autoApprove })
      onClose()
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

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
        <Field label="Model" hint="Blank uses your default.">
          <select className={inputClass} value={model} onChange={(e) => setModel(e.target.value)}>
            <option value="">default</option>
            <option value="opus">opus</option>
            <option value="sonnet">sonnet</option>
            <option value="haiku">haiku</option>
          </select>
        </Field>
        <label className="flex cursor-pointer items-start gap-2 self-end pb-1">
          <input type="checkbox" className="mt-0.5 accent-accent" checked={autoApprove}
            onChange={(e) => setAutoApprove(e.target.checked)} />
          <span>
            <span className="block text-[12px] text-ink">Run unattended</span>
            <span className="block text-[11px] text-ink-faint">Skip the spec and plan gates.</span>
          </span>
        </label>
      </div>

      {error && <p className="text-[11px] text-danger">{error}</p>}

      <div className="flex gap-2">
        <Button variant="primary" type="submit" disabled={busy}>{busy ? 'Starting' : 'Start task'}</Button>
        <Button onClick={onClose}>Cancel</Button>
      </div>
    </form>
  )
}
