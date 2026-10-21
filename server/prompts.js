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
]

export const phasesFor = (run) => (RUNS.find((r) => r.value === run) || RUNS[0]).phases

// Phases that stop for a human before the next one starts.
export const GATES = { spec: true, plan: true, implement: false, review: false, answer: false }

export const PHASE_LABEL = {
  spec: 'Spec',
  plan: 'Implementation plan',
  implement: 'Implement',
  review: 'Self review',
  answer: 'Working',
}

const treeTable = (ctx) =>
  ctx.trees
    .map(
      (t) => `  ${t.repo}
      worktree  ${t.worktree}
      branch    ${t.branch}
      base      ${t.baseRef}  (${t.baseBranch} when this task started)`,
    )
    .join('\n')

/**
 * Naming the task is asked for in whichever phase runs first, so a quick run
 * with no spec still ends up with something better than the first line of the
 * request, which is often a pasted URL.
 */
function titleAsk(ctx) {
  if (ctx.namedByHuman || !ctx.needsTitle) return ''
  return `
This task has no title yet: it is showing the first line of the request. Write
one short line naming what this actually turns out to be into
${ctx.artifactDir}/title.txt. Under 70 characters, no trailing full stop.

Write it in English even when the request is in another language: the branch
gets renamed to match this line, and a branch name has to survive a terminal.
`
}

function preamble(ctx) {
  const many = ctx.trees.length > 1
  return `You are running one phase of an automated workflow on ${
    many ? `${ctx.trees.length} git worktrees, one per repo` : 'an isolated git worktree'
  }.

Working directory: ${ctx.root}

${treeTable(ctx)}

Artifacts:  ${ctx.artifactDir}   (spec.md, plan.md, review.md live here, NOT in any repo)
${
  ctx.attachments?.length
    ? `
Files the human attached. Open every one with the Read tool before you decide
anything they could settle. An image is the brief, not a hint; a log or a diff
is evidence, so read it rather than guessing at what it says:
${ctx.attachments.map((file) => `    ${file}`).join('\n')}
`
    : ''
}

${
  many
    ? `This feature spans these repos on purpose. Each one has its own branch and
its own checkout, so each one can be reviewed and rolled back on its own.

- Read the CLAUDE.md of every repo you touch and follow it. They differ.
- Commit per repo. A change for one repo never goes in another one's commit.
- You are one level above the worktrees, so git needs \`-C <worktree>\`, or cd first.
- Say which repo has to deploy first, and what breaks if that order is wrong.`
    : `Read the repo's own CLAUDE.md and follow it. Stay inside this one repo.`
}

${
  ctx.autoApprove
    ? `This task runs unattended: nobody will answer a question. Where you would
have asked, decide, and write the assumption and your reasoning into the
document for the phase so it can be checked later.`
    : `${
  ctx.previewScript
    ? `This is a Shopify app, so you can look at it running rather than reasoning
about the screen. Start it and get its URL:

    "${ctx.node}" "${ctx.previewScript}"

Then open a path in a browser that is already signed in to the dev store:

    "${ctx.node}" "${ctx.previewScript}" /app/pricing

That prints the page's visible text and saves a screenshot; open the screenshot
with the Read tool. Starting the app takes a couple of minutes the first time.
Use this to check a change you made to a screen. Do not use it to go hunting
around the admin.

`
    : ''
}If you hit a decision only the human can make, run:
    "${ctx.node}" "${ctx.askScript}" "your question"
It blocks and prints their answer on stdout. Use it instead of guessing on
anything that would be expensive to get wrong. Do not use it for questions you
can answer by reading the code.`
}`
}

const BODY = {
  /**
   * No phases, no documents, no review: the plain route. Most of what gets
   * typed into a box like this is a question, and a question answered twice
   * and written up three times is worse than one answered once.
   */
  answer: (ctx) => `## What the human asked

${ctx.prompt}

Do this, and nothing around it.

- If it is a question, answer it. Read whatever you need to be sure, and say
  what you actually found rather than what is usually true.
- If it is a change, make it, run the repo's own checks, and commit it.
- If it turns out to be larger than it reads — a migration, a new dependency,
  something that wants a spec — say so plainly and do the narrow version
  rather than quietly growing it.

There is no spec, no plan and no review on this route, so nothing downstream
will catch a mistake for you. Write no documents.

End with what you found or what you changed, and the real output of anything
you ran.
${titleAsk(ctx)}`,

  spec: (ctx) => `## Phase: write the spec

Task from the human:
${ctx.prompt}

Read enough of the codebase to know what this actually touches. Then write
${ctx.artifactDir}/spec.md with:

- Intent: what this is for and why, in the human's terms
- Scope: what changes, grouped per repo, file by file where you already know
- Non-goals: what this explicitly does not do
- Constraints: existing patterns, APIs, deploy or data gotchas you found${
    ctx.trees.length > 1
      ? `
- Contract between the repos: the exact shape each one sends or expects, and
  which side has to ship first for the other not to break`
      : ''
  }
