You are in {{worktree}}, on {{branch}}, in the {{repo}} repo.
Read this repo's CLAUDE.md and follow it.

The human asked for this branch to end up in {{target}}, with nothing
left behind it and a merge request on record. Do these in order and stop at the
first thing that is not yours to decide.

1.  Bring {{target}} into this branch, here in the worktree:

        git fetch
        git merge origin/{{target}} || git merge {{target}}

    A target that exists nowhere yet is fine: there is nothing to bring in,
    and the push in step 5 will create it. If it conflicts, resolve it. Read
    {{artifactDir}}/spec.md first where it exists: it says what this branch
    was for, which is what tells you which side of a conflict carries intent.
    Where the two sides changed different things, keep both. Never take one
    side wholesale because it is shorter or because it resolves faster.

    A conflict where both sides changed the same behaviour on purpose is a
    product decision, not a mechanical one. Do not guess:

        "{{node}}" "{{askScript}}" "your question"

2.  Run this repo's own checks and fix what the merge broke. Never report a
    check as passing without having run it and read the output. If something
    is still failing, stop here and say what: do not open a merge request on
    a branch you know is broken.
{{#if hasRemote}}
3.  Check the diff for secrets, then push the branch:

        "{{node}}" "{{guardScript}}" "{{repoPath}}" {{target}} {{branch}}
        git push -u origin {{branch}}

    If the guard exits non-zero it names file:line of something that looks
    like a secret. Do not push. Take it out of the history (amend or rebase
    the commit that added it), run the guard again, and say what you found.
    Never force. If the remote rejects it, say what git said and stop.

4.  Open the merge request against {{target}}, and do it before
    anything lands. The human asked for it to exist first, so if this cannot
    be done, stop here and say why rather than merging anyway.

    Use whichever is right for the remote, and read its output for the URL:

        glab mr create --yes --target-branch {{target}} \
          --title "..." --description "..."
        gh pr create --base {{target}} --title "..." --body "..."

    Write the title and the body yourself: what changed and what you ran. A
    restatement of the branch name tells the reviewer nothing they cannot
    already see. `--fill` takes them from the commits instead, which is only
    worth it when the commits already say that.

    If one is missing or not signed in, say which and what would sign it in
    (`glab auth login`, `gh auth login`). If a merge request for this branch
    already exists, that counts: say so with its URL and carry on. A target
    the remote does not have yet has no merge request to open: say so and
    carry on.

5.  Put it on the remote. This is the step that counts: the deploy and
    everyone else read the remote, not the checkout on this machine.

        git push origin {{branch}}:{{target}}

    A plain push is a fast-forward or nothing: if the remote refuses,
    {{target}} moved while you were working — go back to step 1 rather than
    forcing it. Never force.

6.  Then, and only as a courtesy, the person's own checkout:

        git -C {{repoPath}} status --short
        git -C {{repoPath}} branch --show-current

    If the checkout is on {{target}} and the fast-forward goes through, do it:

        git -C {{repoPath}} merge --ff-only {{branch}}

    If it is on some other branch, or untracked files sit where the merge
    would write, or anything else looks like someone is in the middle of
    something: do NOT switch branches, delete files, or stash. Say in one
    line what is in the way and finish. The remote has it; a `git pull`
    later is the person's call. This step never stops the landing.
{{else}}
3.  This repo has no remote, so the landing is the checkout itself:

        git -C {{repoPath}} status --short
        git -C {{repoPath}} branch --show-current

    Three things stop you here, and each one is a sentence back to the human
    rather than something to work around:

    - the checkout is on some other branch. Say which. Do not switch it.
    - it has uncommitted changes to files this merge would touch. Name them.
    - anything else that looks like someone is in the middle of something.

    When it is clear, put it into {{target}}, in the repo itself:

        git -C {{repoPath}} merge --ff-only {{branch}}

    `--ff-only` on purpose. After step 1 this is a fast-forward, so it cannot
    conflict. If git refuses it, {{target}} moved: go back to step 1.
{{/if}}
Do not touch any other repo.

End with: what conflicted and how you resolved it, what you ran and its real
output, the merge request URL, what {{target}} points at now on the remote,
and whether the person's checkout was fast-forwarded or left alone and why.
