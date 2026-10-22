# Agent Flow

Built to the Tern artboards in `design/` (`canvas.json` plus three boards).
Palette, Geist/Geist Mono, spacing and the three-screen split come from there;
anything the artboards show that this tool has no data for (a full file tree, a
context-window meter, a terminal pane) is left out rather than faked.

A local console for running Claude Code on several tasks at once. Each task gets
its own git worktree, writes a spec, writes a plan, stops for your approval at
both, implements, then reviews its own diff. You get a desktop notification when
it needs a decision and when it finishes.

Runs on macOS, Linux and Windows. It needs git and the `claude` CLI on your
PATH, and Node 20 or newer unless you use the app.

```
npm install
npm start          # builds the UI and serves http://127.0.0.1:7777
```

`npm run dev` runs the server plus Vite with hot reload on :5173.

### Or as a macOS app

```
npm run app        # dist/Agent Flow.app
```

Same server, same UI, in a real window. Not a web view: the interface is a
Flutter app drawn by Skia, and one Dart source builds it for both macOS and
Windows. It starts the server as a child, waits for the port, and takes the
server down when you quit — which takes its agents down with it.

Links that leave the tool — a merge request, a pipeline — open in your own
browser rather than taking over the window.

Three things this buys that the web mode cannot have:

- **It can be granted Full Disk Access itself.** In the web mode that
  permission is held against whichever terminal you started the server from,
  which is why copying your Chrome session is refused there by default.
- **It carries its own Node**, downloaded from nodejs.org and checked against
  the release SHASUMS at build time, so the machine running it needs none. A
  Homebrew `node` is not used for this: it links against a dozen Homebrew
  dylibs and would die on the first machine without them. The build refuses
  any runtime that borrows a library from outside `/usr/lib`.
- **It is an application**, with its own Dock icon, its own menu bar and its
  own window position.

A Flutter window has no `Notification` API, so the server raises the desktop
notification itself. It decides that by counting the clients that can raise
one rather than the clients that are connected — which also closes the same
hole in the web mode, where a tab that was never granted permission silenced
the server while raising nothing itself. `/api/state` reports both counts
(`watching`, `notifying`).

The app is sandbox-free on purpose. A sandboxed process cannot spawn Node, let
alone the `git` and `claude` it goes on to run, and cannot hold Full Disk
Access either — which is half the reason the app exists.

Building needs the Flutter SDK; running does not. Flutter desktop does not
cross-compile, so build on the platform you want the app for:

```
npm run app        # macOS -> dist/Agent Flow.app
                   # Windows -> dist/Agent Flow/agent_flow.exe
```

**The Windows build has never been run.** The source is one tree, the
platform-specific paths are written and read as Windows paths, and the file
picker and clipboard go through PowerShell there rather than osascript — but
this was built on a Mac, and none of that has been executed. Treat the first
Windows build as something to debug, not something to ship.

```
cd desktop && flutter test              # renders every screen to test/goldens
cd desktop && flutter test --update-goldens
```

Those goldens are the only way to look at this UI without sitting at the
machine, and they fail when a layout overflows or throws — which is the class
of bug a desktop window hides until someone resizes it.

It still needs `git` and `claude`. A GUI app inherits almost no `PATH`, so the
app adds `~/.local/bin`, `/opt/homebrew/bin` and `/usr/local/bin` before
starting the server; a `claude` installed somewhere else needs
`FLOW_CLAUDE_BIN`. Running from source rather than from a packaged app, it
looks for Node in those same places and then asks a login shell, because
`node` on its own resolves to nothing in a GUI process.

Data goes to `~/Library/Application Support/Agent Flow`, not inside the bundle,
and repos are looked for under your home folder until you add a folder in the
UI. Starting it when the server is already up just opens the browser.

### Signing, and why it decides whether you grant that twice

macOS remembers a permission against the app's *designated requirement*, and
what that is depends on how the app was signed:

```
ad-hoc            designated => cdhash H"dc4872a1..."
a certificate     designated => identifier "..." and ... leaf[subject.OU] = TEAMID
```

Ad-hoc costs nothing and needs no account, but its identity is the hash of the
bundle, so **every rebuild is a different app** and Full Disk Access has to be
granted again. A certificate fixes the identity to the bundle id and the team,
which does not change when the contents do, so the grant survives rebuilds and
survives moving the app.

