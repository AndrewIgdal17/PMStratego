import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const COPIES = [
  'web/js/rules',
  'supabase/functions/_shared/rules',
];

const tsFiles = readdirSync('src/rules').filter((f) => f.endsWith('.ts')).sort();
const jsFiles = tsFiles.map((f) => f.replace(/\.ts$/, '.js'));

const webTmp = mkdtempSync(join(tmpdir(), 'rules-web-'));
const denoTmp = mkdtempSync(join(tmpdir(), 'rules-deno-'));

execFileSync('bash', ['scripts/sync-rules.sh'], {
  env: {
    ...process.env,
    RULES_OUT_WEB: webTmp,
    RULES_OUT_DENO: denoTmp,
  },
  stdio: 'pipe',
});

const fresh = {
  'web/js/rules': Object.fromEntries(
    jsFiles.map((file) => [file, readFileSync(join(webTmp, file), 'utf8')]),
  ),
  'supabase/functions/_shared/rules': Object.fromEntries(
    jsFiles.map((file) => [file, readFileSync(join(denoTmp, file), 'utf8')]),
  ),
};

rmSync(webTmp, { recursive: true, force: true });
rmSync(denoTmp, { recursive: true, force: true });

for (const copy of COPIES) {
  for (const file of jsFiles) {
    test(`${copy}/${file} matches esbuild emit of src/rules/${file.replace(/\.js$/, '.ts')}`, () => {
      const copied = readFileSync(join(copy, file), 'utf8');
      assert.equal(
        copied,
        fresh[copy][file],
        `${copy}/${file} differs from the esbuild emit. Edit src/rules/ and run: npm run sync-rules`,
      );
    });
  }
}
