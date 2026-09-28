/**
 * validate-voice — the mechanical half of the `anti-ai-voice` skill.
 *
 * A grep cannot tell whether prose is good. It can tell whether prose contains
 * the words that reliably mean nobody read it back. That is worth catching for
 * free on every build, and it leaves the `critic-voice` agent to do the part that
 * needs judgment.
 *
 * Scope: reader-visible research prose. Not code, not comments, not run logs.
 *
 * Warn-only by design. It reports what it finds and exits 0, because a voice
 * miss is a quality signal, not a broken build — and a gate that blocks the build
 * on a word choice gets switched off within a week. The gate that can actually
 * stop a push is `critic-voice`, which reads the diff and understands context.
 */
import { loadEntities } from "../app/_platform/research/engine";
import type { Entity, Section } from "../app/_platform/research/types";
import { productsWithResearch } from "./_scan";

/**
 * Words with no defensible use in research prose. A hit here is a hit.
 *
 * Deliberately excludes the context-dependent ones. "Harness" is filler in
 * "harness the power of" and a term of art in "eval harness"; "journey" is filler
 * in "the AI journey" and a domain noun in "customer journey" on a GTM corpus.
 * A grep cannot tell those apart, and a gate that cries wolf on 80% of its hits
 * teaches everyone to ignore it. Those go to `critic-voice`, which reads context.
 */
const BANNED_WORDS = [
  "delve", "seamless", "seamlessly", "comprehensive", "holistic",
  "unlock", "unlocks", "unlocking", "elevate", "empower", "empowers",
  "cutting-edge", "next-generation", "paradigm shift", "revolutionary",
  "game-changer", "game changer", "synergy", "in the era of", "tapestry",
  "best-in-class", "at the end of the day", "moving forward",
];

/** Phrases whose shape is the tell, not the vocabulary. */
const BANNED_PATTERNS: { re: RegExp; why: string }[] = [
  { re: /\bit'?s worth noting\b/i, why: "hedge opener" },
  { re: /\bgenerally speaking\b/i, why: "hedge opener" },
  { re: /\bin conclusion\b/i, why: "hedge opener" },
  { re: /\bnot (just )?[a-z ]{3,20}, but\b/i, why: '"not X, but Y"' },
  { re: /\bis the new\b/i, why: '"X is the new Y"' },
  { re: /\bnavigat(e|ing) the\b/i, why: "metaphorical navigate" },
  { re: /\bharness(es|ing)? the\b/i, why: "filler verb" },
  { re: /\bleverag(e|es|ing) (the|a|our|its)\b/i, why: "leverage as verb" },
];

/**
 * Words that are filler *or* the correct technical term, depending on context.
 * Counted and reported, never presented as violations.
 */
const CONTEXT_WORDS = ["journey", "landscape", "ecosystem", "robust", "harness", "leverage", "realm"];

type Hit = { product: string; slug: string; field: string; term: string; why: string; text: string };
const hits: Hit[] = [];

const SECTIONS = ["abstract", "background", "mechanism", "results", "discussion", "conclusion"] as const;

/** Every reader-visible string on an entity, tagged with where it came from. */
function proseOf(e: Entity): { field: string; text: string }[] {
  const out: { field: string; text: string }[] = [];
  const push = (field: string, text?: string) => {
    if (text?.trim()) out.push({ field, text });
  };
  push("summary", e.summary);
  push("architecture_summary", e.architecture_summary);
  push("positioning", e.positioning);
  push("recommendation", e.recommendation);
  push("thesis", e.thesis);
  (e.key_takeaways ?? []).forEach((t, i) => push(`key_takeaways[${i}]`, t));
  (e.open_questions ?? []).forEach((t, i) => push(`open_questions[${i}]`, t));
  for (const key of SECTIONS) {
    const s = e[key] as Section | undefined;
    if (!s) continue;
    push(`${key}.kicker`, s.kicker);
    (s.bullets ?? []).forEach((b, i) => push(`${key}.bullets[${i}]`, b));
  }
  (e.components ?? []).forEach((c, i) => {
    push(`components[${i}].purpose`, c.purpose);
    push(`components[${i}].recommended`, c.recommended);
  });
  (e.members ?? []).forEach((m, i) => push(`members[${i}].claim`, m.claim));
  return out;
}

/**
 * A citation label quotes someone else's title — we do not get to police their
 * voice, and a paper legitimately called "Robust …" is not a violation.
 */
const contextTally: Record<string, number> = {};
let emDashParas = 0;

for (const product of productsWithResearch()) {
  for (const e of loadEntities(product)) {
    for (const { field, text } of proseOf(e)) {
      for (const w of BANNED_WORDS) {
        const re = new RegExp(`\\b${w.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\b`, "i");
        if (re.test(text)) hits.push({ product, slug: e.slug, field, term: w, why: "banned word", text });
      }
      for (const { re, why } of BANNED_PATTERNS) {
        if (re.test(text)) hits.push({ product, slug: e.slug, field, term: re.source, why, text });
      }
      for (const w of CONTEXT_WORDS) {
        const re = new RegExp(`\\b${w}\\b`, "gi");
        const n = (text.match(re) ?? []).length;
        if (n > 0) contextTally[w] = (contextTally[w] ?? 0) + n;
      }
      // Em-dash density is a corpus statistic here, not a hit.
      //
      // The rule ("max one per paragraph") is real and `critic-voice` enforces it
      // on the diff, where a writer can act on it. Enforcing it across an inherited
      // corpus produces four-figure hit counts that bury the findings anyone can
      // actually fix — the failure mode where a linter's output gets scrolled past.
      for (const para of text.split(/\n\s*\n/)) {
        const n = (para.match(/—/g) ?? []).length;
        if (n > 1) emDashParas += 1;
      }
    }
  }
}

const contextTop = Object.entries(contextTally)
  .sort((a, b) => b[1] - a[1])
  .map(([w, n]) => `${w} ×${n}`)
  .join(" · ");

if (hits.length === 0) {
  console.log("✓ validate-voice: no banned vocabulary or constructions");
  if (contextTop) console.log(`  context words (judge in review, not here): ${contextTop}`);
  process.exit(0);
}

const byProduct: Record<string, Hit[]> = {};
for (const h of hits) (byProduct[h.product] ??= []).push(h);

console.warn(`! validate-voice: ${hits.length} hit(s) across ${Object.keys(byProduct).length} product(s)\n`);
for (const [product, list] of Object.entries(byProduct)) {
  const byTerm: Record<string, number> = {};
  for (const h of list) byTerm[h.term] = (byTerm[h.term] ?? 0) + 1;
  const top = Object.entries(byTerm)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([t, n]) => `${t} ×${n}`)
    .join(" · ");
  console.warn(`  ${product}: ${list.length} hits — ${top}`);
  for (const h of list.slice(0, 3)) {
    const snippet = h.text.length > 90 ? h.text.slice(0, 90) + "…" : h.text;
    console.warn(`      ${h.slug} · ${h.field} · ${h.why}: "${snippet}"`);
  }
}
if (contextTop) console.warn(`\n  context words (judge in review, not here): ${contextTop}`);
if (emDashParas) console.warn(`  paragraphs with >1 em-dash: ${emDashParas} (inherited debt; critic-voice gates new prose)`);
console.warn("\n  Warn-only. `critic-voice` reads the diff and can block the push.");
