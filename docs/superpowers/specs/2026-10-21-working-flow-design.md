# Agent Flow — the working flow, round two

*2026-10-21. Design, not plan. Built from 13 real conversations and 38
follow-ups, not from guesses about what a tool like this should have.*

## Why

The tool runs tasks well. What it does badly is everything *around* a task:
picking the work up again after the machine slept, getting the result onto
prod, knowing whether it is waiting on you, and keeping a pasted API key out
of the places it should never be. The evidence:

- 17 of 38 follow-ups were the same release chore typed by hand: merge main,
  push, cherry-pick to prod, push prod, "has it deployed?"
- Two follow-ups were sent twice, word for word, because nothing visibly
  happened the first time. "đã fix chưa?" and "cần tôi trả lời gì?" are the
  same confusion from the other side.
- A task that was an estimate document (`eee056cc`) checked out twelve
  worktrees for it and then took thirteen follow-ups to shape an Excel file.
- A prompt (`3b84311a`) contained a live API key. It is in `tasks.json`, in
  the log, and was sent to the model verbatim.
- "tiếp tục" after a restart started a fresh run with no memory, and the
  agent asked what "continue" meant.

## Goals

1. A run interrupted by sleep, shutdown, or a server restart **continues**
   where it was, with the agent's own memory of it, without being re-told.
2. The whole release chain is one action per step, with the prod step as
   deliberate as the main step: **cherry-pick, never merge**, and the deploy
   watched to the end.
3. The person can **edit what each agent is told** — spec, plan, implement,
   review, answer, follow-up, land — without touching source.
4. At a glance: **what the agent just did, and what it needs from you**.
5. A task that produces a **document rather than code** gets no worktree,
   and its output is something you can open.
6. A secret in a prompt is **used but never stored or shown**: not in
   `tasks.json`, not in the log, not in the model's context, not in a commit.

## Non-goals

- Windows parity for the new work. The Dart stays platform-correct, but
  nothing here is built or tested on Windows.
- Replacing Jenkins, GitLab, or `glab`. The tool reads their state; it does
  not become them.
- A vault. Secrets are kept out of the wrong places; they are not encrypted
  at rest beyond what the OS keychain offers.

## Anti-goals

- Anything that quietly changes a branch. Every git action that moves a
  shared branch stays explicit, logged, and refusable.
- Resuming by replaying the prompt into a fresh session. That is what "retry"
  already does, and it is the thing being complained about.
- Hiding a secret so well the agent cannot do the job it was pasted for.

## The parts

### 1. Continue, not retry

Every `claude -p` run reports a `session_id` in its stream. Keep it: on the
task for phases, on the side run for follow-ups and landings.

When the server starts and finds a task that was `running`, it does not mark
it failed. It marks it `interrupted`, with the phase and the session it was
in. The app shows these at the top of the board with one line each and a
single **Continue** for the lot (and one per task).

Continue runs `claude -p --resume <session_id>` with a short prompt:
*"You were interrupted. Read the worktree to see what is actually on disk,
compare it with what you remember doing, and carry on from there. Say what
you found."* The phase status goes back to `running`. If `--resume` is
refused (session expired, CLI updated), fall back to today's retry, and say
so in the log.

**Automatic by default** — the app continues interrupted tasks on launch
without being asked — with a setting to make it a button instead. *(My
call. The person described wanting it to just pick up.)*

A sleeping machine does not kill the process, but the CLI's connection may
not survive it. Treat a run whose stream has been silent for N minutes while
the machine was asleep the same way: interrupted, continuable.

"tiếp tục" typed into the follow-up box of a task that has a session resumes
that session rather than opening a new one. The follow-up prompt gains:
*"If the request is only 'continue', carry on with the last thing you were
doing; do not ask what it means."*

### 2. Ship: main, then prod

Today's **Land** does: catch up → checks → push → merge request → fast-forward
base → push base. It stays.

A new **Ship to prod** on the repo card, enabled once the branch is on the
base, runs an agent that:

1. identifies the task's commits (`base-ref..branch`, the ones Land put on
   main),
