# Agent Flow — smoother coding, fewer bugs, reviews that catch them

Round three. Designed from the logs of the 21 real tasks run so far
(≈$220, 3,210 shell calls, 53 follow-ups, 17 questions), not from guesses.

## What the logs say

**Where the follow-ups went.** 53 follow-ups on 21 tasks, 2.5 per task:

| What the person typed | Count | What it tells us |
| --- | --- | --- |
| merge main / push origin / pick to prod / push prod / "no commit behind" / MR into *another* branch | ~20 | Git plumbing typed by hand. Land and Ship now exist, but a third of these name a target other than the base (`develop`, `gorgias-support`, `main` from a `dev`-based branch). |
| "sửa hết cho tôi" / "sửa hết các issue" / "sửa hết cả 6 issue" | 4 | The self-review found real issues, wrote them under *Left (out of scope)*, and stopped. The person wanted them fixed. Every time. |
| "đã fix chưa?" / "đã xong rồi hả?" / "vẫn chưa đẩy lên main?" | 3 | The run's last message did not say where the branch stood. |
| re-explaining a product model (one analysis task) | 5 | A misread brief, repeated. The Document route and better acceptance criteria are the lever. |
| pasted deploy failure, pricing/cost questions, UI tweaks | rest | Normal iteration. |

**Where runs stopped short.** 4 of 21 final messages are *"I stopped before
the merge into main: your checkout has untracked files the fast-forward would
overwrite"* — `@types/api-routes.d.ts` (generated, gitignored by intent) and
stray image folders. The remote never got the merge; the person had to come
back. 2 more stopped at the secrets guard on tokens that live in `.env.dev`
on `main` (committed long ago), not on the branch: the guard diffed against a
stale local base and blamed the branch.

**Where the shell calls went.** 3,210 Bash calls: 2,053 are `cat`, `sed -n`,
`grep`, `git show` — reading files through the shell, one turn each, instead
of the Read tool. 259 are edits through python heredocs. Probes show the
choice is not a permission-mode effect (both modes read with `sed` once a
shell call has happened) and a one-line instruction flips it sometimes. Cheap
to say; not a lever to build on.

**What repeats at the start of every task.** `pnpm install` in a fresh
worktree, then discovering the gitignored generated files the main checkout
has (`@types/api-routes.d.ts`, `android/key.properties`), then learning that
`tsc` is red at base with 264 pre-existing errors and `verify-all` is 145/147
at base. One task reinstalled `node_modules` mid-way. The agent pays for this
discovery every time, and sometimes reports a baseline failure as its own.

**Preview.** On the largest task every `preview.mjs` call failed with
`Cannot take screenshot with 0 width`: the tool's Chrome window was minimised
or off-screen. 47 wasted calls, and the agent reasoned about screens blind.

**Reviews.** All 16 `review.md` files follow the five headings. They *find*
things (6 found / 2 fixed is typical). The misses are in what happens next:
findings parked as out of scope, nothing that proves a changed behaviour is
guarded by a test, and no end-to-end trace required before "correct".

## Goals

1. Land never stops at the person's checkout. The remote is the truth.
2. Land and Ship can target the branch the person names, not only the base.
3. What the review leaves behind is one click from being fixed.
4. The guard blames only the task's own commits.
5. A worktree arrives ready: installed, generated files in place, checks named, baseline known.
6. Preview takes a screenshot even when the window was put away.
7. The agents are told to prove, not to read: trace a real path, guard each changed behaviour with a test, compare a red check against base before owning it.

## Non-goals

- Changing the permission mode or fighting the harness over Read vs `cat`. One line in the preamble, nothing more.
- A new route or screen. This round is prompts, repo config, and three buttons.
- Windows.

## Anti-goals

- Land pushing to a branch the person did not pick. The target is always visible before the run starts.
- A "Fix all" that re-opens product decisions. Only items the review itself marked fixable go in.
- Silent setup: a setup command that fails must show in the conversation, not vanish.

## The parts

### 1. Land: the remote is the truth, and the target is a choice

Land step 5 today fast-forwards the person's own checkout and stops when
untracked files sit in the way. New order after the merge request exists:

1. `git push origin <branch>:<target>` — a fast-forward on the remote, which
   refuses on its own if `<target>` moved. This is the step that counts.
2. Then, best effort, `git -C <repo> merge --ff-only <branch>` in the
   person's checkout *if* it is on `<target>` and clean enough. If untracked
   files block it, say exactly that in one line and finish: the remote has
   it, GitLab shows the MR merged, Jenkins deploys from the remote.

**Target.** The repo card's *Land on main* becomes *Land on ▾*: the base
(default), the other local branches that exist on the remote, or a typed
name. The server takes `{ repo, target }`; the prompt names the target in
every step. The last target used is remembered per repo. Ship stays on the
prod branch from repo config.

