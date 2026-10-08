import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const CANONICAL = 'src/rules';
const COPIES = [
  'web/js/rules',
  'supabase/functions/_shared/rules',
];

const jsFiles = readdirSync(CANONICAL).filter((f) => f.endsWith('.js'));

for (const copy of COPIES) {
  for (const file of jsFiles) {
    test(`${copy}/${file} is identical to ${CANONICAL}/${file}`, () => {
      const canonical = readFileSync(join(CANONICAL, file), 'utf8');
      const copied = readFileSync(join(copy, file), 'utf8');
      assert.equal(
        copied,
        canonical,
        `${copy}/${file} differs from ${CANONICAL}/${file}. Edit src/rules/ and run: npm run sync-rules`,
      );
    });
  }
}
