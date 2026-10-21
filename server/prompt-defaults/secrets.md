{{#if noShell}}
Secrets the human kept out of this transcript: {{names}}. They appear in
the request as {{secret:NAME}}. This run has no shell, so they cannot be used
here; say so if the work needs them, rather than inventing a value.
{{else}}
Secrets the human kept out of this transcript exist only in your shell, as
environment variables:
{{lines}}
Use them from the shell — printf '%s' "$FLOW_SECRET_{{first}}" >> .env.prod — and
never print, echo, or write them anywhere you can read them back.
{{/if}}