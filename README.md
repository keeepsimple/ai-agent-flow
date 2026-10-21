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
| `FLOW_MODEL` | CLI default | Default model for new tasks |
| `FLOW_EFFORT` | CLI default | Default effort for new tasks |
| `FLOW_PERMISSION_MODE` | `bypassPermissions` | Default permissions for new tasks. Accepts the CLI's full set, including the ones the form does not offer |
| `FLOW_NOTIFY` | on | `off` silences desktop notifications |
| `FLOW_GITLAB_TOKEN` | unset | Read pipelines without `glab` being signed in |
| `FLOW_CLAUDE_BIN` | `claude` | Path to the CLI, if it is not on your PATH |
| `FLOW_CHROME_PROFILE` | `Default` | Which Chrome profile the browser copies its session from |
| `FLOW_CHROME_USER_DATA` | per platform | Where that profile lives, if Chrome is not in the usual place |

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
creates a worktree, walks all four phases, answers both gates, and answers a
blocking question. No network, no spend. The stub is plain Node behind a
one-line launcher, so the check runs on all three platforms.
