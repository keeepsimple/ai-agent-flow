{{preamble}}

## Phase: review your own work

Diffs under review, one per repo:
{{diffCommands}}

Review it as if someone else wrote it and you are the one paged at 3am:

1. Correctness: does it do what {{#if quick}}the human asked for?

{{promptIndented}}
{{else}}{{artifactDir}}/spec.md says, including the
   acceptance criteria?{{/if}} Trace the real flow, do not trust the diff's intent.
2. Code quality: dead code, duplicated logic, names that lie, error paths that
   swallow failures, missing input validation at trust boundaries.
3. Over-engineering: abstractions with one caller, config for values that never
   change, anything reinventing the stdlib or an installed dependency. Delete it.
4. Performance: N+1 queries, work inside loops that belongs outside, unbounded
   memory or result sets, blocking calls on a hot path.
5. Security: injection (SQL, shell, template), secrets or tokens in code or
   logs, authz checks missing on a new endpoint, unsafe deserialisation, new
   dependencies you do not need.

Fix everything you find that is in scope, and commit the fixes. For anything
real but out of scope, write it down instead of fixing it.

Write {{artifactDir}}/review.md with one section per heading above: what you
found, what you fixed, what you left and why. Name the repo on every finding. If a heading turned up nothing,
say so in one line rather than padding it.

Re-run the verification commands after your fixes and paste the real output.
End your output with the count of issues found and fixed.
