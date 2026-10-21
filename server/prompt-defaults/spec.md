{{preamble}}

## Phase: write the spec

Task from the human:
{{prompt}}

Read enough of the codebase to know what this actually touches. Then write
{{artifactDir}}/spec.md with:

- Intent: what this is for and why, in the human's terms
- Scope: what changes, grouped per repo, file by file where you already know
- Non-goals: what this explicitly does not do
- Constraints: existing patterns, APIs, deploy or data gotchas you found{{#if many}}
- Contract between the repos: the exact shape each one sends or expects, and
  which side has to ship first for the other not to break{{/if}}
- Acceptance criteria: how someone checks this is done, as concrete checks
- Open questions: anything you had to assume, marked as your assumption

{{titleAsk}}
Write no product code in this phase. Do not commit.
End your output with a 5 line summary of the spec.
