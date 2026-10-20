import { useState } from 'react'
import { IconFolderOff, IconTrash } from '@tabler/icons-react'
import { Button } from './bits.jsx'
import { api } from '../api.js'
import { go, to } from '../router.js'

const ACTIVE = new Set(['running', 'queued', 'awaiting_approval', 'awaiting_answer'])

/**
 * The two ways to let go of a task, kept apart on purpose.
 *
 * Dropping the worktree frees the disk and keeps everything you can read: the
 * conversation, the documents, the branches. Deleting throws the conversation
 * away as well. Neither touches a branch: that is the work.
 */
export default function TaskActions({ task, onError }) {
  const [busy, setBusy] = useState('')
  const [confirming, setConfirming] = useState(false)

  if (ACTIVE.has(task.status)) return null

  const run = async (what, fn) => {
    setBusy(what)
    try {
      await fn()
    } catch (err) {
      onError(err.message)
    } finally {
      setBusy('')
    }
  }

  return (
    <>
      {task.root && (
        <Button
          variant="quiet"
          disabled={!!busy}
          title="Frees the checkout. The conversation, the documents and the branches stay."
          onClick={() => run('drop', () => api.dropWorktree(task.id))}
        >
          <IconFolderOff size={14} /> {busy === 'drop' ? 'Dropping' : 'Drop worktree'}
        </Button>
      )}

      {confirming ? (
        <>
          <Button
            variant="danger"
            disabled={!!busy}
            onClick={() =>
              run('delete', async () => {
                await api.removeTask(task.id)
                go(to.sessions())
              })
            }
          >
            {busy === 'delete' ? 'Deleting' : 'Delete it'}
          </Button>
          <Button variant="quiet" disabled={!!busy} onClick={() => setConfirming(false)}>
            Keep
          </Button>
          <span className="text-xs text-muted">
            The conversation goes. {task.trees?.length ? 'The branches stay.' : ''}
          </span>
        </>
      ) : (
        <Button
          variant="quiet"
          disabled={!!busy}
          title="Throws away the conversation and the documents too"
          onClick={() => setConfirming(true)}
        >
          <IconTrash size={14} /> Delete
        </Button>
      )}
    </>
  )
}
