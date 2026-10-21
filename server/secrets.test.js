import assert from 'node:assert/strict'
import { detect, redact, placeholderNames } from './secrets.js'

const names = (text) => detect(text).map((f) => f.name)

// NAME=value on its own line, named the way the person named it.
assert.deepEqual(names('EGO_API_KEY=ck_abc123def456ghi789jkl0\nhello'), ['EGO_API_KEY'])
assert.deepEqual(names('export DB_PASSWORD="hunter2hunter2"'), ['DB_PASSWORD'])
assert.deepEqual(names('SMTP_TOKEN: abcdefgh12345678'), ['SMTP_TOKEN'])
assert.deepEqual(names('set EGO_API_KEY=ck_abc123def456ghi789jkl0 in .env.dev and go'), ['EGO_API_KEY'], 'mid-sentence too')

// Known prefixes, bare in prose.
assert.deepEqual(names('token glpat-ABCDEFGHIJKLMNOPQRST here'), ['SECRET_1'])
assert.deepEqual(names('use sk_fake_ABCDEFGHIJKLMNOPQR and ghp_ABCDEFGHIJKLMNOP1234'), ['SECRET_1', 'SECRET_2'])

// What the person wrapped by hand.
assert.deepEqual(names('the key is <<super secret thing>> ok'), ['SECRET_1'])

// Long mixed base64 runs — but not a sha, a UUID, or ordinary words.
assert.deepEqual(names('x ' + 'aB3' .repeat(14) + ' y'), ['SECRET_1'])
assert.deepEqual(names('sha 1e2cd8614d1353989b561695c331cf9efcfa15cb'), [], 'a git sha is not a secret')
assert.deepEqual(names('id 3ffed98a-7ffb-800f-9b52-cf0b48569eba'), [], 'nor a UUID')
assert.deepEqual(names('branch flow/thay-doi-create-with-ai-notifications-72bea277'), [], 'nor a branch name')
assert.deepEqual(names('the quick brown fox jumps over the lazy dog again and again'), [])
assert.deepEqual(names('https://gitlab.com/egohub/mobile-admin-shopify/-/merge_requests/875'), [])
assert.deepEqual(names('API_KEY=xxx'), [], 'too short to be a value worth hiding')

// Redaction keeps the name and the shape of the line.
const line = 'EGO_API_KEY=ck_abc123def456ghi789jkl0'
assert.equal(redact(line, detect(line)), 'EGO_API_KEY={{secret:EGO_API_KEY}}')
const two = 'a glpat-ABCDEFGHIJKLMNOPQRST b <<hide me>> c'
assert.equal(redact(two, detect(two)), 'a {{secret:SECRET_1}} b {{secret:SECRET_2}} c')
// A value that appears twice is one secret with one name.
const twice = 'TOKEN_KEY=glpat-ABCDEFGHIJKLMNOPQRST\nagain glpat-ABCDEFGHIJKLMNOPQRST'
assert.deepEqual(names(twice), ['TOKEN_KEY'])
assert.equal(redact(twice, detect(twice)), 'TOKEN_KEY={{secret:TOKEN_KEY}}\nagain {{secret:TOKEN_KEY}}')

// Placeholders read back.
assert.deepEqual(placeholderNames('x {{secret:A}} y {{secret:B}} {{secret:A}}'), ['A', 'B'])

console.log('ok: secrets are found by name, prefix, wrapper and shape; shas, UUIDs and prose are left alone')

// Kept values live in the OS keychain (macOS) or a 0600 file (elsewhere), and
// reach the agent only as FLOW_SECRET_<NAME> in its environment.
const { keep, read, forget, env } = await import('./secrets.js')
const who = 'agentflow-test'
try {
  keep(who, 'A', 'value-one')
  assert.equal(read(who, 'A'), 'value-one')
  keep(who, 'A', 'value-two') // overwrite, not duplicate
  assert.equal(read(who, 'A'), 'value-two')
  keep(who, 'B', 'other')
  assert.deepEqual(env({ id: who, secrets: ['A', 'B'] }), { FLOW_SECRET_A: 'value-two', FLOW_SECRET_B: 'other' })
  assert.deepEqual(env({ id: who, secrets: [] }), {})
  assert.deepEqual(env({ id: who }), {})
  forget(who, ['A', 'B'])
  assert.equal(read(who, 'A'), null)
  assert.equal(read(who, 'B'), null)
  assert.equal(read(who, 'NEVER'), null)
  console.log('ok: secrets are kept, read back, and forgotten')
} finally {
  forget(who, ['A', 'B'])
}

