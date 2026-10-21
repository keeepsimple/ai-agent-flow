// The long route's phases, in order. `answer` is not one of them: it is the
// whole of the plain route, and listing it here put it on the end of every
// full run.
export const PHASES = ['spec', 'plan', 'implement', 'review']

/**
 * Not every change earns a spec. A one-line fix spends more on writing the
 * document than on the work, so there is a shorter route that still reviews
 * itself: the review is what catches the bug, and it is cheap next to implement.
 */
export const RUNS = [
  {
    value: 'ask',
    label: 'Normal',
    hint: 'One run, no documents and no self review. Answering a question, or a change small enough that the ceremony costs more than the work.',
    phases: ['answer'],
  },
  {
    value: 'full',
    label: 'Spec, plan, then build',
    hint: 'Writes a spec and a plan and stops for you at each, before any code moves.',
    phases: PHASES,
  },
  {
    value: 'quick',
    label: 'Just build it',
    hint: 'Straight to the work, then the same self review. No spec, no plan, no gates.',
    phases: ['implement', 'review'],
  },
  {
    value: 'doc',
    label: 'Document',
    hint: 'Writes a file, not code. No worktree; the repos are there to read.',
    phases: ['write'],
  },
]

export const phasesFor = (run) => (RUNS.find((r) => r.value === run) || RUNS[0]).phases

// Phases that stop for a human before the next one starts.
export const GATES = { spec: true, plan: true, implement: false, review: false, answer: false, write: false }

export const PHASE_LABEL = {
  spec: 'Spec',
  plan: 'Implementation plan',
  implement: 'Implement',
  review: 'Self review',
  answer: 'Working',
  write: 'Writing',
}

import { render, load } from './templates.js'

const treeTable = (ctx) =>
  ctx.trees
    .map(
      (t) => `  ${t.repo}
      worktree  ${t.worktree}
      branch    ${t.branch}
      base      ${t.baseRef}  (${t.baseBranch} when this task started)`,
    )
    .join('\n')

const indent = (text, by = '    ') => String(text || '').split('\n').map((l) => `${by}${l}`).join('\n')

/**
 * Naming the task is asked for in whichever phase runs first, so a quick run
 * with no spec still ends up with something better than the first line of the
 * request, which is often a pasted URL.
 */
function titleAsk(ctx) {
  if (ctx.namedByHuman || !ctx.needsTitle) return ''
  return render(load('title'), { artifactDir: ctx.artifactDir })
}

/** Where the kept values are, and the one rule about them. */
function secretsNote(ctx) {
  const names = ctx.secrets || []
  if (!names.length) return ''
  return render(load('secrets'), {
    noShell: ctx.permissionMode === 'acceptEdits',
    names: names.join(', '),
    lines: names.map((n) => `    {{secret:${n}}}  ->  $FLOW_SECRET_${n}`).join('\n'),
    first: names[0],
  })
}

function preamble(ctx) {
  const many = ctx.trees.length > 1
  return render(load('preamble'), {
    many,
    treeCount: ctx.trees.length,
    root: ctx.root,
    treeTable: treeTable(ctx),
    artifactDir: ctx.artifactDir,
    secretsNote: secretsNote(ctx),
    hasAttachments: Boolean(ctx.attachments?.length),
    attachmentList: (ctx.attachments || []).map((file) => `    ${file}`).join('\n'),
    autoApprove: Boolean(ctx.autoApprove),
    hasPreview: Boolean(ctx.previewScript),
    node: ctx.node,
    previewScript: ctx.previewScript || '',
    askScript: ctx.askScript,
  })
}

/** Everything a phase or a follow-up template may use. */
function phaseContext(ctx) {
  const isDoc = ctx.run === 'doc'
  return {
    isDoc,
    preamble: isDoc ? docPreamble(ctx) : preamble(ctx),
    prompt: ctx.prompt,
    workDir: `${ctx.artifactDir}/work`,
    promptIndented: indent(ctx.prompt, '   '),
    artifactDir: ctx.artifactDir,
    many: ctx.trees.length > 1,
    quick: ctx.run === 'quick',
    hasFeedback: Boolean(ctx.feedback),
    feedback: ctx.feedback || '',
    titleAsk: titleAsk(ctx),
    diffCommands: ctx.trees.map((t) => `    git -C ${t.worktree} diff ${t.baseRef}...HEAD`).join('\n'),
    requestIndented: indent(ctx.request),
  }
}

/** The document route has no worktree: its own opening instead of the preamble. */
function docPreamble(ctx) {
  return render(load('doc-preamble'), {
    workDir: ctx.root,
    repoList: (ctx.repoPaths || []).map((p) => `    ${p}`).join('\n') || '    (none)',
    artifactDir: ctx.artifactDir,
    secretsNote: secretsNote(ctx),
    hasAttachments: Boolean(ctx.attachments?.length),
    attachmentList: (ctx.attachments || []).map((file) => `    ${file}`).join('\n'),
    autoApprove: Boolean(ctx.autoApprove),
    node: ctx.node,
    askScript: ctx.askScript,
  })
}

export function buildPrompt(phase, ctx) {
  return render(load(phase), phaseContext(ctx))
}

/** What a continued session is told. It must look before it acts: the disk may differ from its memory. */
export const resumePrompt = () => load('resume').trim()

/**
 * A follow-up: the task already ran, and the human came back with something
 * else to do on the same branches. Usually "the build is broken".
 */
export function buildFollowUpPrompt(ctx) {
  return render(load('follow-up'), phaseContext(ctx))
}

const sideContext = (tree, ctx) => ({
  worktree: tree.worktree,
  branch: tree.branch,
  repo: tree.repo,
  repoPath: tree.repoPath,
  baseBranch: tree.baseBranch,
  artifactDir: ctx.artifactDir,
  node: ctx.node,
  askScript: ctx.askScript,
  guardScript: ctx.guardScript,
})

/**
 * A one-off run, outside the four phases: bring the base branch into the task's
 * branch and resolve whatever that turns up. It happens in the worktree, never
 * in the human's own checkout, so a bad resolution costs them nothing.
 */
export function buildCatchUpPrompt(tree, ctx) {
  return render(load('catch-up'), sideContext(tree, ctx))
}

/** Get this branch into the base with nothing left behind it, and a merge request on record. */
export function buildMergePrompt(tree, ctx) {
  return render(load('land'), {
    ...sideContext(tree, ctx),
    target: ctx.target || tree.baseBranch,
    hasRemote: ctx.hasRemote !== false,
  })
}

/** The task's landed commits, cherry-picked onto prod in a worktree of their own, pushed, watched. */
export function buildShipPrompt(tree, ctx) {
  return render(load('ship'), {
    ...sideContext(tree, ctx),
    prodWorktree: ctx.prodWorktree,
    prodBranch: ctx.prodBranch,
    shaList: ctx.shas.map((s) => `    ${s}`).join('\n'),
    jenkinsScript: ctx.jenkinsScript,
    hasJenkins: Boolean(ctx.jenkins),
    jenkinsUrl: ctx.jenkins?.url || '',
    jenkinsJob: ctx.jenkins?.job || '',
  })
}
