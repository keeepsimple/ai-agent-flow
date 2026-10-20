export const PHASES = ['spec', 'plan', 'implement', 'review']

// Phases that stop for a human before the next one starts.
export const GATES = { spec: true, plan: true, implement: false, review: false }

export const PHASE_LABEL = {
  spec: 'Spec',
  plan: 'Implementation plan',
  implement: 'Implement',
  review: 'Self review',
}

function preamble(ctx) {
  return `You are running one phase of an automated workflow on an isolated git worktree.

Repo:       ${ctx.repo}
Worktree:   ${ctx.worktree}   (you are already in it, on branch ${ctx.branch})
Base:       ${ctx.baseBranch}
Artifacts:  ${ctx.artifactDir}   (spec.md, plan.md, review.md live here, NOT in the repo)

Read the repo's own CLAUDE.md and follow it. Stay inside this one repo; if the
work genuinely needs a second repo, say so in your output and stop.

If you hit a decision only the human can make, run:
    ${ctx.askScript} "your question"
It blocks and prints their answer on stdout. Use it instead of guessing on
anything that would be expensive to get wrong. Do not use it for questions you
can answer by reading the code.`
}

const BODY = {
  spec: (ctx) => `## Phase: write the spec

Task from the human:
${ctx.prompt}

Read enough of the codebase to know what this actually touches. Then write
${ctx.artifactDir}/spec.md with:

- Intent: what this is for and why, in the human's terms
- Scope: what changes, file by file where you already know
- Non-goals: what this explicitly does not do
- Constraints: existing patterns, APIs, deploy or data gotchas you found
- Acceptance criteria: how someone checks this is done, as concrete checks
- Open questions: anything you had to assume, marked as your assumption

Write no product code in this phase. Do not commit.
End your output with a 5 line summary of the spec.`,

  plan: (ctx) => `## Phase: write the implementation plan

Read ${ctx.artifactDir}/spec.md. If the human left feedback below, it overrides
the spec where they conflict.
${ctx.feedback ? `\nHuman feedback on the spec:\n${ctx.feedback}\n` : ''}
Write ${ctx.artifactDir}/plan.md with:

- Ordered steps, each small enough to verify on its own
- Files touched per step
- The exact commands that verify the work (the repo's test / typecheck / lint)
- Risks, and what you will do if a step turns out wrong
- What you are deliberately leaving out

Write no product code in this phase. Do not commit.
End your output with the step list, one line each.`,

  implement: (ctx) => `## Phase: implement

Read ${ctx.artifactDir}/spec.md and ${ctx.artifactDir}/plan.md and build it.
${ctx.feedback ? `\nHuman feedback on the plan:\n${ctx.feedback}\n` : ''}
- Work the plan in order. Commit each step separately with a real message.
- Run the verification commands from the plan. If they fail, fix the cause.
- Match the surrounding code: its naming, its idiom, its comment density.
- Do not invent abstractions the plan did not call for.

Never claim a step passes without having run the command and read the output.
End your output with: what you built, what you ran, and what the output was.`,

  review: (ctx) => `## Phase: review your own work

Diff under review: \`git diff ${ctx.baseBranch}...HEAD\` in this worktree.

Review it as if someone else wrote it and you are the one paged at 3am:

1. Correctness: does it do what ${ctx.artifactDir}/spec.md says, including the
   acceptance criteria? Trace the real flow, do not trust the diff's intent.
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
found, what you fixed, what you left and why. If a heading turned up nothing,
say so in one line rather than padding it.

Re-run the verification commands after your fixes and paste the real output.
End your output with the count of issues found and fixed.`,
}

export function buildPrompt(phase, ctx) {
  return `${preamble(ctx)}\n\n${BODY[phase](ctx)}\n`
}
