import { useState } from 'react'
import { IconArrowUp, IconPaperclip } from '@tabler/icons-react'
import { ImageStrip, usePastedImages } from './bits.jsx'
import { api } from '../api.js'

/** The prompt box at the foot of the workspace: a follow-up on this task. */
export default function Composer({ task, onError }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const shots = usePastedImages()
  const dropped = !task.root
  const running = ['running', 'queued'].includes(task.status)

  const send = async () => {
    if (!text.trim() || busy || dropped || running) return
    setBusy(true)
    try {
      await api.followUp(task.id, [text.trim(), ...shots.paths.map((p) => `Screenshot: ${p}`)].join('\n'))
      setText('')
      shots.clear()
    } catch (err) {
      onError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-[720px] px-6 pt-3 pb-5">
      <div className="rounded-[14px] border border-line-strong bg-input p-3">
        <label htmlFor="prompt" className="sr-only">Message Tern</label>
        <textarea
          id="prompt"
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={shots.onPaste}
          onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && send()}
          disabled={dropped}
          placeholder={
            dropped
              ? 'The worktree was dropped, so there is nothing left to work on.'
              : running
                ? 'Tern is working. This box opens when it stops.'
                : 'Ask for a change. Paste a screenshot or an error straight in.'
          }
          className="w-full resize-none border-0 bg-transparent outline-none placeholder:text-faint"
        />
        <ImageStrip images={shots.images} onRemove={shots.remove} size="h-12 w-16" />
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
            aria-label="Attach"
            className="flex size-9 cursor-not-allowed items-center justify-center rounded-full text-muted"
            title="Paste an image into the box instead"
          >
            <IconPaperclip size={16} />
          </button>
          <button
            type="button"
            aria-label="Send"
            onClick={send}
            disabled={busy || dropped || running || !text.trim()}
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
