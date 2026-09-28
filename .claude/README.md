# `.claude` — the agent + skill foundation

This directory is the **foundation** every agent inherits when working in `x`. It
covers two concerns:

- **Isolation + product model**: the non-overridable
  `do_not_impact_other_product` guardrail, the `site` / `product` agents, and the
  per-product research skill override pattern.
- **Research craft**: the `researcher` agent, the `research-site` build skill
  (depth ladder, entities, edges, `[[pills]]`), the `deep-research` routine, and
  the `anti-ai-voice` gate.

## Precedence

1. `skills/do_not_impact_other_product` — **non-overridable**. A product's own
   `.claude/skills` can never shadow it. Enforced by `.githooks/check-product-scope.sh`.
2. Root skills here — the shared contract.
3. Per-product overrides — each product folder may carry its own
   `.claude/agents/*` and `.claude/skills/*`. A product's `research` skill
   overrides the root `deep-research` defaults with product-specific sources and
   a knowledge frontier. A product that keeps its own agent puts it under `app/(products)/<slug>/.claude/` (stored in its database, pulled before a build).

## Agents

| Agent | Scope |
|-------|-------|
| `site` | The platform spine (`app/_platform`, `app/lib`, root config, this `.claude/`). Never a product folder. |
| `product` | One product folder (`app/(products)/<slug>/`). Set `ACTIVE_PRODUCT=<slug>`. |
| `researcher` | Moves a product's research entities up the 0–10 depth ladder. Runs inside a product scope. |

## Skills

`do_not_impact_other_product`, `deep-research`, `research-site`, `design`,
`anti-ai-voice`, `run-demo`, `deploy-demo`.
