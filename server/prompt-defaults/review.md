{{preamble}}

## Phase: review your own work

Diffs under review, one per repo:
{{diffCommands}}

Review it as if someone else wrote it and you are the one paged at 3am.
Before anything else, trace one real path end to end: run the command, hit
the route, open the page (the preview script, where there is one). Write
down what you observed, not what the diff intends. A review that only read
the diff has not reviewed.

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

6. Guarded: for each behaviour this diff changes, name the test or check
   that would fail if it broke. Where there is none, write it now, in the
   repo's own test style, and commit it. A behaviour with no guard is a bug
   waiting for the next change.

Fix everything you find that is in scope, and commit the fixes. A bug or a
smell inside files this task already touched, under about thirty lines, is
yours to fix now, not to list. What you leave goes under one heading:

    ## Left
    - [ ] fixable: <a bug or smell you could fix but did not, and where>
    - [ ] decision: <something only the human can decide, and the choice>

One line each, starting with the tag. A failure that is also recorded under
baseline/ in the artifacts folder was there before this task: name it under
decision:, do not fix it.

Write {{artifactDir}}/review.md with one section per heading above: what you
found, what you fixed, what you left and why. Name the repo on every finding.
If a heading turned up nothing, say so in one line rather than padding it.

Re-run the verification commands after your fixes and paste the real output.
End your output with four counts: found / fixed / left-fixable / left-decision.
