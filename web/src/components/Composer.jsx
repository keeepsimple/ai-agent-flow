import { useEffect, useState } from 'react'
import { IconArrowUp, IconClock, IconPaperclip, IconPencil, IconX } from '@tabler/icons-react'
import { AttachStrip, Picker, inputClass, useAttachments } from './bits.jsx'
import { api } from '../api.js'

function Queued({ task, onError }) {
  const queue = task.queued || []
  const [at, setAt] = useState(null)
  const [draft, setDraft] = useState('')
  if (!queue.length) return null

  const save = async (i) => {
    const text = draft.trim()
    if (!text) return setAt(null)
    setAt(null)
    try {
      await api.editQueued(task.id, i, text)
    } catch (err) {
      onError(err.message)
    }
  }

  return (
    <ul className="mb-2.5 flex list-none flex-col gap-1.5 p-0">
      {queue.map((text, i) => (
        <li
          key={i}
          className="flex items-start gap-2.5 rounded-xl border border-line bg-raised px-3.5 py-2.5 shadow-e1"
        >
          <IconClock size={14} className="mt-0.5 shrink-0 text-muted" />
          {at === i ? (
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => save(i)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') save(i)
                if (e.key === 'Escape') setAt(null)
              }}
              className={`${inputClass} flex-1 py-1 text-[13px]`}
            />
          ) : (
            <span className="flex-1 text-[13px] break-words text-ink-3">{text}</span>
          )}
          <span className="font-mono text-[11px] text-muted">{i + 1}/{queue.length}</span>
          <button
            type="button"
            aria-label="Edit"
            onClick={() => { setDraft(text); setAt(i) }}
            className="cursor-pointer text-muted transition-colors duration-200 ease-smooth hover:text-ink"
          >
            <IconPencil size={13} />
          </button>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => api.dropQueued(task.id, i).catch((e) => onError(e.message))}
            className="cursor-pointer text-muted transition-colors duration-200 ease-smooth hover:text-bad"
          >
            <IconX size={13} />
          </button>
        </li>
      ))}
    </ul>
  )
}

/** The prompt box at the foot of the workspace: a follow-up on this task. */
export default function Composer({ task, flow, onError }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const attach = useAttachments()
  // Optimistic: the select should move under the pointer, not a round trip
  // later. It goes back if the server will not have it.
  const [model, setModel] = useState(task.model || '')
  const [effort, setEffort] = useState(task.effort || '')
  useEffect(() => setModel(task.model || ''), [task.model])
  useEffect(() => setEffort(task.effort || ''), [task.effort])

  const change = (set, was, send) => async (next) => {
    set(next)
    try {
      await send(next)
    } catch (err) {
      set(was)
      onError(err.message)
    }
  }
  const changeModel = change(setModel, model, (m) => api.setModel(task.id, m))
  const changeEffort = change(setEffort, effort, (e) => api.setEffort(task.id, e))
  // The worktree being dropped no longer blocks this: asking for one more
  // thing checks the branches back out.
  const dropped = !task.root
  const running = ['running', 'queued'].includes(task.status)

  const send = async () => {
    if (!text.trim() || busy || running) return
    setBusy(true)
    try {
      await api.followUp(task.id, [text.trim(), ...attach.paths.map((p) => `Attached: ${p}`)].join('\n'))
      setText('')
      attach.clear()
    } catch (err) {
      onError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-[720px] shrink-0 px-6 pt-3 pb-5">
      <Queued task={task} onError={onError} />
      <div
        onDrop={attach.onDrop}
        onDragOver={attach.onDragOver}
        onDragLeave={attach.onDragLeave}
        className={`rounded-2xl border bg-input p-3.5 shadow-e3 transition-all duration-300 ease-smooth
                    focus-within:border-accent/60
                    focus-within:shadow-[inset_0_1px_0_rgb(255_255_255/0.06),0_2px_6px_rgb(0_0_0/0.4),0_18px_44px_-14px_rgb(0_0_0/0.8),0_0_0_4px_color-mix(in_srgb,var(--color-accent)_14%,transparent)]
                    ${attach.dragging
                      ? 'border-accent shadow-[0_0_0_4px_color-mix(in_srgb,var(--color-accent)_25%,transparent)]'
                      : 'border-line-strong'}`}
      >
        <label htmlFor="prompt" className="sr-only">Message Tern</label>
        <textarea
          id="prompt"
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={attach.onPaste}
          onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && send()}
          placeholder={
            running
              ? 'Tern is working. This box opens when it stops.'
              : dropped
                ? 'The worktree was dropped. Asking for something checks it back out.'
                : 'Ask for a change. Paste a screenshot or an error straight in.'
          }
          className="field-bare w-full resize-none field-sizing-content min-h-[2lh] max-h-[40vh] border-0 bg-transparent outline-none placeholder:text-faint"
        />
        <AttachStrip files={attach.files} onRemove={attach.remove} size="h-12 w-16" />
        {attach.error && <p className="mt-1 text-[11px] text-bad">{attach.error}</p>}
        {attach.picker}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {task.trees?.map((tree) => (
            <span
              key={tree.repo}
              className="inline-flex h-7 items-center rounded-full border border-line bg-selected px-2.5
                         font-mono text-xs text-ink-3 shadow-e1"
            >
              @{tree.repo}
            </span>
          ))}
          {flow?.options?.models && (
            <Picker
              value={model}
              options={flow.options.models}
              onPick={changeModel}
              title="The model the next run uses"
              label={(m) =>
                m || (flow.defaults?.cliModel ? `CLI default (${flow.defaults.cliModel})` : 'CLI default')
              }
            />
          )}
          {flow?.options?.efforts && (
            <Picker
              value={effort}
              options={flow.options.efforts}
              onPick={changeEffort}
              title="How hard the next run thinks"
              label={(e) => (e ? `${e} effort` : 'default effort')}
            />
          )}
          <div className="flex-1" />
          <span className="font-mono text-[10px] text-muted">⌘↵</span>
          <button
            type="button"
            aria-label="Attach a file"
            onClick={attach.pick}
            title="Attach a screenshot, a log, a diff"
            className="flex size-9 cursor-pointer items-center justify-center rounded-full text-muted
                       transition-all duration-200 ease-smooth hover:bg-selected hover:text-ink"
          >
            <IconPaperclip size={16} />
          </button>
          <button
            type="button"
            aria-label="Send"
            onClick={send}
            disabled={busy || running || !text.trim()}
            className="flex size-9 cursor-pointer items-center justify-center rounded-full bg-accent
                       text-on-accent shadow-accent transition-all duration-200 ease-smooth
                       hover:scale-105 hover:shadow-accent-lift active:scale-95
                       disabled:scale-100 disabled:opacity-30 disabled:shadow-none"
          >
            <IconArrowUp size={16} stroke={2.4} />
          </button>
        </div>
      </div>
    </div>
  )
}