Any certificate will do — an `Apple Development` one from a free Apple ID is
enough, and no Developer Program membership is needed for a build you run
yourself:

```sh
security find-identity -v -p codesigning
FLOW_SIGN_IDENTITY="Apple Development: you (TEAMID)" npm run app
```

Signing this way is for your own machines. Handing the app to someone else
needs a `Developer ID Application` certificate and notarisation, which is what
the Developer Program is for.

Re-signing drops whatever entitlements were applied at build time, so the
build passes `Release.entitlements` back in. Without that the app would lose
the ones that let it leave the sandbox, which it only survived before because
*no* entitlements also means no sandbox.

## Three screens

```
#/                Sessions   the board: start a task, see every one at a glance
#/t/<id>          Workspace  explorer · conversation · the diff as it is written
#/t/<id>/review   Review     changed files · diff · summary, checks and merge
```

## How a task runs

```
Normal  (nothing chosen)
  worktree -> one run

Just build it
  worktree -> implement -> review

Spec, plan, then build
  worktree -> spec -> [your call] -> plan -> [your call] -> implement -> review

Lead and specialists
  worktree -> split -> [your call] -> N pieces, each its own task -> integrate
```

Most of what gets typed into a box like this is a question, or a change small
enough that the ceremony costs more than the work. That is the route you get by
choosing nothing: one run, no documents, no self review. Nothing downstream
catches a mistake on it, which is the trade.

The two longer routes are opt-in. **Just build it** skips the documents but
keeps the review, because the review is the phase that catches the bug and it
is cheap next to implement. **Spec, plan, then build** stops for you twice
before any code moves.

The question channel stays open on all three.

Each phase is a separate `claude -p` run in the worktree. They hand off through
files, not through a shared session, so a failed phase can be retried on its own.
The spec, plan and review documents live outside the repo (in `data/tasks/<id>/`)
so nothing the workflow writes about itself ends up in your commits.

The review phase is not a rubber stamp: it diffs against the pinned base commit
and goes through correctness, code quality, over-engineering, performance and
security, fixes what it finds, and writes `review.md`.

**Run unattended** means nobody is watching: both gates are skipped, and where
the agent would have asked you something it decides instead and writes the
assumption into that phase's document. The prompt tells it so up front, rather
than letting it waste a turn on a question that will never be answered.

A **title is optional**. Leave it blank and the first line of the request stands
in until the first phase has read the code and can name the work.

The branch has to exist before anything has read the request, so it is named
from the request itself. Accents are split off their letters rather than taken
with them, so a request in any language still slugs to something readable, and
once the agent has named the task — in English, which the prompt asks for — the
branch is renamed to match. A branch already on a remote is left alone.

## Lead and specialists

The fourth route is for work that is genuinely several pieces at once: three
screens, four endpoints, a migration plus the code that reads it.

A lead agent gets a worktree and one job — read the code and decide what the
independent pieces are. It writes `split.json` in the task's artifacts folder:
a title, a prompt and optionally a subset of the repos, per piece. Then it
stops for you, like the spec and plan gates do, and nothing has been started
yet.

Approve it and each piece becomes **an ordinary task**: its own worktree, its
own branch, its own self review, its own row on the board, its own Land button.
They run through the same queue as everything else, so `FLOW_MAX_CONCURRENT`
still decides how many agents are alive at once — the lead gives its own slot
back while it waits, so a cap of one cannot deadlock on a piece queued behind
the lead holding the only slot.

What you type into the gate's feedback box goes to every piece, not to the
lead: by the time you read the split, the lead's work is done and the pieces
are the ones who have not started.

When the last piece stops — done, failed or cancelled — the lead comes back and
merges each branch into its own, in the order they were created, resolving what
the seams turn up with the whole request in hand. Then the repo's checks, then
a review of the lot as one change, into `review.md` with the usual `## Left`.

- A piece says nothing on its own account: no desktop notification, no
  Telegram, for a piece that merely finished. A **question** or a **failure**
  still reaches you, because those are the ones only you can clear.
- A piece inherits the lead's model, effort, permissions and attachments, and
  **none of its secrets** — a piece that needs a key has to be given one by
  hand, on its own task.