### 2. Review leftovers → a checklist, and one click

The review prompt gains a convention: everything found and not fixed goes
under `## Left`, one `- [ ]` line each, each line starting with a short tag:
`fixable:` (a bug or smell in files this task touched, left only for scope)
or `decision:` (needs the person). The review is also told: a `fixable:`
item under ~30 lines inside files you already changed is *yours to fix now*,
not to list.

The app parses `## Left` from `review.md`. The explorer shows *Left (N)*
under Documents with the items; the workspace gets a **Fix the N left**
button when any are `fixable:`. It sends one follow-up: *"Fix every item
tagged fixable under ## Left in review.md, re-run the checks, tick them off
in review.md."* `decision:` items are shown, not sent.

### 3. The guard blames only the task

`guard-secrets.mjs` and `scanForSecrets` scan the added lines of the task's
own commits — `git log --first-parent -p <base>..<branch>` — instead of
`git diff base...branch`. A token on `main` that the catch-up merged in is
`main`'s problem, said in one line, not a reason to stop.

### 4. A worktree that arrives ready

Per-repo config (`repos.json`, the *Prod…* dialog grows a second section
*Worktree*) gains:

- `setup`: a shell command run in the new worktree right after creation
  (e.g. `pnpm install --frozen-lockfile && pnpm prisma generate`). Output
  goes to the conversation as a `tool` entry; a non-zero exit is logged as
  an error and the first phase still starts, told about it.
- `copy`: gitignored paths to copy from the main checkout
  (`@types/api-routes.d.ts`, `android/key.properties`, `.env.dev`). Missing
  ones are skipped silently; copied ones are listed in one log line.
- `checks`: the commands that are the repo's gate (`pnpm tsc`,
  `pnpm verify-all`). Named in the preamble as *the checks for this repo*.

**Baseline.** Before the first phase, the server runs each `checks` command
once *at the base commit* in the fresh worktree and records exit code and the
last 20 lines to `<artifacts>/baseline/<n>.txt`. The implement and review
prompts say: *a check that is also red in baseline/ is not yours; say which,
and do not try to fix it.* This replaces the agent's ad-hoc `git archive`
comparisons. Baseline runs are skipped when `checks` is empty.

*(My call: baseline runs cost a few minutes per task on big repos. It is
gated per repo by `checks` being set, and it runs while the agent is already
working on the spec phase — the implement phase is what needs it.)*

### 5. Preview survives a hidden window

Before `Page.captureScreenshot`, `browser.visit` brings the window to a
normal state and size (`Browser.setWindowBounds` normal 1280×900,
`Page.bringToFront`) and sets a viewport override. If the capture still
fails, it retries once headless on a fresh tab with the same URL. The
error text names what it tried.

### 6. The agents

Changes to the default templates, all editable as before:

- **preamble**: *Read files with the Read tool and search with Grep; the
  shell is for commands. Edit with Edit.* Plus the repo's `checks`, the
  `baseline/` note, and the setup result when there was one.
- **spec**: acceptance criteria as things someone can run or click, one
  line each, with the command or the path. A criterion that cannot be
  checked is rewritten until it can.
- **implement**: for every behaviour you change, name the test that guards
  it; if none exists, write one in the repo's own test style before you
  call the step done. Run the repo's checks; a failure present in
  `baseline/` is not yours — say so and move on.
- **review**: Correctness starts with an end-to-end trace of one real path
  (run the command, hit the route, open the page via preview) and says
  what was observed. A new section *6. Guarded*: for each changed behaviour,
  the test or check that would catch it breaking; missing ones are written.
  `## Left` as in part 2. The count line at the end becomes
  *found / fixed / left-fixable / left-decision*.
- **follow-up**: ends with *Branch state:* one line — commits ahead of base,
  pushed or not, MR URL or none, on base or not. The three "is it done?"
  follow-ups were this line missing.
- **land**: part 1.

## Constraints

- Server stays dependency-free. Setup and baseline run through `spawn` with
  the same logging as a claude run; they are cancellable with the task.
- Nothing here touches the person's checkout except the best-effort
  fast-forward Land already did, now explicitly optional.
- Every new behaviour has a stub-driven e2e check or a Flutter widget test,
  as before.

## Order

Land target + remote-first (1) → guard scope (3) → worktree setup, copy,
checks, baseline (4) → prompts (6) → review leftovers checklist (2) →
preview (5). The first two remove the stops the logs show most.

## Left to the builder

- Exact wording of the templates.
- How the *Land on ▾* picker lists remote branches (a `git branch -r` read
  behind the git status row is the obvious place).
- Whether baseline output is shown in the explorer (a *Baseline* row under
  Documents is enough).
