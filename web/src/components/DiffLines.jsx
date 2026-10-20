import { parsePatch } from '../diff.js'

const ROW = {
  add: 'bg-ok/[0.09]',
  del: 'bg-bad/[0.09]',
  hunk: 'bg-raised text-muted',
}

const NUM = { add: 'text-[#4F7A5C]', del: 'text-[#8A5A5A]' }

/** A unified patch in the artboard's two-gutter form. */
export default function DiffLines({ patch, single = false }) {
  const lines = parsePatch(patch)
  if (!lines.length) return <p className="px-4 py-3 text-xs text-muted">No textual change.</p>

  return (
    <div className="overflow-x-auto py-2 font-mono text-[12.5px] leading-[1.85]">
      {lines.map((line, i) => {
        if (line.type === 'hunk') {
          return (
            <div key={i} className={`flex pr-4 whitespace-pre ${ROW.hunk}`}>
              <span className="w-[88px] flex-none" />
              <span>{line.text}</span>
            </div>
          )
        }
        const num = NUM[line.type] || 'text-faint'
        return (
          <div key={i} className={`flex pr-4 whitespace-pre ${ROW[line.type] || ''}`}>
            {single ? (
              <span className={`w-11 flex-none pr-3 text-right ${num}`}>{line.newNo ?? line.oldNo ?? ''}</span>
            ) : (
              <>
                <span className={`w-10 flex-none text-right ${num}`}>{line.oldNo ?? ''}</span>
                <span className={`w-10 flex-none pr-2 text-right ${num}`}>{line.newNo ?? ''}</span>
              </>
            )}
            <span
              className={`w-4 flex-none ${line.type === 'add' ? 'text-ok' : line.type === 'del' ? 'text-bad' : ''}`}
            >
              {line.type === 'add' ? '+' : line.type === 'del' ? '−' : ''}
            </span>
            <span className={line.type === 'del' ? 'text-[#E7C6C6]' : 'text-ink-2'}>{line.text || ' '}</span>
          </div>
        )
      })}
    </div>
  )
}
