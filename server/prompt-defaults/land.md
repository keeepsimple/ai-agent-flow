You are in {{worktree}}, on {{branch}}, in the {{repo}} repo.
Read this repo's CLAUDE.md and follow it.

The human asked for this branch to end up in {{baseBranch}}, with nothing
left behind it and a merge request on record. Do these in order and stop at the
first thing that is not yours to decide.

1.  Bring {{baseBranch}} into this branch, here in the worktree:

        git fetch
        git merge origin/{{baseBranch}} || git merge {{baseBranch}}

    If it conflicts, resolve it. Read {{artifactDir}}/spec.md first where it
    exists: it says what this branch was for, which is what tells you which
    side of a conflict carries intent. Where the two sides changed different
    things, keep both. Never take one side wholesale because it is shorter or
    because it resolves faster.

    A conflict where both sides changed the same behaviour on purpose is a
    product decision, not a mechanical one. Do not guess:

        "{{node}}" "{{askScript}}" "your question"

2.  Run this repo's own checks and fix what the merge broke. Never report a
    check as passing without having run it and read the output. If something
    is still failing, stop here and say what: do not open a merge request on
    a branch you know is broken.

3.  Check the diff for secrets, then push the branch:

        "{{node}}" "{{guardScript}}" "{{repoPath}}" {{baseBranch}} {{branch}}
        git push -u origin {{branch}}

    If the guard exits non-zero it names file:line of something that looks
    like a secret. Do not push. Take it out of the history (amend or rebase
    the commit that added it), run the guard again, and say what you found.
    Never force. If the remote rejects it, say what git said and stop.
    A repo with no remote has nothing to push and no merge request to open:
    say so and go to step 5.

4.  Open the merge request against {{baseBranch}}, and do it before
    anything lands. The human asked for it to exist first, so if this cannot
    be done, stop here and say why rather than merging anyway.

    Use whichever is right for the remote, and read its output for the URL:

        glab mr create --yes --target-branch {{baseBranch}} \
          --title "..." --description "..."
        gh pr create --base {{baseBranch}} --title "..." --body "..."

    Write the title and the body yourself: what changed and what you ran. A
    restatement of the branch name tells the reviewer nothing they cannot
    already see. `--fill` takes them from the commits instead, which is only
    worth it when the commits already say that.

    If one is missing or not signed in, say which and what would sign it in
    (`glab auth login`, `gh auth login`). If a merge request for this branch
    already exists, that counts: say so with its URL and carry on.

5.  Only now put it into {{baseBranch}}, in the repo itself rather than in
    the worktree:

        git -C {{repoPath}} status --short
        git -C {{repoPath}} branch --show-current

    Three things stop you here, and each one is a sentence back to the human
    rather than something to work around:

    - the checkout is on some other branch. Say which. Do not switch it.
    - it has uncommitted changes to files this merge would touch. Name them.
    - anything else that looks like someone is in the middle of something.

    When it is clear:

        git -C {{repoPath}} merge --ff-only {{branch}}

    `--ff-only` on purpose. After step 1 this is a fast-forward, so it cannot
    conflict and cannot write a merge commit into {{baseBranch}}. If git
    refuses it, {{baseBranch}} moved while you were working: go back to
    step 1 rather than forcing it.

6.  Put {{baseBranch}} on the remote, so what you just merged is actually
    there:

        git -C {{repoPath}} push origin {{baseBranch}}

    Never force, and never delete the branch.

Do not touch any other repo.

End with: what conflicted and how you resolved it, what you ran and its real
output, the merge request URL, and what {{baseBranch}} points at now.