2. in a worktree on `prod` (never the person's checkout), `git cherry-pick`
   each, in order, resolving conflicts with the spec in hand and asking on
   product decisions — exactly the catch-up rules,
3. runs the repo's checks on the result,
4. pushes `prod`. Never force.
5. **watches the deploy.** With Jenkins configured for the repo, polls the
   job's last build until it finishes and reports success or the failing
   stage's console tail. Without it, ends with the push and says where to
   look.

"Cherry-pick, never merge" is a rule in the prompt and a check in the tool:
the agent is told it, and the server refuses to run Ship if `prod` would be
fast-forwardable from `main` *and* the repo's config says cherry-pick —
because that means someone merged by hand and the branch is not what it is
supposed to be. *(My call: refuse and say so rather than carry on.)*

**Jenkins config** lives per repo in the workspace settings: base URL, job
name, and a token kept in the keychain (see part 6). The pipeline row that
today shows GitLab CI gains a Jenkins row for the prod branch when configured.

### 3. Editable prompts

A **Prompts** screen in the app lists the seven: spec, plan, implement,
review, answer, follow-up, land (and ship, once it exists). Each shows the
default and an editor. A saved edit is stored as
`<data>/prompts/<name>.md`; the server reads it instead of the built-in
when present. **Reset** deletes the file.

The placeholders are the ones the built-ins use (`{{prompt}}`,
`{{artifactDir}}`, `{{trees}}`, `{{askScript}}`…), listed beside the editor
with one line each on what they expand to. A saved prompt that references
an unknown placeholder is refused with the name.

**Global, not per-workspace**, in this round. *(My call. CLAUDE.md in each
repo already carries the repo's own rules, which is where repo-specific
instruction belongs; a per-workspace layer on top is easy to add later and
hard to take away.)* Prompts are versioned by the file's own history — the
data folder is not a git repo, so the app keeps the last three saves as
`<name>.1.md` etc. and offers them under Reset.

### 4. The status line

At the top of a task's workspace, under the header, one line in two parts:

- **Did:** the first sentence of the agent's last message, or the last tool
  it ran while running.
- **Needs:** the open question, the gate it is waiting at, or nothing.

It is the thing you read instead of scrolling. Clicking it scrolls the
transcript to that message. On the board, each task row shows the same
"Needs" fragment when there is one, so a board of twelve tasks says which
two are waiting on you.

### 5. The document route

A fourth route beside normal, build, and full: **Document**. No worktree.
The agent runs in `<data>/tasks/<id>/work/` with read access to the repos
it was pointed at (paths named in the prompt) and writes its output there.

The workspace screen for a document task replaces the diff pane with an
**Output** pane: the files in `work/`, newest first. Markdown and text
render inline; anything else opens with the OS. Follow-ups work the same
as today; the queue and the status line too.

The route is chosen on the form like the others. A task started on the
normal route whose first message says it produced a file is **offered** a
switch to the document route *(my call: offered, not switched; the worktree
may be wanted)*.

### 6. Secrets: used, never kept

**Detection.** On the way into a task — the prompt, a follow-up, a pasted
attachment that is text — scan for things that look like secrets:
`NAME=value` where the name matches `*_KEY`, `*_TOKEN`, `*_SECRET`,
`*_PASSWORD`; bare values matching known shapes (`ck_…`, `sk_…`, `ghp_…`,
`glpat-…`, long base64/hex runs); and anything the person wraps in
`<<secret>>` by hand.

**Ask once.** The form shows what it found, named, and asks: *keep this out
of the transcript?* Yes is the default. No sends it through as text, which
is what happens today.

**Storage.** Kept values go to the OS keychain (`security add-generic-
password` on macOS, Credential Manager on Windows) under the task id and
the name. `tasks.json`, the log, and the attachment on disk hold
`{{secret:NAME}}` in their place. Deleting the task deletes its entries.

**Use.** When a run for that task starts, each kept secret is passed to the
`claude` process as an environment variable `FLOW_SECRET_NAME`. The prompt
says: *"These values exist only in your shell as `$FLOW_SECRET_NAME`. Use
them from there — `printf '%s' "$FLOW_SECRET_NAME" >> .env.prod` — and
never print, echo, or write them anywhere you can read them back."* The
model never sees the value; the shell does.

**Guard.** Before Land or Ship pushes anything, the server diffs
`base..branch` for the kept values and for the shapes above. A match stops
the push with the file and line, and the prompt tells the agent the same
rule. `.env.*` files are the usual home for these and are usually
gitignored; this guard is for when they are not.

The key already in `3b84311a` is handled on the day this lands: a one-off
migration finds it, moves it to the keychain, and rewrites the task, the
log, and the prompt. *(And the person is told to rotate it, because it has
already been in a model's context.)*

## Constraints

- The server stays dependency-free Node. Keychain access is through the OS
  CLI, like the file dialogs already are.
- Nothing here touches the person's own checkout except the fast-forward
  that Land already does. Ship works in a worktree on `prod`.
- Every new git action is an agent run with the same ask script and the
  same stop-and-say rules as catch-up and Land.
- Tests: the server's end-to-end check covers each new route and refusal
  against the stub; the app's golden and widget tests cover each new screen
  and the status line.

## Order

Resume first — it is the one the person named first and it makes every
later feature less annoying to test. Then secrets, because a key is already
sitting where it should not. Then Ship, prompts, status line, document route.

## Left to the builder

- The exact shapes in the secret detector, and its false-positive rate on
  the existing thirteen prompts (none of the others should trip it).
- How long "silent while asleep" is before a run counts as interrupted.
- Whether `--resume` of a session that ended cleanly needs `--continue`
  instead; read the CLI's current help, do not assume.
- Layout of the Prompts screen and the Output pane within the existing
  Tern tokens.
