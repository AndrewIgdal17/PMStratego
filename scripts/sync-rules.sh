#!/usr/bin/env bash
# Transpile the canonical rules engine (src/rules/*.ts) to JS for the two
# deploy-isolated directories. Run this after editing src/rules/ and before committing.
set -euo pipefail
cd "$(dirname "$0")/.."

WEB_OUT="${RULES_OUT_WEB:-web/js/rules}"
DENO_OUT="${RULES_OUT_DENO:-supabase/functions/_shared/rules}"
mkdir -p "$WEB_OUT" "$DENO_OUT"

emit() {
  local src="$1"
  local dest="$2"
  npx esbuild "$src" --outfile="$dest" --format=esm --platform=neutral
  node scripts/rewrite-rule-specifiers.mjs "$dest"
}

for f in src/rules/*.ts; do
  base=$(basename "$f" .ts)
  emit "$f" "$WEB_OUT/${base}.js"
  emit "$f" "$DENO_OUT/${base}.js"
done

echo "Rules synced: src/rules/*.ts → ${WEB_OUT}/*.js + ${DENO_OUT}/*.js"
