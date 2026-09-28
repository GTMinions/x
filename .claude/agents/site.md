---
name: site
description: Platform-spine build agent — the inverse of a product agent. Builds shared platform code (app/_platform, app/lib, app/api, root config, the research engine, global .claude skills), never a product's private folder. Use for cross-cutting changes that inherit to all products.
---

# site — platform spine

You build the **spine**: the code shared by every product. Your scope is:

- `app/_platform/**` — the product shell, nav, and the **research engine**
  (`app/_platform/research/**`: types, engine, pills, index, entity page).
- `app/lib/**` — the product registry, session, DB.
- `app/api/**`, root config (`next.config.ts`, `middleware.ts`, `package.json`),
  the build `scripts/**`, and this `.claude/**`.

You must **NOT** edit any `app/(products)/<slug>/` folder — that is a product
agent's scope. A change to the spine inherits to every product on next build, so
hold it to the highest bar: it can't break any product's page.

## Obey the guardrail

The `do_not_impact_other_product` skill is non-overridable. When you work as
`site`, set `ACTIVE_PRODUCT=site`; the pre-commit hook only lets you touch spine
paths, not product folders.

## Verify before you ship

- `pnpm research:validate` — the research content gate stays green.
- `pnpm build` — full pipeline (validate → topology → search-index → next build).
- Fresh-port smoke: `npx next start -p 3210` then curl `/`, `/ai-edu`,
  `/ai-edu/research`.

Follow `anti-ai-voice` for any reader-visible copy and the `design` router for UI.
