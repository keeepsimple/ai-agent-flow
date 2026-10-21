# Round Four Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Twelve small closures of the task loop: shell reads refused and measured, the guard's last holes, Land & ship, post-deploy smoke, restated briefs, cost on the card with a threshold, Telegram for questions, overlap warnings, a per-repo view with fates, templates, a preview pane, and the three repos configured.

**Architecture:** Each item is a server function plus a route proven against the stub, or a Flutter widget with a test; settings that are not per-repo live in `<data>/settings.json` behind `/api/settings`; secrets in the keychain as before.

**Tech Stack:** Node 24, Flutter 3.47, `claude -p --settings` hooks, git 2.54 (`--diff-merges=remerge`), Telegram Bot API over `fetch`.

**Spec:** `docs/superpowers/specs/2026-10-21-round-four-design.md`

## Global Constraints

- No npm dependency. No Flutter plugin.
- The hook refuses only a bare read: a pipeline, redirection, or `&&` passes.
- A Telegram reply answers a question only when it replies to the bot's question message or starts with the question id.
- The cost alert fires once per task.
- Stub conventions hold (no backslashes in stub source; prompt-substring branches, ship before `--ff-only`; state-changing tests at the end; restart tests last).

## Review Focus

1. The hook sees `cat file | grep x` and `cat > f <<'EOF'`: both pass. *(Task 1 unit.)*
2. A Telegram update with no `reply_to_message` and no leading id: not an answer, gets the hint. *(Task 7.)*
3. A task that crosses the threshold twice (cost keeps growing): one alert. *(Task 6.)*
4. Overlap with a task that already landed: not reported. *(Task 8.)*
5. The preview pane with no shots yet: says so, no poll storm (one request per 5 s only while running). *(Task 11 widget.)*

---

### Task 1: Refuse bare shell reads, count them

**Files:** Create `server/hook-reads.mjs`, `server/hook-reads.test.js`; modify `server/runner.js` (write `<data>/claude-settings.json` on boot in `ensureSettings()`, pass `--settings` in `runClaude`; `toolMix` in `taskView` via `server/index.js`), `desktop/lib/screens/sessions.dart` (row shows `N shell reads`).
**Interfaces:** `isBareRead(command: string) → boolean` exported; `toolMix(log) → { bash, shellReads, read, edit }` exported from `server/store.js`.
- [ ] Test: `isBareRead('cat a.ts')`, `sed -n 1,40p a.ts`, `head -20 a`, `tail -n 5 a` → true; `cat a | grep x`, `cat > f <<EOF`, `cat a && ls`, `sed -i 's/a/b/' f`, `grep -n foo a` → false; the script with stdin `{tool_name:'Bash', tool_input:{command:'cat x'}}` exits 2 with the message, with `ls` exits 0. e2e: the stub records argv; `--settings` points at a file whose JSON has a `PreToolUse` hook on `Bash` naming `hook-reads.mjs`; `GET /api/tasks/:id` has `toolMix`.
- [ ] Implement; run; commit `feat(hook): refuse bare shell reads and count them`.

### Task 2: Guard — origin base, merge resolutions
**Files:** `server/git.js` (`guardBase(tree)` → `origin/<base>` if exists else `<base>`; range `guardBase..branch` with `--first-parent --diff-merges=remerge -p --format=`), `server/guard-secrets.mjs` (same), `server/test.js`.
- [ ] Test: in the landing5 block, a conflict resolved in the worktree by writing `RESOLVED_TOKEN=abcdefgh12345678` → push refused naming the file; the stranger case still passes.
- [ ] Implement; run; commit `fix(guard): origin base, merge resolutions`.

### Task 3: Land & ship
**Files:** `server/runner.js` (`mergeViaAgent(id, repo, { target, then })`; sideRun gains `after` callback), `server/index.js`, `desktop/lib/screens/review.dart` (menu item *Land & ship to prod* when `prod.exists`), `desktop/lib/api.dart`.
- [ ] Test e2e: `POST /merge {repo:'web', then:'ship'}` → done, prod moved, log has both decisions. Widget: menu has the item when prod exists.
- [ ] Implement; run; commit `feat(land): land & ship`.

### Task 4: Smoke after deploy
**Files:** `server/repo-config.js` (`smoke`), `server/prompt-defaults/ship.md` (`{{#if hasSmoke}}` step), `server/templates.js`, `server/prompts.js`, `desktop/lib/screens/review.dart` (field), `server/test.js`.
- [ ] Test: config `smoke:'echo smoke-ok'` → ship prompt contains `echo smoke-ok` and *deployed, smoke failed*; templates test marker.
- [ ] Implement; run; commit `feat(ship): smoke after deploy`.