- Cancelling the lead cancels every piece still running. The branches stay.
- At most six pieces (`FLOW_MAX_PIECES`). A lead that asks for fifteen has not
  understood the work, and fifteen agents is real money.
- Interrupted mid-wait — the app quit, the laptop slept — the lead waits again
  on resume rather than integrating branches that are still being written.
  Retrying a failed integrate re-merges; it does not re-split.

The cost of this route is N agents in parallel, so it is the most expensive
thing here by a wide margin. A change that is really one change is cheaper and
better on **Just build it**.

## Per task: model, effort, permissions

Every task carries its own three settings, defaulted from the environment and
changeable on the form:

- **Model**: `fable`, `opus`, `sonnet`, `haiku`, or the CLI's own default.
- **Effort**: `low` through `max`, or the CLI's default. How hard it thinks per turn.
- **Permissions**: *Full access* (`bypassPermissions`) runs anything inside the
  worktree without asking. *Edits only* (`acceptEdits`) can write files but is
  denied a shell, so the plan's test commands will not run.

All three are validated against a fixed list before they go anywhere near a
command line. They apply to all four phases of that task.

Anything with no shell has nobody to answer a permission prompt, so modes other
than Full access also get `--permission-prompts none`: a tool call that would
have asked is denied straight away instead of stalling the phase.

## Pasting images

Paste a screenshot or a Figma frame straight into the task box, the gate feedback
box, or an answer. The file is uploaded to `data/uploads/`, the thumbnail shows
up under the field, and the agent is told to open it with the Read tool before it
decides anything about layout or wording.

Uploads are checked on their bytes, not their headers: PNG, JPEG, GIF and WebP
only, 10 MB each. A path that does not resolve inside `data/uploads/` is refused,
so a task cannot be talked into attaching `/etc/passwd`.

For images pasted mid-task, the path travels inside the text that goes back to
the agent, and the uploads folder is always on the agent's allowed list.

## When the agent needs you mid-phase

The agent gets a script it can run to ask you something:

```sh
node /path/to/agent-flow/server/ask.mjs "live Shopify API, or the cached copy?"
```

The prompt hands it the absolute path, so there is nothing to install in the
worktree and nothing that assumes a shell.

That call blocks until you answer in the UI, and the answer comes back on stdout.
The prompt tells the agent to use it for decisions only you can make, not for
things it could find by reading the code.

## When it is not quite right

A finished task keeps a box at the bottom. Say what is wrong and it picks the
work back up on the same branches, in the same worktrees, with the spec and the
review it already wrote: no new task, nothing to re-explain.

```
the build is broken, pnpm typecheck fails in orders.service.ts
```

Paste the error, or a screenshot of it. The prompt tells it to reproduce the
failure before touching anything, because a fix for a failure nobody has seen is
a guess. A task that is done stays done when the follow-up ends; one that failed
comes back as whatever it is then.

This is also what **Catch up with \<base\>** runs on, so both are the same thing:
one agent run on a task that already happened.

## When the machine went to sleep

A run that was cut off — the app quit, the laptop slept long enough for the
CLI's connection to drop — is not failed. It is **interrupted**, and it keeps
the session it was in. On launch the app continues every interrupted task by
itself; the sidebar has a switch to make that a button instead. Continue runs
`claude --resume` with one instruction: look at what is actually on disk,
compare it with what you remember doing, carry on. A session the CLI will not
continue falls back to a fresh run and says so in the conversation.

Typing `tiếp tục` (or `continue`) into the box of a finished task continues its
last session the same way, instead of opening a new run that has to be told the
story again.

## Secrets: used, never kept

Paste a key into a prompt and the form notices — `NAME=value` with a name like
`*_KEY`, `*_TOKEN`, `*_SECRET`, `*_PASSWORD`; the usual prefixes (`ck_`, `sk_`,
`ghp_`, `glpat-`, …); or anything you wrap in `<<…>>` by hand — and asks once:
keep it out of the transcript? Yes is the default.

Kept values go to the macOS keychain under the task (a file only you can read,
elsewhere). The conversation, the log and the task record show
`{{secret:NAME}}` instead. When a run starts, each value reaches the agent only
as `$FLOW_SECRET_NAME` in its shell, and the prompt says to use it from there —
`printf '%s' "$FLOW_SECRET_NAME" >> .env.prod` — and never print it. A task on
*Edits only* has no shell and is told so. Deleting the task deletes its secrets.

