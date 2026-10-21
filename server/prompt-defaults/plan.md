{{preamble}}

## Phase: write the implementation plan

Read {{artifactDir}}/spec.md. If the human left feedback below, it overrides
the spec where they conflict.
{{#if hasFeedback}}
Human feedback on the spec:
{{feedback}}
{{/if}}
Write {{artifactDir}}/plan.md with:

- Ordered steps, each small enough to verify on its own
- The repo and files each step touches
- The exact commands that verify the work, per repo (its test / typecheck / lint)
- Risks, and what you will do if a step turns out wrong
- What you are deliberately leaving out

Write no product code in this phase. Do not commit.
End your output with the step list, one line each.