### Task 5: The Document route restates the brief
**Files:** `server/prompt-defaults/write.md`, `server/templates.test.js`.
- [ ] Test marker `I read this as:`; attended vs unattended branches via `{{#if autoApprove}}` already in doc-preamble → write.md gets `{{#if autoApprove}}` (KNOWN.write += autoApprove).
- [ ] Implement; run; commit `feat(doc): restate the brief first`.

### Task 6: Cost and time on the card; a threshold
**Files:** Create `server/settings.js` (`get()`, `set(patch)`, file `<data>/settings.json`, defaults `{ costWarnUsd: 20, telegram: { chatId: '' } }`); `server/index.js` (`GET/PUT /api/settings`); `server/runner.js` (in `toLogEntry` result branch: threshold check → `decision` + `notify` + `costWarned`); `desktop/lib/screens/sessions.dart` (row `$x · Nm`), `desktop/lib/widgets/header.dart` (*Settings…* button → `SettingsDialog`), create `desktop/lib/widgets/settings_dialog.dart`, `desktop/lib/api.dart`.
- [ ] Test e2e: PUT `{costWarnUsd: 0.015}`; stub result cost 0.01 per run → a task with 2 runs (quick: implement+review) crosses → one decision line `Cost passed $0.015` and `costWarned === true`; a third run (follow-up) adds no second line. Widget: row shows `$1.42 · 3m` for a task with `startedAt`.
- [ ] Implement; run; commit `feat(cost): on the card, and a line not to cross`.

### Task 7: Telegram
**Files:** Create `server/telegram.js` (`configure()`, `send(text, {taskId, questionId})`, `poll()` loop, `handleUpdate(update)` exported pure for tests: returns `{ answered: {taskId, questionId, text} } | { hint: true } | null`), `server/notify.js` (also `telegram.send` when configured), `server/runner.js` (askQuestion → send with ids; answers via `answerQuestion`), `server/index.js` (`PUT /api/settings` accepts `telegramToken` → keychain; `POST /api/settings/telegram-test`), `desktop/lib/widgets/settings_dialog.dart` (chat id, token, Test), `server/telegram.test.js`, `server/test.js` (fake Telegram server with `FLOW_TELEGRAM_API` base URL).
- [ ] Tests: `handleUpdate` with reply_to carrying `Q ab12cd34/q1:` → answered; text `q1 yes` → answered; plain text → hint. e2e: fake API records `sendMessage` calls; a task asks a question → a message with `Q <id>/<qid>:`; the fake serves one update replying → the question is answered and the task finishes.
- [ ] Implement; run; commit `feat(telegram): questions on the phone`.

### Task 8: Overlap
**Files:** `server/git.js` (`overlapsOf(task, tree)` → `[{taskId, title, files}]` over tasks active or done-without-landing on the same repo; row `overlaps`), `desktop/lib/status.dart` (`needsOf` adds overlap while running: needs the row → pass `overlaps` into the task view? No: the server adds `task.overlaps` summary to the task view when running), `desktop/lib/screens/review.dart` (card line).
- [ ] Test e2e: two tasks on `api` both committed `app/services/discount.server.ts` → each row's `overlaps` names the other with the file; after one lands, the other's `overlaps` is empty.
- [ ] Implement; run; commit `feat(git): two tasks on the same file`.

### Task 9: Per-repo view with fates
**Files:** `desktop/lib/fate.dart` (`fateOf(task) → String?` from decision lines: `landed on X`, `shipped to Y`), `desktop/lib/screens/sessions.dart` (repo chips; filter; fate badge), `desktop/lib/flow.dart` (`repoFilter`), tests.
- [ ] Test: `fateOf` on logs; board with repo chips filters rows; badge text.
- [ ] Implement; run; commit `feat(board): per-repo view with fates`.

### Task 10: Templates
**Files:** `server/index.js` (`GET/PUT/DELETE /api/templates` over `<data>/templates.json`), `desktop/lib/api.dart`, `desktop/lib/screens/sessions.dart` (*From template ▾*, *Save as template*), tests.
- [ ] Test e2e: PUT creates with id; GET lists; DELETE removes. Widget: picking a template fills prompt/repos/run.
- [ ] Implement; run; commit `feat(form): templates`.

### Task 11: Preview pane
**Files:** `server/index.js` (`GET /api/tasks/:id/shots` → newest first; `GET /api/tasks/:id/shots/<name>` png), `desktop/lib/widgets/preview_pane.dart`, `desktop/lib/screens/workspace.dart` (pane mode toggle), `desktop/lib/api.dart`, tests.
- [ ] Test e2e: shots listed, `..` refused. Widget: no shots → "No screenshot yet"; with `initial` → image shown and `Open in browser` present.
- [ ] Implement; run; commit `feat(workspace): preview pane`.

### Task 12: Configure the three repos
- [ ] Through the API on the live server (start it if down): PUT repos config for mobile-admin-shopify, mobile-builder, internal-tool per the spec; read back; stop the server if started.

## Finishing
- [ ] README; both suites; fresh review; fix pass; merge; push; build+install.
