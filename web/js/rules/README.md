# Generated copy

These files are a verbatim copy of `src/rules/*.js`. Render deploys `web/`
as its own static site root (see `staticPublishPath: ./web`), so the
frontend cannot import from outside its `web/` directory at deploy time,
just like Deno Edge Functions cannot import from outside their
`supabase/functions/` directory. The canonical rules engine (tested by
`npm test` against `src/rules/`) is duplicated here for the frontend
(`setup.js`, `game.js`, etc.) to import.

**When you change anything in `src/rules/`, re-run:**

```bash
cp src/rules/*.js web/js/rules/
```

Do not edit the files in this directory directly — edit `src/rules/`,
re-run the tests, then re-copy.
