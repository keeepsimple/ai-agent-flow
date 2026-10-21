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
- For every behaviour you change, name the test that guards it. If none
  exists, write one in the repo's own test style before you call the step
  done. A change with no test that would fail without it is not done.
- Run the repo's own checks (test, typecheck, lint). If they fail, fix the
  cause. A failure that is also recorded under baseline/ in the artifacts
  folder was there before you: say which, and do not try to fix it.
- Match the surrounding code: its naming, its idiom, its comment density.
- Do not invent abstractions the plan did not call for.

{{titleAsk}}
Never claim a step passes without having run the command and read the output.
End your output with: what you built, what you ran, and what the output was.