- Acceptance criteria: how someone checks this is done, as concrete checks
- Open questions: anything you had to assume, marked as your assumption

${titleAsk(ctx)}
Write no product code in this phase. Do not commit.
End your output with a 5 line summary of the spec.`,

  plan: (ctx) => `## Phase: write the implementation plan

Read ${ctx.artifactDir}/spec.md. If the human left feedback below, it overrides
the spec where they conflict.
${ctx.feedback ? `\nHuman feedback on the spec:\n${ctx.feedback}\n` : ''}
Write ${ctx.artifactDir}/plan.md with:

- Ordered steps, each small enough to verify on its own
- The repo and files each step touches
- The exact commands that verify the work, per repo (its test / typecheck / lint)
- Risks, and what you will do if a step turns out wrong
- What you are deliberately leaving out

Write no product code in this phase. Do not commit.
End your output with the step list, one line each.`,

  implement: (ctx) => `## Phase: implement
${
  ctx.run === 'quick'
    ? `
What the human asked for:
${ctx.prompt}

There is no spec and no plan for this one on purpose: it was started as a small
change. Read enough of the code to be sure that is true. If it turns out to need
a spec, say so plainly in your output and build the narrow version only.
`
    : `
Read ${ctx.artifactDir}/spec.md and ${ctx.artifactDir}/plan.md and build it.`
}${ctx.feedback ? `\nHuman feedback on the plan:\n${ctx.feedback}\n` : ''}
- ${ctx.run === 'quick' ? 'Commit in logical steps with real messages.' : 'Work the plan in order. Commit each step separately with a real message.'}
- Run the repo's own checks (test, typecheck, lint). If they fail, fix the cause.
- Match the surrounding code: its naming, its idiom, its comment density.
- Do not invent abstractions the plan did not call for.

${titleAsk(ctx)}
Never claim a step passes without having run the command and read the output.
End your output with: what you built, what you ran, and what the output was.`,

  review: (ctx) => `## Phase: review your own work

Diffs under review, one per repo:
${ctx.trees.map((t) => `    git -C ${t.worktree} diff ${t.baseRef}...HEAD`).join('\n')}

Review it as if someone else wrote it and you are the one paged at 3am:

1. Correctness: does it do what ${
    ctx.run === 'quick'
      ? `the human asked for?\n\n   ${ctx.prompt.split('\n').join('\n   ')}\n`
      : `${ctx.artifactDir}/spec.md says, including the
   acceptance criteria?`
  } Trace the real flow, do not trust the diff's intent.
2. Code quality: dead code, duplicated logic, names that lie, error paths that
   swallow failures, missing input validation at trust boundaries.
3. Over-engineering: abstractions with one caller, config for values that never
   change, anything reinventing the stdlib or an installed dependency. Delete it.
4. Performance: N+1 queries, work inside loops that belongs outside, unbounded
   memory or result sets, blocking calls on a hot path.
5. Security: injection (SQL, shell, template), secrets or tokens in code or
   logs, authz checks missing on a new endpoint, unsafe deserialisation, new
   dependencies you do not need.

Fix everything you find that is in scope, and commit the fixes. For anything
real but out of scope, write it down instead of fixing it.

Write ${ctx.artifactDir}/review.md with one section per heading above: what you
found, what you fixed, what you left and why. Name the repo on every finding. If a heading turned up nothing,
say so in one line rather than padding it.

Re-run the verification commands after your fixes and paste the real output.
End your output with the count of issues found and fixed.`,
}

export function buildPrompt(phase, ctx) {
  return `${preamble(ctx)}\n\n${BODY[phase](ctx)}\n`
}

/**
 * A one-off run, outside the four phases: bring the base branch into the task's
 * branch and resolve whatever that turns up. It happens in the worktree, never
 * in the human's own checkout, so a bad resolution costs them nothing.
 */
export function buildCatchUpPrompt(tree, ctx) {
  return `You are in ${tree.worktree}, on ${tree.branch}, in the ${tree.repo} repo.
Read this repo's CLAUDE.md and follow it.

Bring ${tree.baseBranch} into this branch:

    git merge ${tree.baseBranch}

If it merges cleanly, say so, run the repo's checks, and stop.

If it conflicts, resolve it:

- Read ${ctx.artifactDir}/spec.md first. It says what this branch was for, which
  is what tells you which side of a conflict carries intent.
- For each conflicted file, read both sides in full. Where the two changes are
  about different things, keep both. Never take one side wholesale because it is
  shorter or because it resolves faster.
- A conflict where both sides changed the same behaviour on purpose is a product
  decision, not a mechanical one. Do not guess. Ask:
      "${ctx.node}" "${ctx.askScript}" "your question"
