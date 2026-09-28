# CLAUDE.md — x

A platform for taking an idea from **research → demo → launch**. Prototype
something with thorough, cited research; build the demo from what that research
established; then take it to market on claims the research can actually defend.

Three ideas define it:

- a multi-tenant spine with hard per-product isolation,
- a depth-ladder research pipeline each product renders as its own site, and
- a go-to-market layer **derived from** that research — where a marketing claim
  carries the same burden of proof as a research claim.

The through-line: **evidence earns the right to be said.** An entity must earn its
depth score; a claim must name the entity it rests on; and an entity too thin to
have established a mechanism is one you are not allowed to sell from.

Standalone Next.js 16 + React 19. pnpm. Every product lives in a database of its
own and the list of products in a site database; `/setup` walks an operator
through the credentials and creates the databases (see "What a product is").

## Shape

```
app/
  page.tsx                     platform landing (product directory)
  _platform/                   THE SPINE (site agent only)
    ProductShell.tsx           per-product layout + nav + accent
    research/                  the shared research engine
      types.ts engine.ts depth.ts  ← the depth ladder + its gates, as code
      EntityPage.tsx ResearchIndex.tsx ui.tsx pills.tsx SectionDive.tsx
      substrates.ts SourcesIndex.tsx SubstratePanels.tsx   voices/benchmarks/incidents
      history.ts Evolvement.tsx                            the corpus as it grew
    gtm/                       THE LAUNCH LAYER
      types.ts channels.ts derive.ts gate.ts brief.ts publish.ts LaunchPage.tsx
    slides/                    entity → deck → .pptx, deterministic (no LLM key)
  lib/                         products.ts · registry/ (the site DB) · setup.ts · provision.ts
                               content-db.ts (schema + bundles) · turso.ts · vercel.ts
  setup/                       /setup — first-run onboarding, public to read
  (products)/
    [slug]/                    generic pages for a registered product with no folder:
                               landing, research, research/[topic], launch, wishes, …
    inference-economics/       the demo product: a game, its world and saves in its own DB
      page.tsx                 overview + the game in a frame + leaderboard
      play/ api/               the framed game, its world/save/run routes
      data/schema.ts seed.json the product's tables and the seed that bootstraps them
      _game/index.html game.js the game source; bundle.ts is generated (pnpm game:embed)
      _copy.json               its UI copy, from the DB (gitignored)
    <slug>/                    any other product: the same shape plus, when it has a corpus,
      research/content/…       entities, edges, substrates — from the DB, never in git
      _store.ts _research.ts   data modules — from the DB; git carries *.stub.ts
      .claude/                 its OWN agent + research skill — from the DB, confined to this folder
  _copy.json                   the platform's own UI copy (product `site`), from the DB
  about/                       the platform roster: /about + /about/<agent> (public)
scripts/                       validate-content · validate-voice · validate-sources
                               audit-depth · build-topology(-history) · build-search-index
.claude/                       THE ORG — agents/ · skills/ · memory/ (works on every product)
.githooks/                     product-scope guardrail
```

## The research feature (how the "large site" maps onto each product)

The research **engine is shared** (`app/_platform/research/`); each product
supplies only **content**, which lives in that product's own database rather than
in git — `pnpm product:db pull <slug>` writes it to
`app/(products)/<slug>/research/content/` before a build, and
`pnpm product:db push <slug>` is what saves an edit. One repository has a single
visibility boundary, so a corpus that must stay private cannot be committed to a
shared one. The same applies to the data modules (`_store.ts`, `_research.ts`,
`_shipped.ts`): git carries a generated `*.stub.ts` with the types and no content.

The words on the pages are content too. Every reader-visible string a product
page renders carries a **content id** — `<product>.<page>.<tag>-<n>`, e.g.
`ai-edu.kernel.p-2` — and the page holds only the id: `<T id="…" />` for
words in JSX (it renders a `data-cid` span, so the id is inspectable on the
UI) and `t("…")` for attributes and metadata (`app/_platform/copy/`). The
words live in the product's `ui_copy` table, one row per id, and `pull`
writes them to `_copy.json` beside the data modules; a checkout without the
credential renders every id in brackets. `pnpm copy:validate` (part of
`build`) fails when a page names an id the working copy lacks. A new string
means a new id in the page and a new row in `_copy.json`, then `push`; a
client component reads its rows through `useCopy()` inside the `<CopyScope>`
its server page wraps it in. `pnpm copy:codemod <slug>` is the one-shot
extraction that moved the existing copy out.