Before anything is pushed — the Push button, Land, Ship — the diff is checked
for the kept values and for anything shaped like a secret. A hit names the file
and line and nothing moves. The agent runs the same guard itself before it
pushes.

Already have a key in an old task? With the server stopped:

```sh
node scripts/redact-existing.mjs
```

It moves what it finds to the keychain, rewrites the files, and lists what to
rotate, because those values have already been in a model's context.

## Landing: the remote is the truth

**Land on main ▾** on the repo card: the base by default, or any branch the
remote or the checkout knows, or a name typed in (the push creates it). The
last target is remembered per repo. The run catches the target up, runs the
checks and the secrets guard, pushes the branch, opens the merge request,
and then pushes `branch:target` to the remote — a fast-forward or nothing.
That is the step that counts: the deploy reads the remote. Your own checkout
is fast-forwarded only as a courtesy, when it is on that branch and nothing
untracked sits in the way; otherwise the run says so in one line and
finishes, and a `git pull` later is yours.

## A worktree that arrives ready

**Repo…** on the card, under *Worktree*:

- **Setup command** runs in every fresh worktree before the first phase
  (`pnpm install --frozen-lockfile && pnpm prisma generate`). Its output is
  in the conversation; a failure is said and the run still starts; a command
  that never ends is cut after ten minutes.
- **Copy from the checkout**: generated, gitignored files a fresh worktree
  lacks (`@types/api-routes.d.ts`, `android/key.properties`).
- **Checks**: the repo's gate (`pnpm tsc`, `pnpm verify-all`). They run once
  at the base commit before the agent starts, into `baseline/` under the
  task's artifacts, and the prompt names which were already red. A failure
  that was red at base is not the agent's, and it is told so.

## Shell reads, cost, and the phone

Every run gets a hook that refuses a bare file read through the shell
(`cat`, `sed -n`, `head`, `tail`) with *use the Read tool*; a pipeline or a
redirection is not a read and passes. The board row says how many reads
still went through the shell, so the effect is visible.

**Settings…** in the header: a cost line per task (default $20) that, once
crossed, writes a line in the conversation and notifies, once; and a
Telegram bot. With a chat id and a bot token (keychain), questions, gates,
finishes and cost lines go to the chat, and replying to a question message
answers it. *Test* sends one message. Every message carries what the agent said last, so it reads on the phone; a long one is split into several messages, and past three the rest waits behind a *Show more* button. Send `/status` to the bot for what is running and what is waiting on you, `/task <id>` for one task's latest lines, `/help` for the list.

Each board row carries `$cost · elapsed`, what became of the branch
(*landed on main*, *shipped to prod*), and the board filters by repo. The
repo card names other tasks that changed the same files and have not landed.
**Land & ship to prod** in the Land menu runs both.

**Repo…** gains a *Smoke command* that the ship run executes after the
deploy and quotes. The workspace's right pane has a screenshot toggle: the
latest one the agent took, refreshed while it runs, with *Open in browser*.
**From template** and **Save as template** on the form keep a prompt, its
repos and its route for next time.

## What the review leaves

The self-review fixes what it finds in the files it touched. What it leaves
goes under `## Left` in `review.md`, one line each, tagged `fixable:` or
`decision:`. The explorer lists them; **Fix the N left** sends one follow-up
that clears the fixable ones. Decisions are shown, never sent.

## Ship to prod

Land puts a branch on its base. **Ship to prod** on the repo card, enabled once
it has landed, takes the task's commits to the prod branch — by cherry-pick,
one at a time, oldest first, in a worktree on prod. Never by merging main in,
never with force. Conflicts are resolved with the spec in hand; a product
decision is asked, not guessed. Then the repo's checks, the secrets guard, and
`git push origin prod`.

Ship is refused when there is nothing left to pick (counted by patch, so a
cherry-pick done by hand counts), when the branch has not landed yet, and on a
repo that has no prod branch. **Prod…** on the card names the branch (default
`prod`) and, optionally, the Jenkins job that deploys it: URL, job, user, API
token. The token goes to the keychain. With Jenkins set, the ship run ends by
watching the deploy — it waits for the build the push starts, then for it to
finish, and quotes the console tail if it fails.

