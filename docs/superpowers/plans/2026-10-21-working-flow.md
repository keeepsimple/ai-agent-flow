# Working Flow (round two) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make an interrupted run continue where it was, keep pasted secrets out of the places they must not be, ship to prod by cherry-pick with the deploy watched, let the person edit every agent prompt, show what the agent did and needs at a glance, and give document-producing tasks a route with no worktree.

**Architecture:** The Node server (`server/`) keeps owning every git action and every `claude -p` run; each new capability is a function in `runner.js` plus a route in `index.js`, driven by a prompt in `prompts.js`, and proven against the stubbed CLI in `server/test.js`. The Flutter app (`desktop/lib/`) stays a client: it reads new fields off the task and gains a screen or a widget per part, each with a golden or widget test. Six parts, in the spec's order; each part leaves `npm test` and `flutter test` green and is shippable alone.

**Tech Stack:** Node 24 (no runtime deps), Flutter 3.47 / Dart, `claude` CLI (`-p --output-format stream-json`, `--resume`), git, macOS `security` CLI, Jenkins JSON API over `fetch`.

**Spec:** `docs/superpowers/specs/2026-10-21-working-flow-design.md`

## Global Constraints

- Server adds no npm dependency. OS integrations go through CLIs already used this way (`security`, `osascript`, `git`).
- Nothing touches the person's own checkout except the existing `--ff-only` in Land. Ship works in a worktree on the prod branch.
- Every git action that moves a shared branch is an agent run with the ask script and "stop and say so" rules, or a server call that refuses with the reason. Never `--force`.
- Secrets never appear in `tasks.json`, `data/logs/*.jsonl`, the prompt text, or a commit. They reach the agent only as `FLOW_SECRET_<NAME>` environment variables.
- `{{secret:NAME}}` is the placeholder form in stored text. `FLOW_SECRET_NAME` is the env name (same NAME).
- Prompt overrides live at `<data>/prompts/<name>.md`; the last three saves at `<name>.1.md`, `.2.md`, `.3.md`.
- Prod branch name per repo defaults to `prod`; Ship is hidden where the branch does not exist.
- Windows: Dart stays platform-correct; nothing here is built or tested there. Secret storage falls back to a 0600 file under the data folder off macOS.
- Stub conventions in `server/test.js`: the stub source is a JS template literal — **no backslashes in stub code**; match prompts on single-line markers; put state-changing tests (anything that moves a base branch) at the end of the main flow.

## Review Focus

1. Resuming a task whose worktree was dropped in between: `setupWorktrees` rebuilds it from the branch, then `--resume` hands the agent a memory of files that may now differ — the resume prompt must make it re-read before acting. *(Test in Task 1.4.)*
2. A bare token shape that is really a hash in ordinary text (a git sha, a UUID): the detector must not flag 40-hex or UUIDs; bare shapes need a known prefix or ≥ 32 chars of mixed base64. *(Test in Task 2.1.)*
3. A prompt override saved before a placeholder is renamed in a later version: loading must fall back to the default and log the unknown name, not throw at task start. *(Test in Task 4.1.)*
4. Ship when `git cherry` says every commit is already on prod (someone picked by hand): refuse with "nothing to pick", do not create a worktree. *(Test in Task 3.3.)*
5. A document task whose `work/` fills with thousands of files (a `node_modules` the agent installed): the output listing caps at 200 entries and says so. *(Test in Task 6.2.)*

---

## Part 1 — Continue, not retry

### Task 1.1: Remember the session of every run

**Files:**
- Modify: `server/runner.js` (`runClaude`, the stream loop at ~745, `sideRun`, `runTask`)
- Test: `server/test.js`

**Interfaces:**
- Produces: `task.lastSession = { id: string, kind: 'phase'|'side', phase?: string, label?: string, cwd: string, at: number }` — set when the first stream message with a `session_id` arrives, on every run.
- Produces: `runClaude(task, prompt, cwd, { resume?: string } = {})` — when `resume` is given, args gain `--resume <id>` and the prompt is the one passed in.

- [ ] **Step 1: Write the failing test** — after the `created` task's spec gate, assert `task.lastSession` has `kind: 'phase'`, `phase: 'spec'`, a non-empty `id`, and `cwd === task.root`. The stub must emit a `session_id`: in the stub's result JSON add `session_id: 'stub-' + process.pid`.

