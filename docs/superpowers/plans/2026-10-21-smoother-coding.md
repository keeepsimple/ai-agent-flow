# Smoother Coding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the stops the 21 real runs show most (Land blocked by the person's checkout, the guard blaming `main`, reviews that park fixable bugs, worktrees that arrive bare, blind previews) and tell the agents to prove rather than read.

**Architecture:** Same shape as round two: each behaviour is a function in `server/runner.js` or `server/git.js`, a route in `server/index.js`, a default template under `server/prompt-defaults/`, proven against the stubbed CLI in `server/test.js`; the Flutter app reads new fields off the task or the git row and gains a picker, a dialog section, a checklist, and one button, each with a widget test. Per-repo settings extend `server/repo-config.js` and its dialog.

**Tech Stack:** Node 24 (no deps), Flutter 3.47, `claude` CLI, git, Chrome DevTools Protocol over the existing `browser.js` socket.

**Spec:** `docs/superpowers/specs/2026-10-21-smoother-coding-design.md`

## Global Constraints

- Server adds no npm dependency.
- Nothing touches the person's checkout except the fast-forward Land already did, now best effort and after the remote push.
- Land's target is always visible on the card before the run starts; Ship stays on the repo's prod branch.
- "Fix the N left" sends only items tagged `fixable:`; `decision:` items are shown, never sent.
- Setup, copy and baseline output reach the conversation as log entries; a failing setup is an `error` entry and the first phase still starts.
- Stub conventions hold: no backslashes in stub source, prompt-substring branches with order, state-changing tests at the end of the main flow, restart tests last.

## Review Focus

1. Land on a target the remote does not have yet (a brand-new release branch): `git push origin branch:target` creates it; the prompt must not refuse. *(Test in Task 1.)*
2. The person's checkout is on a different branch than the target during Land: the remote push still happens, the local fast-forward is skipped with one line. *(Test in Task 1.)*
3. A `setup` command that never exits (a dev server by mistake): the server must cap it (10 min) and log the cap, not hang the task forever. *(Test in Task 3.)*
4. `## Left` with an item tagged neither `fixable:` nor `decision:`: shown as decision (never sent). *(Test in Task 5.)*
5. Preview retry when the capture error is not about width (a crashed tab): the retry must not loop; one headless attempt, then the error text with both attempts named. *(Test in Task 6.)*

---

### Task 1: Land on a chosen target, remote first

**Files:**
- Modify: `server/git.js` (`statusOf` row gains `targets: string[]`), `server/runner.js` (`mergeViaAgent(id, repo, { target })`), `server/index.js` (`POST /merge {repo, target}`), `server/repo-config.js` (`landTarget` remembered per repo), `server/prompt-defaults/land.md`, `server/templates.js` (`KNOWN.land` += `target`, `hasRemote`)
- Modify: `desktop/lib/api.dart` (`merge(id, repo, {target})`), `desktop/lib/screens/review.dart` (`RepoCard` → *Land on ▾*: `PopupMenuButton` over `targets` with the remembered one first and an *Other…* entry opening a one-field dialog), `desktop/lib/screens/review.dart` (`onMerge` takes the target)
- Test: `server/test.js`, `desktop/test/screens_test.dart`

**Interfaces:**
- Produces: git row `targets` — `git branch -r --format=%(refname:short)` minus `origin/HEAD`, stripped of `origin/`, plus local branches that exist, minus the task branch, base first. Row also carries `landTarget: string` (remembered or base).
- Produces: `mergeViaAgent(id, repo, { target = tree.baseBranch } = {})` — refuses a target that is neither in `targets` nor a valid ref name (`git check-ref-format --branch`); records `repoConfig.set(repoPath, { landTarget: target })`; logs `Push <branch>, open a merge request, then land on <target>`.
- Land prompt (`land.md`): steps 1–4 as today with `{{target}}` in place of the base; step 5 becomes *Put it on the remote: `git push origin {{branch}}:{{target}}` (fast-forward only: if the remote refuses, {{target}} moved — back to step 1)*; step 6 *best effort, the person's checkout: if `git -C {{repoPath}} branch --show-current` is `{{target}}` and `git merge --ff-only` succeeds, say so; if untracked files or another branch block it, say exactly that in one line and finish — the remote has it.* `{{#if hasRemote}}` wraps steps 3–5; without a remote, step 6 is the landing and a block there is a stop.
- Stub: the `--ff-only` branch parses `landing on ` for the target, pushes `branch:target` when the prompt says `git push origin`, and only then tries the local ff.

