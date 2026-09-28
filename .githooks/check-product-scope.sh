#!/usr/bin/env bash
# Product-scope guardrail (enforces .claude/skills/do_not_impact_other_product).
#
# Every staged file must fall inside the ACTIVE_PRODUCT's blast radius:
#   ACTIVE_PRODUCT=<slug> → only app/(products)/<slug>/**
#   ACTIVE_PRODUCT=site   → only the spine (app/_platform, app/lib, app/api,
#                           scripts, .claude, root config) — NOT a product folder
# Fails closed. A platform owner may set GUARDRAIL_BYPASS=1 for a deliberate
# cross-cutting one-off. Enable with: git config core.hooksPath .githooks
set -euo pipefail

if [[ "${GUARDRAIL_BYPASS:-0}" == "1" ]]; then
  echo "[guardrail] bypassed (GUARDRAIL_BYPASS=1)"; exit 0
fi

active="${ACTIVE_PRODUCT:-}"
if [[ -z "$active" ]]; then
  echo "[guardrail] ACTIVE_PRODUCT is not set. Set it to a product slug or 'site'." >&2
  echo "            e.g.  ACTIVE_PRODUCT=ai-edu git commit ..." >&2
  exit 1
fi

changed="$(git diff --cached --name-only)"
[[ -z "$changed" ]] && exit 0

violations=()
while IFS= read -r f; do
  [[ -z "$f" ]] && continue
  if [[ "$active" == "site" ]]; then
    # site owns the spine + root; it may touch anything EXCEPT a product folder
    if [[ "$f" == app/\(products\)/* ]]; then violations+=("$f"); fi
  else
    # a product may touch ONLY its own folder — not the spine, not root config,
    # not another product. Cross-cutting work goes to the `site` agent.
    if [[ "$f" != "app/(products)/$active/"* ]]; then
      violations+=("$f")
    fi
  fi
done <<< "$changed"

if (( ${#violations[@]} > 0 )); then
  echo "[guardrail] BLOCKED — ACTIVE_PRODUCT=$active may not touch:" >&2
  printf '  - %s\n' "${violations[@]}" >&2
  echo "Hand cross-product/spine changes to the right agent, or GUARDRAIL_BYPASS=1 for a one-off." >&2
  exit 1
fi
echo "[guardrail] ok (ACTIVE_PRODUCT=$active, ${changed//$'\n'/ } within scope)"
