import { useCallback, useEffect, useRef, useState } from 'react'

export const taskIdFromHash = () => {
  const hash = location.hash.slice(1)
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

export const api = {
  state: () => call('GET', '/api/state'),
  task: (id) => call('GET', `/api/tasks/${id}`),
  create: (payload) => call('POST', '/api/tasks', payload),
  approve: (id, approved, feedback) => call('POST', `/api/tasks/${id}/approve`, { approved, feedback }),
  answer: (id, questionId, answer) => call('POST', `/api/tasks/${id}/answer`, { questionId, answer }),
  cancel: (id) => call('POST', `/api/tasks/${id}/cancel`),
  retry: (id) => call('POST', `/api/tasks/${id}/retry`),
  dropWorktree: (id) => call('DELETE', `/api/tasks/${id}/worktree`),
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
    if (selectedId) location.hash = selectedId
  }, [selectedId, loadDetail])

  useEffect(() => {
    const es = new EventSource('/api/events')
    es.onopen = () => setLive(true)
    es.onerror = () => setLive(false)
    es.addEventListener('task', (e) => {
      const task = JSON.parse(e.data)
      setTasks((prev) => {
        if (!prev) return prev
        const next = prev.filter((t) => t.id !== task.id)
        return [task, ...next].sort((a, b) => b.createdAt - a.createdAt)
      })
      if (task.id === selectedRef.current) setDetail((d) => (d ? { ...d, ...task } : d))
    })
    es.addEventListener('log', (e) => {
      const { id, entry } = JSON.parse(e.data)
      if (id !== selectedRef.current) return
      setDetail((d) => (d ? { ...d, log: [...d.log, entry] } : d))
    })
    return () => es.close()
  }, [])

  // Artifacts arrive as files, not events, so re-read the detail when a phase
  // boundary moves. Cheap: it is one local read.
  const phaseKey = detail ? `${detail.status}:${detail.phase}` : ''
  useEffect(() => {
    if (selectedId) loadDetail(selectedId)
  }, [phaseKey]) // eslint-disable-line react-hooks/exhaustive-deps

  return {
    tasks, repos, repoRoot, options, defaults, error, live, detail,
    selectedId, select: setSelectedId,
    reload: loadState,
    setError,
  }
}