- [ ] **Step 1: Write the failing tests** — (a) fixture `web` gets a `release` branch pushed to origin; `GET /git` row for a `web` task has `targets` starting with `main` and containing `release`; (b) `POST /merge {repo:'web', target:'release'}` → done; `git -C origin.git rev-parse release` equals the branch tip; local `web` checkout still on `main` and `main` unmoved; log has the `landing on release` decision; `GET /git` row `landTarget === 'release'`; (c) an untracked file in the `web` checkout at a path the branch changes, then `POST /merge {target:'main'}` → done, origin `main` moved, local `main` not, a text entry matches `/untracked/`; (d) `POST /merge {target:'nope branch'}` → 400; (e) a target that does not exist anywhere yet (`fresh-release`) lands: origin now has it.
- [ ] **Step 2: Run** `npm test` — expect 400s and missing `targets`.
- [ ] **Step 3: Implement** per Interfaces; Flutter picker and `onMerge(target)`.
- [ ] **Step 4: Run** `npm test` and `flutter test` (golden `repo-card` shows *Land on main ▾*) — PASS.
- [ ] **Step 5: Commit** `feat(land): choose the target; the remote is the truth`

### Task 2: The guard blames only the task's commits

**Files:**
- Modify: `server/git.js` (`scanForSecrets(tree, values)` reads `git log --first-parent -p --format= <base>..<branch>`), `server/guard-secrets.mjs` (same command), `server/secrets.js` (`scanDiff` already handles repeated `+++` headers; add nothing unless the test says so)
- Test: `server/test.js`