**The platform is the product `site`.** Its pages (`/`, `/about`, `/wishes`,
`/settings`, `/sign-in`) and every shared component under `app/_platform/`
carry ids `site.<page>.<tag>-<n>`; the rows live in the site database and
pull to `app/_copy.json` — which, unlike a product's, is committed: it is the
platform's own words, and a fresh install's site database is seeded from it
(`push site`) before it has rows of its own. The spine's client components are nested too deep to
scope one by one, so the root layout provides all their rows at once through
the generated `app/_platform/copy/site-scopes.ts`. No product word and no
platform word is in git.

An entity's age lives with the entity: `first_seen` and `updated_at` are
columns in the product DB (set on insert; moved only by a real change), and
`pull` writes them to `research/content/_timestamps.json`, which
`build-topology-history` reads as the floor under whatever git can see. Git no
longer carries a dates cache, so nothing in git lists the corpus's slugs.


The content itself is unchanged in shape — entities on a 0–10 depth ladder plus a
typed edge graph — only in where it rests. The routes
`<slug>/research` and `<slug>/research/[topic]` are thin calls into the engine.
So each product gets its own large research site without duplicating the engine.
Prose cross-links with `[[slug]]` pills; `pnpm research:validate` fails the build
on an unresolved pill, an illegal edge rel, or a bad depth score.

Two content tiers. An **entity** answers *what is this thing*. A **MOC**
(`entity_kind: "moc"`) answers *what are these things arguing about* — a thesis,
named axes, and a primary source under every member row. They climb different
ladders, because asking a map for a SWOT is a category error.

**The depth ladder is code, not a convention** (`research/depth.ts`). Each rung
names the evidence it requires as a predicate over the entity, so the system
computes whether a score was earned rather than trusting the number in the file:

- `gateFor(e)` → what the next rung needs, and what the current score claims but
  has not earned. The entity page renders both.
- `backlog(entities)` → the work queue, ordered **overclaimed → stale →
  promotable → thin**. `pnpm research:audit` prints it.
- Rungs are structural, never temporal. Age is the other axis (`isStale`).
  Overclaimed means the evidence was never there; stale means it aged.

**Gates.** `validate-content` is hard (dangling pills, illegal rels, unresolvable
MOC members). `validate-voice` and `validate-sources` are warn-only — a word
choice or a rotted link is a quality signal, not a broken build. The gate that can
actually stop a push is the **`pre-commit-critic`**: `critic-voice` and
`critic-visual` review the diff and either can `block`. Self-grading does not count.

## Launch — the GTM layer (`app/_platform/gtm/`)

A product that wants a launch page adds `launch/page.tsx` in its folder and renders `LaunchPage`; the generic `/<slug>/launch` route and the Workspace tab were removed on 2026-09-26. Shared engine, per-product output, same as research.

`derive.ts` reads the research corpus and proposes every claim the evidence
supports — a benchmark *is* a proof point, a MOC's axes *are* the competitive
frame, a voice *is* evidence a segment exists. It writes no copy: a claim's text
comes from the corpus's own words.

`gate.ts` then refuses the ones that cannot ship. A claim must name its evidence,
carry a falsifier, and rest on an entity at **`working` or above** that is not
overclaiming. This is the depth ladder doing load-bearing work outside research:
*the rung an entity reached decides whether you may sell from it.* When `/launch`
says "no entity is deep enough to sell from," the fix is in the research.

`channels.ts` holds what each channel accepts and what it **fails at**. Copy is
checked against the real budget and never truncated to fit — a claim cut to length
is a different claim.

