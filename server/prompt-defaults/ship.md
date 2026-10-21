You are in {{prodWorktree}}, a worktree on {{prodBranch}} of the {{repo}} repo.
Read this repo's CLAUDE.md and follow it.

The work on {{branch}} has landed on {{baseBranch}}. The human asked for it
to reach {{prodBranch}} as well. {{prodBranch}} only ever receives cherry-picks of individual
commits: never merge {{baseBranch}} into {{prodBranch}}, and never rebase or force
anything. Do these in order and stop at the first thing that is not yours to
decide.

1.  Make sure {{prodBranch}} here is current:

        git pull --ff-only origin {{prodBranch}}

    If that is not a fast-forward, or there is no remote, say so and stop.

2.  Cherry-pick these, one at a time, in this order. They are the commits this
    task put on {{baseBranch}}, oldest first.

Commits to pick, oldest first:
{{shaList}}

        git cherry-pick <sha>

    A pick that comes up empty — the change reached {{prodBranch}} some other
    way — is `git cherry-pick --skip`, not a failure. If one conflicts, resolve it. Read {{artifactDir}}/spec.md first where
    it exists: it says what this work was for, which is what tells you which
    side of a conflict carries intent. Where the two sides changed different
    things, keep both. Never take one side wholesale because it is shorter.

    A conflict where both sides changed the same behaviour on purpose is a
    product decision, not a mechanical one. Do not guess:

        "{{node}}" "{{askScript}}" "your question"

3.  Run this repo's own checks on the result and fix what the pick broke.
    Never report a check as passing without having run it and read the
    output. If something is still failing, stop here and say what: do not
    push a {{prodBranch}} you know is broken.

4.  Check the diff for secrets, then push:

        "{{node}}" "{{guardScript}}" "{{repoPath}}" origin/{{prodBranch}} {{prodBranch}}
        git push origin {{prodBranch}}

    If the guard exits non-zero it names file:line of something that looks
    like a secret. Do not push. Take it out of the history, run the guard
    again, and say what you found. Never force. If the remote rejects the
    push, say what git said and stop.
{{#if hasJenkins}}
5.  Watch the deploy. This job deploys {{prodBranch}}; the watcher waits for the build
    the push starts and reports how it went:

        "{{node}}" "{{jenkinsScript}}" "{{jenkinsUrl}}" "{{jenkinsJob}}"

    Exit 0 means it deployed. Exit 1 means the build failed: quote the lines
    it printed and stop; do not try to fix the deploy from here. Exit 2 means
    it could not tell: say so.
{{else}}
5.  No deploy watcher is configured for this repo. End by saying where the
    human should look to see {{prodBranch}} deploy.
{{/if}}
Do not touch any other repo, and do not touch the repo's own checkout at
{{repoPath}}.

End with: what you picked, what conflicted and how you resolved it, what you
ran and its real output, what {{prodBranch}} points at now, and how the deploy went.