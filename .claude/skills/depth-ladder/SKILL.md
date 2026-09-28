---
name: depth-ladder
description: What a research entity's depth_score means and what it takes to move up a rung. Use when researching an entity, deciding what to work on next, or judging whether a page has earned the score it claims.
---

# depth-ladder

Every research entity carries a `depth_score` from 0 to 10. The score is not a
label an agent assigns — it is a claim about the evidence on the page, and
`app/_platform/research/depth.ts` can check it.

**No entity is done.** A run's job is to take at least one entity up one rung.

## The rungs

| Score | Rung | What it is |
|---|---|---|
| 0–2 | **stub** | A name and a line saying what it is. |
| 3–4 | **skeleton** | Enough shape to argue with: a position, and one real source. |
| 5–6 | **foundation** | The facts are in and it knows where it sits in the graph. |
| 7–8 | **working** | It explains a mechanism and every number has a receipt. |
| 9–10 | **reference** | The page a serious reader would cite. Diagrammed, densely sourced, linked to. |

## The promotion gates

Requirements are **cumulative** — a rung inherits everything below it. You cannot
skip evidence by raising the number.

- **stub → skeleton** · `entity_kind` set · SWOT on ≥2 quadrants · ≥1 citation
- **skeleton → foundation** · ≥1 **dated** citation from the entity's own primary
  source (its docs, its filing, its blog — not coverage of it) · `key_takeaways`
  · `positioning` or `data_points`
- **foundation → working** · a mechanism (`components[]`, or `mechanism.bullets`,
  or `architecture_summary`) · **≥1 numerical claim grounded in a dated primary
  source** · ≥6 citations · something sourced inside the past 90 days · open
  questions named
- **working → reference** · a diagram · ≥12 citations · refreshed in the past 30
  days · linked from ≥3 other pages

The gate that does the most work is the numerical one. It is what stops an entity
from reaching `working` on fluent prose. A component that says *"manages memory
efficiently"* fails it. A component that says `block size = 16 tokens · eviction =
LRU · cache key = SHA-256(token_ids[0..n])`, each with a `source`, passes it.

## The per-component bar

At `working` and above, a mechanism is decomposed, not narrated:

```jsonc
{
  "name": "Prefix caching",
  "purpose": "2–4 paragraphs of real mechanism: block size, eviction policy, cache key, TTL.",
  "numbers": [{ "label": "Block size", "value": "16 tokens", "source": "https://…" }],
  "prior_art": [{ "name": "…", "approach": "…", "tradeoff": "what it gives up" }],
  "recommended": "the pick, and why"
}
```

4–7 `numbers`, 3–5 `prior_art`. An `architecture_summary` that is one long
paragraph with no numbers is not a mechanism; it is a summary of one.

## Refresh cadence

A reference page that went six months untouched is not reference-grade any more,
and the score should stop claiming it is.

- score ≥7 → refresh every **30 days**
- score 5–6 → refresh every **60 days**, or whenever a primary event lands
- score ≤4 → promote a rung within **2 runs**, or kill it from the queue with a
  written reason

## Overclaiming

`gateFor(entity)` returns `overclaimed` — the requirements the current score
asserts but the content does not support. An agent can type `depth_score: 9` into
a JSON file; it cannot fake a diagram or twelve citations.

**An overclaimed page is worse than an honestly thin one.** It is the first thing
in the backlog (`backlog()` sorts it above stale, promotable, and thin). Fix the
evidence or lower the score — both are honest; leaving it is not.

## Picking the next move

`backlog(entities, inbound)` orders the work: **overclaimed → stale → promotable
→ thin**. Take the top item. A `promotable` entity has already earned its next
rung and just needs the score raised — that is free depth, take it first among
equals.

Related: [[cross-link-not-duplicate]] decides whether the move is *deepen this
page* or *scaffold a new one*. [[citation-discipline]] governs what counts as a
source.
