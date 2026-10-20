import { useEffect, useState } from 'react'
import { IconChevronDown, IconFileDiff } from '@tabler/icons-react'
import { api } from '../api.js'

// Unified diff, coloured by the first character of each line. A real parser
// would buy nothing here: git already did the work.
const LINE = {
  '+': 'bg-accent/10 text-accent',
  '-': 'bg-danger/10 text-danger',
  '@': 'text-ink-faint',
}

function lineClass(text) {
  if (text.startsWith('+++') || text.startsWith('---')) return 'text-ink-faint'
  return LINE[text[0]] || 'text-ink-dim'
}

function File({ file, openByDefault }) {
  const [open, setOpen] = useState(openByDefault)
  // The header git writes is noise once the filename is in our own row.
  const body = file.patch?.split('\n').filter((l) => !/^(diff --git|index |new file|deleted file|similarity|rename) /.test(l))

  return (
    <li className="border-b border-line/60 last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left
                   transition-colors duration-150 hover:bg-surface-2"
      >
        <IconChevronDown
          size={13}
          className={`shrink-0 text-ink-faint transition-transform duration-200 ${open ? '' : '-rotate-90'}`}
        />
        <span className="truncate font-mono text-[11.5px] text-ink">{file.path}</span>
        <span className="ml-auto shrink-0 font-mono text-[10px]">
          <span className="text-accent">+{file.added}</span>{' '}
          <span className="text-danger">-{file.removed}</span>
        </span>
      </button>
      {open && (
        <div className="overflow-x-auto bg-surface">
          {body ? (
            <pre className="w-max min-w-full font-mono text-[11px] leading-[1.55]">
              {body.map((text, i) => (
                <div key={i} className={`px-3 ${lineClass(text)}`}>{text || ' '}</div>
              ))}
            </pre>
          ) : (
            <p className="px-3 py-2 font-mono text-[11px] text-ink-faint">
              {(file.bytes / 1024).toFixed(0)} KB of changes, too much to read here. Open the worktree.
            </p>
          )}
        </div>
      )}
    </li>
  )
}

export default function Diff({ taskId }) {
  const [repos, setRepos] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    setRepos(null)
    api.diff(taskId).then(setRepos).catch((e) => setError(e.message))
  }, [taskId])

  if (error) return <p className="px-4 py-3 text-[12px] text-danger">{error}</p>
  if (!repos) {
    return (
      <div className="space-y-2 px-4 py-3">
        {[0, 1, 2].map((i) => <div key={i} className="skeleton h-4 w-full rounded" />)}
      </div>
    )
  }

  const total = repos.reduce((n, r) => n + r.files.length, 0)
  if (!total) {
    return (
      <div className="flex flex-col items-center gap-2 py-20 text-ink-faint">
        <IconFileDiff size={28} stroke={1.5} />
        <p className="text-[13px]">Nothing has changed yet.</p>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto">
      {repos.map((repo) => {
        const added = repo.files.reduce((n, f) => n + f.added, 0)
        const removed = repo.files.reduce((n, f) => n + f.removed, 0)
        return (
          <section key={repo.repo}>
            <h3
              className="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-surface/95 px-3 py-1.5
                         font-mono text-[11px] text-ink-dim backdrop-blur"
            >
              {repo.repo}
              <span className="text-ink-faint">
                {repo.files.length} file{repo.files.length === 1 ? '' : 's'}
              </span>
              <span className="ml-auto">
                <span className="text-accent">+{added}</span> <span className="text-danger">-{removed}</span>
              </span>
            </h3>
            <ul>
              {repo.files.map((file) => (
                // Open the small ones; a big file is usually generated.
                <File key={file.path} file={file} openByDefault={repo.files.length <= 6 && file.bytes < 8000} />
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
