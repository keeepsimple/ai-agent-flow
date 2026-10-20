import { useState } from 'react'
import { IconArrowRight } from '@tabler/icons-react'
import { Button, ImageStrip, inputClass, usePastedImages } from './bits.jsx'
import { api } from '../api.js'

/**
 * Keep working on a task that has already finished: the build broke, the fix
 * missed, one more thing. Same worktrees and branches, no new task.
 */
export default function FollowUp({ task, onError }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const shots = usePastedImages()

  const dropped = !task.root
  const send = async () => {
    if (!text.trim() || busy) return
    setBusy(true)
    try {
      // Images travel as paths: the agent reads them off disk.
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
    <div className="border-t border-line px-4 py-3">
      <div className="mx-auto max-w-4xl">
        <div className="relative">
          <textarea
            className={`${inputClass} max-h-40 min-h-[44px] resize-y py-2.5 pr-24`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onPaste={shots.onPaste}
            onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && send()}
            disabled={dropped}
            placeholder={
              dropped
                ? 'The worktree was dropped, so there is nothing left to work on.'
                : 'The build is broken: pnpm typecheck fails in orders.service.ts. Paste the error.'
            }
          />
          <div className="absolute top-1.5 right-1.5">
            <Button variant="primary" disabled={busy || dropped || !text.trim()} onClick={send}>
              {busy ? 'Starting' : 'Send'} <IconArrowRight size={13} />
            </Button>
          </div>
        </div>
        <div className="mt-2 flex items-center gap-3">
          <ImageStrip images={shots.images} onRemove={shots.remove} size="h-10 w-16" />
          {shots.error && <span className="text-[11px] text-danger">{shots.error}</span>}
          <span className="ml-auto font-mono text-[10px] text-ink-faint">
            keeps the same branches · ⌘↵
          </span>
        </div>
      </div>
    </div>
  )
}
