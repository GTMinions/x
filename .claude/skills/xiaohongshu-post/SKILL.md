---
name: xiaohongshu-post
description: How to write and package a Xiaohongshu (小红书/RED) post from a product's research corpus — format limits, card specs, caption register, hashtags, compliance, and the generator discipline. Use when writing a share topic (research/content/sharing/), building its cards, or reviewing one. Products layer their own content doctrine on top (e.g. gtm's sharable-topic skill); this skill owns FORMAT and LANGUAGE for every product.
---

# xiaohongshu-post — the format skill

A share topic (`ShareTopic` in `app/_platform/research/share/sharing.ts`) is a
Xiaohongshu post cut from a research corpus: cards + title + caption + hashtags,
in Chinese. This skill is the platform's knowledge of what Xiaohongshu accepts
and rewards, verified against sources in July 2026. The product's own share
skill (if any) governs what the post is *about*; this one governs its shape.

## Hard limits (the composer enforces these; we enforce them earlier)

| Field | Limit | Notes |
|---|---|---|
| `title` | **20 chars** — hanzi count 1, latin/digits count ½ | Hard input cap. Feed clips at ~2 lines; keep ≤18. Put the search keyword in the first 10 chars — search is ~30% of entry traffic. |
| `caption` | **1,000 chars** incl. punctuation | First ~50 chars show in feed preview; first ~200 sit above the 展开 fold. Front-load the payoff. |
| `cards` | up to 18 images; use 4–9 | JPG/PNG. The FIRST card's ratio sets the whole carousel's display. |
| card size | **1080×1440 (3:4 portrait)** | The ratio the two-column feed gives the most height to. `CARD_W`/`CARD_H` in the engine. |
| `hashtags` | ≤10, aim 3–6 | In the app these must be picked from the topic dropdown to become live 话题; free-typed `#text` is plain text. Ours paste as text — keep them real topic names. |

## What the feed rewards (design targets, not vanity)

- **收藏 (save) is the metric a knowledge post optimizes.** Saves and comments
  outweigh likes in every credible account of the ranking; save-heavy posts earn
  long-tail search traffic for weeks. So a card set must be *worth keeping*: a
  reusable principle, a numbers table, a checklist — content the reader will
  need again, not content that is merely true.
- **The cover card is the CTR gate.** The first 1–2 hours decide whether a post
  leaves the cold-start pool, and the cover + title decide the click. Cover =
  poster: one claim, huge type, no table.
- **Carousels beat single images** (swipe-through and dwell count). One idea per
  card, consistent template across the set, last card = the takeaway/summary.

## Language register (zh-CN)

- Short sentences. One idea per line. Hard line breaks every 1–3 lines — a
  formal 书面语 paragraph is an instant tell, and so are 然而/综上所述
  transitions. This overlay coexists with `anti-ai-voice`: named, dated,
  falsifiable — but spoken, not written.
- Numbers do the exclaiming; keep 绝绝子-grade slang out (dated slang reads
  fake). 0–2 emoji in the title; emoji as bullet markers in the caption are
  fine, dense emoji noise is not.
- x's posts are research cuts, so the register is "操盘手拆解给同行看" —
  an operator walking a peer through a case — not 姐妹分享. Concrete verbs,
  present tense, second person allowed.

## Compliance — these get a post throttled or deleted

- **极限词** (PRC Advertising Law): 最 / 第一 / 顶级 / 100% / 独一无二 /
  首选… Write the dated number instead ("2025 年收官 $330M+"), or attribute
  the superlative to a named source with a date.
- **导流**: no external URLs, WeChat IDs, QR codes, platform names in body or
  images. The card footer's `<site domain>/...` line is for THE READER OF OUR
  SITE tracing the claim; when actually posting, know that a live link will not
  work and the string is tolerated only as small print.
- **诱导互动**: never write 点赞收藏关注 / 评论区扣1. Earn the save with a
  reference-grade card instead.
- Cover/title must match the content (标题党 mismatch hurts completion and
  triggers 虚假夸大 review).

## The card discipline (engine + generator)

- Cards are **generated, never hand-edited** — each product keeps a generator
  beside its content (`research/share/_generate.mjs` in gtm) that owns the
  palette, the type scale, and `fit()` overflow guards which THROW rather than
  ship a clipped line. Hex colors, not `var()` — an exported SVG has no page
  to resolve a custom property against.
- Every card names the entity it came from, and the topic page links to it.
  A claim on a card must be chaseable to a citation on the entity page: a
  social post is a marketing claim wearing a smaller hat.
- Downloads are PNG (the engine rasterizes; Xiaohongshu doesn't take SVG, and
  SVG re-lays-out text with whatever CJK font the device has).

## Posting mechanics (for whoever operates the account)

- Desktop: creator.xiaohongshu.com takes finished images, real-keyboard
  captions, and scheduled posting (定时发布). No editing tools — cards arrive
  finished, which is exactly what the generator produces.
- Cadence: 3–5 posts/week beats daily filler; evening 19:00–21:30 CST is the
  strongest window. A good post keeps pulling search traffic for 2–3 weeks.

## Unverified folklore (do not state as fact)

The CES weight formula (like 1 / save 1 / comment 4 / share 4 / follow 8) and
the 40/30/20/10 quality-dimension split circulate in every guide but have never
been confirmed by the platform. Design to the *ordering* (save ≫ like), not
the coefficients.
