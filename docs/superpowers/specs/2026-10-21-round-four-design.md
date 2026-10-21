# Agent Flow — round four: cost, templates, overlap, phone, preview, smoke

Twelve items the person asked for after round three, in one round. Each is
small; together they close the loop from "typed a task" to "saw it deployed"
without the person typing git, re-explaining, or watching the screen.

## Goals

1. **Shell reads cost money.** 64% of shell calls are `cat`/`sed`. A
   Claude Code hook refuses a plain file read in Bash with "use the Read
   tool", and the task card shows how many reads still went through the
   shell, so the effect is measurable.
2. **The guard's last two holes.** Scan against `origin/<base>` when the
   remote has it (a rebase onto a stale local base no longer re-blames main),
   and scan merge commits' *resolutions* (`--diff-merges=remerge`), not what
   the merge brought in.
3. **Land & ship in one click** when prod is configured for the repo.
4. **Post-deploy smoke.** A per-repo `smoke` command runs after Jenkins
   reports success, inside the ship run, and its result is in the report.
5. **The Document route restates the brief** in three lines before writing
   and, when someone is there, asks once whether that is the job.
6. **Cost on the card, and a line not to cross.** Cost and elapsed time on
   each board row; a per-app threshold (default $20) that, once crossed,
   notifies once and writes a line in the conversation.
7. **Questions on the phone.** A Telegram bot: questions, gates, and
   finishes go to a chat; a reply in that chat answers the question. Token
   in the keychain; chat id in settings.
8. **Two tasks on the same file.** The git row names the other active
   tasks that changed the same files; the card and the status line say so.
9. **Per-repo view.** The board filters by repo, and each row carries what
   became of the branch: landed where, shipped, or still open.
10. **Task templates.** Save the form as a template; start from one.
11. **See the app.** A Preview pane on the workspace shows the latest
    screenshot the agent took, refreshed while it runs, with "Open in
    browser".
12. **Repo config filled** for the three repos the person uses, from what
    is already known about them.

## Non-goals

A web view inside the app (no plugins). Discord. Windows. A second notifier
beyond Telegram.

## Anti-goals

- The hook blocking a shell read that is really a pipeline or a write
  (`cat a | grep`, `cat > f <<EOF`): only a bare read is refused.
- A phone reply answering the wrong question: a reply must quote the
  question's id (the bot puts it in the message) or be a reply-to.
- A cost alert that fires every poll: once per task per threshold.

## The parts

**1. Hook.** `server/hook-reads.mjs` reads the hook JSON on stdin; when
`tool_name === 'Bash'` and the command is a bare read — `^(cat|head|tail|
less|more|bat)\s+[^|;&<>]+$` or `^sed\s+-n\s+[^|;&<>]+$` — it exits 2 with
*"Read files with the Read tool, not the shell."* Every `claude -p` gets
`--settings <data>/claude-settings.json`, written on boot with a
`PreToolUse` hook on `Bash`. The task view carries `toolMix: { bash,
shellReads, read, edit }` counted from the log; the board row shows
`N shell reads` when N > 0.

**2. Guard.** `scanForSecrets` and the guard CLI use `origin/<base>` as the
range start when that ref exists, else `<base>`; and `--first-parent
--diff-merges=remerge -p` instead of `--no-merges`, so a token typed while
resolving a conflict is caught and what main brought in is not.

**3. Land & ship.** `mergeViaAgent(id, repo, { target, then: 'ship' })`:
when the landing run finishes done, `shipViaAgent` starts. The card's menu
gains *Land & ship to prod* when prod exists.

**4. Smoke.** Repo config `smoke` (a command). `ship.md` step 6: after the
watcher exits 0, run it and quote its output; a non-zero exit is said as
*deployed, smoke failed*. Dialog field under Prod.

**5. Restate.** `write.md`: before writing, three lines *"I read this as:
…"*; attended, ask once via the ask script and wait; unattended, put the
three lines at the top of the document.

**6. Cost.** Settings `costWarnUsd` (default 20) in `<data>/settings.json`
via `GET/PUT /api/settings`. In the result handler, when `task.cost`
crosses it and `task.costWarned` is unset: a `decision` line, a
notification, `costWarned = true`. Board row: `$x · 12m`.

**7. Telegram.** Settings `telegram: { chatId }`; token kept under
`app:telegram`/`TOKEN` in the keychain. `server/telegram.js`: `send(text)`
via `sendMessage`; a long-poll loop (`getUpdates` with offset) while
configured. Outbound: every question (`Q <taskId>/<qid>: …`), gate, done,
failed, cost alert. Inbound: a message that is a reply to a question
message, or starts with `<qid>`, answers that question; anything else gets
*"reply to a question to answer it"*. Settings dialog in the app; a
*Test* button sends *"Agent Flow is here"*.

**8. Overlap.** In `status(id)`, for each tree, files changed
(`git diff --name-only baseRef..branch`) are compared with every other task
that is active or done-but-not-landed on the same repo; the row carries
`overlaps: [{ taskId, title, files }]`. The card shows *"also changed by
<title>: a, b"*; `needsOf` adds *"overlaps <title>"* while the task runs.

**9. Repo view.** Board header gains repo chips for the workspace; a chosen
repo filters rows. Each row shows a fate badge from the log's decision
lines: *landed on main*, *shipped*, or nothing.

**10. Templates.** `<data>/templates.json`: `[{ id, name, prompt, repos,
run, permissionMode, model, effort }]`; `GET/PUT/DELETE /api/templates`.
Form: *From template ▾* fills the form; *Save as template* names the
current form.

**11. Preview pane.** Workspace right pane gains a third mode *Preview*
(a segmented toggle Changes / Preview, Output for doc tasks) listing
`<artifacts>/shots/*.png` newest first, showing the newest, polling every
5 s while the task runs; *Open in browser* calls `POST /preview` with no
path and opens the URL.

**12. Config.** `repos.json` entries for mobile-admin-shopify
(`pnpm install --frozen-lockfile && pnpm prisma generate`; copy
`@types/api-routes.d.ts`; checks `pnpm tsc`, `pnpm verify-all`),
mobile-builder (`fvm flutter pub get && fvm dart run build_runner build
--delete-conflicting-outputs`; copy `android/key.properties`), internal-tool
(`pnpm install --frozen-lockfile`; checks `pnpm typecheck`, `pnpm test`).
Written through the API against the live data, verified by reading back.

## Constraints

Same as before: no npm dependency; everything behind a stub e2e or a
widget test; nothing touches the person's checkout beyond Land's courtesy
fast-forward; secrets never in files.

## Order

1 hook → 2 guard → 3 land&ship → 4 smoke → 5 restate → 6 cost → 7 Telegram
→ 8 overlap → 9 repo view → 10 templates → 11 preview → 12 config.
