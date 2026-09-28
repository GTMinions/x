/**
 * Creative briefs, derived from the research.
 *
 * The reference implementation for this (a bot that markets a product to a short-video platform)
 * works like so: scrape the product's landing page, hand ~3000 characters of
 * stripped HTML to a model, ask it for a caption and a video prompt, send that to
 * a video generator, publish the result.
 *
 * It is a good pipeline with a bad input. Everything downstream inherits whatever
 * the landing page happened to say — including the parts that were aspirational —
 * and the model fills the gaps with plausible invention. The output is fluent and
 * unfalsifiable, which is exactly what an ad should not be.
 *
 * x has a better input available: an entity that has already climbed the depth
 * ladder. It is cited, dated, its mechanism is decomposed, its numbers carry
 * sources, and a gate has already refused to let it claim more than it earned. So
 * the brief is *derived* from it rather than generated from a scrape — every beat
 * traces to a field in the corpus, and there is no step at which a model is
 * invited to make something up.
 *
 * The output is a spec a human or a generator can execute. It is deliberately not
 * finished copy: the last mile is a judgment call, and pretending otherwise is how
 * you get a feed full of content nobody chose to publish.
 */
import type { Entity } from "../research/types";
import { CHANNELS } from "./channels";
import type { Brief, Claim, ChannelId } from "./types";

/** The strongest sourced number on an entity — the thing worth leading with. */
function leadNumber(e: Entity): { label: string; value: string; source: string } | null {
  for (const c of e.components ?? []) {
    for (const n of c.numbers ?? []) {
      if (n.source) return { label: n.label, value: n.value, source: n.source };
    }
  }
  for (const b of e.benchmarks ?? []) {
    if (b.source && b.values) {
      const [k, v] = Object.entries(b.values)[0] ?? [];
      if (k && v) return { label: b.metric, value: `${v}`, source: b.source };
    }
  }
  return null;
}

/**
 * The hook.
 *
 * Taken from what the entity already committed to — its abstract kicker or its
 * thesis. Those sentences were written to survive a citation gate, which makes
 * them a better hook than anything a copywriter would reach for, because they are
 * both interesting and true.
 */
function hookFor(e: Entity): string {
  const candidate = e.abstract?.kicker || e.thesis || e.mechanism?.kicker || e.summary;
  if (!candidate) return `${e.name}: what it is and why it matters.`;
  const firstSentence = candidate.split(/(?<=[.?!])\s/)[0] ?? candidate;
  return firstSentence.trim();
}

/** The beats. Each one is a claim the corpus can already defend. */
function beatsFor(e: Entity, max: number): string[] {
  const beats: string[] = [];

  const num = leadNumber(e);
  if (num) beats.push(`${num.label} — ${num.value}`);

  for (const c of e.components ?? []) {
    if (beats.length >= max) break;
    if (c.purpose) beats.push(`${c.name}: ${c.purpose.split(/(?<=[.?!])\s/)[0]}`);
  }
  for (const t of e.key_takeaways ?? []) {
    if (beats.length >= max) break;
    beats.push(t.split(/(?<=[.?!])\s/)[0]);
  }
  if (e.mechanism?.bullets) {
    for (const b of e.mechanism.bullets) {
      if (beats.length >= max) break;
      beats.push(b);
    }
  }
  return beats.slice(0, max);
}

/**
 * What the entity does NOT yet give us.
 *
 * A brief that quietly omits its gaps produces an asset that quietly invents
 * them. Naming them is what keeps the last mile honest.
 */
function needsFor(e: Entity, channel: ChannelId): string[] {
  const spec = CHANNELS[channel];
  const needs: string[] = [];

  if (spec.medium === "video") {
    needs.push(
      "A screen recording of the product doing the thing this claim describes. The demo is the ad — an explanation is not a substitute for it.",
    );
    if (!leadNumber(e)) {
      needs.push(
        "A measured number. Without one this video can only assert, and an assertion in a 9:16 frame with music is indistinguishable from every other assertion.",
      );
    }
  }
  if (spec.medium === "image") needs.push("One legible visual. A chart of the measured number, not a stock photo.");
  if (!e.diagram_svg && spec.medium === "long-form") {
    needs.push("A diagram. The entity has none, and a long-form piece without one asks the reader to hold the whole mechanism in their head.");
  }
  return needs;
}

