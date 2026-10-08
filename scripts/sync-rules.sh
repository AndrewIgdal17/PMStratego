#!/usr/bin/env bash
# Copies the canonical rules engine (src/rules/) to the two deploy-isolated
# directories. Run this after editing src/rules/ and before committing.
set -euo pipefail

cp src/rules/*.js web/js/rules/
cp src/rules/*.js supabase/functions/_shared/rules/

echo "Rules synced: src/rules/ → web/js/rules/ + supabase/functions/_shared/rules/"
