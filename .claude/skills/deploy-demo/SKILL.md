---
name: deploy-demo
description: How x ships to Vercel. Use when asked to deploy, release, or push, or to understand the deploy workflow.
user-invocable: true
---

# deploy-demo

The repo links to Vercel (`.vercel/`, gitignored). Production tracks the
**`release`** branch, not `main`. Pushing `main` builds a PREVIEW; shipping is
merging `main` into `release` and pushing that:

```bash
git checkout release && git merge --ff-only main && git push origin release
```

`--ff-only` on purpose: `release` should never carry a commit `main` does not
have, or the thing serving users is code nobody reviewed on the way in.

## Before pushing
1. `pnpm build` is green (it runs the research gate first: an unresolved pill or
   illegal edge fails the build).
2. Smoke the routes with `/run-demo` — a green build alone doesn't prove server
   components render.
3. Commit with the product scope set (`ACTIVE_PRODUCT=<slug>` or `site`) so the
   guardrail hook passes.

## Push
```bash
git add -A
git commit -m "…"      # end with the Co-Authored-By trailer
git push
```

No env vars are required to run the demo (fully in-memory). Optional Vercel
integration vars (`VERCEL_TOKEN`, `VERCEL_PROJECT_ID`, `VERCEL_TEAM_ID`) enable a
build-status light; Turso vars (`TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`) enable
cross-session persistence of the product registry. Auth turns on only if
`AUTH_SECRET` is set.
