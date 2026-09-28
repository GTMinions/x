---
name: cross-link-not-duplicate
description: The broaden-vs-deepen decision. Use before writing research on a topic, to decide whether to deepen the page in front of you, cross-link to a page that already covers it, or scaffold a new entity or MOC.
---

# cross-link-not-duplicate

The failure this prevents: a request to "go deeper on X" gets answered by copying
what the dedicated X page already says into whatever page happened to mention X.
The corpus grows, the knowledge does not, and now two pages disagree the moment
one is updated.

**Always look first.** Grepping for the slug takes five seconds.

## The gate

**1. Does a dedicated page for this topic already exist at depth ≥7?**
No → deepening the page in front of you is fine. Go.
Yes → keep going.

**2. Does that page already cover the specific angle being asked about?**

- **It is silent on the angle** → *hybrid-deepen*. Add the new evidence to the
  **dedicated page** (that is where it belongs), and add one linking sentence on
  the source page pointing at it.
- **It already answers it** → *redirect-deepen*. Do not restate it. Improve the
  source page's prose so the reader knows the answer lives one click away, and
  make sure the `[[pill]]` is actually there.

**3. Is there a cross-link gap?** If page A discusses X substantively and does not
link `[[x]]`, that is the bug. Fix that, not the prose.

## Broaden vs deepen

Both are legitimate. They are different moves and the run log should say which.

**Deepen** — raise an existing entity a rung on the [[depth-ladder]]. This is the
default and it is what most runs should do.

**Broaden** — create something new. Two triggers, and only two:

- **A new entity.** The bar: *would someone serious about this domain expect to
  find it here within 30 days?* If yes, scaffold it with SWOT, citations,
  `entity_kind`, `positioning`, and at least one primary source — a skeleton, not
  an empty file. If no, log it in the MOC's `discovered_not_added` with the reason
  and move on. A named "we looked and chose not to" is research; a silent omission
  is a gap.

- **A new MOC.** The threshold is **three**. When three or more entities cluster
  around a theme no existing map covers, they justify a map. One orphan gets
  absorbed into the nearest existing MOC. Two wait for a third.

## Placement is part of the research

An entity nobody links to is an entity nobody finds. When you add or deepen one:

- set `belongs_to` (1–2 MOC slugs — cap is 2; if it needs three, the taxonomy is wrong)
- set `related` (≥3 sibling slugs)
- emit the typed edges (`uses`, `depends-on`, `peer-of`, `cited-by`, `acquired-by`
  — these five, the validator rejects anything else)

The `reference` rung is gated on inbound links precisely so that placement cannot
be deferred forever.

## Anti-patterns

- Deepening page A without checking whether page B exists. Look. Two thirds of
  topics already have a page.
- A MOC that lists members without annotating them. That is a tag bucket. A MOC
  makes a claim, names the axes, and takes a position per member.
- Duplicating a mechanism into three pages "for context." Write it once, link it
  twice.
