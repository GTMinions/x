/**
 * How much prose does this entity actually put in front of a reader?
 *
 * A file's byte size is the wrong answer: an entity carrying a 6KB inline SVG and
 * forty citation URLs looks "big" while saying nothing. So this counts only the
 * fields a reader *reads* — narrative text — and deliberately excludes:
 *
 *   diagram_svg   markup, not prose
 *   citations     the URL and the label are receipts, not argument
 *   tags, slug, name, dates, urls   metadata
 *   Num.value / data_points values  the number is the payload; it is counted once,
 *                                   via its label, and not double-counted as prose
 *
 * The result is a single honest scalar: characters of argument. It is what makes
 * "the corpus grew" mean something other than "more JSON."
 */
import type { Entity, Section } from "./types";

const len = (s?: string): number => (s ? s.trim().length : 0);
const sumLen = (xs?: (string | undefined)[]): number => (xs ?? []).reduce((n, s) => n + len(s), 0);

function sectionChars(s?: Section): number {
  if (!s) return 0;
  return len(s.kicker) + sumLen(s.bullets);
}

/** Characters of reader-visible prose in one entity, as it stands right now. */
export function proseChars(e: Entity): number {
  let n = 0;

  // Overview prose.
  n += len(e.summary) + len(e.architecture_summary) + len(e.positioning);
  n += len(e.recommendation) + len(e.thesis) + len(e.subtitle);

  // Paper anatomy.
  n += sectionChars(e.abstract);
  n += sectionChars(e.background);
  n += sectionChars(e.mechanism);
  n += sectionChars(e.results);
  n += sectionChars(e.discussion);
  n += sectionChars(e.conclusion);

  // The argument, in list form.
  n += sumLen(e.key_takeaways);
  n += sumLen(e.open_questions);
  n += sumLen(e.swot?.strengths);
  n += sumLen(e.swot?.weaknesses);
  n += sumLen(e.swot?.opportunities);
  n += sumLen(e.swot?.threats);

  // The mechanism, part by part. A number's label is prose; its value is data.
  for (const c of e.components ?? []) {
    n += len(c.name) + len(c.purpose) + len(c.recommended);
    for (const num of c.numbers ?? []) n += len(num.label);
    for (const pa of c.prior_art ?? []) n += len(pa.name) + len(pa.approach) + len(pa.tradeoff);
  }
  for (const b of e.benchmarks ?? []) n += len(b.metric);
  for (const f of e.formulas ?? []) n += len(f.name) + len(f.note);

  // MOC editorial work: the per-member claim is the whole point of a map.
  for (const m of e.members ?? []) n += len(m.claim);
  for (const a of e.axes ?? []) n += len(a.name) + len(a.question) + len(a.note);
  for (const d of e.discovered_not_added ?? []) n += len(d.name) + len(d.why_not);

  // data_points: the key is the claim ("2025 ARR"), the value is the datum.
  for (const k of Object.keys(e.data_points ?? {})) n += len(k);

  return n;
}
