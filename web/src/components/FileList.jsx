import { Eyebrow, Stat } from './bits.jsx'

// git's status letter, in the artboard's colours.
//
// These rows keep the soft 6px rather than the pill the controls use: a pill
// around a file path wastes the width the path needs, and a list is not a
// row of buttons.
const MARK = { A: 'text-ok', D: 'text-bad', M: 'text-warn' }

export function markOf(file) {
  if (file.removed === 0 && file.added > 0) return 'A'
  if (file.added === 0 && file.removed > 0) return 'D'
  return 'M'
}

/** Changed files, grouped per repo. Nothing else is known to have changed. */
export default function FileList({ repos, selected, onSelect, title = 'Changed files', aside }) {
  const total = repos.reduce((n, r) => n + r.files.length, 0)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between px-2">
        <Eyebrow>{title}</Eyebrow>
        <span className="font-mono text-[11px] text-accent">{aside ?? `${total} changed`}</span>
      </div>

      {repos.map((repo) => (
        <div key={repo.repo} className="flex flex-col">
          {repos.length > 1 && (
            <div className="truncate px-2 py-1 font-mono text-[11px] text-muted">{repo.repo}</div>
          )}
          {repo.files.map((file) => {
            const key = `${repo.repo}:${file.path}`
            const on = key === selected
            const mark = markOf(file)
            return (
              <button
                key={key}
                type="button"
                onClick={() => onSelect(key)}
                className={`flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2 text-left
                            font-mono text-xs transition-colors duration-200 ease-smooth
                            ${on
                              ? 'bg-selected text-ink shadow-[inset_2px_0_0_var(--color-accent)]'
                              : 'text-ink-3 hover:bg-selected/60 hover:text-ink'}`}
              >
                <span className={`w-3 shrink-0 ${MARK[mark]}`}>{mark}</span>
                <span className="flex-1 truncate" title={file.path}>{file.path.split('/').pop()}</span>
                <Stat added={file.added} removed={file.removed} className="shrink-0 text-[11px]" />
              </button>
            )
          })}
        </div>
      ))}

      {!total && <p className="px-2 text-xs text-muted">Nothing has changed yet.</p>}
    </div>
  )
}
