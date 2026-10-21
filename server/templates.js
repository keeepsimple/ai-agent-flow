// The prompt templates: {{name}} and {{#if name}}…{{else}}…{{/if}}, nothing
// else. Defaults ship in prompt-defaults/; a person's override lives at
// <data>/prompts/<name>.md and wins when every placeholder it uses is one the
// prompt is actually given. Only identifiers are placeholders, so the
// {{secret:NAME}} markers in prompt text pass through untouched.
import fs from 'node:fs'
import path from 'node:path'

const DATA = process.env.FLOW_DATA || path.join(import.meta.dirname, '..', 'data')
export const DEFAULTS_DIR = path.join(import.meta.dirname, 'prompt-defaults')
export const OVERRIDES_DIR = path.join(DATA, 'prompts')

/** What each prompt is given. The API shows these; load() checks overrides against them. */
export const KNOWN = {
  preamble: ['many', 'treeCount', 'root', 'treeTable', 'artifactDir', 'secretsNote', 'checksNote', 'hasAttachments', 'attachmentList', 'autoApprove', 'hasPreview', 'node', 'previewScript', 'askScript'],
  title: ['artifactDir'],
  secrets: ['noShell', 'names', 'lines', 'first'],
  answer: ['preamble', 'prompt', 'workDir', 'titleAsk'],
  spec: ['preamble', 'prompt', 'artifactDir', 'many', 'titleAsk'],
  plan: ['preamble', 'artifactDir', 'hasFeedback', 'feedback'],
  implement: ['preamble', 'quick', 'prompt', 'artifactDir', 'hasFeedback', 'feedback', 'titleAsk'],
  review: ['preamble', 'diffCommands', 'quick', 'promptIndented', 'artifactDir'],
  'follow-up': ['preamble', 'artifactDir', 'requestIndented', 'isDoc'],
  'catch-up': ['worktree', 'branch', 'repo', 'baseBranch', 'artifactDir', 'node', 'askScript'],
  land: ['worktree', 'branch', 'repo', 'repoPath', 'baseBranch', 'baseRef', 'target', 'hasRemote', 'artifactDir', 'node', 'askScript', 'guardScript'],
  ship: ['prodWorktree', 'prodBranch', 'repo', 'repoPath', 'branch', 'baseBranch', 'shaList', 'artifactDir', 'node', 'askScript', 'guardScript', 'jenkinsScript', 'hasJenkins', 'jenkinsUrl', 'jenkinsJob', 'hasSmoke', 'smoke'],
  resume: [],
  'doc-preamble': ['workDir', 'repoList', 'artifactDir', 'secretsNote', 'hasAttachments', 'attachmentList', 'autoApprove', 'node', 'askScript'],
  write: ['preamble', 'prompt', 'titleAsk', 'autoApprove', 'node', 'askScript'],
}

/** One line each, for the Prompts screen. */
export const ABOUT = {
  preamble: 'The opening every phase and follow-up gets: worktrees, artifacts, attachments, how to ask.',
  title: 'Asked once per task, in whichever phase runs first, when the human gave no title.',
  secrets: 'Added to the preamble when the task has kept secrets.',
  answer: 'The plain route: one run, no documents, no review.',
  spec: 'The spec phase of the full route.',
  plan: 'The plan phase of the full route.',
  implement: 'The implement phase, on the full and the quick route.',
  review: 'The self-review phase.',
  'follow-up': 'A follow-up on a finished task.',
  'catch-up': 'Catch up: merge the base branch into the task branch, in the worktree.',
  land: 'Land: catch up, checks, guard, push, merge request, fast-forward the base.',
  ship: 'Ship to prod: cherry-pick onto the prod branch, checks, guard, push, watch Jenkins.',
  resume: 'What a continued session is told after an interruption.',
  'doc-preamble': 'The opening a document task and its follow-ups get: the work folder, the repos to read, how to ask.',
  write: 'The document route: a file, not code; no worktree; the repos there to read.',
}

const TOKEN = /\{\{(?:(#if)[ \t]+([A-Za-z_][A-Za-z0-9_]*)|(else)|(\/if)|([A-Za-z_][A-Za-z0-9_]*))\}\}/g

function tokenize(template) {
  const tokens = []
  let last = 0
  for (const m of template.matchAll(TOKEN)) {
    if (m.index > last) tokens.push({ text: template.slice(last, m.index) })
    if (m[1]) tokens.push({ open: m[2] })
    else if (m[3]) tokens.push({ else: true })
    else if (m[4]) tokens.push({ end: true })
    else tokens.push({ name: m[5] })
    last = m.index + m[0].length
  }
  if (last < template.length) tokens.push({ text: template.slice(last) })
  return tokens
}

export function render(template, ctx = {}) {
  const tokens = tokenize(template)
  let i = 0
  const block = () => {
    let out = ''
    while (i < tokens.length) {
      const t = tokens[i++]
      if (t.text !== undefined) out += t.text
      else if (t.name !== undefined) out += ctx[t.name] ?? ''
      else if (t.open) {
        const yes = block()
        let no = { out: '', stoppedBy: yes.stoppedBy }
        if (yes.stoppedBy === 'else') no = block()
        if (no.stoppedBy !== 'end') throw new Error(`unclosed {{#if ${t.open}}}`)
        out += ctx[t.open] ? yes.out : no.out
      } else if (t.else) return { out, stoppedBy: 'else' }
      else if (t.end) return { out, stoppedBy: 'end' }
    }
    return { out, stoppedBy: null }
  }
  const top = block()
  if (top.stoppedBy) throw new Error(`stray {{${top.stoppedBy === 'else' ? 'else' : '/if'}}}`)
  return top.out
}

/** The placeholder names a template uses, in order of first appearance. */
export function placeholders(template) {
  const seen = []
  for (const t of tokenize(template)) {
    const name = t.open || t.name
    if (name && !seen.includes(name)) seen.push(name)
  }
  return seen
}

const defaults = new Map()
export function defaultOf(name) {
  if (!KNOWN[name]) throw new Error(`unknown prompt: ${name}`)
  if (!defaults.has(name)) defaults.set(name, fs.readFileSync(path.join(DEFAULTS_DIR, `${name}.md`), 'utf8'))
  return defaults.get(name)
}

export function overrideOf(name) {
  if (!KNOWN[name]) throw new Error(`unknown prompt: ${name}`)
  try { return fs.readFileSync(path.join(OVERRIDES_DIR, `${name}.md`), 'utf8') } catch { return null }
}

const warnedAbout = new Set()
export function load(name, { warn = console.warn } = {}) {
  const fallback = defaultOf(name)
  const text = overrideOf(name)
  if (text === null) return fallback
  const unknown = placeholders(text).filter((p) => !KNOWN[name].includes(p))
  let broken = unknown.length ? `uses unknown {{${unknown[0]}}}` : null
  if (!broken) {
    try { render(text, {}) } catch (err) { broken = `has a syntax error (${err.message})` }
  }
  if (broken) {
    // Once per problem, not once per name: a different breakage is news.
    const key = `${name}: ${broken}`
    if (!warnedAbout.has(key)) {
      warnedAbout.add(key)
      warn(`prompt override ${name} ${broken}; using default`)
    }
    return fallback
  }
  for (const key of warnedAbout) if (key.startsWith(`${name}: `)) warnedAbout.delete(key)
  return text
}
