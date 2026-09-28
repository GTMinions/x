---
name: deep-research
description: The daily deep-research routine — one deep research pass per product per day (or on user trigger), producing cited "researched opportunities" on the product roadmap and moving research-site entities up the depth ladder. Updates the product's research skill after every run.
user-invocable: true
---

# deep-research

One deep research pass **per product per day** (or on demand). A pass produces
two outputs and always updates the product's own research skill so the next pass
doesn't repeat it.

## Inputs
- The product's `.claude/skills/research` skill: its **sources** and its
  **knowledge frontier** (what's already been researched, with dates).
- The current research-site entities and their depth scores.

## Outputs of a pass
1. **Researched opportunities** → append 2–4 to
   `app/(products)/<slug>/_research.ts`. Each: `idea`, `description`,
   `reasoning`, `citations` (real, checkable, primary), `researchedAt`. They
   render on the product roadmap.
2. **Depth-ladder progress** → move ≥1 research-site entity up a rung with new
   citations / mechanism (via the `research-site` + `researcher` skills).

## Mandatory after every run
- Update the product's `research` skill: append findings to its **knowledge
  frontier** and record the **run date**. If a source went stale or a new
  recurring source appeared, edit the skill's sources list too.
- Commit with `ACTIVE_PRODUCT=<slug>` so the guardrail keeps it in the product
  folder.

## Pick the work from the backlog, don't invent it
`pnpm research:audit` orders the queue: **overclaimed → stale → promotable → thin**.

- **overclaimed** — the entity asserts a depth its content does not support. Top of
  the list, always: a page that overstates itself is worse than one that is honestly
  thin, and the reader cannot detect the difference unaided. Add the evidence, or
  lower the score. Both are honest; leaving it is not.
- **promotable** — it has already earned its next rung and only the number lags.
  Free depth. Take it.

## Rigor — the four skills that govern a pass
- **`depth-ladder`** — the rungs, the promotion gates, the refresh cadence. Defined
  once, in the skill and in `app/_platform/research/depth.ts`. Never keep a second
  copy of the table.
- **`citation-discipline`** — the source ladder, the anti-sources, and the test:
  **earned, dated, falsifiable**. Numbers carry their own `source`, on the number.
- **`cross-link-not-duplicate`** — broaden or deepen. Look before you write.
- **`anti-ai-voice`** — how the sourced claim gets written. `critic-voice` reviews
  the diff and can block the push.

Before deepening anything, run the drift check (see the `researcher` agent): names,
leadership, and stack, verified against a primary source. It catches fabrications,
not just staleness.
