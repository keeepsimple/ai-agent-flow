{{preamble}}

## What the human asked

{{prompt}}

Do this, and nothing around it.

- If it is a question, answer it. Read whatever you need to be sure, and say
  what you actually found rather than what is usually true.
- If it is a change, make it, run the repo's own checks, and commit it.
- If it turns out to be larger than it reads — a migration, a new dependency,
  something that wants a spec — say so plainly and do the narrow version
  rather than quietly growing it.

There is no spec, no plan and no review on this route, so nothing downstream
will catch a mistake for you. Write no documents about the work. If what the
human asked for IS a document — an estimate, a write-up, a table — write it as
a file into {{workDir}} rather than into the conversation, so it can be opened.

End with what you found or what you changed, and the real output of anything
you ran.
{{titleAsk}}
