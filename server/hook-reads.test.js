import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { isBareRead } from './hook-reads.mjs'

for (const c of ['cat a.ts', 'cat "a b.ts"', 'sed -n 1,40p a.ts', 'sed -n 12p x', 'head -20 a', 'tail -n 5 a', 'less a', 'bat src/x.js', '  cat a.ts  ']) {
  assert.ok(isBareRead(c), `bare read: ${c}`)
}
for (const c of ['cat a | grep x', "cat > f <<'EOF'", 'cat a && ls', "sed -i '' 's/a/b/' f", 'grep -n foo a', 'cat a > b', 'cat a; ls', 'ls -la', 'sed -n 1p a | head', 'cat < a', 'node x.js', 'git diff', 'catalog list']) {
  assert.ok(!isBareRead(c), `not a bare read: ${c}`)
}

// The hook itself: stdin is the hook event; exit 2 refuses with the reason on stderr.
const hook = path.join(import.meta.dirname, 'hook-reads.mjs')
const run = (event) => {
  try {
    execFileSync(process.execPath, [hook], { input: JSON.stringify(event), stdio: ['pipe', 'pipe', 'pipe'] })
    return { code: 0 }
  } catch (err) { return { code: err.status, err: String(err.stderr) } }
}
const refused = run({ tool_name: 'Bash', tool_input: { command: 'cat src/x.ts' } })
assert.equal(refused.code, 2)
assert.match(refused.err, /Read files with the Read tool, not the shell/)
assert.equal(run({ tool_name: 'Bash', tool_input: { command: 'ls' } }).code, 0)
assert.equal(run({ tool_name: 'Read', tool_input: { file_path: 'x' } }).code, 0)
assert.equal(run({}).code, 0, 'garbage never blocks')
console.log('ok: a bare shell read is refused, everything else passes')
