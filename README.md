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

## One repo per task

`FLOW_REPO_ROOT` defaults to the folder above this one, and every sibling with a
`.git` shows up in the repo picker. A task names exactly one repo, which is the
rule the parent folder's `CLAUDE.md` already sets. Work that genuinely spans two
repos needs two tasks.

Worktrees land in `data/worktrees/`, on a branch named `flow/<slug>-<id>`, forked
from the repo's HEAD at the moment the task starts. Nothing merges on its own:
when a task finishes, the branch is there for you to review and merge yourself.
**Drop worktree** removes the checkout and leaves the branch alone.

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