// The guard reads a diff: added lines only, numbered by hunk.
const { scanDiff, hide: hideAll } = await import('./secrets.js')
const diff = [
  'diff --git a/.env.dev b/.env.dev', '--- a/.env.dev', '+++ b/.env.dev',
  '@@ -1,3 +1,5 @@', ' A=1', '-B=2', '+B=3', ' C=4', '+DB_PASSWORD=hunter2hunter2', '+D=5',
  'diff --git a/README.md b/README.md', '--- a/README.md', '+++ b/README.md',
  '@@ -10,2 +10,3 @@', ' text', '+the value ck_test_value_1234567890 is here', ' more',
].join('\n')
assert.deepEqual(scanDiff(diff, ['ck_test_value_1234567890']), [
  { file: '.env.dev', line: 4 },
  { file: 'README.md', line: 11 },
])
assert.deepEqual(scanDiff(diff.replace('ck_test_value_1234567890', 'nothing'), []), [{ file: '.env.dev', line: 4 }])
// The guard never trips on a lockfile hash, a data URL, or a C++ template:
// in a diff only kept values, NAME=value and known prefixes count.
const lockDiff = ['+++ b/pnpm-lock.yaml', '@@ -1 +1,3 @@', '+  integrity: sha512-K7y0RiAbcDEFghijk1234567890LMNOPqrstuvWXYZabcdef==', '+  src: data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ1', '+  x = a<<b>>c'].join('\n')
assert.deepEqual(scanDiff(lockDiff, []), [], 'shapes alone do not block a push')
assert.deepEqual(scanDiff('+++ b/x\n@@ -1 +1 @@\n+DB_PASSWORD=hunter2hunter2', []), [{ file: 'x', line: 1 }], 'a named one still does')
assert.deepEqual(scanDiff('+++ b/x\n@@ -1 +1 @@\n+token glpat-ABCDEFGHIJKLMNOPQRST', []), [{ file: 'x', line: 1 }], 'and a prefixed one')
assert.deepEqual(scanDiff('+++ b/x\n@@ -1 +1 @@\n+K7y0RiAbcDEFghijk1234567890LMNOPqrstuvWXYZabcdef', ['K7y0RiAbcDEFghijk1234567890LMNOPqrstuvWXYZabcdef']), [{ file: 'x', line: 1 }], 'and a kept value')

// One list of what counts as a text attachment, with .env.* in it.
const { TEXT_ATTACHMENT } = await import('./secrets.js')
for (const f of ['/u/a.env', '/u/.env', '/u/.env.prod', '/u/x.env.local', '/u/notes.txt', '/u/c.yml', '/u/d.toml']) assert.ok(TEXT_ATTACHMENT.test(f), f)
for (const f of ['/u/a.png', '/u/b.jpg', '/u/env']) assert.ok(!TEXT_ATTACHMENT.test(f), f)

// Numbering can start after what a task already has, so a second follow-up
// does not reuse SECRET_1 for a different value.
const later = hideAll([{ key: 'p', text: 'use xoxb-ABCDEFGHIJKLMNOPQRS now' }], { start: 2 })
assert.deepEqual(later.secrets.map((s) => s.name), ['SECRET_3'])

console.log('ok: the guard reads added lines with their line numbers, and ignores shapes')

// The hand wrapper is for what a person types; a shell line with a heredoc
// and an append on it is not that, and logs never get the wrapper rule at all.
assert.deepEqual(names('cat <<EOF >> out.txt'), [], 'a heredoc feeding an append is not a wrapped secret')
assert.deepEqual(names('<< not this >>'), [], 'nor spaces at the edges')
assert.deepEqual(names('key <<abc-def-ghi>> here'), ['SECRET_1'])
assert.deepEqual(detect('key <<abc-def-ghi>> here', { wrapped: false }).map((f) => f.name), [], 'the wrapper rule can be turned off for logs')
console.log('ok: the wrapper rule is for hands, not heredocs')
