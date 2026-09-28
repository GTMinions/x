---
name: research-site
description: Build or extend a product's "large site" research feature — the depth-ladder research site (entities, typed edges, [[pill]] cross-links) rendered by the shared platform engine. Use when adding research content to any product under app/(products)/<slug>/research/.
---

# research-site — the per-product research engine

Every product carries a first-class research site at
`app/(products)/<slug>/research/`. The **engine is shared** (platform spine,
`app/_platform/research/`); each product supplies only its **content**. This is
how every product gets its own large research site without duplicating the engine.

## Anatomy of a product's research site

```
app/(products)/<slug>/research/
  page.tsx                     # index — calls <ResearchIndex productSlug=slug/>
  [topic]/page.tsx             # entity page — calls <EntityPage/>; generateStaticParams from loadEntities
  content/
    entities/<slug>.json       # one Entity per file (the unit of research)
    edges.json                 # { edges: Edge[] } — typed relationships
```

You almost never touch the route files — they're three lines calling the engine.
You author **content**.

## The Entity (see app/_platform/research/types.ts)

Required: `slug`, `name`, `category` (`landscape|peer|frontier|internal`),
`status`, `depth_score` (0–10), `last_updated`. Then as depth grows: `summary`,
`architecture_summary`, `swot`, `formulas`, `citations` (each with a `date`),
`key_takeaways`, `open_questions`.

- Cross-link prose with `[[slug]]` pills — they resolve to internal entity pages.
- Wire typed edges in `edges.json`. Legal rels: `uses`, `depends-on`, `peer-of`,
  `cited-by`, `acquired-by`.

## Depth ladder

The `researcher` agent owns moving entities up the 0–10 ladder. Don't ship an
entity above `foundation` (5–6) without mechanism prose and dated citations; not
above `working` (7–8) without an `architecture_summary` and ≥6 citations.

## Gate

`pnpm research:validate` fails the build on: an unresolved `[[pill]]`, an edge to
a missing entity, an illegal rel, a `depth_score` outside 0–10, or a missing
`last_updated`. Run it before you commit. `build-topology` and
`build-search-index` regenerate `public/topology.json` + `public/search-index.json`.