/**
 * One brief, for one claim, on one channel.
 *
 * The `beats` budget is set by the medium rather than by taste: a 15-to-34-second
 * vertical video holds about three beats before it stops being watched, and
 * pretending otherwise produces a video that gets scrolled past at beat four.
 */
export function briefFor(
  e: Entity,
  claim: Claim,
  channel: ChannelId,
  audienceId: string,
): Brief {
  const spec = CHANNELS[channel];
  const maxBeats = spec.medium === "video" ? 3 : spec.medium === "long-form" ? 7 : 4;

  return {
    id: `brief:${channel}:${claim.id}`,
    channel,
    claim_id: claim.id,
    audience_id: audienceId,
    hook: hookFor(e),
    beats: beatsFor(e, maxBeats),
    cta:
      spec.medium === "long-form"
        ? `Read the research: /${"{product}"}/research/${e.slug}`
        : `The evidence for this is public. Link in the post.`,
    needs: needsFor(e, channel),
  };
}

/**
 * The generation spec for a video asset — what a Sora, a Veo, or a human editor
 * would actually be handed.
 *
 * Built from the brief, not from a model. Every line of it is traceable to a
 * field in the corpus, which means the resulting video can be checked against the
 * research the same way the research can be checked against its sources.
 */
export function videoSpec(brief: Brief, e: Entity): string {
  const spec = CHANNELS[brief.channel];
  const [lo, hi] = spec.house_seconds ?? [15, 30];
  const lines = [
    `Format: ${spec.aspect ?? "9:16"}, ${lo}–${hi}s, no voiceover unless the beat needs one.`,
    `Subject: ${e.name}.`,
    ``,
    `Open (0–2s): ${brief.hook}`,
    ``,
    `Beats:`,
    ...brief.beats.map((b, i) => `  ${i + 1}. ${b}`),
    ``,
    `Close: ${brief.cta}`,
  ];
  if (brief.needs?.length) {
    lines.push(``, `Missing before this can be made:`, ...brief.needs.map((n) => `  - ${n}`));
  }
  return lines.join("\n");
}

/**
 * The rendered plain text of a corpus string — what a reader actually sees once
 * the inline markup resolves. `[[slug]]` renders as the slug, `**bold**` and
 * `` `code` `` render their inner text (see research/pills.tsx). The loop settles
 * nested markup (`**[[slug]]**`) before returning.
 */
function renderedText(s: string): string {
  let prev: string;
  let out = s;
  do {
    prev = out;
    out = out
      .replace(/\[\[([a-z0-9-]+)\]\]/g, "$1")
      .replace(/\*\*([\s\S]+?)\*\*/g, "$1")
      .replace(/`([^`]+)`/g, "$1");
  } while (out !== prev);
  return out;
}

/**
 * Channel copy, within the channel's budget.
 *
 * Truncation here would be a bug, not a feature: a claim cut mid-sentence to fit
 * 280 characters is a different claim, and possibly a false one. So a claim that
 * does not fit is *reported* as not fitting, and the gate blocks the post. The
 * fix is a shorter claim, which is a decision a person makes.
 *
 * The budget is measured against the *rendered* text, not the raw markup. A
 * channel post never shows `[[slug]]` or `**` — those are corpus markup that the
 * reader never sees — so counting them would fail a claim for characters that do
 * not ship, and hand back copy with brackets a person would then have to strip.
 */
export function channelCopy(brief: Brief, claim: Claim, channel: ChannelId): { copy: string; fits: boolean } {
  const spec = CHANNELS[channel];
  const body = [brief.hook, "", claim.text].join("\n");
  const copy = renderedText(body).trim();
  return { copy, fits: !spec.max_chars || copy.length <= spec.max_chars };
}
