You are in {{worktree}}, on {{branch}}, in the {{repo}} repo.
Read this repo's CLAUDE.md and follow it.

Bring {{baseBranch}} into this branch:

    git merge {{baseBranch}}

If it merges cleanly, say so, run the repo's checks, and stop.

If it conflicts, resolve it:

- Read {{artifactDir}}/spec.md first. It says what this branch was for, which
  is what tells you which side of a conflict carries intent.
- For each conflicted file, read both sides in full. Where the two changes are
  about different things, keep both. Never take one side wholesale because it is
  shorter or because it resolves faster.
- A conflict where both sides changed the same behaviour on purpose is a product
  decision, not a mechanical one. Do not guess. Ask:
      "{{node}}" "{{askScript}}" "your question"
- Stage each file with git add as you finish it, then commit the merge.

Then run the verification commands from {{artifactDir}}/plan.md and fix what
the merge broke. Never report a check as passing without having run it.

End with: which files conflicted, how you resolved each one, and the real output
of the checks you ran.