- Stage each file with git add as you finish it, then commit the merge.

Then run the verification commands from ${ctx.artifactDir}/plan.md and fix what
the merge broke. Never report a check as passing without having run it.

End with: which files conflicted, how you resolved each one, and the real output
of the checks you ran.`
}

/**
 * Get this branch into the base with nothing left behind it.
 *
 * Two steps that used to be two buttons: catch up, then merge. Doing them in
 * one run is what makes the second one safe — after the base has been merged
 * in, the merge the other way is a fast-forward, which cannot conflict.
 */
export function buildMergePrompt(tree, ctx) {
  return `You are in ${tree.worktree}, on ${tree.branch}, in the ${tree.repo} repo.
Read this repo's CLAUDE.md and follow it.

The human asked for this branch to end up in ${tree.baseBranch}, with nothing
left behind it and a merge request on record. Do these in order and stop at the
first thing that is not yours to decide.

1.  Bring ${tree.baseBranch} into this branch, here in the worktree:

        git fetch
        git merge origin/${tree.baseBranch} || git merge ${tree.baseBranch}

    If it conflicts, resolve it. Read ${ctx.artifactDir}/spec.md first where it
    exists: it says what this branch was for, which is what tells you which
    side of a conflict carries intent. Where the two sides changed different
    things, keep both. Never take one side wholesale because it is shorter or
    because it resolves faster.

    A conflict where both sides changed the same behaviour on purpose is a
    product decision, not a mechanical one. Do not guess:

        "${ctx.node}" "${ctx.askScript}" "your question"

2.  Run this repo's own checks and fix what the merge broke. Never report a
    check as passing without having run it and read the output. If something
    is still failing, stop here and say what: do not open a merge request on
    a branch you know is broken.

3.  Push the branch:

        git push -u origin ${tree.branch}

    Never force. If the remote rejects it, say what git said and stop.
    A repo with no remote has nothing to push and no merge request to open:
    say so and go to step 5.

4.  Open the merge request against ${tree.baseBranch}, and do it before
    anything lands. The human asked for it to exist first, so if this cannot
    be done, stop here and say why rather than merging anyway.

    Use whichever is right for the remote, and read its output for the URL:

        glab mr create --yes --target-branch ${tree.baseBranch} \\
          --title "..." --description "..."
        gh pr create --base ${tree.baseBranch} --title "..." --body "..."

    Write the title and the body yourself: what changed and what you ran. A
    restatement of the branch name tells the reviewer nothing they cannot
    already see. \`--fill\` takes them from the commits instead, which is only
    worth it when the commits already say that.

    If one is missing or not signed in, say which and what would sign it in
    (\`glab auth login\`, \`gh auth login\`). If a merge request for this branch
    already exists, that counts: say so with its URL and carry on.

5.  Only now put it into ${tree.baseBranch}, in the repo itself rather than in
    the worktree:

        git -C ${tree.repoPath} status --short
        git -C ${tree.repoPath} branch --show-current

    Three things stop you here, and each one is a sentence back to the human
    rather than something to work around:

    - the checkout is on some other branch. Say which. Do not switch it.
    - it has uncommitted changes to files this merge would touch. Name them.
    - anything else that looks like someone is in the middle of something.

    When it is clear:

        git -C ${tree.repoPath} merge --ff-only ${tree.branch}

    \`--ff-only\` on purpose. After step 1 this is a fast-forward, so it cannot
    conflict and cannot write a merge commit into ${tree.baseBranch}. If git
    refuses it, ${tree.baseBranch} moved while you were working: go back to
    step 1 rather than forcing it.

6.  Put ${tree.baseBranch} on the remote, so what you just merged is actually
    there:

        git -C ${tree.repoPath} push origin ${tree.baseBranch}

    Never force, and never delete the branch.

Do not touch any other repo.

End with: what conflicted and how you resolved it, what you ran and its real
output, the merge request URL, and what ${tree.baseBranch} points at now.`
}

/**
 * A follow-up: the task already ran, and the human came back with something
 * else to do on the same branches. Usually "the build is broken".
 */
export function buildFollowUpPrompt(ctx) {
  return `${preamble(ctx)}

## Follow-up

This task has already run. Its branches, worktrees and commits are above, and
whatever it produced is in ${ctx.artifactDir}.

What the human came back with:

${ctx.request
  .split('\n')
  .map((line) => `    ${line}`)
  .join('\n')}

- Read ${ctx.artifactDir}/review.md and spec.md where they exist. They say what
  this was for and what was already known to be wrong with it.
- If they are reporting something broken, reproduce it before you touch
  anything. A fix for a failure you have not seen is a guess.
- Work on the existing branches. Do not start new ones.
- Run the repo's own checks, and commit what you change.
- If what they are asking for is larger than it sounds, say so plainly and do
  the narrow version rather than quietly growing the task.

End with what you changed, what you ran, and the real output.`
}
