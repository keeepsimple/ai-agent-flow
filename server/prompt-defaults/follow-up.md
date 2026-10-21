{{preamble}}

## Follow-up

{{#if isDoc}}This task has already run. What it produced is in the working directory above.{{else}}This task has already run. Its branches, worktrees and commits are above, and
whatever it produced is in {{artifactDir}}.{{/if}}

What the human came back with:

{{requestIndented}}

- Read {{artifactDir}}/review.md and spec.md where they exist. They say what
  this was for and what was already known to be wrong with it.
- If they are reporting something broken, reproduce it before you touch
  anything. A fix for a failure you have not seen is a guess.
- If the request is only "continue", carry on with the last thing you were
  doing; do not ask what it means.
{{#if isDoc}}- Write into the working directory, as before. The repos are there to read,
  not to change.{{else}}- Work on the existing branches. Do not start new ones.
- Run the repo's own checks, and commit what you change.{{/if}}
- If what they are asking for is larger than it sounds, say so plainly and do
  the narrow version rather than quietly growing the task.

End with what you changed, what you ran, and the real output.