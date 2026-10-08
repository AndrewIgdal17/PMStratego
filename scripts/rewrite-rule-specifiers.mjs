// esbuild keeps import specifiers. Rules sources use .ts so Node can load them;
// the deployed copies are .js, so sibling imports must point at .js files.
import { readFileSync, writeFileSync } from 'node:fs';

const path = process.argv[2];
const source = readFileSync(path, 'utf8');
const rewritten = source.replace(
  /from (['"])(\.\.?\/[^'"]+)\.ts\1/g,
  'from $1$2.js$1',
);
writeFileSync(path, rewritten);
