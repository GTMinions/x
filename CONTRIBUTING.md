# Contributing

Thanks for looking. This is a small project with one maintainer, so the most
useful thing you can do before writing code is open an issue and check the idea
is wanted — a good PR for something out of scope is still a PR that gets closed.

## Running it

```bash
pnpm install
pnpm dev            # http://localhost:4000
```

**It runs with no secrets.** No API keys, no database, no accounts service. The
identity database becomes a local SQLite file, sign-in codes are printed to the
server log instead of emailed, and the wish board lands in local SQLite files —
one per product, the same shape it has in production. Everything in
`.env.example` buys an optional capability; the absence of a key disables that
capability rather than breaking the app.

Pull requests target **`main`**. Merging there produces a preview deployment;
`release` is what users are served, and moving work onto it is a separate,
deliberate push by a maintainer.

The first thing to know about the codebase is in
[`CLAUDE.md`](./CLAUDE.md) — it is the architecture document, not a config file.

## Before you push

```bash
pnpm build          # runs the content gate first, then next build
pnpm test           # the unit suites
pnpm platform:selftest
```

`gitleaks` runs in the pre-commit hook when you have it installed.

`pnpm build` is the real gate. It refuses on a dangling `[[pill]]`, an illegal
edge relation, a product page that skips the access wrapper, or a product
without a wish-id block. Those are hard failures on purpose: each one is a class
of bug that otherwise ships looking fine.

Two checks are **warn-only** — `pnpm research:voice` and `pnpm research:sources`.
A word choice or a rotted link is a quality signal, not a broken build.

## What a good PR looks like

- **One thing.** A PR that fixes a bug and tidies imports is two reviews.
- **A test when the behaviour is load-bearing.** Access control, id allocation
  and the wish store all have suites in `test/`; add to them rather than trusting
  a manual check. The rule of thumb: if getting it wrong would look like a
  working site rather than an error, it needs a test.
- **Comments that say *why*.** The codebase is unusually heavily commented and
  that is deliberate — the comments carry the reasoning that made a decision,
  not a restatement of the line below. Match that.
- **No new dependency without a sentence justifying it.** This project has
  twelve runtime dependencies. That is a feature.

## Where things live

| | |
|---|---|
| `app/_platform/` | The spine — shared by every product. Research engine, GTM layer, the wish board and queue. |
| `app/(products)/<slug>/` | One product. Isolated, with its own `.claude/`. |
| `app/lib/` | Registry, identity, access control, tiers, the token ledger. |
| `scripts/` | Validators, the per-product database tooling, the build loop's CLI. |
| `test/` | Unit suites. `pnpm test`. |

**Products are isolated from each other and it is enforced**, by
`.githooks/check-product-scope.sh` and by CI. A change inside
`app/(products)/foo/` may not touch `app/(products)/bar/` or the platform spine.
If your change genuinely needs both, that is two PRs.

Enable the hooks once:

```bash
git config core.hooksPath .githooks
```

## Content vs code

A product's research corpus, its data modules and its wishes live in **that
product's own database**, not in git. Git carries the schema and the code that
reads it. So:

- You will not see other people's product content in a checkout, and that is
  the design rather than a missing file.
- The words a product's pages render are content too: pages carry content ids
  (`<T id="…" />`, see `app/_platform/copy/`) and the text is a row in that
  product's database, pulled to a gitignored `_copy.json`. A wording change is
  `pnpm product:db push <slug>`, not a commit. So is a change to a product's
  own agent or skills under its `.claude/`, which live in its database with a
  version per change.
- The list of products is the site database, not a file. `/setup` (or
  `pnpm product:db provision <slug>`) registers one; nothing in git names it.
- The build pulls content before compiling; without credentials it uses the
  committed `*.stub.ts` files, which carry the types and no data.
- **Never commit a `.db` file, a dump, or anything out of `backups/`.** The
  gitignore covers them by extension; do not work around it.

## What this project takes contributions to

**The platform, not the products.** What is open source here is the engine: the
multi-tenant spine, the research pipeline, the wish system, the launch layer,
the tooling. `app/_platform/`, `app/lib/`, `app/api/`, `scripts/` — pull requests
welcome, and CI runs the full gate on them.

**The products are demos of that engine, and their code is generated.** A file
under `app/(products)/<slug>/` got there because somebody filed a wish and a
worker built it: on a `wish/<n>` branch, under the product-scope guardrail, past
two critics, with a receipt on the wish. A hand-written pull request against one
does the same job while skipping all of that, and it edits somebody's demo on
their behalf.

So if you want a product changed, **file a wish rather than a pull request**.
It goes to that product's board, an admin of that product approves it (or you do,
if you administer it), and the work arrives with its trail intact. Product paths
are owned in `.github/CODEOWNERS` for this reason — not to keep you out, but
because a PR arriving there means something skipped the pipeline and should be
read before it lands.

The distinction in one line: **the engine takes pull requests; the demos take
wishes.**

## What CI will and will not accept

Everything here runs on your pull request, including one from a fork. Local git
hooks do not — they live on a maintainer's machine and never see your branch —
so CI is where the project's rules actually bind a contributor. Three of the
four jobs are gates; the fourth is there to help the reviewer.

**The shared platform is open to contributions.** `app/_platform/`, `app/lib/`,
`app/api/` — the code every product inherits — takes pull requests like anything
else. It requires a maintainer's review before it can merge (see
`.github/CODEOWNERS`), which is a queue, not a closed door.

**One concern per pull request.** A PR that edits two products fails, and so
does one that mixes a product with shared code. Shared changes reach every
product at once and are reviewed on different terms than a change to one
product, so they travel separately. Split it and send two.

**A fork may not change the project's own guardrails.** `.github/`,
`.githooks/`, `scripts/validate-*`, `proxy.ts`, `next.config.ts`, `vercel.json`,
`.claude/` — a change to any of these decides whether the other checks run at
all, which makes it self-referential: the diff that would switch off the review
is reviewed by the thing it switches off. No amount of care at review time fixes
that, so the class is refused rather than judged case by case. It is not a
statement about you. If one of them genuinely needs changing, open an issue
saying what and why.

**New dependencies are allowed, and are read.** A package is a real
supply-chain risk, but unlike a workflow edit it is *legible* — a name can be
looked up and judged — so it is flagged rather than refused. CI prints every
package your PR adds to the lockfile, and the reviewer reads that list. Adding a
library to do real work is expected; adding one that shares a name with a
popular package is what the list is for.

**The build runs with no environment at all.** No API keys, no database. A fresh
clone must build, which is also what keeps the project honest about not needing
secrets to run. If your change only works with credentials present, that is a
design problem rather than a CI problem.

## Licence and the CLA

x is **AGPL-3.0**, plus a commercial licence for anyone who cannot publish
their modifications. Offering that second licence means the project has to hold
the rights to all of the code, so a first-time contributor is asked to sign the
[CLA](./CLA.md) — a bot posts the instructions on your first PR.

**You keep your copyright.** The CLA grants rights; it is not an assignment.
It is short, and you are asked once.

Prose and research content are under [CC BY-NC-SA 4.0](./LICENSE-CONTENT), not
AGPL — see [`NOTICE`](./NOTICE) for the map.

## Security

Please do not open a public issue for a vulnerability. See
[`SECURITY.md`](./SECURITY.md) — private reporting is enabled on this repository.