## Prompts

Everything the agents are told is a template you can edit: **Prompts** in the
header, when no task is open. Each has the placeholders it is given listed
above the editor — `{{prompt}}`, `{{artifactDir}}`, … — and
`{{#if x}}…{{else}}…{{/if}}` for the branches. An override that names a
placeholder the prompt does not get is refused. Saves keep the last three
versions; Reset puts the default back. Overrides live at
`<data>/prompts/<name>.md`, so they survive updates and travel with the data.

## The status line

Under the header of every task, one line: **Did** — the first sentence of the
agent's last message, or the tool it is on while running — and **Needs** — the
open question, the gate it is waiting at, or nothing. Click it to go to that
message. The board shows the same Needs on each row, so twelve tasks say which
two are waiting on you.

## The Document route

Beside normal, build and full there is **Document**: for an estimate, a
write-up, a table. No worktree. The agent works in a folder under the task,
with the repos reachable to read and told not to touch them. The workspace
shows an **Output** pane in place of the diff: the files it produced, newest
first; Markdown and text render in place, anything else opens with the system.
A normal-route task that produced a file (the prompt tells it where to put one)
is offered the switch.

## Repos: one, several, or all of them

`FLOW_REPO_ROOT` defaults to the folder above this one, and every sibling with a
`.git` shows up in the picker. Tick one for an ordinary change, or tick several
when a feature genuinely spans repos. **Whole directory** ticks all of them.

Every ticked repo gets its own worktree, under `data/worktrees/<task-id>/<repo>`,
on a branch named `flow/<slug>-<id>`, forked from that repo's HEAD at the moment
the task starts. Same branch name across repos, so a cross-repo feature is easy
to find later.

With one repo the agent runs inside its worktree, so the CLI picks up that repo's
`CLAUDE.md` the usual way. With several it runs one level up, the prompt names
every worktree, and it is told to read each repo's `CLAUDE.md`, commit per repo,
and say which repo has to deploy first.

Nothing merges on its own. When a task finishes, each repo's row shows how many
commits the base branch is missing and offers two buttons:

- **Push** runs `git push -u <remote> <branch>` so the branch exists on the
  remote and can be turned into an MR.
- **Push \<base\>** appears once a local merge has left the base branch ahead of
  its own remote, with the count beside it. Neither push ever forces: if the
  remote has moved, git says so and you get its words.
- **Merge into \<base\>** hands the whole landing to an agent, in this order:
  bring the base in here and resolve what that turns up, run the repo's checks,
  push the branch, open a merge request against the base, and only then merge
  into the base in your own checkout and push it.

  The merge request comes first on purpose: it is the record, so if it cannot
  be opened — no `glab` or `gh`, or not signed in — the run stops there and
  says so rather than landing anything.

  The merge itself is `--ff-only`. After the catch-up it is a fast-forward, so
  it cannot conflict and cannot write a merge commit into the base; if git
  refuses, the base moved underneath and it starts again rather than forcing.
  A checkout on another branch, or with uncommitted changes to files the merge
  touches, stops it with those files named.
- **Catch up with \<base\>** appears when the base has moved on. It runs an agent
  that merges the base *into the task's branch*, inside the worktree, resolving
  conflicts with the spec in hand and asking you when a conflict is a product
  decision rather than a mechanical one. Your own checkout is not touched, so a
  resolution you dislike costs a branch and nothing else. Afterwards the merge
  into the base is a fast-forward, which cannot conflict.

Neither button deletes the branch, and none of this is automatic.

Both read the branch through the repo rather than the worktree, so **Drop
worktrees** frees the disk without taking the work out of reach.

## Looking at the running app

A Shopify app cannot be checked by reading the diff: the screen is the thing.
Where a worktree has a `shopify.app.toml`, the agent gets a second script:

```sh
node /path/to/agent-flow/server/preview.mjs            # start it, print its URL
node /path/to/agent-flow/server/preview.mjs /app/plans # open that path
```

The second form returns the page's visible text and saves a screenshot the
agent opens with its Read tool.