```js
assert.equal(task.lastSession.kind, 'phase')
assert.equal(task.lastSession.phase, 'spec')
assert.match(task.lastSession.id, /^stub-\d+$/)
```

- [ ] **Step 2: Run** `npm test` — expect the new assertion to fail with `lastSession` undefined.
- [ ] **Step 3: Implement** — in the stream loop, on any `msg.session_id` not yet recorded for this run, `update(task.id, { lastSession: {...} })`. `runClaude` gains the options object; `sideRun` and `runTask` pass `kind/phase/label` through a `meta` argument so the record is right.
- [ ] **Step 4: Run** `npm test` — PASS.
- [ ] **Step 5: Commit** `feat(resume): remember the session of every run`

### Task 1.2: Interrupted, not failed

**Files:**
- Modify: `server/store.js:31-42` (the STALE block)
- Modify: `server/runner.js` (new `resume(id)`, `resumeFrom` handling in `runTask`/`sideRun`), `server/prompts.js` (`RESUME_PROMPT`)
- Modify: `server/index.js` (route `POST /api/tasks/:id/resume`)
- Test: `server/test.js`

**Interfaces:**
- Produces: status value `'interrupted'`; `task.interruptedAt: number`.
- Produces: `resume(id)` → throws unless `status === 'interrupted'`; sets `task.resumeFrom = task.lastSession`, status `queued`, pumps. `runTask` sees `resumeFrom.kind === 'phase'` and runs that phase with `--resume` and `RESUME_PROMPT`; `kind === 'side'` runs `sideRun` with `--resume`. `resumeFrom` is cleared when the resumed run ends either way.
- Produces: `RESUME_PROMPT` (prompts.js) — exact text: *"You were interrupted. Read the worktree to see what is actually on disk, compare it with what you remember doing, and carry on from there. Say what you found."*
- Fallback: if the resumed run exits non-zero **and streamed no log entries**, log `{kind:'text', text:'resume refused; running the phase again'}` and re-run the phase fresh (today's retry path).

- [ ] **Step 1: Write the failing test** — restart the test server mid-run: create a `SLEEPY` task, wait for its pid file, **kill the server process**, start a new one on the same port and data dir, fetch the task: `status === 'interrupted'`, `lastSession.phase === 'answer'`. Then `POST /resume`: status becomes `running`, and the stub, when started with `--resume`, writes `art/resumed.txt` containing the session id it was given (stub reads `process.argv` for `--resume`). Assert the file exists and matches `lastSession.id`.
- [ ] **Step 2: Run** `npm test` — expect `status === 'failed'` (today's behaviour).
- [ ] **Step 3: Implement** — STALE: `running` with a `lastSession` → `interrupted` (+ `interruptedAt`), else `failed` as today; `queued` stays queued and is pumped on boot. `resume()`, the `resumeFrom` branch in `runTask` (skip `buildPrompt`; use `RESUME_PROMPT`; pass `{ resume: id }`), the no-output fallback.
- [ ] **Step 4: Run** `npm test` — PASS.
- [ ] **Step 5: Commit** `feat(resume): interrupted tasks continue their own session`

### Task 1.3: Continue on launch, and "tiếp tục"

**Files:**
- Modify: `server/runner.js` (`resumeInterrupted()`, `followUp`), `server/index.js` (call after `listen`), `server/prompts.js` (follow-up prompt line)
- Test: `server/test.js`

**Interfaces:**
- Produces: `resumeInterrupted()` — resumes every `interrupted` task; runs on boot unless `FLOW_AUTO_RESUME === '0'`.
- Produces: `followUp(id, request)` — when `request.trim()` matches `/^(tiếp tục|continue|carry on)[.!]?$/i` and `task.lastSession?.id`, it resumes that session with `RESUME_PROMPT` instead of opening a new run.
- Follow-up prompt gains the line: *"If the request is only 'continue', carry on with the last thing you were doing; do not ask what it means."*

- [ ] **Step 1: Write the failing tests** — (a) boot the second server with `FLOW_AUTO_RESUME` unset: the interrupted task from 1.2 is `running` within 2 s without a POST. (b) boot with `FLOW_AUTO_RESUME=0`: it stays `interrupted`. (c) on a done task with a `lastSession`, `POST /follow-up {request:'tiếp tục'}` → the stub's `resumed.txt` appears with that session id.
- [ ] **Step 2: Run** — expect (a) and (c) to fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test` — PASS.
- [ ] **Step 5: Commit** `feat(resume): continue on launch, and on "tiếp tục"`

### Task 1.4: Sleep watchdog, and resume after a dropped worktree

**Files:**
- Modify: `server/runner.js` (`watchdog`, `markInterrupted(id)`)
- Test: `server/test.js`

**Interfaces:**
- Produces: `markInterrupted(id)` — kills the child tree, sets `interrupted` with `lastSession` intact. Exported for the test.
- Watchdog: every 60 s compare `Date.now()` with the last tick; a jump > 180 s means the machine slept. After a sleep, any running task whose stream has been silent > 10 min is `markInterrupted`. Constants `WATCHDOG_MS = 60_000`, `SLEEP_JUMP_MS = 180_000`, `SILENT_MS = 600_000` exported.

- [ ] **Step 1: Write the failing tests** — (a) `markInterrupted` on a SLEEPY task: child pid is dead within 7 s, status `interrupted`, `lastSession` still set. (b) drop the worktree of an interrupted task (`DELETE /worktree` must be allowed on `interrupted`), then `POST /resume`: `root` is back on disk and `resumed.txt` is written — i.e. `setupWorktrees` ran before `--resume`.
- [ ] **Step 2: Run** — expect `markInterrupted` undefined.
- [ ] **Step 3: Implement** — the watchdog uses `setInterval(...).unref()`; `removeWorktrees` accepts `interrupted`; `resume()` calls `setupWorktrees` when `!task.root`.
- [ ] **Step 4: Run** `npm test` — PASS.
- [ ] **Step 5: Commit** `feat(resume): sleep watchdog; resume rebuilds a dropped worktree`

### Task 1.5: The app shows interrupted tasks and continues them

**Files:**
- Modify: `desktop/lib/prefs.dart` (`autoResume: bool`, default true), `desktop/lib/server.dart` (`FLOW_AUTO_RESUME=0` when off), `desktop/lib/widgets/sidebar.dart` (a "Continue on launch" switch in the footer)
- Modify: `desktop/lib/api.dart` (`resume(id)`), `desktop/lib/widgets/bits.dart` (`statusWords`, `StatusDot.colourFor` — `interrupted` → `Tern.warn`, words `Interrupted`), `desktop/lib/widgets/header.dart` (Continue button when `status == 'interrupted'`), `desktop/lib/screens/sessions.dart` (an "Interrupted" strip above the board with one Continue-all button)
- Test: `desktop/test/screens_test.dart`

**Interfaces:**
- Consumes: `POST /api/tasks/:id/resume`.
- Produces: `Api.resume(String id)`; `Task.get interrupted => status == 'interrupted'`; `Prefs.autoResume`.

- [ ] **Step 1: Write the failing golden** — board with two interrupted tasks: `find.text('2 interrupted')` and `find.text('Continue all')` exist; header for an interrupted task shows `Continue`. A widget test: `Prefs.memory()..autoResume = false` makes `FlowServer.env()` carry `FLOW_AUTO_RESUME: '0'`.
- [ ] **Step 2: Run** `flutter test` — fails (text not found).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `flutter test --update-goldens` then `flutter test` — PASS; look at `sessions.png`.
- [ ] **Step 5: Commit** `feat(resume): continue from the board and the header`

---

## Part 2 — Secrets: used, never kept

### Task 2.1: Detect and redact

**Files:**
- Create: `server/secrets.js`
- Create: `server/secrets.test.js` (pure; add to `npm test`)

**Interfaces:**
- Produces: `detect(text: string) → Array<{ name: string, value: string, start: number, end: number }>`. Rules, in order: (1) `NAME=value` on its own line where NAME matches `/_(KEY|TOKEN|SECRET|PASSWORD)$/i` → name as written; (2) `<<...>>` wrapper → name `SECRET_<n>`; (3) bare prefixes `ck_`, `sk_`, `ghp_`, `glpat-`, `xoxb-`, `AKIA` followed by ≥ 16 `[A-Za-z0-9._-]` → name `SECRET_<n>`; (4) a run of ≥ 40 base64 chars **containing both cases and a digit** and not matching `/^[0-9a-f]{40}$/` or a UUID → `SECRET_<n>`.
- Produces: `redact(text, found) → string` replacing each span with `{{secret:NAME}}`.
- Produces: `placeholderNames(text) → string[]` reading `{{secret:NAME}}` back.

- [ ] **Step 1: Write the failing tests**
```js
assert.deepEqual(detect('EGO_API_KEY=ck_abc123def456ghi789jkl0\nhello').map(f=>f.name), ['EGO_API_KEY'])
assert.deepEqual(detect('token glpat-ABCDEFGHIJKLMNOPQRST here').map(f=>f.name), ['SECRET_1'])
assert.deepEqual(detect('sha 1e2cd8614d1353989b561695c331cf9efcfa15cb'), [], 'a git sha is not a secret')
assert.deepEqual(detect('id 3ffed98a-7ffb-800f-9b52-cf0b48569eba'), [], 'nor a UUID')
assert.equal(redact('EGO_API_KEY=ck_abc123def456ghi789jkl0', detect('EGO_API_KEY=ck_abc123def456ghi789jkl0')), 'EGO_API_KEY={{secret:EGO_API_KEY}}')
```
- [ ] **Step 2: Run** `node server/secrets.test.js` — fails to import.
- [ ] **Step 3: Implement** `server/secrets.js`.
- [ ] **Step 4: Run** — PASS. Also run `detect` over every prompt in the 13 real tasks (a throwaway script, not committed) and confirm only `3b84311a` trips.
- [ ] **Step 5: Commit** `feat(secrets): detect and redact`

### Task 2.2: Keep, read, forget — keychain on macOS

**Files:**
- Modify: `server/secrets.js`
- Test: `server/secrets.test.js` (keychain tests run only on darwin; use account `agentflow-test`, clean up in `finally`)

**Interfaces:**
- Produces: `keep(taskId, name, value)`, `read(taskId, name) → string|null`, `forget(taskId, names)`, `env(task) → Record<string,string>` (`FLOW_SECRET_<NAME>` for each of `task.secrets`).
- macOS: `security add-generic-password -U -a <taskId> -s agentflow:<name> -w <value>` / `find-generic-password -a <taskId> -s agentflow:<name> -w` / `delete-generic-password`. Elsewhere: `<data>/secrets/<taskId>.json` created with mode `0o600`.

- [ ] **Step 1: Write the failing tests** — keep then read returns the value; forget then read returns null; `env({id, secrets:['A']})` yields `{ FLOW_SECRET_A: value }`.
- [ ] **Step 2: Run** — fails.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(secrets): keychain-backed keep/read/forget`

### Task 2.3: Secrets through the API and into the agent's shell

**Files:**
- Modify: `server/index.js` (`POST /api/secrets/scan {text} → found[]` without values; `createTask`/`follow-up` accept `secrets: [{name,value}]`), `server/runner.js` (`createTask`, `followUp`, `runClaude` env, `remove` → `forget`), `server/prompts.js` (`preamble` paragraph)
- Test: `server/test.js`

**Interfaces:**
- Consumes: `secrets.env(task)`, `secrets.keep/forget`.
- Produces: `task.secrets: string[]` (names only). `runClaude` spawns with `env: { ...process.env, ...secrets.env(task) }`.
- `createTask`/`followUp` also run `secrets.redact` over every text attachment (`.txt/.md/.env*/.json/.csv`) in the task's uploads dir, in place, with the given values.
- Preamble text when `task.secrets.length`: *"These values exist only in your shell as `$FLOW_SECRET_<NAME>`: NAME, NAME. Use them from there — `printf '%s' "$FLOW_SECRET_NAME" >> .env.prod` — and never print, echo, or write them anywhere you can read them back."* On `acceptEdits` the paragraph instead says they cannot be used without a shell.

- [ ] **Step 1: Write the failing tests** — create a task with `prompt: 'set EGO_API_KEY={{secret:EGO_API_KEY}}'` and `secrets: [{name:'EGO_API_KEY', value:'ck_test_value_1234567890'}]`; the stub writes `process.env.FLOW_SECRET_EGO_API_KEY` to `art/seen-env.txt`; assert the file holds the value, `tasks.json` on disk does not contain `ck_test_value`, nor does the log file. `DELETE /api/tasks/:id` then `read()` returns null. `POST /api/secrets/scan` returns names without values.
- [ ] **Step 2: Run** — fails.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test` — PASS.
- [ ] **Step 5: Commit** `feat(secrets): names on the task, values in the shell`

### Task 2.4: The push guard

**Files:**
- Create: `server/guard-secrets.mjs` (CLI for the agent: `node guard-secrets.mjs <repoPath> <base> <branch>`, reads `FLOW_SECRET_*` from env; exits 1 with `file:line` lines on stderr)
- Modify: `server/git.js` (`scanForSecrets(tree, values) → Array<{file,line}>`; `push()` throws when non-empty), `server/prompts.js` (Land step 3 and Ship run the guard before pushing), `server/runner.js` (`GUARD_SCRIPT` passed as `ctx.guardScript`)
- Test: `server/test.js`

**Interfaces:**
- Produces: `scanForSecrets(tree, values)` — `git diff base...branch` lines starting `+` matched against each value and against `secrets.detect` shapes.

- [ ] **Step 1: Write the failing test** — a task with a kept secret whose stub commits a file containing the raw value; `POST /push` → 400 with the file name; the guard CLI run against that worktree exits 1.
- [ ] **Step 2: Run** — push succeeds today → fails.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test` — PASS.
- [ ] **Step 5: Commit** `feat(secrets): refuse to push a diff that contains one`

### Task 2.5: The form asks, and the existing key is moved

**Files:**
- Modify: `desktop/lib/api.dart` (`scanSecrets(text)`, `create`/`followUp` carry `secrets`), `desktop/lib/screens/sessions.dart`, `desktop/lib/widgets/composer.dart` (before sending: scan prompt + text attachments; dialog listing names, "Keep out of the transcript" checked by default; when the task's permission mode is `acceptEdits` the dialog adds *"Edits only has no shell, so the agent cannot use these."*)
- Create: `scripts/redact-existing.mjs` — scans every task's prompt and log, keeps found values, rewrites the files, prints what it moved and *"rotate these: …"*.
- Test: `desktop/test/screens_test.dart` (dialog golden), `server/test.js` (the script against a fixture task)

- [ ] **Step 1: Write the failing tests.**
- [ ] **Step 2: Run** — fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** both suites — PASS. Run `node scripts/redact-existing.mjs` against the real data once; confirm `3b84311a` is rewritten and tell the person to rotate the key.
- [ ] **Step 5: Commit** `feat(secrets): ask on the form; move the key that is already there`

---

## Part 3 — Ship to prod

### Task 3.1: Per-repo config

**Files:**
- Create: `server/repo-config.js` — `get(repoPath) → { prodBranch: 'prod', jenkins: null | { url, job } }`, `set(repoPath, patch)`, stored at `<data>/repos.json`; Jenkins token via `secrets.keep('repo:'+repoPath, 'JENKINS_TOKEN', value)`.
- Modify: `server/index.js` (`GET/PUT /api/repos/config?repo=<name>`; PUT body may include `jenkinsToken`, never returned)
- Test: `server/test.js`

- [ ] **Step 1: Write the failing test** — PUT `{ prodBranch:'release', jenkins:{url:'http://j', job:'api-prod'}, jenkinsToken:'t' }`; GET returns the first two and no token; `secrets.read('repo:'+path,'JENKINS_TOKEN') === 't'`.
- [ ] **Step 2–5:** run, implement, run, commit `feat(ship): per-repo prod and Jenkins config`.

### Task 3.2: What is left to pick

**Files:**
- Modify: `server/git.js` (`toPick(tree, prodBranch) → { shas: string[], picked: number }` via `git cherry <prod> <branch>`; `status(id)` rows gain `prod: { branch, exists, toPick, picked } | null`)
- Test: `server/test.js`

- [ ] **Step 1: Write the failing test** — fixture repo gains a `prod` branch; after a task commits twice, `GET /git` row has `prod.toPick === 2`; cherry-pick one by hand onto `prod` → `toPick === 1`, `picked === 1`. A repo with no `prod` → `prod.exists === false`.
- [ ] **Step 2–5:** run, implement, run, commit `feat(ship): count what prod is still missing`.

### Task 3.3: The Ship run and the Jenkins watcher

**Files:**
- Create: `server/jenkins.mjs` — `node jenkins.mjs <url> <job>` polls `<url>/job/<job>/lastBuild/api/json` with `Authorization: Basic` from `FLOW_JENKINS_USER:FLOW_JENKINS_TOKEN`, every 15 s, until `building === false`; prints `result`, and on non-SUCCESS the last 60 lines of `consoleText`; exits 0 on SUCCESS, 1 otherwise, 2 after 30 min.
- Modify: `server/prompts.js` (`buildShipPrompt(tree, ctx)`), `server/runner.js` (`shipViaAgent(id, repo)`: refuses when `toPick.length === 0` with `nothing left to pick onto <prod>`; creates `<data>/worktrees/<id>/<repo>-prod` on `prodBranch`; passes `FLOW_JENKINS_*` env when configured), `server/index.js` (`POST /api/tasks/:id/ship {repo}`)
- Test: `server/test.js` (stub answers the ship prompt by cherry-picking the listed shas onto `prod` and pushing it to the fixture origin; a fake Jenkins `http.createServer` answers `building:false,result:'SUCCESS'`)

**Interfaces:**
- Ship prompt lists the exact shas from `toPick`, in order, and the rules: cherry-pick each, resolve with the spec and ask on product decisions, run checks, guard, `git push origin <prod>` never force, then `node <jenkinsScript> <url> <job>` and report its output. "Never merge main into prod" stated.

- [ ] **Step 1: Write the failing tests** — after Land on a fixture task: `POST /ship` → run ends `done`, `prod` has both commits (by `git cherry` showing `-`), and `toPick === 0` afterwards; a second `POST /ship` → 400 `nothing left to pick`.
- [ ] **Step 2–5:** run, implement, run, commit `feat(ship): cherry-pick onto prod and watch Jenkins`.

### Task 3.4: Ship in the app

**Files:**
- Modify: `desktop/lib/api.dart` (`ship`, `repoConfig`, `saveRepoConfig`), `desktop/lib/screens/review.dart` (`RepoCard`: "Ship to prod" when `prod.exists && toPick > 0 && ahead == 0`; a `Configure prod…` dialog; a Jenkins row under CI when configured)
- Test: `desktop/test/screens_test.dart` (repo-card golden with `prod`)

- [ ] **Step 1–5:** golden first, implement, update goldens, commit `feat(ship): the button, the config dialog, the Jenkins row`.

---

## Part 4 — Editable prompts

### Task 4.1: Templates out of code, overrides in data

**Files:**
- Create: `server/prompt-defaults/{spec,plan,implement,review,answer,follow-up,catch-up,land,ship,resume}.md` — the current text with `${ctx.x}` → `{{x}}` and the `quick`/`full` branch of implement as `{{#if quick}}…{{else}}…{{/if}}`.
- Create: `server/templates.js` — `render(template, ctx) → string` supporting `{{name}}` and `{{#if name}}…{{else}}…{{/if}}`; `placeholders(template) → string[]`.
- Modify: `server/prompts.js` — each builder becomes `render(load(name), ctx)`; `load(name)` reads `<data>/prompts/<name>.md` if present and all its placeholders are known, else the default (logging `prompt override <name> uses unknown {{x}}; using default` once).
- Create: `server/templates.test.js`; modify `server/test.js` (prompts still contain the same markers the stub matches on — run the full suite).

**Interfaces:**
- Produces: `KNOWN_PLACEHOLDERS` per prompt name, exported for the API.

- [ ] **Step 1: Write the failing tests** — `render('a {{x}} {{#if y}}Y{{else}}N{{/if}}', {x:1,y:false}) === 'a 1 N'`; `placeholders(...)` → `['x','y']`; an override with `{{nope}}` loads the default and logs.
- [ ] **Step 2–5:** run, implement, run the full `npm test` (every stub marker must still match), commit `refactor(prompts): templates in files, overrides in data`.

### Task 4.2: The prompts API and screen

**Files:**
- Modify: `server/index.js` (`GET /api/prompts` → `[{name, default, custom|null, placeholders}]`; `PUT /api/prompts/:name {text}` → 400 naming an unknown placeholder, else rotates `.1/.2/.3` and writes; `DELETE /api/prompts/:name` → removes; `GET /api/prompts/:name/history` → the kept versions)
- Create: `desktop/lib/screens/prompts.dart` — list on the left, editor on the right, Save / Reset / History; reachable from a gear in the header.
- Modify: `desktop/lib/api.dart`, `desktop/lib/widgets/header.dart`, `desktop/lib/main.dart` (route)
- Test: `server/test.js`; `desktop/test/screens_test.dart` golden

- [ ] **Step 1–5:** tests first for the API (unknown placeholder refused; three saves keep three; reset deletes), golden for the screen; implement; commit `feat(prompts): edit what each agent is told`.

---

## Part 5 — The status line

### Task 5.1: Did / Needs

**Files:**
- Create: `desktop/lib/widgets/status_line.dart` — `StatusLine(task, onJump)`; `did` = first sentence of the last `text` log entry (≤ 140 chars) or, while running, `tool  text` of the last tool entry; `needs` = open question text, or `Your call: <phase>` at a gate, or null.
- Modify: `desktop/lib/screens/workspace.dart` (under the header, above the three panes; `onJump` scrolls the conversation to the end), `desktop/lib/screens/sessions.dart` (row shows `needs` in warn colour when present)
- Create: `desktop/lib/status.dart` — pure `didOf(task)`, `needsOf(task)` for tests.
- Test: `desktop/test/status_test.dart` (pure), `desktop/test/screens_test.dart` (golden)

- [ ] **Step 1: Write the failing tests** — `didOf` picks the last text entry's first sentence; a running task with a tool after the last text reports the tool; `needsOf` returns the question text, then the gate label, then null.
- [ ] **Step 2–5:** run, implement, goldens, commit `feat(status): what it did and what it needs, at a glance`.

---

## Part 6 — The document route

### Task 6.1: A run with no worktree

**Files:**
- Modify: `server/prompts.js` (`RUNS` += `{ value:'doc', label:'Document', hint:'Writes a file, not code. No worktree; the repos are there to read.', phases:['write'] }`; `BODY.write` from `prompt-defaults/write.md`: work in `{{workDir}}`, repos listed read-only, "do not modify anything under them")
- Modify: `server/runner.js` (`createTask` for `run==='doc'`: `root = <artifactDir>/work`, `trees = []`, `readPaths = repoPaths`; `runTask` skips `setupWorktrees` when `run==='doc'`; `runClaude` adds `--add-dir` for each `readPaths`)
- Test: `server/test.js`

- [ ] **Step 1: Write the failing test** — create `run:'doc'` on `['api']`: `trees` is empty, no `data/worktrees/<id>` exists, `root` ends with `/work`; the stub writes `work/estimate.md`; the task ends `done`.
- [ ] **Step 2–5:** run, implement, run, commit `feat(doc): a route that writes a file and checks nothing out`.

### Task 6.2: Output, listed and opened

**Files:**
- Modify: `server/index.js` (`PUT /api/tasks/:id/run {run}` → 400 unless `run === 'doc'` and status is not running; `GET /api/tasks/:id/output` → `[{name, bytes, mtime}]` newest first, capped at 200 with `truncated: true`; `GET /api/tasks/:id/output/<name>` → the file, `text/*` for `.md/.txt/.csv`, else octet-stream; refuses `..`)
- Modify: `desktop/lib/api.dart`, `desktop/lib/screens/workspace.dart` (an `OutputPane` replaces the diff pane when `task.run == 'doc'`: list; `.md`/`.txt` render in `MarkdownView`; others `openExternal(file://…)`), `desktop/lib/screens/sessions.dart` (a "This produced files — switch to the Document route?" banner on an `ask` task whose `work/` is non-empty; Yes calls `PUT /api/tasks/:id/run {run:'doc'}`, which only sets `task.run`; the worktree stays until dropped)
- Test: `server/test.js` (listing, cap, `..` refused), `desktop/test/screens_test.dart` (golden)

- [ ] **Step 1–5:** tests first, implement, goldens, commit `feat(doc): see and open what it produced`.

---

## Finishing

- [ ] Update `README.md`: Continue, Secrets, Ship to prod, Prompts, the status line, the Document route — one short section each, in the README's voice.
- [ ] `npm test` and `cd desktop && flutter test` green; `npm run app -- --install` with the signing identity; relaunch from `/Applications`.
- [ ] Tell the person to rotate the key the migration moved.
