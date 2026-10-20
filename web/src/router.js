import { useEffect, useState } from 'react'

/**
 * Three screens, addressable. Hash routing because the server serves one file
 * and a router dependency would buy nothing here.
 *
 *   #/                  Sessions
 *   #/t/<id>            Workspace
 *   #/t/<id>/review     Review
 */
export function parse(hash = location.hash) {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean)
  if (parts[0] === 't' && parts[1]) {
    return { name: parts[2] === 'review' ? 'review' : 'workspace', taskId: parts[1] }
  }
  if (parts[0] === 'new') return { name: 'sessions', composing: true }
  return { name: 'sessions' }
}

export const to = {
  sessions: () => '#/',
  workspace: (id) => `#/t/${id}`,
  review: (id) => `#/t/${id}/review`,
}

export const go = (href) => { location.hash = href.replace(/^#/, '') }

export function useRoute() {
  const [route, setRoute] = useState(() => parse())
  useEffect(() => {
    const onHash = () => setRoute(parse())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  return route
}