- [ ] **Step 1: Write the failing test** — in the ship test's stranger step, the stranger's commit on `main` adds `.env.dev` with `DB_PASSWORD=hunter2hunter2`; after catch-up merges it into the branch, `POST /push {repo:'web'}` succeeds and the guard CLI exits 0; then a commit on the branch itself adding `OTHER_TOKEN=abcdefgh12345678` makes both refuse naming `.env.dev`.
- [ ] **Step 2: Run** — push refused today (stranger's line counted) → RED.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test` — PASS.
- [ ] **Step 5: Commit** `fix(guard): blame only the task's own commits`

### Task 3: A worktree that arrives ready

**Files:**
- Modify: `server/repo-config.js` (`get` → adds `setup: string`, `copy: string[]`, `checks: string[]`; `set` validates: `copy` entries relative, no `..`), `server/runner.js` (`setupWorktrees` → after creation: `copyFromCheckout(tree, copy)`, then `runSetup(task, tree, setup)`; `runTask` → before the first phase and only when `!task.baselineAt`, `runBaseline(task, tree, checks)`), `server/prompts.js` + `server/prompt-defaults/preamble.md` (`{{checksNote}}`: the checks per repo, which were red at base, and the setup result)
- Modify: `desktop/lib/screens/review.dart` (`ProdConfigDialog` → `RepoConfigDialog` with a *Worktree* section: Setup command, Copy from checkout (one per line), Checks (one per line); button label *Repo…*)
- Test: `server/test.js`, `desktop/test/screens_test.dart`

**Interfaces:**
- Produces: `runSetup(task, tree, cmd) → Promise<{code}>` — `spawn(sh, ['-c', cmd])` in the worktree (`cmd.exe /c` on Windows), stdout+stderr streamed to the log as one `tool` entry `Setup  <cmd>` then a `text` entry with the last 40 lines; non-zero → `error` entry `setup exited <code>`; killed after `SETUP_MAX_MS = 600_000` with an `error` entry `setup capped at 10 min`. Cancel kills it (`children` map).
- Produces: `copyFromCheckout(tree, paths) → string[]` — copies each existing `<repoPath>/<p>` to `<worktree>/<p>` (files and directories), returns the ones copied; one `text` entry `Copied from the checkout: a, b`.
- Produces: `runBaseline(task, tree, checks)` — for each check `n`, runs it in the worktree at `baseRef` (the fresh worktree is there already), writes `<artifacts>/baseline/<repo>/<n>.txt` as `$ <cmd>\nexit <code>\n<last 20 lines>`, records `task.baseline[repo] = [{cmd, code}]` and `task.baselineAt`. Capped like setup. Skipped when `checks` is empty.
- Preamble `{{checksNote}}`: *Checks for <repo>: `cmd1`, `cmd2`. Red at base: `cmd1` (exit 3) — see <artifacts>/baseline/. A failure that is also red there is not yours: say which and move on.* Empty when no checks.

- [ ] **Step 1: Write the failing tests** — repo config for `api`: `setup: 'echo ran > SETUP_MARK'`, `copy: ['generated.txt', 'missing.txt']`, `checks: ['sh -c "echo boom; exit 3"', 'true']`; create ignored `generated.txt` in the `api` checkout; a new quick task on `api` → when done: `SETUP_MARK` and `generated.txt` exist in the worktree; log has `Copied from the checkout: generated.txt`; `baseline/api/0.txt` contains `exit 3` and `boom`; `task.baseline.api[1].code === 0`; `prompt.txt` of implement matches `/Red at base: .*exit 3/`. Then `setup: 'sleep 30'` with `FLOW_SETUP_MAX_MS=500` on a restarted server → the task still reaches `done` and the log has `setup capped`.
- [ ] **Step 2: Run** — RED on `SETUP_MARK`.
- [ ] **Step 3: Implement.** Dialog golden `repo-config-dialog` with the three new fields.
- [ ] **Step 4: Run** both suites — PASS.
- [ ] **Step 5: Commit** `feat(worktree): setup, copy, checks and a baseline before the first phase`

### Task 4: The agents are told to prove

**Files:**
- Modify: `server/prompt-defaults/preamble.md` (Read/Grep/Edit line; `{{checksNote}}`), `spec.md` (acceptance criteria as runnable/clickable lines), `implement.md` (guard every changed behaviour with a test; baseline rule), `review.md` (end-to-end trace first; *6. Guarded*; `## Left` convention with `fixable:`/`decision:` tags and the rule that a fixable item under ~30 lines in touched files is fixed now; count line `found / fixed / left-fixable / left-decision`), `follow-up.md` (*Branch state:* line), `server/templates.js` (`KNOWN` updates)
- Test: `server/templates.test.js` (each default renders and contains its marker: `Read tool`, `## Left`, `6. Guarded`, `Branch state:`, `Red at base`), `server/test.js` (stub markers unchanged: `Phase: write the spec`, `Phase: implement`, `## What the human asked`, `Commits to pick`, `--ff-only`, `into this branch`)

- [ ] **Step 1: Write the failing tests** — template marker assertions.
- [ ] **Step 2: Run** — RED.
- [ ] **Step 3: Edit the templates.**
- [ ] **Step 4: Run** `npm test` — PASS (every stub branch still matches).
- [ ] **Step 5: Commit** `feat(prompts): trace, guard, baseline, left, branch state`

### Task 5: Review leftovers → checklist and one click

**Files:**
- Create: `desktop/lib/left.dart` — `List<LeftItem> leftOf(String? reviewMd)`; `LeftItem { String text; String kind /* fixable|decision */; bool done }`; parses the `## Left` section's `- [ ]` / `- [x]` lines; an untagged item is `decision`.
- Modify: `desktop/lib/screens/workspace.dart` (explorer: *Left (N)* under Documents listing items with a dot colour by kind, ticked ones struck; a **Fix the N left** button under the status line when any undone `fixable` exists; the follow-up text is exactly *"Fix every item tagged fixable under ## Left in review.md, re-run the checks, and tick them off in review.md."*)
- Test: `desktop/test/left_test.dart`, `desktop/test/screens_test.dart`

- [ ] **Step 1: Write the failing tests** — `leftOf` on a review with 2 fixable, 1 decision, 1 untagged, 1 ticked → kinds and done flags; widget: a done task with that review shows `Left (4)` and `Fix the 2 left`; tapping calls `followUp` with the exact text (fake via `FlowState` subclass or by checking `flow.error` is null and the composer text); a review with only decisions shows the list and no button.
- [ ] **Step 2: Run** — RED.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `flutter test` — PASS.
- [ ] **Step 5: Commit** `feat(review): what was left is a checklist, and one click`

### Task 6: Preview survives a hidden window

**Files:**
- Modify: `server/browser.js` (`visit(url, shotPath, opts)` → before capture: `Browser.getWindowForTarget` + `Browser.setWindowBounds({windowState:'normal', width:1280, height:900})`, `Page.bringToFront`, `Emulation.setDeviceMetricsOverride({width:1280,height:900,deviceScaleFactor:1,mobile:false})`; capture inside `captureWith(send)`; on a capture error, one retry on a fresh headless tab via `ensure({headless:true})` is **not** possible while the visible Chrome holds the profile, so the retry is: close and reopen the tab with the metrics override applied before load; the final error names both attempts)
- Create: `server/browser-capture.js` — pure `captureWith(send, { width = 1280, height = 900 }) → Promise<{data}>`: applies bounds + override, calls capture, on failure applies the override again on the same session and tries once more, then throws `Error('screenshot failed twice: <first> / <second>')`.
- Test: `server/browser.test.js` (fake `send`: first capture throws `Cannot take screenshot with 0 width`, second returns data → `{data}` and the fake saw `Browser.setWindowBounds` and `Emulation.setDeviceMetricsOverride`; two failures → the combined error; a non-width error also retries exactly once)

- [ ] **Step 1: Write the failing tests.**
- [ ] **Step 2: Run** `node server/browser.test.js` — RED.
- [ ] **Step 3: Implement** `browser-capture.js` and call it from `visit`.
- [ ] **Step 4: Run** `npm test` — PASS.
- [ ] **Step 5: Commit** `fix(preview): bring the window back before the screenshot, retry once`

---

## Finishing

- [ ] README: *Land on ▾*, worktree setup/copy/checks/baseline, the Left checklist, what the agents are now told.
- [ ] `npm test` and `flutter test` green; fresh whole-branch review; fix pass; `npm run app -- --install`.
