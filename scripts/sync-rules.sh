#!/usr/bin/env bash
# Transpile the canonical rules engine (src/rules/*.ts) to JS for the
# deploy-isolated Deno directory. Run this after editing src/rules/ and before committing.
set -euo pipefail
cd "$(dirname "$0")/.."

DENO_OUT="${RULES_OUT_DENO:-supabase/functions/_shared/rules}"
mkdir -p "$DENO_OUT"

emit() {
  local src="$1"
  local dest="$2"
  npx esbuild "$src" --outfile="$dest" --format=esm --platform=neutral
  node scripts/rewrite-rule-specifiers.mjs "$dest"
}

for f in src/rules/*.ts; do
  base=$(basename "$f" .ts)
  emit "$f" "$DENO_OUT/${base}.js"
done

echo "Rules synced: src/rules/*.ts → ${DENO_OUT}/*.js"
