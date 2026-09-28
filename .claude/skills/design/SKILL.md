---
name: design
description: Design router for x — the single entry point for any UI/design task. Read this first. Applies the Peel design system by token register. Use whenever you build, style, or review a visual surface (pages, cards, nav, badges, the research site).
user-invocable: true
---

# design — the Peel design system

`x` uses the **Peel** design system. It is warm and
scholarly: **Cormorant Garamond** serif headings over a **Manrope** body, on
**parchment / linen** surfaces, with soft warm borders. Never hard-code a color —
read the CSS variables from `app/globals.css`.

## The Peel palette

| Role | Name | Value | Use |
|------|------|-------|-----|
| Platform brand | **Ember** | `#f97316` | `--accent` on `:root` — platform chrome, landing |
| Product brand | **Ivy** | `#356a4d` | `--accent` on `[data-shell="product"]` — the education (Schola) register; each product may override |
| Premium / warn | **Brass** | `#b3873c` | `--status-warn` |
| Success | Ivy | `#356a4d` | `--status-ok` |
| Destructive | **Oxblood** | `#9e3b2f` | `--status-bad` |
| Surface | **Parchment / Linen** | `#faf8f2` / `#f7f4ee` | `--bg`, `--bg-card` |
| Ink | **Spine** (warm charcoal) | `#262019` | `--ink` |

Typography: `--font-serif` = Cormorant Garamond (h1/h2 — scholarly display),
`--font-sans` = Manrope (body, h3/h4, UI), `--font-mono` = Geist Mono (eyebrows,
labels, code). Radius 8px cards / 6px controls. Elevation is soft + warm, not
cold drop-shadows.

## Two registers, same token names

Both registers define the same variable names, so the shared primitives work in
either context; the wrapping shell re-themes the subtree.

1. **Platform** (`:root`) — Ember on linen. The landing + non-product chrome.
2. **Product** (`[data-shell="product"]`) — Ivy on parchment (Schola education
   variant). Applied by `ProductShell`; each product may override `--accent`
   (Atlas Learn = Ivy).

## The third register: the dark chrome

The nav bar is the one surface that stays dark in **both** registers, so it has its
own ink scale rather than borrowing the page's: `--nav-bg`, `--nav-ink`,
`--nav-ink-soft`, `--nav-ink-faded`, `--nav-ink-mute`, `--nav-rule`, `--nav-hover`,
`--nav-active`. Use those in `SiteNav` / `ProductTopNav`, never a literal.

The brand colour inside the bar is still `var(--accent)` — the *same* token as
everywhere else, not a copy of its value.

That distinction is load-bearing, and it was a real bug: `#f97316` sat hand-copied
in `SiteNav` for months. Changing `--accent` in `globals.css` would have re-themed
the whole platform *except the bar across the top of it*, and nothing would have
failed — the two oranges would simply have drifted, and a user would have found it
first. **A token that is a copy of another token is a bug with a delay on it.**

## Rules
- **New product UI → the product register.** It's applied by `ProductShell`; use
  the tokens + shared primitives (`.card`, `.btn`, `.pill`, `.depth`, `.grid`,
  `.eyebrow`, `.wikilink`).
- **Headings are serif.** h1/h2 render in Cormorant Garamond automatically — lean
  on real headings rather than bold sans for scholarly hierarchy.
- **Warm, not cold.** Borders and surfaces carry a warm hue; don't introduce
  pure-grey or cool-blue chrome. Don't mix registers mid-surface.
- Unsure which token? Ask rather than guess.

## Primitives (globals.css)
`.card`, `.btn` / `.btn.ghost`, `.pill` (+ `ok|warn|bad|info`), `.eyebrow`,
`.wikilink`, `.depth`, `.grid.cols-2|cols-3`, `.pnav`.

## The paper register

A research entity at depth is a short paper, and it renders as one
(`app/_platform/research/PaperShell.tsx` + the `.paper*` block in `globals.css`).
Three things make it a paper rather than a styled stack of cards:

**A measure.** Prose holds `--paper-measure` (68ch). The same paragraph run
full-width across a wide monitor is skimmed and abandoned. Tables and figures may
bleed to `--paper-wide` (86ch) — a table cramped to the text measure stops being
readable, and that is the only case where breaking the column is right.

**Numbered sections.** A reader can cite §4; the contents rail can point at it.
Neither works when every block is an anonymous card. Sections are collected as
data (`Sections`), and both the body numbering and the rail are derived from that
one array — so they cannot drift apart.

**Numbered figures and tables.** Prose refers to Table 2, which stays true when
the layout reflows. "The table below" does not.

Sections auto-omit when their content is absent, so **depth is legible from the
silhouette**: a stub is a short paper, a reference-grade entity is a long one with
figures and a reference list, and you can see which before reading a word.

Do not add a card inside the paper body. The card is a dashboard primitive; the
paper has a spine instead.
