import { useState } from 'react'
import { IconAlertTriangle, IconMessageQuestion } from '@tabler/icons-react'
import { AttachStrip, Button, inputClass, useAttachments } from './bits.jsx'
import { api } from '../api.js'

const GATE = {
  spec: 'The spec is written. Read it before the plan gets built on top of it.',
  plan: 'The plan is written. Approving this starts the implementation.',
}

/** The warn-bordered card the artboard uses for anything blocking on you. */
export default function Decision({ task, onError }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const attach = useAttachments()

  const withImages = () =>
    [text.trim(), ...attach.paths.map((p) => `Attached: ${p}`)].filter(Boolean).join('\n')

  const run = async (fn) => {
    setBusy(true)
    try {
      await fn()
      setText('')
      attach.clear()
    } catch (err) {
      onError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const gate = task.status === 'awaiting_approval'
  const open = (task.questions || []).filter((q) => q.answer === null)
  const question = task.openQuestionId
    ? open.find((q) => q.id === task.openQuestionId)
    : open.at(-1)

  if (!gate && !question) return null

  return (
    <section className="flex flex-col gap-2.5 rounded-xl border border-warn-line bg-warn-bg p-3.5">
      <div className="flex items-center gap-2 text-[13px] font-medium text-warn">
        {gate ? <IconAlertTriangle size={14} /> : <IconMessageQuestion size={14} />}
        {gate ? `Your call: ${task.awaitingPhase}` : 'Tern needs an answer'}
      </div>

      <div className="text-[13px] break-words whitespace-pre-wrap text-ink-2">
        {gate ? GATE[task.awaitingPhase] : question.text}
      </div>

      <textarea
        rows={2}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onPaste={attach.onPaste}
        placeholder={gate ? 'Optional. Anything here overrides the document.' : 'Your answer. Screenshots can be pasted in.'}
        className={`${inputClass} resize-y bg-page font-mono`}
      />
      <AttachStrip files={attach.files} onRemove={attach.remove} size="h-12 w-16" />
      {attach.picker}
      {attach.error && <span className="text-[11px] text-bad">{attach.error}</span>}

      <div className="flex flex-wrap gap-2">
        {gate ? (
          <>
            <Button variant="primary" disabled={busy} onClick={() => run(() => api.approve(task.id, true, withImages()))}>
              {text.trim() || attach.files.length ? 'Approve with feedback' : 'Approve'}
            </Button>
            <Button variant="danger" disabled={busy} onClick={() => run(() => api.approve(task.id, false, withImages()))}>
              Reject and stop
            </Button>
          </>
        ) : (
          <Button
            variant="primary"
            disabled={busy || (!text.trim() && !attach.files.length)}
            onClick={() => run(() => api.answer(task.id, question.id, withImages()))}
          >
            Send answer
          </Button>
        )}
      </div>
    </section>
  )
}
