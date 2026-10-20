import { useState } from 'react'
import { IconHandStop, IconMessageQuestion } from '@tabler/icons-react'
import { Button, Field, inputClass } from './bits.jsx'

const GATE_COPY = {
  spec: 'The spec is written. Read it before the plan gets built on top of it.',
  plan: 'The plan is written. Approving this starts the implementation.',
}

export default function Decision({ task, onApprove, onAnswer }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const run = async (fn) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      setText('')
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  if (task.status === 'awaiting_approval') {
    const phase = task.awaitingPhase
    return (
      <section className="rounded-md border border-warn/40 bg-warn/5 p-3">
        <header className="flex items-center gap-2 text-warn">
          <IconHandStop size={16} stroke={1.8} />
          <h2 className="text-[13px] font-semibold">Your call: {phase}</h2>
        </header>
        <p className="mt-1 mb-3 text-[12px] text-ink-dim">{GATE_COPY[phase]}</p>
        <Field label="Feedback" hint="Optional. Anything here overrides the document in the next phase.">
          <textarea
            className={`${inputClass} min-h-[72px] resize-y font-mono`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Keep the scope to the admin side. Skip the migration for now."
          />
        </Field>
        {error && <p className="mt-2 text-[11px] text-danger">{error}</p>}
        <div className="mt-3 flex gap-2">
          <Button variant="primary" disabled={busy} onClick={() => run(() => onApprove(true, text))}>
            {text.trim() ? 'Approve with feedback' : 'Approve'}
          </Button>
          <Button variant="danger" disabled={busy} onClick={() => run(() => onApprove(false, text))}>
            Reject and stop
          </Button>
        </div>
      </section>
    )
  }

  const open = task.questions?.find((q) => q.answer === null)
  if (task.status === 'awaiting_answer' && open) {
    return (
      <section className="rounded-md border border-warn/40 bg-warn/5 p-3">
        <header className="flex items-center gap-2 text-warn">
          <IconMessageQuestion size={16} stroke={1.8} />
          <h2 className="text-[13px] font-semibold">The agent is blocked on a question</h2>
        </header>
        <p className="mt-1 mb-3 text-[13px] whitespace-pre-wrap text-ink">{open.text}</p>
        <Field label="Answer" error={error}>
          <textarea
            className={`${inputClass} min-h-[72px] resize-y font-mono`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoFocus
          />
        </Field>
        <div className="mt-3">
          <Button
            variant="primary"
            disabled={busy || !text.trim()}
            onClick={() => run(() => onAnswer(open.id, text))}
          >
            Send answer
          </Button>
        </div>
      </section>
    )
  }

  return null
}
