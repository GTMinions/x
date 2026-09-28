---
name: go-to-market
description: How x turns a researched product into a launch — deriving claims from the research corpus, gating them on evidence, briefing creatives, and running omni-channel operations. Use when working on a product's /launch surface, its claims, its channels, or its campaign calendar.
---

# go-to-market

The platform's arc is **research → demo → launch**. This is the last stage, and it
inherits the discipline of the first.

## The one rule

**A marketing claim carries the same burden of proof as a research claim.**

Earned, dated, falsifiable — the same test from [[citation-discipline]]. A claim
must name the entity, benchmark, voice, or incident it rests on, and that source
must exist in the product's corpus. `app/_platform/gtm/gate.ts` enforces it, and a
claim that cannot name its evidence is not shipped.

The usual objection is "it's just marketing copy." That attitude is what produces
a landing page the product cannot live up to and a support queue full of people
who believed it.

## Depth decides what you may say

A claim may only rest on an entity at **`working` or above**, and only if that
entity is not overclaiming.

An entity below `working` has not established a mechanism and has not grounded a
single number — it is a page of assertions. Selling from it means asserting in
public what the research could not establish in private. This is the depth ladder
doing load-bearing work outside research: **the rung an entity has reached decides
whether you are allowed to sell from it.**

If `/launch` says *"no entity is deep enough to sell from"*, the fix is in the
research, not in the copy. Run `pnpm research:audit`.

## The corpus already wrote most of it

Do not invent GTM artefacts. Derive them (`app/_platform/gtm/derive.ts`):

| The research has | which is really |
|---|---|
| a benchmark | a proof point |
| a MOC's axes | the competitive frame |
| a MOC's members | the alternatives the buyer is weighing |
| a voice | evidence a segment exists, in their own words |
| an incident | the cost of the status quo, dated |
| an entity's mechanism | the answer to "but how" |

A segment invented in a workshop is a hypothesis. A segment built from a named
person's public words is a hypothesis with a data point.

## Channels are bets, not places

`app/_platform/gtm/channels.ts` carries what each channel physically accepts and —
more usefully — what it **fails at**. Read `fails_at` before choosing one.

A claim needing two sentences of caveat cannot ship on a channel that gives you
one line. The gate checks copy against the channel's real budget, because
discovering that at launch is a self-inflicted wound. **Never truncate to fit** —
a claim cut mid-sentence is a different claim, and possibly a false one.

## Publishing

Two rules that do not bend (`app/_platform/gtm/publish.ts`):

**x ships no credentials.** Every adapter takes the *user's own* token. The
platform never posts as itself and cannot post for a user who hasn't connected
their account. (The system this pattern was learned from had live API keys
hardcoded in its source. Do not copy that.)

**Dry-run is the default.** Without a token, publishing returns exactly what it
*would* have sent — copy, endpoint, destination — and sends nothing. Publishing is
public and irreversible; the safe default matters more than the convenient one.

## What we will not build

No cold outreach. No scraped lists. No posting into groups the user does not
belong to. Outbound channels (`email`, `telegram`) require the plan to name an
**opted-in** audience, and the gate blocks them otherwise.

This is not squeamishness. Cold blasting gets the account banned and the domain
burned, which ends the launch it was supposed to serve.

## Creatives

`app/_platform/gtm/brief.ts` derives the brief from the entity — hook from the
abstract's kicker, beats from the sourced numbers and the mechanism, and an honest
`needs[]` list of what does not exist yet.

It is **deterministic**. No model is invited to fill a gap, because a model asked
to fill a gap will fill it fluently and falsely. The brief is a spec, not finished
copy: the last mile is a judgment call, and pretending otherwise gets you a feed
full of content nobody chose to publish.

For a video, the demo *is* the ad. A screen recording of the product doing
something surprising outperforms any explanation of it.
