# Agent Flow

A local console for running Claude Code on several tasks at once. Each task gets
its own git worktree, writes a spec, writes a plan, stops for your approval at
both, implements, then reviews its own diff. You get a macOS notification when it
needs a decision and when it finishes.

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

## When the agent needs you mid-phase

The agent gets a script it can run to ask you something:

```sh
"$FLOW_ARTIFACTS/ask" "should this hit the live Shopify API or the cached copy?"
```

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
| `FLOW_PERMISSION_MODE` | `bypassPermissions` | Passed to `claude --permission-mode` |
| `FLOW_MAX_BUDGET_USD` | unset | Per-phase spend cap |
| `FLOW_NOTIFY` | on | `off` silences macOS notifications |

## The risk worth knowing about

The default permission mode is `bypassPermissions`. An agent running under it can
run any command in its worktree without asking, which is the only way the
implement phase works unattended. The server listens on `127.0.0.1` only, for
exactly that reason. Set `FLOW_PERMISSION_MODE=acceptEdits` if you would rather
it could edit files but not run commands, and expect phases that need a shell to
stall.

## Checks

`npm test` drives the whole machine end to end against a stubbed `claude`: it
creates a worktree, walks all four phases, answers both gates, and answers a
blocking question. No network, no spend.
