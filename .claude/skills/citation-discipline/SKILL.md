---
name: citation-discipline
description: What counts as a source, what does not, and the test a claim must pass before it ships. Use whenever writing a research claim, adding a citation, or reviewing someone else's.
---

# citation-discipline

An unsourced research page can assert anything. The build gate enforces the floor
(every entity needs a dated `last_updated` and at least one real citation); this
skill is the bar above the floor.

## The test

A claim ships when all three are true:

- **Earned** — a primary source on the ladder below actually says it.
- **Dated** — the source carries a publication date, and the date appears in the
  prose. "Recently" is not a date.
- **Falsifiable** — the claim could be wrong, and you can name the evidence that
  would prove it wrong. *Vibes are not falsifiable.*

If you cannot name what would disprove it, you have written an opinion. Either
sharpen it into something checkable or cut it.

## The source ladder

Descending. Use the highest rung that has the answer.

1. **The subject's own primary publication** — its docs, changelog, engineering
   blog, spec, release notes.
2. **Regulatory and legal filings** — SEC EDGAR (10-K, 10-Q, 8-K, S-1), court
   records, regulator sites.
3. **Peer-reviewed papers and preprints** — arXiv, OpenReview, conference
   proceedings.
4. **Earnings-call transcripts** — quote the speaker, with name, role, and call
   date.
5. **Open-source repositories** — at a **pinned commit**, not `main`. `main`
   moves and your citation rots.
6. **Trade press that did primary reporting** — only when 1–5 are silent. Cite
   the reporting, not the aggregation of it.
7. **Vendor case studies and partner blogs** — never load-bearing on their own.
   Flag the bias in the prose.

## Anti-sources — do not cite

- Social posts without primary-author confirmation.
- SEO content farms and AI-generated blog spam.
- Anything behind a paywall you could not actually read. If you did not read it,
  you did not verify it.
- **AI-augmented research tools' output.** Treat as an anti-source by default.
  Vendor legal-research AI has been measured hallucinating on a substantial share
  of queries, and a major consultancy refunded a government report over fabricated
  citations. These tools are a *discovery channel*, not a source of record.

## Verify against the primary

When a claim arrives via any secondary route:

1. **Identify the original publisher.** A ruling → the court. A regulation → the
   regulator. A benchmark → the paper.
2. **Check the claim word-for-word against that primary.** Not the summary of it.
3. **If it does not verify, refuse the citation.** Do not soften the claim to fit
   a weak source — drop the claim.

If it *does* verify, still cite the primary, not the tool that surfaced it. The
tool was how you found it; the primary is what makes it true.

## Numbers

Every number needs its own source, attached to the number — that is why `numbers[]`
on a component is `{ label, value, source }` and not prose. A paragraph with one
citation at the end and six numbers inside it is six unsourced numbers.

Do not invent numbers. Do not estimate and present as measured. If the real figure
is not public, say it is not public — that is a finding, and it is more useful than
a fabricated precision.

## Sources compound

Each run logs `sources_used` with `useful: true|false` and a one-line note. The
next run reads the last three logs and biases toward what worked.

- flagged `useful: true` ≥2 times in the last 3 runs → promote toward tier 1
- flagged `useful: false` twice running → drop it from the default sweep

Write the new tier-1 sources you discover into the product's `research` skill, so
the next run inherits them instead of rediscovering them.

Related: [[depth-ladder]] gates promotion on citation count and recency.
[[anti-ai-voice]] governs how the sourced claim gets written.
