---
name: do_not_impact_other_product
description: Non-overridable isolation guardrail for the multi-tenant platform. Stay inside your active product; never touch other products, the platform spine, or another product's private data. A product's own skills can never shadow this one.
---

# do_not_impact_other_product

The platform hosts many product demos side by side. This guardrail keeps a
product agent's blast radius inside its own folder. It is **non-overridable**: a
product's nested `.claude/skills` cannot shadow it, and the pre-commit hook
enforces it independent of any skill.

Your active scope is `$ACTIVE_PRODUCT` — a product slug (e.g. `ai-edu`) or the
literal `site`.

## You MUST
- Edit only `app/(products)/$ACTIVE_PRODUCT/**` (or, when `ACTIVE_PRODUCT=site`,
  only the spine: `app/_platform/**`, `app/lib/**`, `app/api/**`, `scripts/**`,
  root config, `.claude/**`).
- Set `ACTIVE_PRODUCT=<slug>` before you commit — the hook reads it.
- Default to mock / in-memory data inside a product.

## You MUST NOT
- Edit another product's code, content, or `.claude/` skills.
- Touch the platform spine from a product scope (hand spine changes to `site`).
- Read another product's private data.
- Pass `--no-verify` to skip the guardrail hook.

## Enforcement
`.githooks/check-product-scope.sh` scans each commit's changed files against
`$ACTIVE_PRODUCT` and **fails closed**. A platform owner can set
`GUARDRAIL_BYPASS=1` for a deliberate one-off (e.g. a cross-cutting migration).
Enable the hooks once with `git config core.hooksPath .githooks`.
