# How x works

The README says how to start it and what to do with it. This is the rest: what
the pieces are and where things live. `CLAUDE.md` is the architecture document
proper; this is the map to it.

## The idea

A multi-tenant product-demo platform where **every product ships its own
deep-research site**. Two ideas define it:

- **Multi-tenant spine** — products live under `app/(products)/<slug>/` behind a
  product shell + nav, with hard per-product isolation (the non-overridable
  `do_not_impact_other_product` guardrail).
- **Research pipeline** — entities on a 0–10 **depth ladder**, typed **edges**,
  `[[pill]]` cross-links, and a build-time validate → topology → search-index gate.

Every product is an isolated demo that also carries a research site, powered by a
**shared engine** — each product supplies only its content.

## Running it by hand

`install.sh` is three commands and a form. Without it:

```bash
pnpm install
pnpm dev              # http://localhost:4000 — then open /setup
```

**Two independent choices** (`app/lib/providers.ts`): a *host* — this
computer, or Vercel — and a *database* — SQLite files under `.local-db/`, or
Turso. Each provider names the keys it needs before the site can reach
anything; those, and only those, live in the environment (`.env.local` on a
computer, the project's variables on Vercel): `VERCEL_TOKEN` for the host,
`TURSO_API_TOKEN` + `TURSO_ORG` for the database. With no Turso keys every
database is a file — the registry, each product, identity — and the site runs
on one machine with no account anywhere. With them, each database is created
on Turso on first use, which is what Vercel needs (a function keeps no files
between requests). The one pair that cannot work is Vercel with files, and
both the installer and `/setup` say so.

**Everything else is asked on `/setup`** and kept in the site's own settings
table (`app/lib/onboarding.ts`): who administers the site, how sign-in codes
are mailed, Google sign-in. A value in the environment (`SITE_ADMIN_EMAILS`,
`SMTP_*`, `GOOGLE_CLIENT_*`) still counts and takes precedence. Two rules make
the page usable before anyone can sign in. **Local single-user:** a site on a
computer, answering on localhost, signs its owner in automatically — there is
nobody else to keep out. It is on under `pnpm dev` (which binds to 127.0.0.1)
and off in a production build, where a reverse proxy could present any visitor
as localhost; `X_SINGLE_USER=1` turns it on for a production build on a
personal machine, `X_SINGLE_USER=0` turns it off for a shared one. **Owner proof:** on Vercel, the page accepts the Vercel token the
deployment runs with, compared in constant time and never stored — whoever
holds the host key already owns the site. No new secret is invented.

`/setup` also loads the demo product or creates an empty one, stores the Turso
keys into the Vercel environment when a deployment lacks them, and can redeploy
the site. `.env.example` documents every variable.

## What a product is

A product is a row in the site database with a database of its own. Its pages
live in code under `app/(products)/<slug>/`; everything else about it — research,
data, the words on its pages, its own agent and skills — lives in its database
and is pulled before a build. Nothing product-specific is in git, not even the
list of products.

**Inference Economics** is the demo: a business-simulation game
(推理经济学 2022–2028), shipped as `demo/inference-economics.json` and loaded
from `/setup`. Once it is in, `/inference-economics` is the game. Its world —
GPU generations, the seven years, the tech tree, power plans, the glossary —
is rows in its own database, declared in
`app/(products)/inference-economics/data/schema.ts` and filled from
`data/seed.json` the first time the tables are found empty. Saves and
finished runs are rows there too, so progress follows a person's account.

The list of products is a table in the site database, read at request time.
A product without pages of its own renders through the generic routes under
`app/(products)/[slug]/`. Words on pages carry content ids (`<T id="…" />`);
the text is a row in the product's database, so a wording change is a database
change, not a commit. A product's own agent and skills live there too, with a
version kept for every change.

## Wishes — how product code arrives

The engine takes pull requests; the demos take wishes. A signed-in user files a
wish against a product; a worker claims it atomically, builds it on a
`wish/<n>` branch under the product-isolation guardrail, past two adversarial
critics, and ships it with a receipt. A hand-written PR against
`app/(products)/**` skips all of that, so product paths are owned and
`CONTRIBUTING.md` says to file a wish instead.

```bash
pnpm worker next     # claim the top wish, print the brief
pnpm worker ship <n> --run <id>
pnpm tiers           # what this deployment sells (a fresh clone sells nothing)
```

Tiers, prices, and every commercial number live in the deployment's own
database, never in this repository. A tier is a guarantee, not a cap: work past
it queues behind everybody's guaranteed work rather than being refused.

## Build gate

```bash
pnpm research:validate   # pills resolve · edges legal · depth scores valid
pnpm test                # access control · claims · tiers · the wish store
pnpm build               # validate → topology → search-index → next build
```

## Licence

Two licences, because the repository holds two different kinds of thing.

| | Licence | |
|---|---|---|
| Source code | **AGPL-3.0-only** | [`LICENSE`](./LICENSE) |
| Research corpus + prose | **CC BY-NC-SA 4.0** | [`LICENSE-CONTENT`](./LICENSE-CONTENT) |

**Free, forever, no permission needed:** read it, study it, run it for yourself
or your company, modify it, teach with it, contribute back.

**AGPL's one condition:** if you run a modified version and let other people use
it over a network, you must offer those users your modified source (§13).

**A commercial licence** removes that condition, for anyone who wants to build on
this without publishing their changes. See
[`COMMERCIAL-LICENSE.md`](./COMMERCIAL-LICENSE.md).

The deciding question is not "am I a company" — it is *"am I willing to publish
my modifications?"* If yes, AGPL costs nothing, commercial use included.

Contributions are accepted under the [CLA](./CLA.md), signed once via a bot on
your first pull request. It is what makes the dual licence legally possible; you
keep your copyright, and your contribution stays public under AGPL regardless.

The corpus is licensed apart from the code because it is analytical writing about
named companies, quoting third-party sources that remain their owners'. A code
licence has no way to account for that.
