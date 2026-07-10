# Generated copy

These files are a verbatim copy of `src/rules/*.js`. Deno Edge Functions
cannot import from outside their `supabase/functions/` directory at deploy
time, so the canonical rules engine (tested by `npm test` against
`src/rules/`) is duplicated here for the `make-move` function to import.

**When you change anything in `src/rules/`, re-run:**

```bash
cp src/rules/*.js supabase/functions/_shared/rules/
```

Do not edit the files in this directory directly — edit `src/rules/`,
re-run the tests, then re-copy.
