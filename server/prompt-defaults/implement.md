{{preamble}}

## Phase: implement
{{#if quick}}
What the human asked for:
{{prompt}}

There is no spec and no plan for this one on purpose: it was started as a small
change. Read enough of the code to be sure that is true. If it turns out to need
a spec, say so plainly in your output and build the narrow version only.
{{else}}
Read {{artifactDir}}/spec.md and {{artifactDir}}/plan.md and build it.{{/if}}{{#if hasFeedback}}
Human feedback on the plan:
{{feedback}}
{{/if}}
- {{#if quick}}Commit in logical steps with real messages.{{else}}Work the plan in order. Commit each step separately with a real message.{{/if}}
- Run the repo's own checks (test, typecheck, lint). If they fail, fix the cause.
- Match the surrounding code: its naming, its idiom, its comment density.
- Do not invent abstractions the plan did not call for.

{{titleAsk}}
Never claim a step passes without having run the command and read the output.
End your output with: what you built, what you ran, and what the output was.
