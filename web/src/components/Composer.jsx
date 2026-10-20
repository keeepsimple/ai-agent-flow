import { useState } from 'react'
import { IconArrowUp, IconPaperclip } from '@tabler/icons-react'
import { AttachStrip, useAttachments } from './bits.jsx'
import { api } from '../api.js'

/** The prompt box at the foot of the workspace: a follow-up on this task. */
export default function Composer({ task, onError }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const attach = useAttachments()
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
      <div
        onDrop={attach.onDrop}
        onDragOver={attach.onDragOver}
        onDragLeave={attach.onDragLeave}
        className={`rounded-2xl border bg-input p-3.5 transition-colors duration-150
                    focus-within:border-accent/60 focus-within:ring-2 focus-within:ring-accent/15
                    ${attach.dragging ? 'border-accent ring-2 ring-accent/25' : 'border-line-strong'}`}
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
              className="inline-flex h-7 items-center rounded-md bg-selected px-2 font-mono text-xs text-ink-3"
            >
              @{tree.repo}
            </span>
          ))}
          <div className="flex-1" />
          <span className="font-mono text-[10px] text-muted">⌘↵</span>
          <button
            type="button"
            aria-label="Attach a file"
            onClick={attach.pick}
            title="Attach a screenshot, a log, a diff"
            className="flex size-9 cursor-pointer items-center justify-center rounded-full text-muted
                       transition-colors duration-150 hover:text-ink"
          >
            <IconPaperclip size={16} />
          </button>
          <button
            type="button"
            aria-label="Send"
            onClick={send}
            disabled={busy || running || !text.trim()}
            className="flex size-9 cursor-pointer items-center justify-center rounded-full bg-accent
                       text-on-accent transition-opacity duration-150 disabled:opacity-30"
          >
            <IconArrowUp size={16} stroke={2.4} />
          </button>
        </div>
      </div>
    </div>
  )
}
