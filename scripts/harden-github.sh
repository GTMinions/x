#!/usr/bin/env bash
#
# harden-github.sh — put the repository's protections into their intended state.
#
# WHY THIS IS A SCRIPT AND NOT A CHECKLIST
# Branch protection, rulesets, and secret scanning are refused with 403 on a
# private repository under a free plan: "Upgrade to GitHub Pro or make this
# repository public." So the protections cannot be set up in advance — going
# public is the act that unlocks them. That leaves a window between the flip and
# the configuration in which `main` is unprotected and the repository is
# visible. A checklist makes that window as long as it takes a person to click
# through six settings pages. This makes it a few seconds.
#
# It is also the protection state written down: what the repository is supposed
# to enforce lives in the tree, next to the code it protects, and can be
# re-applied after any accident.
#
# USAGE
#   ./scripts/harden-github.sh --check     # read-only: what is set vs intended
#   ./scripts/harden-github.sh --apply     # make it so
#
# Idempotent. Safe to run repeatedly; `--check` never writes.

set -euo pipefail

REPO="${REPO:-GTMinions/x}"
BRANCH="${BRANCH:-main}"
MODE="${1:---check}"

# The CI jobs that must pass before anything merges. These are job *names* as
# GitHub sees them, which are the `name:` fields in .github/workflows/ci.yml —
# not the job keys. A typo here does not fail loudly: the rule simply waits for
# a check that never arrives, and nothing can merge. Verified by --check.
CHECKS=("build + content gate" "product isolation" "privileged paths")

ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; }
head_() { printf '\n\033[1m%s\033[0m\n' "$1"; }

apply() { [ "$MODE" = "--apply" ]; }

# ── 0. preconditions ────────────────────────────────────────────────────────
head_ "Repository"
vis=$(gh api "repos/$REPO" --jq .visibility)
echo "  $REPO · $vis"

if [ "$vis" != "public" ]; then
  bad "Still private. Branch protection, rulesets, and secret scanning all 403"
  echo "    under a free plan until this repository is public. Flip it first:"
  echo "      gh repo edit $REPO --visibility public --accept-visibility-change-consequences"
  echo "    then re-run this script immediately — that gap is the exposure."
  exit 1
fi

# ── 1. the merge gate ───────────────────────────────────────────────────────
# A ruleset rather than classic branch protection: rulesets can be inspected as
# data, can carry an explicit bypass list, and apply to tags and branches under
# one object. `bypass_actors` keeps the maintainer able to push directly — the
# rule exists to bind contributions, not to lock the owner out of their own
# repository during an incident.
head_ "Branch rule on $BRANCH"

checks_json=$(printf '%s\n' "${CHECKS[@]}" | jq -R '{context: .}' | jq -s .)
ruleset=$(jq -n --arg branch "$BRANCH" --argjson checks "$checks_json" '{
  name: "protect main",
  target: "branch",
  enforcement: "active",
  bypass_actors: [{ actor_id: 5, actor_type: "RepositoryRole", bypass_mode: "always" }],
  conditions: { ref_name: { include: ["refs/heads/" + $branch], exclude: [] } },
  rules: [
    { type: "deletion" },
    { type: "non_fast_forward" },
    { type: "pull_request", parameters: {
        required_approving_review_count: 1,
        require_code_owner_review: true,
        dismiss_stale_reviews_on_push: true,
        require_last_push_approval: true,
        required_review_thread_resolution: false,
        allowed_merge_methods: ["squash", "merge"]
    }},
    { type: "required_status_checks", parameters: {
        strict_required_status_checks_policy: true,
        required_status_checks: $checks
    }}
  ]
}')

existing=$(gh api "repos/$REPO/rulesets" --jq '.[] | select(.name=="protect main") | .id' 2>/dev/null || true)
if apply; then
  if [ -n "$existing" ]; then
    gh api -X PUT "repos/$REPO/rulesets/$existing" --input - <<<"$ruleset" >/dev/null
    ok "ruleset updated"
  else
    gh api -X POST "repos/$REPO/rulesets" --input - <<<"$ruleset" >/dev/null
    ok "ruleset created"
  fi
else
  [ -n "$existing" ] && ok "ruleset exists (id $existing)" || warn "not set — would create"
fi

# The check names must match reality, or the gate waits forever on a check that
# never reports. Compare against the workflow file rather than trusting them.
head_ "Do the required checks exist?"
for c in "${CHECKS[@]}"; do
  if grep -qF "name: $c" .github/workflows/ci.yml; then ok "\"$c\""
  else bad "\"$c\" — no job with this name in ci.yml; nothing would ever merge"; fi
done

# ── 2. supply chain ─────────────────────────────────────────────────────────
# Forces every `uses:` to be a commit SHA. A tag is a movable label: the action's
# author can repoint v4 at new code and every repository that trusts the tag runs
# it on the next build, with no diff to review. This makes that impossible to
# reintroduce by hand.
head_ "Actions"
pin=$(gh api "repos/$REPO/actions/permissions" --jq .sha_pinning_required)
if apply; then
  gh api -X PUT "repos/$REPO/actions/permissions" -F enabled=true -f allowed_actions=all -F sha_pinning_required=true >/dev/null
  ok "SHA pinning required"
else
  [ "$pin" = "true" ] && ok "SHA pinning required" || warn "SHA pinning off — would enable"
fi

# ── 3. secrets and dependencies ─────────────────────────────────────────────
# Free on public repositories. Push protection is the one that matters most: it
# refuses the push that contains a key, rather than telling you afterwards.
head_ "Secret scanning and dependencies"
sec=$(gh api "repos/$REPO" --jq '.security_and_analysis')
for f in secret_scanning secret_scanning_push_protection; do
  cur=$(jq -r --arg f "$f" '.[$f].status // "unset"' <<<"$sec")
  if apply; then
    gh api -X PATCH "repos/$REPO" --input - >/dev/null <<<"$(jq -n --arg f "$f" '{security_and_analysis: {($f): {status: "enabled"}}}')"
    ok "$f enabled"
  else
    [ "$cur" = "enabled" ] && ok "$f" || warn "$f is $cur — would enable"
  fi
done

if apply; then
  gh api -X PUT "repos/$REPO/vulnerability-alerts" >/dev/null && ok "Dependabot alerts enabled"
  gh api -X PUT "repos/$REPO/automated-security-fixes" >/dev/null && ok "Dependabot security updates enabled"
else
  gh api "repos/$REPO/vulnerability-alerts" >/dev/null 2>&1 && ok "Dependabot alerts" || warn "Dependabot alerts off — would enable"
fi

# ── 4. housekeeping ─────────────────────────────────────────────────────────
head_ "Repository settings"
if apply; then
  gh api -X PATCH "repos/$REPO" -F delete_branch_on_merge=true -F allow_auto_merge=false >/dev/null
  ok "delete merged branches; auto-merge off"
else
  ok "(would set delete_branch_on_merge, disable auto-merge)"
fi

# ── 5. what this script cannot do ───────────────────────────────────────────
head_ "Left for a human"
echo "  · Settings → Actions → Fork pull request workflows:"
echo "    set \"Require approval for all external contributors\". It is not in the"
echo "    REST API, and without it anyone opening a PR can run your CI minutes."
echo "  · Settings → Actions → Workflow permissions: read-only (the default)."
echo "  · If a maintainers team is created later, move the Tier 1 lines in"
echo "    .github/CODEOWNERS onto it — never a team that does not exist yet."

head_ "Done"
apply && echo "  Applied. Re-run with --check to read the state back." \
      || echo "  Nothing was changed. Re-run with --apply to make it so."