`publish.ts`: **x ships no credentials** (adapters take the user's own token) and
**dry-run is the default**. No cold outreach, no scraped lists; outbound channels
(`email`, `telegram`) require a named opted-in audience. See the `go-to-market` skill.

## Wishes — where they live, and the stages they move through

A wish is a **row in the database of the product it names** (`site` is a product
like any other). It used to be a GitHub issue in one shared public repo, which
was wrong twice: the repo is public, so every wish for every product was
world-readable forever; and one repo is one permission boundary, where a
per-product database has its own scoped token and cannot read a sibling's.
Skeleton in git, content in the DB — the same rule the research corpus follows.

- Store: `app/_platform/wishes/db.ts` · tables in `SHARED_DDL`
  (`scripts/product-db.ts`), created lazily at runtime too so a deployment heals
  itself. No credential → in-memory floor, and every surface says so.
- **Ids stay global, and cost one query.** Splitting the store did not split the
  id space. Each product owns a **block** of it (`WISH_ID_BLOCKS` in
  `wishes/ids.ts`) and draws at random inside its own block:
  `id = block × 100_000 + random`. Two products therefore hold disjoint ranges —
  a cross-product collision is impossible by layout, not merely unlikely — and
  the only clash left, two wishes in one product, is rejected by
  `id INTEGER PRIMARY KEY` on the insert itself. So creating a wish is **one
  INSERT**, with a rare retry; it does not grow as products are added.
  (The first version verified each draw against every database: `COUNT(*)` +
  `SELECT 1` per product, nine round trips per wish. Partitioning replaced
  checking with a guarantee.)
  `WISH_ID_BLOCKS` is **append-only** — a number is a permanent claim on a range,
  and `validate-content` fails the build if a product has no block or two share
  one. Imported wishes keep their GitHub number, below every block, so history
  and new work can never collide.
- `app/_platform/wishes/github.ts` is **read-only**, kept solely for
  `pnpm wishes:import` (idempotent via `legacy_issue`; relinks parent/child onto
  the new ids in a second pass). Delete it once the import has run everywhere.

**Stages** (`app/_platform/wishes/stages.ts` — import-free so client components
and the CLI can read it without pulling in the store):

```
OPEN                      ACTIVE                CLOSED
triage → backlog → ready → building → review → done / declined / duplicate
```

Each stage has a **category**; branch on `stageCategory`/`isClosed`, never on a
list of stage names. `nextStages` shapes the admin dropdown only — the API stays
permissive, because a workflow that refuses to let a person fix it gets routed
around. Old values map on read (`readStage`: `new→triage`, `pending→backlog`,
`in-progress→building`, `wontfix→declined`).

`review` is the stage that did not exist before: the critic gate is real, so a
wish genuinely sits there, and it used to be invisible.

## Approval — by permission, not by wording (`app/lib/approval.ts`)

**If you administer what a wish touches, it is approved the moment you file it.
Everything else waits for an admin of that scope**, in `triage`, and lands on
**`/wishes/review`** — every scope you administer, in one queue, with the body
shown in full because a decision about spending a run is not answerable from a
title.

This replaced a gate that read the *request*: body over 600 characters, four or
more bullets, a keyword out of a list. That did not sort wishes by risk, it
sorted them by how they were typed — and it once refused the wish asking for its
own removal, because the word "approval" was in that wish's title. The new
question cannot be gamed by rewording, because nothing in it can see the text:
*does this person already have the authority to make the change themselves?* If
they do, a reviewer is ceremony. If they do not, no rewrite lets them in.

- **admin, not editor.** `editor` changes a product's content; `admin` decides
  what the product is for, and approving is a claim on what ships next.
- **The owning team's admin counts.** `roleAtLeast` does not cascade
  team → product on its own, so without it the admin of the team that owns a
  product could not approve wishes against it — the same lockout `access.ts`
  had to solve for reading.
- **One predicate, three places.** `canApproveScope` decides what the board
  offers, what `PATCH /api/wishes/<id>` allows, and what the review queue lists.
  They were three separate checks and two of them disagreed about team admins,
  which would have shown a reviewer a wish and then refused the click.
- `governProductWish` still refuses a product wish naming the platform or
  another product, whoever is asking. A misfile is not something to wave
  through: the wish is real and belongs on another board.
- **`triage` IS pending.** There is no second flag to keep in step —
  `needsApproval` is that stage, read back.

**Two ways code arrives, and they are not interchangeable.** The platform takes
pull requests — that is what is open source here. A product's code is the
*output* of the wish pipeline: a worker built it on a `wish/<n>` branch, under
the scope guardrail, past the critics, with a receipt. A hand-written PR against
`app/(products)/**` does the same job while skipping all of it, so product paths
are owned in `.github/CODEOWNERS` and `CONTRIBUTING.md` says to file a wish
instead. The engine takes pull requests; the demos take wishes.

**A product wish that reaches outside its product is SPLIT, not refused.** If it
needs a platform change, the platform half is filed on the site board and the
product half is made to wait on it (`blockedBy`). A bad split costs a site admin
one click to decline; a bad refusal turns a real ask away and the person often
does not come back — so the cheap-to-be-wrong answer wins. A wish naming a
*different product* is still refused: that half belongs on a board the filer may
not be allowed to read.

**`blockedBy` is a field, never a stage.** As a stage somebody would have to
un-set it when the blocker closed — to whichever stage it held before, which
nothing records. As a field, `workable()` re-derives the answer from the
blocker's stage on every read, so closing the blocker *is* the unblock. It still
reads as a status on the board; that display is computed.

**Site wishes are not world-readable.** `readableScopes` always contains `site`,
so scope alone never gated the platform board — `siteWishFilter`
(`app/lib/access.ts`) is the second pass that does. Four ways in: you administer
the site, you filed it, it was split out of a product you can read
(`originScope`), or an admin published it (`publicWish` — a checkbox beside
Approve in the review queue, and a toggle on the card afterwards, because a wish
often becomes worth showing only once it ships). The list and the
single-wish page ask the same predicate, because a filter on a list is not a
permission — the URL reaches the wish directly.

## Capacity: tiers, the queue's order, and the meter

A wish is built by a worker the deployment supplies. **What that worker runs on
is the operator's choice, and this repository names it nowhere** — not in a
comment, not in an error string, not on a page. Deployments differ, and a reader
of the code or of the site should not be able to infer the answer for any of
them. `validate-content` enforces this: it scans the platform's own files for
vendor names and business-model tells and fails the build on a new one. A second
gate does the same for **this operator's commercial figures** — measured token
counts and spend do not belong in a public repository even inside a comment.

**A tier is a guarantee, not a cap** (`app/lib/tiers.ts`). Its number is a floor
— "three a day" means three get built today; a fourth is not refused, it waits
behind everybody's guaranteed work and is built when there is room. A cap is
enforced by refusing, a guarantee by ordering, and the two produce opposite
code. The order, top to bottom: the operator's own wishes; guaranteed work,
highest tier first; everything else, same tier order. Within a band, the
board's own sort (priority → votes → newest) stands untouched.

**Tier rows live in the database, never in the code.** Names, prices,
guarantees, Stripe price ids — all rows in the `tiers` table, managed with
`pnpm tiers set …`. A fresh clone sells nothing: every account sits on one
unpriced tier with no guarantee, and the queue falls back to the board's own
order. Same rule the research corpus follows — skeleton in git, content in the
database — because a public repository must not publish one operator's prices.

- **Every tier requires a card, including the free one.** Not a charge — it is
  the one cheap thing that makes a second account cost something. Enforced at
  filing, but only when payments are configured: a gate nobody can pass is not
  a gate, it is an outage. Binding uses a hosted checkout in `setup` mode, so
  no card form lives in this codebase; the webhook flips `has_card`, never a
  redirect, because a redirect can be forged.
- **The webhook is the only writer of an account's tier**
  (`/api/billing/webhook`, exempt from the sign-in wall in `proxy.ts` — it
  authenticates by signature and arrives with no cookie). `past_due` still
  entitles: dunning takes days, and cutting service on the first failed charge
  treats an expired card as non-payment.
- **Fulfilment is what gets counted** (`fulfilments` table): one row per wish
  built per account, keyed on the wish so a retried report cannot spend two of
  somebody's guarantee, day stamped at first write so a retry after midnight
  stays on the day the wish shipped. Counted before the token check and
  independent of it — otherwise "report no tokens" would be the way to build
  outside the guarantee. A split child bills and counts against the **parent's
  filer**: splitting changes how work arrives, not whose work it is.
- Tokens are recorded when a wish **ships**, from what the run measured, four
  kinds kept apart (cache reads dominate the count at a fraction of the rate),
  joined to an account through `wish_owners`. `POST /api/internal/usage` takes
  a **wish number, never an account**, so a caller can only bill work it just
  did. A run that recorded nothing charges nothing — nothing here estimates.
- Rows read are deliberately not metered — a board render reads every wish in a
  product on behalf of whoever loaded the page, so it cannot honestly be charged
  to one account; `WISHES_MAX_PER_SCOPE` bounds that cost structurally instead.
- `FREE_TIER_BYTES` still gates storage at filing — bytes sit on disk whether or
  not the wish is ever built.

**Credits exist but gate nothing yet** (`app/lib/credits.ts`). They are the
pay-per-use layer that arrives later: balance arithmetic, ledger columns, and
tests are kept ready, but no route consults the balance and `recordSpend`
charges nothing. Wiring a balance gate in while tiers are live would
double-ration the same wish. BYOK is gone for the same kind of reason — it took
a real credential in exchange for nothing and split every queue question in
two.

**There is still no scheduler.** `prioritise()` orders; it never drops, never
round-robins, never holds a turn ledger. The worker takes the top claimable
wish and the atomic claim (a lease — it expires, and is re-entrant for the same
worker id) settles races. Ordering lives server-side behind
`GET /api/internal/queue` because it needs the identity database, and because a
worker computing its own copy of the rules is the drift nobody notices until a
guarantee quietly stops being honoured.

**Splitting** (`pnpm wishes --split <n> --into "…"`) is a working practice, not a
fairness mechanism: a wish too big for one sitting means the filer sees nothing
until it is all done, the diff lands too large for the critics to review, and an
interrupted run loses everything instead of one slice. Children inherit the
parent's scope and filer; the parent becomes a tracker `workable()` skips, and
closes itself when the last slice closes.

Beside the allowance, the only filing limit is an anti-flood rate
(`WISH_FILE_RATE`), which shapes no tier — it bounds how fast wishes arrive, not
how much gets built.

**Paying changes nothing about the gates.** Same critic gate, same product-scope
guardrail, same validators, same refusals. A balance buys throughput, never a
weaker review — a wish is untrusted text handed to an agent with shell access
whoever paid for it, so metering was never the control.

## Access — who may read which product (`app/lib/access.ts`)

`visibility` on `Product` had existed since the registry was written and
**nothing read it** (`listProducts()` even carried `filter(p => … || true)`), so
every signed-in user could open every product and the cross-scope wish board
showed everybody everything. Now:

- `public` — any signed-in user reads it, and it is listed. **inference-economics** (the demo).
- `unlisted` — readable by link; listed only to members.
- `private` — product or owning-team grant required. **Default for anything new.**

Read and listing are separate questions on purpose — `unlisted` is exactly the
case that needs both answers to differ. A team grant counts, because
`roleAtLeast` does **not** cascade team → product on its own (only site admin is
global), so without it owners would be locked out of their own products.

**This protects DATA, not existence.** The codebase is open source: every slug
and route is public knowledge. So a refusal says "you do not have access" rather
than faking a 404 — a fake 404 hides nothing a `git clone` does not reveal, and
strands a user who just needs a grant.

Grants themselves live in the **identity DB** (`memberships`), beside
`wish_owners` and the key vault. They were a GitHub issue — durable, and also a
list of people's email addresses in a repo heading for public. `pnpm
memberships:import` lifts the old table across; bootstrap admins keep coming
from `SITE_ADMIN_EMAILS` and are never written (they must stay undeletable).
Writes are keyed upserts, so two admins granting at once can no longer clobber
each other the way a whole-table JSON rewrite did.

Enforced at `ProductShell`, which every product page wraps and which returns
**before** `children` (so the page body never runs its query). The `(products)`
route group has no dynamic segment, so its layout cannot know the slug — which
makes "a new page forgot" a real silent failure, so `validate-content` fails the
build unless every `app/(products)/**/page.tsx` uses ProductShell. Also filtered:
the landing directory, `/api/wishes` (`scope=all` filters, a named private scope
403s), wish stats/timeline, and product export.

## Deploying: the databases make themselves

**Functions run beside the data.** `vercel.json` pins `regions: ["pdx1"]`
because the Turso group's primary is `aws-us-west-2`, and the default function
region is `iad1` — a continent away. Every query was paying ~60ms of Atlantic-
to-Pacific round trip, several times per render. If you move the database
group, move this with it; a pin that points at the wrong coast is worse than no
pin, because it looks deliberate.


`TURSO_API_TOKEN` + `TURSO_ORG` are the only two variables a fresh deploy needs.
`app/lib/turso.ts` then creates each database — identity and one per product —
on first use over the Turso HTTP API, and the tables are created lazily on top
of that. Clone, set two variables, ship.

Precedence is deliberate: **an explicit `PRODUCT_DB_<SCOPE>_URL` always wins.**
An operator who named a database meant it, and quietly creating a second beside
theirs is the worst of the three behaviours. With neither, it is local SQLite
files — real and working, single-instance, and every surface says so.

One group token authenticates every database in the group, so a new product
needs no new credential. Set `TURSO_GROUP_TOKEN` in production to skip minting
one per cold start. `pnpm product:db provision` uses the same HTTP path and no
longer needs the CLI, so it runs in CI.

## Product tables on the fly (`app/_platform/productData.ts`)

A wish that needs somewhere to put data does not need a platform change or a
migration. A product declares its tables beside its code and wraps its queries
in `withProductData(slug, ddl, fn)`: the declaration is applied idempotently on
first touch against that product's own database — the same self-healing rule
the wish store and the identity database follow. Statements naming a platform
table (`wishes`, `runs`, …) are refused before anything executes, so "my
feature needs a table" can never become "my feature rewrote the board". One
database per product stays the whole isolation story: a product can only break
its own tables.

## The guest list (`app/lib/comps.ts`)

Addresses a site admin types into site settings. Two effects, deliberately
separate: **no paywall** (a member on sight, no checkout and no card — asking
somebody you invited for card details is the opposite of an invitation) and
**first in the queue**, everywhere including inside a product, below only the
operator's own platform work.

It is allowed above people who pay because it is small, explicit and visible:
every row was typed by a person, carries a note saying why, and is rendered in
full on the settings page. Nothing writes to it but that form and
`pnpm tiers comp`. A derived or self-serve version would be a different feature
and a much worse one.

Keyed on **email, not account id** — you invite somebody before they sign in,
and a table of account ids can only record acceptances. `isComped` **fails
closed**: an unreachable table hands out nothing, and the worst case is a guest
waiting like everybody else.

## Home is two pages (`app/page.tsx` · `app/lib/membership.ts`)

`/` renders nothing itself — it routes. A **visitor** goes to `/get-started`
(the landing page: what this is, how it works, what it costs, and where ads
point). A **member** goes to `/dashboard`. One address, because "where do I go"
should not depend on the reader remembering which of two URLs they are entitled
to; two real URLs behind it, because an ad, a bookmark and the back button all
need one.

`started_at` on `account_usage` is the whole boundary. It is set by a completed
checkout — every tier goes through one, Free included as a $0 subscription, so
one door produces one outcome: a tier the queue can order by and a card on file
— or, on a deployment with the paywall down, by clicking through the landing
page once. One column answers the question in both worlds; two predicates could
disagree about the same person.

**The paywall is a switch, and it fails closed** (`paywall.enabled`). Off is the
internal deployment, where asking your own colleagues to check out is ceremony.
It also stands down on its own when no payment provider is configured — a gate
nobody can pass is not a gate, it is an outage. An unreachable settings table
leaves it standing.

`/get-started` stays in the header forever, for members too: the page that
explained the thing should not vanish the moment somebody understands it.

## The operator toolbar (`app/_platform/DevToolbar.tsx`)

One pill in the corner, mounted in the root layout, holding every tool an
operator can reach from any page: Design Mode, view-as, and the payment mode
with a link into billing. There were two floating controls fighting for that
corner and a third was coming; a corner that accumulates buttons is one people
stop reading.

The pill goes **loud** for the two states where forgetting which mode you are in
produces a real mistake — payments live, or a borrowed identity in force — and
says which.

**Two payment switches, deliberately.** The site-wide one (Settings → Billing,
mirrored on Settings → Site) is the `stripe.mode` setting every visitor's
checkout follows. The chip in the dock is the other: clicking it sets a
session cookie (`x-payment-mode`) that moves **this browser only** to the other
Stripe, so an admin can run a sandbox checkout on a live site without moving
the switch under everyone. Same trust rule as view-as: `stripeModeDetail()`
re-checks that the holder is a site admin on every read and ignores the cookie
otherwise (a non-admin could else buy a live tier through the sandbox), and an
override naming a mode with no keys is ignored too. The webhook reads neither
switch: it takes the mode from the event's own signed `livemode` and verifies
with that secret, since both Stripe endpoints point at one URL. That is the reason it is fixed to the viewport rather than living in
a settings page: it cannot be scrolled away from.

**View-as is read-only and cannot outlive its authority** (`app/lib/impersonation.ts`).
It is a second cookie carrying an email, never a replacement session and never a
token: standing is re-derived from the real session on every read, so a leaked
cookie is worth nothing and an admin who loses the role stops borrowing with
nothing to clean up. The borrowed session carries **no scopes** — the point is
to see the user's screen including its refusals. Writes keep using the real
session: a support tool that can act as the customer produces records nobody can
explain later.

## What a product is

A row in the **site database** (`PRODUCT_DB_SITE_*`, `app/lib/registry/`), with a
database of its own whose URL and token the row carries (an env
`PRODUCT_DB_<SLUG>_URL/_TOKEN` overrides the row). The folder under
`app/(products)/<slug>/` is only its pages and is optional: a registered product
without one renders through `app/(products)/[slug]/`. `listProducts()` and
`getProduct()` are async and read the registry; a slug the registry does not
carry is not a product, and `ProductShell` 404s it, whatever folders exist. The
home page, the nav and settings list only what the registry holds.

`prebuild` runs `product:db pull --all`: every registered product plus `site`.
No registry (a fresh checkout) means nothing pulled, stubs in place, and a home
page that points at `/setup`.

**Onboarding** (`app/lib/setup.ts`, `/setup`): host and database are two
independent choices (`app/lib/providers.ts`: computer|vercel × sqlite|turso;
vercel+sqlite impossible); only their keys live in the environment
(`VERCEL_TOKEN`; `TURSO_API_TOKEN`+`TURSO_ORG`). Everything else —
administrators, SMTP, Google — is a form on `/setup` saved to `site_settings`
(`app/lib/onboarding.ts`; env wins when set). Before an admin exists the forms
authorise by *local single-user* (localhost on a computer host under `pnpm dev`;
off on Vercel, off in production builds unless `X_SINGLE_USER=1`, off with `=0`;
`getSession()` and `proxy.ts` both honour it; dev/start bind to 127.0.0.1) or
by *owner proof* (the Vercel token, timing-safe compare). `install.sh` asks the
same two questions; its Vercel path links, sets env and deploys through the
Vercel CLI. Then a first product. **Demo:**
`demo/inference-economics.json` is the demo product's bundle — Inference
Economics, a business-simulation game (推理经济学 2022–2028) served in a frame
from `app/(products)/inference-economics/play` (`pnpm product:demo:export`
regenerates it); `/setup` loads it into a fresh database of its own, or
`pnpm product:db import inference-economics demo/inference-economics.json`.
The game's world and the players' saves and runs are product tables declared
in `app/(products)/inference-economics/data/schema.ts`, created on first touch
through `withProductData` and filled from `data/seed.json` when empty; the
game source is `_game/index.html` + `_game/game.js`, embedded as strings by
`pnpm game:embed` (tests fail when the bundle is stale).
**Create:** `/setup` or `pnpm product:db provision <slug> --name …` gives a new
product a database and a registry row. Content is pulled at build time, so a
product added at runtime appears after `pull` + restart locally, or a redeploy
on Vercel (triggered from `/setup` when `VERCEL_TOKEN` is set).

## Isolation

Each product lives in `app/(products)/<slug>/` (code + its own `.claude/`). The
non-overridable `do_not_impact_other_product` skill + `.githooks/check-product-scope.sh`
keep a product agent inside its folder. Set `ACTIVE_PRODUCT=<slug>` (or `site`)
before committing. Enable hooks once: `git config core.hooksPath .githooks`.

## Agents & skills (`.claude/`)

**The org is the site's.** Five agents in `.claude/agents/` and thirteen skills
in `.claude/skills/` belong to x and work across every product. The roster
renders at **`/about`** (public), with `/about/<agent>` for the full doctrine.

- Build agents: `site` (spine), `product` (one product), `researcher` (depth ladder).
- The gate: `critic-voice` + `critic-visual` — neither reviews its own work.
- Load-bearing skills: `do_not_impact_other_product` (non-overridable),
  `research-site`, `deep-research`, `depth-ladder`, `citation-discipline`,
  `cross-link-not-duplicate`, `pre-commit-critic`, `go-to-market`, `design`,
  `anti-ai-voice`, `run-demo`, `deploy-demo`, `xiaohongshu-post`.

**A product keeps its own.** Agents and skills under
`app/(products)/<slug>/.claude/` belong to that product, and that folder is the
only place they can write — the guardrail above confines them. They are not in
git: a research skill names the sources a product trusts and the frontier it
has covered, which describes its private corpus, so they live in the product's
database (`product_files`, beside `_store.ts`) and `pull` writes them to disk
before a build. Every change is a version: `pnpm product:db versions <slug>
.claude/skills/research/SKILL.md` lists them, `restore … <version>` puts one
back on disk to be pushed as the next. All three products
keep one build agent (derived from `product`) and one `research` skill naming the
sources that field trusts and the frontier it has already covered. A product's
skill shadows a platform skill of the same name inside that folder. A product with
no `.claude/` is built by the platform's generic `product` agent.

## A wish is untrusted input

Anyone with an account can file one, and the loop reads it and acts with shell
access and repo write. **The containment is structural, not a filter:**

- `pnpm worker next` claims atomically and prints the brief — the safe path is
  the default, not something the loop has to remember mid-run. The doctrine a
  worker follows is `cronjobs/worker.md`, deliberately outside any one
  harness's folder so every kind of runner reads the same words.
- `.githooks/pre-push` refuses a push to `main` from a wish run
  (`WISH_PUSH_OK=1` when you are the human and you meant it).
- `--ship` prints the PR command. **A wish's work is not merged by the run that
  did it.**
- The loop should hold no production credentials. If yours does, a wish that
  talks it into misbehaving reaches your database.

## Verify
`pnpm build` (the research gate, then next build) · `pnpm test` (46 unit
assertions: access control, id partitioning, the wish store) ·
`pnpm platform:selftest` · then `/run-demo` — server components render at
request time, so smoke the routes; a green build is not proof.

`pnpm db:backup` dumps every database to `backups/<timestamp>/` and replays each
dump into sqlite3 to prove it restores. `pnpm db:backup:check` re-verifies the
newest one without taking a new one.

## Ship
**`main` integrates; `release` deploys.** Vercel's production branch is
`release`, so merging to `main` gets you a preview URL and nothing more —
shipping is a deliberate second act:

```bash
git checkout release && git merge --ff-only main && git push origin release
```

They were the same branch until the repository was about to go public, at which
point "a pull request merged is a pull request live" stopped being convenient
and started being the problem: a contributor's merge would have reached users
with no step in between. `.githooks/pre-push` guards both names.

See `/deploy-demo`. End
commit messages with the `Co-Authored-By` trailer.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
