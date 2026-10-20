# Agent Flow

A local console for running Claude Code on several tasks at once. Each task gets
its own git worktree, writes a spec, writes a plan, stops for your approval at
both, implements, then reviews its own diff. You get a desktop notification when
it needs a decision and when it finishes.

Runs on macOS, Linux and Windows. It needs Node 20 or newer, git, and the
`claude` CLI on your PATH.

```
npm install
npm start          # builds the UI and serves http://127.0.0.1:7777
```

`npm run dev` runs the server plus Vite with hot reload on :5173.

## How a task runs

```
worktree  ->  spec  ->  [your call]  ->  plan  ->  [your call]  ->  implement  ->  review
```

Each phase is a separate `claude -p` run in the worktree. They hand off through
files, not through a shared session, so a failed phase can be retried on its own.
The spec, plan and review documents live outside the repo (in `data/tasks/<id>/`)
so nothing the workflow writes about itself ends up in your commits.

The review phase is not a rubber stamp: it diffs against the pinned base commit
and goes through correctness, code quality, over-engineering, performance and
security, fixes what it finds, and writes `review.md`.

Tick **Run unattended** on a task to skip both approval gates.

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

Nothing merges on its own. When a task finishes the branches are there for you to
review and merge yourself, one repo at a time. **Drop worktrees** removes the
checkouts and leaves every branch alone.

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
| `FLOW_MAX_BUDGET_USD` | unset | Per-phase spend cap |
| `FLOW_NOTIFY` | on | `off` silences desktop notifications |
| `FLOW_CLAUDE_BIN` | `claude` | Path to the CLI, if it is not on your PATH |

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

## Platform notes

Notifications use `osascript` on macOS, `notify-send` on Linux, and a PowerShell
toast on Windows. A machine without a notification daemon just gets no popup;
nothing else changes.

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
