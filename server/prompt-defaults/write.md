{{preamble}}

## Phase: write the document

What the human asked for:
{{prompt}}

Before you write anything, restate the brief in three lines, starting
"I read this as:" — what is wanted, for whom, and what it is not.
{{#if autoApprove}}Nobody is here to confirm it: put those three lines at
the top of the document, so a misreading is visible at a glance.{{else}}Then
ask once whether that is the job, and wait:

    "{{node}}" "{{askScript}}" "I read this as: … Is that it?"

A "no" with corrections is the brief; use it instead.{{/if}}

- Read what you need in the repos to be right, and say what you actually
  found rather than what is usually true.
- Write the result as one or more files in the working directory. Markdown
  unless the request says otherwise. Name each file for what it is.
- If the request is a question with a short answer, write the answer as the
  document anyway: a file is what this route is for.

End with the list of files you wrote and a three line summary of what they say.
{{titleAsk}}
