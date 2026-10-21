import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// The template language is two things: {{name}} and {{#if name}}…{{else}}…{{/if}}.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-templates-'))
process.env.FLOW_DATA = tmp
const { render, placeholders, load, KNOWN } = await import('./templates.js')

assert.equal(render('a {{x}} {{#if y}}Y{{else}}N{{/if}}', { x: 1, y: false }), 'a 1 N')
assert.equal(render('{{#if y}}Y{{else}}N{{/if}}', { y: true }), 'Y')
assert.equal(render('{{#if y}}Y{{/if}}!', { y: false }), '!', 'no else is fine')
assert.equal(render('{{#if a}}A{{#if b}}B{{else}}b{{/if}}{{/if}}', { a: true, b: false }), 'Ab', 'nesting')
assert.equal(render('{{#if list}}has{{/if}}', { list: '' }), '', 'an empty string is false')
assert.equal(render('{{missing}}', {}), '', 'a missing value renders empty rather than "undefined"')
assert.equal(render('keep {{secret:NAME}} as is', {}), 'keep {{secret:NAME}} as is', 'only identifiers are placeholders')
assert.deepEqual(placeholders('a {{x}} {{#if y}}Y{{else}}N{{/if}} {{x}} {{secret:Z}}'), ['x', 'y'])
assert.throws(() => render('{{#if a}}open', {}), /unclosed/i)

// Defaults live in prompt-defaults/; an override in <data>/prompts/<name>.md
// wins when every placeholder it uses is one the prompt is given.
assert.ok(KNOWN.answer.includes('prompt'))
assert.match(load('answer'), /What the human asked/)
fs.mkdirSync(path.join(tmp, 'prompts'), { recursive: true })
fs.writeFileSync(path.join(tmp, 'prompts', 'answer.md'), 'mine: {{prompt}}')
assert.equal(load('answer'), 'mine: {{prompt}}')
const warned = []
fs.writeFileSync(path.join(tmp, 'prompts', 'answer.md'), 'broken: {{nope}}')
assert.match(load('answer', { warn: (m) => warned.push(m) }), /What the human asked/, 'a broken override falls back')
assert.match(load('answer', { warn: (m) => warned.push(m) }), /What the human asked/)
assert.equal(warned.length, 1, 'and is warned about once')
assert.match(warned[0], /prompt override answer uses unknown \{\{nope\}\}; using default/)
assert.throws(() => load('nothing-here'), /unknown prompt/)
// A hand-edited override with broken syntax must not take a task down at start.
fs.writeFileSync(path.join(tmp, 'prompts', 'answer.md'), 'open {{#if prompt}}never closed')
const warned2 = []
assert.match(load('answer', { warn: (m) => warned2.push(m) }), /What the human asked/, 'bad syntax falls back')
assert.equal(warned2.length, 1)
assert.match(warned2[0], /unclosed/)

fs.rmSync(tmp, { recursive: true, force: true })
console.log('ok: templates render, placeholders are listed, overrides load and broken ones fall back')

// Every default renders and carries the line that makes it do its job.
const { defaultOf } = await import('./templates.js')
const has = (name, marker) => assert.ok(defaultOf(name).includes(marker), `${name} should say: ${marker}`)
has('preamble', 'Read files with the Read tool')
has('spec', 'can run or click')
has('implement', 'name the test that guards it')
has('implement', 'baseline/')
has('review', 'trace one real path')
has('review', '6. Guarded')
has('review', '## Left')
has('review', 'fixable:')
has('review', 'decision:')
has('review', 'found / fixed / left-fixable / left-decision')
has('follow-up', 'Branch state:')
console.log('ok: the agents are told to prove, guard, compare against base, and say where the branch stands')