**`shopify app dev` rewrites an app's URLs on the Partner dashboard**, so which
app it points at is the whole safety question, and this never guesses it. Pick
a repo with a `shopify.app.toml` and two more chips appear on the form: the app
config and the dev store. The configs are the `shopify.app.<name>.toml` files
beside the repo, each already paired with the store the CLI remembered for it.

The live `shopify.app.toml` is deliberately not offered: that is the file
`shopify app dev` rewrites.

With nothing picked it refuses rather than falling back to whatever is linked.
Your last choice is remembered in `data/shopify.json`, and
`FLOW_SHOPIFY_CONFIG` / `FLOW_SHOPIFY_STORE` seed it the first time.

It runs with `--no-input`, so anything it would have asked fails the run rather
than hanging on a prompt nobody can answer, and it logs the app name, client id,
store and the URL being repointed before it starts. The dev server stops when
the task finishes or is cancelled.

The browser is a Chrome the tool owns, with its own profile under `data/chrome`.
It cannot be the browser you already have open: that one was started without a
debugging port, the flag cannot be added to a running process, and Chrome
refuses it outright on its default directory.

So the first start copies the session out of the Chrome you already use, and
you are signed in without doing anything. Cookies, local storage and
preferences cross; history, cache and extensions do not. It happens once, while
`data/chrome` is still empty — after that the copy has its own life, and
signing out in one does not sign you out of the other. Delete `data/chrome` to
take a fresh copy.

**macOS keeps that folder behind Full Disk Access**, held against whatever
runs this server rather than against Chrome. In the web mode that is your
terminal; the macOS app exists partly so it can hold that permission itself.
Without it the copy is refused, **Test browser** says so, and you get a blank
profile to sign into by hand.
`FLOW_CHROME_PROFILE` picks which profile to copy when you have several
(`Default`, `Profile 1`, …), and `FLOW_CHROME_USER_DATA` points at the folder
holding them.

## Pipeline status

Once a branch is pushed, its row shows what CI made of it, linked to the
pipeline. It reads through the `glab` CLI, so no token lives in this tool or its
config. Sign in once per host:

```sh
glab auth login --hostname gitlab.abcsoft.vn
```

Until you do, the row says `CI unavailable` and hovering it gives you that
command. `FLOW_GITLAB_TOKEN` works instead for a machine without `glab`. GitHub
remotes are skipped: there is no equivalent read here yet.

Lookups are cached for 20 seconds and refreshed in the background, so a slow
network never makes the row stutter.

## Disk

A worktree shares the repo's history but keeps its own `node_modules`, pods and
build output. One task here reached 1.1 GB, and a Flutter checkout is several
times that. The sidebar footer shows the total; clicking it lists every task's
checkout and offers to drop the finished ones in one go.

Dropping frees the checkout and nothing else: the branch and its commits stay.
Directories under `data/worktrees/` with no task left to own them are listed
separately and swept with the same button.

## On another machine

Nothing is installed globally and nothing is configured per machine. Clone it,
install, start:

```sh
git clone https://github.com/keeepsimple/ai-agent-flow.git
cd ai-agent-flow
npm install
npm start
```

What has to already be there:

| | Why |
| --- | --- |
| **Node 20+** | `npm test` and the server both run on it |
| **git** | worktrees are the whole isolation model |
| **`claude` on your PATH**, signed in | every phase is a `claude -p` run. `claude` on its own should answer before you start this |
| **Your repos in one folder** | the folder *above* this one is scanned for anything with a `.git`. Clone this beside them, or set `FLOW_REPO_ROOT` |

Everything else is optional and only matters for the feature it belongs to:
`glab auth login` for pipeline status, `terminal-notifier` for clickable
notifications on macOS, Chrome for the preview browser.

Nothing carries over from this machine. `data/` is ignored by git, so tasks,
logs, worktrees, uploads and your Shopify choice all stay where they were made.
A machine with its own `~/.claude/settings.json` picks that up on its own.

## Settings

