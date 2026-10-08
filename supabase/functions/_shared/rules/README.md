# Generated copy

These files are esbuild output from `src/rules/*.ts` (types stripped, sibling
imports rewritten to `.js`). Deno Edge Functions cannot import from outside
their `supabase/functions/` directory at deploy time, so the canonical rules
engine (tested by `npm test` against `src/rules/`) is emitted here for
`make-move` and `submit-setup` to import.

**When you change anything in `src/rules/`, re-run:**

```bash
npm run sync-rules
```

Do not edit the files in this directory directly — edit `src/rules/`,
re-run the tests, then re-sync.
