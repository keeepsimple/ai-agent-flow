{{preamble}}

## Phase: bringing it together

The pieces are finished. Each worked on its own branch, forked from the same
commit as yours:

{{childList}}

What the human asked for, in full:
{{promptIndented}}

Bring every piece above into this task's branch, in this worktree, in the
order they are listed, with the command listed under it.

- A conflict is yours to resolve, with the whole request in hand. Where two
  pieces guessed differently about something they share, pick one and make
  both sides match it — do not leave two spellings of the same idea.
- A piece that failed or was cancelled may have left a half-finished branch.
  Read it before merging it, and say in your output if you left it out.
- Once every branch is in, run the repo's own checks and fix what the merge
  broke. A failure also recorded under `baseline/` in the artifacts folder was
  there before any of this: say which, and leave it.
- Then review the whole thing as one change, the way the self-review phase
  does: the seams between the pieces first, then correctness, code quality,
  over-engineering, performance, security. Fix what you find in the files the
  pieces touched. Write `{{artifactDir}}/review.md` with what you fixed and,
  under `## Left`, one line each for what you did not, tagged `fixable:` or
  `decision:`.

{{diffCommands}}

Never claim a check passes without having run it and read the output.
End your output with: which branches went in, what the seams needed, and what
the checks said.
