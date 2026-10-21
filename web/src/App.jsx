import { useEffect } from 'react'
import { IconX } from '@tabler/icons-react'
import { useFlow } from './api.js'
import { useRoute } from './router.js'
import Sessions from './routes/Sessions.jsx'
import Workspace from './routes/Workspace.jsx'
import Review from './routes/Review.jsx'
import Header from './components/Header.jsx'

export default function App() {
  const route = useRoute()
  const flow = useFlow(route.taskId)
  const task = route.taskId ? flow.detail : null

  // An error that waits to be clicked outlives whatever it was about, and the
  // next click lands on a stale one. The X still works for reading it sooner.
  const { error, setError } = flow
  useEffect(() => {
    if (!error) return
    const timer = setTimeout(() => setError(null), 5000)
    return () => clearTimeout(timer)
  }, [error, setError])

  let screen
  if (route.name === 'sessions') {
    screen = <Sessions flow={flow} />
  } else if (!task || task.id !== route.taskId) {
    // The task is being read; keep the frame so the page does not flash.
    screen = (
      <>
        <Header active={route.name} />
        <div className="flex min-h-0 flex-1 items-center justify-center text-muted">Loading…</div>
      </>
    )
  } else if (route.name === 'review') {
    screen = <Review task={task} flow={flow} />
  } else {
    screen = <Workspace task={task} flow={flow} />
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {screen}

      {flow.error && (
        <div
          role="alert"
          className="animate-fade fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3
                     rounded-full border border-bad/50 bg-input px-4 py-2.5 text-[13px] text-bad
                     shadow-[inset_0_1px_0_rgb(255_255_255/0.06),0_2px_6px_rgb(0_0_0/0.4),0_18px_44px_-14px_rgb(255_128_128/0.35)]"
        >
          <span>{flow.error}</span>
          <button
            type="button"
            onClick={() => flow.setError(null)}
            aria-label="Dismiss"
            className="cursor-pointer text-muted transition-colors duration-200 ease-smooth hover:text-ink"
          >
            <IconX size={14} />
          </button>
        </div>
      )}
    </div>
  )
}
