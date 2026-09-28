#!/usr/bin/env bash
# Product-scope guardrail, over an arbitrary list of changed files.
#
# The same rule as .githooks/check-product-scope.sh, factored out so CI can run
# it. The hook protects the person who ran `git config core.hooksPath`; this
# protects the repository, including against contributors who never ran it. A
# guardrail only the maintainer has enabled is a habit, not a rule.
#
# Usage:  ACTIVE_PRODUCT=<slug|site> scripts/check-scope.sh <file>...
#         ACTIVE_PRODUCT=<slug|site> git diff --name-only main | xargs scripts/check-scope.sh
#
# GUARDRAIL_BYPASS is deliberately NOT honoured here. It exists so a platform
# owner can make a one-off cross-cutting commit locally; an env var that turns
# the rule off is not a rule once it is reachable from a pull request.
set -euo pipefail

active="${ACTIVE_PRODUCT:-}"
if [[ -z "$active" ]]; then
  echo "[scope] ACTIVE_PRODUCT is not set (a product slug, or 'site')." >&2
  exit 1
fi

violations=()
for f in "$@"; do
  [[ -z "$f" ]] && continue
  if [[ "$active" == "site" ]]; then
    # site owns the spine and root; it may touch anything except a product folder
    [[ "$f" == app/\(products\)/* ]] && violations+=("$f")
  else
    # a product may touch only its own folder
    [[ "$f" != "app/(products)/$active/"* ]] && violations+=("$f")
  fi
done

if (( ${#violations[@]} > 0 )); then
  echo "[scope] BLOCKED — ACTIVE_PRODUCT=$active may not touch:" >&2
  printf '  - %s\n' "${violations[@]}" >&2
  echo >&2
  echo "A product changes only app/(products)/<slug>/**. Cross-cutting work is" >&2
  echo "'site' scope and must not carry product edits in the same change." >&2
  exit 1
fi

echo "[scope] ok — ACTIVE_PRODUCT=$active, $# file(s) in scope"
