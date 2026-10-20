import { useEffect, useState } from 'react'

/**
 * The artboards expose the accent as a prop with four options; this is that
 * control. Lime is the board's default but puts near-black text on a
 * near-yellow, which is the hardest of the four to read, so sky leads here.
 */
export const ACCENTS = [
  { value: '#7dd3fc', name: 'Sky' },
  { value: '#c8f04a', name: 'Lime' },
  { value: '#c4b5fd', name: 'Violet' },
  { value: '#ffb86b', name: 'Amber' },
]

const KEY = 'tern.accent'
const valid = (v) => ACCENTS.some((a) => a.value === v)

export function useAccent() {
  const [accent, setAccent] = useState(() => {
    const saved = localStorage.getItem(KEY)
    return valid(saved) ? saved : ACCENTS[0].value
  })

  useEffect(() => {
    document.documentElement.style.setProperty('--accent', accent)
    localStorage.setItem(KEY, accent)
  }, [accent])

  return [accent, setAccent]
}