| Env | Default | What it does |
| --- | --- | --- |
| `FLOW_PORT` | `7777` | HTTP port, loopback only |
| `FLOW_REPO_ROOT` | parent folder | Where repos are discovered |
| `FLOW_DATA` | `./data` | Tasks, logs, artifacts, worktrees |
| `FLOW_MAX_CONCURRENT` | `3` | Tasks running at the same time |
| `FLOW_MAX_PIECES` | `6` | How many pieces a lead may split one request into |
| `FLOW_MODEL` | CLI default | Default model for new tasks |
| `FLOW_EFFORT` | CLI default | Default effort for new tasks |
| `FLOW_PERMISSION_MODE` | `bypassPermissions` | Default permissions for new tasks. Accepts the CLI's full set, including the ones the form does not offer |
| `FLOW_NOTIFY` | on | `off` silences desktop notifications |
| `FLOW_GITLAB_TOKEN` | unset | Read pipelines without `glab` being signed in |
| `FLOW_CLAUDE_BIN` | `claude` | Path to the CLI, if it is not on your PATH |
| `FLOW_CHROME_PROFILE` | `Default` | Which Chrome profile the browser copies its session from |
| `FLOW_CHROME_USER_DATA` | per platform | Where that profile lives, if Chrome is not in the usual place |
| `FLOW_AUTO_RESUME` | on | `0` leaves interrupted tasks for the Continue button (the sidebar switch sets this) |
| `FLOW_WATCHDOG_MS` / `FLOW_SLEEP_JUMP_MS` / `FLOW_SILENT_MS` | 60s / 180s / 10min | How a sleep is noticed, and how long a run may be silent after one before it counts as interrupted |
| `FLOW_JENKINS_POLL_MS` / `FLOW_JENKINS_START_MS` / `FLOW_JENKINS_MAX_MS` | 15s / 2min / 30min | The deploy watcher: poll interval, how long to wait for a new build to start, how long to wait for it |

## The risk worth knowing about

**Stop really stops.** The agent runs in its own process group and cancelling
signals the whole tree, then follows up with SIGKILL. On this machine `claude` is
a shell wrapper around the real binary, and signalling only the wrapper left the
agent alive, spending money against a worktree nobody was watching. Killing the
server takes its agents with it for the same reason.

Permissions default to `bypassPermissions`. An agent running under it can run any
command in its worktree without asking, which is the only way the implement phase
works unattended. The server listens on `127.0.0.1` only, for exactly that
reason. Pick *Edits only* on a task you would rather keep away from a shell, and
expect its verification commands to be denied.

## Notifications

With the tab open, the notification comes from the browser, and clicking it
focuses this window and opens the task it is about. Turn it on with **Notify me**
in the header the first time.

When nothing watching can raise one, the server raises a desktop notification
instead, so closing the browser does not mean missing the end of a run.

The test is whether anyone *can* raise one, not whether anyone is watching. A
tab that was never granted permission is watching and silent, and so is the
app's window, which has no `Notification` API at all — both say so when they
connect, and the server falls back for both. On macOS that goes through
`terminal-notifier` when it is installed (`brew install terminal-notifier`),
because clicking that one opens the web app. Without it the fallback is
`osascript`, whose notifications belong to Script Editor, so clicking one opens
Script Editor rather than anything useful.

## Platform notes

The desktop fallback uses `terminal-notifier` or `osascript` on macOS,
`notify-send` on Linux, and a PowerShell toast on Windows. A machine without a
notification daemon just gets no popup; nothing else changes.

On Windows the `claude` CLI is a `.cmd`, which Node will not spawn directly, so
the child goes through `cmd.exe`. The prompt is piped in on stdin rather than
passed as an argument, which keeps it off the command line entirely on every
platform. Stopping a task uses `taskkill /T` there, because killing the wrapper
alone would leave the agent running underneath.

Windows also still has a 260 character path limit in places. If a repo name is
long, point `FLOW_DATA` somewhere short like `C:\flow` so the worktrees stay
well inside it.

## Checks

`npm test` drives the whole machine end to end against a stubbed `claude`: it
creates a worktree, walks all four phases, answers both gates, answers a
blocking question, lands on the base and on a branch the remote does not have
yet, pushes past untracked files in the checkout, ships to a prod branch,
kills the server mid-run and continues the session, keeps a secret out of
every file and refuses to push it (but not for a token that came in from
main), runs a repo's setup and baseline into a fresh worktree, splits one
request into two pieces and merges both branches back into the lead's, and
overrides a prompt. No network, no spend. The stub is plain Node behind a
one-line launcher, so the check runs on all three platforms.
