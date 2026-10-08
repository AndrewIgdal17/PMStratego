# Generated copy

These files are esbuild output from `src/rules/*.ts` (types stripped, sibling
imports rewritten to `.js`). Render deploys `web/` as its own static site root
(see `staticPublishPath: ./web`), so the frontend cannot import from outside
its `web/` directory at deploy time, just like Deno Edge Functions cannot
import from outside their `supabase/functions/` directory. The canonical rules
engine (tested by `npm test` against `src/rules/`) is emitted here for the
frontend (`setup.js`, `game.js`, etc.) to import.

**When you change anything in `src/rules/`, re-run:**

```bash
npm run sync-rules
```

Do not edit the files in this directory directly — edit `src/rules/`,
re-run the tests, then re-sync.
