import { useCallback, useEffect, useRef, useState } from 'react'

export const taskIdFromHash = () => {
  const hash = location.hash.slice(1).split('/')[0]
  return hash && hash !== 'new' ? hash : null
}

async function call(method, url, payload) {
  const res = await fetch(url, {
    method,
    headers: payload ? { 'Content-Type': 'application/json' } : undefined,
    body: payload ? JSON.stringify(payload) : undefined,
  })
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) throw new Error(data?.error || `${res.status} ${res.statusText}`)
  return data
}

async function upload(file) {
  const res = await fetch('/api/uploads', {
    method: 'POST',
    headers: { 'X-Filename': file.name || 'pasted' },
    body: file,
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error || 'upload failed')
  return data
}

export const api = {
  upload,
  state: () => call('GET', '/api/state'),
  task: (id) => call('GET', `/api/tasks/${id}`),
  create: (payload) => call('POST', '/api/tasks', payload),
  approve: (id, approved, feedback) => call('POST', `/api/tasks/${id}/approve`, { approved, feedback }),
  answer: (id, questionId, answer) => call('POST', `/api/tasks/${id}/answer`, { questionId, answer }),
  cancel: (id) => call('POST', `/api/tasks/${id}/cancel`),
  retry: (id) => call('POST', `/api/tasks/${id}/retry`),
  dropWorktree: (id) => call('DELETE', `/api/tasks/${id}/worktree`),
  push: (id, repo, base = false) => call('POST', `/api/tasks/${id}/push`, { repo, base }),
  merge: (id, repo) => call('POST', `/api/tasks/${id}/merge`, { repo }),
  catchUp: (id, repo) => call('POST', `/api/tasks/${id}/catch-up`, { repo }),
}

export function useFlow() {
  const [tasks, setTasks] = useState(null)
  const [repos, setRepos] = useState([])
  const [repoRoot, setRepoRoot] = useState('')
  const [options, setOptions] = useState(null)
  const [defaults, setDefaults] = useState(null)
  const [error, setError] = useState(null)
  const [selectedId, setSelectedId] = useState(() => taskIdFromHash())
  const [detail, setDetail] = useState(null)
  const [live, setLive] = useState(false)
  const [notifications, setNotifications] = useState(
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
  )
  const selectedRef = useRef(null)
  selectedRef.current = selectedId

  const loadState = useCallback(() => {
    api.state()
      .then((s) => {
        setTasks(s.tasks)
        setRepos(s.repos)
        setRepoRoot(s.repoRoot)
        setOptions(s.options)
        setDefaults(s.defaults)
        setError(null)
      })
      .catch((e) => setError(e.message))
  }, [])

  const loadDetail = useCallback((id) => {
    if (!id) return setDetail(null)
    api.task(id).then(setDetail).catch((e) => setError(e.message))
  }, [])

  useEffect(loadState, [loadState])
  useEffect(() => {
    loadDetail(selectedId)
    // Deep link, so a task survives a reload and can be shared as a URL.
    if (selectedId && taskIdFromHash() !== selectedId) location.hash = selectedId
  }, [selectedId, loadDetail])

  useEffect(() => {
    const es = new EventSource('/api/events')
    es.onerror = () => setLive(false)
    es.onopen = () => {
      setLive(true)
      // The stream drops when the server restarts, and everything that happened
      // in between is missed. Without this the tab keeps showing a question
      // nobody is waiting on any more, and you type an answer into nothing.
      loadState()
      if (selectedRef.current) loadDetail(selectedRef.current)
    }
    es.addEventListener('task', (e) => {
      const task = JSON.parse(e.data)
      setTasks((prev) => {
        if (!prev) return prev
        const next = prev.filter((t) => t.id !== task.id)
        return [task, ...next].sort((a, b) => b.createdAt - a.createdAt)
      })
      if (task.id === selectedRef.current) setDetail((d) => (d ? { ...d, ...task } : d))
    })
    // Raised by the tab rather than the server, because a notification the tab
    // owns can focus this window and open the task when it is clicked. The
    // server only falls back to a desktop one when no tab is listening.
    es.addEventListener('notify', (e) => {
      if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
      const { taskId, title, body } = JSON.parse(e.data)
      const note = new Notification(title, { body, tag: taskId, icon: '/icon.svg' })
      note.onclick = () => {
        window.focus()
        setSelectedId(taskId)
        note.close()
      }
    })
    es.addEventListener('log', (e) => {
      const { id, entry } = JSON.parse(e.data)
      if (id !== selectedRef.current) return
      setDetail((d) => (d ? { ...d, log: [...d.log, entry] } : d))
    })
    return () => es.close()
  }, [loadState, loadDetail])

  // Artifacts arrive as files, not events, so re-read the detail when a phase
  // boundary moves. Cheap: it is one local read.
  const phaseKey = detail ? `${detail.status}:${detail.phase}` : ''
  useEffect(() => {
    if (selectedId) loadDetail(selectedId)
  }, [phaseKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const askForNotifications = useCallback(async () => {
    if (typeof Notification === 'undefined') return
    setNotifications(await Notification.requestPermission())
  }, [])

  return {
    tasks, repos, repoRoot, options, defaults, error, live, detail,
    selectedId, select: setSelectedId,
    notifications, askForNotifications,
    reload: loadState,
    setError,
  }
}
