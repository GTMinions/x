/**
 * validate-coherence — a withdrawn claim must be withdrawn from the whole corpus.
 *
 * THE INVARIANT
 * -------------
 * For every string in a `retractions[].fingerprints` list, that string appears in no other
 * field of no other entity in the product — except in the entities the retraction explicitly
 * allows. Because a fabrication does not live in a file. It lives in the corpus, and it
 * survives in whichever entity you were not looking at:
 *
 *   - bombora retracted the Madhive acquisition and left it standing in 19 fields of the very
 *     same file, including the entity's own falsifier.
 *   - black-forest-labs retracted a March 2025 Series B that never happened. The phantom
 *     round's number had already been ADDED INTO a "$531M total" — the entity did arithmetic
 *     on a fabrication. That sum quotes no phrase from the claim, so a gate keyed on the
 *     proposition cannot see it. `$531M` is the fingerprint that can, and it is why
 *     fingerprints are short.
 *   - cartesia retracted "Vox", a product that does not exist. Fifteen fields kept selling
 *     it, in two languages, and it was steering a purchase recommendation.
 *
 * WHY THE AUTHOR DECLARES THE STRINGS INSTEAD OF THE GATE INFERRING THEM
 * ---------------------------------------------------------------------
 * Four earlier versions of this file tried to READ the retraction prose and work out what had
 * been withdrawn. All four failed, and the record is kept because each looked obviously
 * correct until it ran:
 *
 *   1. EDIT-DEBRIS REGEX — patterns for the wreckage a find/replace leaves mid-sentence.
 *      884 findings, zero true. `()` matched `run()`. `; \.` matched `Python-only; .NET
 *      shops cannot adopt` — `.NET` is a word. `\. \.` matched the tail of `system='...'`.
 *      A doubled word matched "change blindness blindness", a real term.
 *
 *   2. SUPERLATIVE COLLISION — "only one deal may be the largest". It read $5.2B (FY25
 *      revenue) and $230B (a valuation) as deal sizes.
 *
 *   3. QUOTE HARVESTING — take what the retraction puts in quotes. A retraction also
 *      scare-quotes single words while arguing, so `"explicitly"` became a withdrawn claim
 *      and matched 251 innocent fields across three products.
 *
 *   4. QUOTE HARVESTING, PHRASES ONLY — require two words. This is the one that settles it:
 *      a retraction quotes the false claim AND the true correction, and lexically those are
 *      the same thing. The gate read `"Alphabet's $185B FY26 capex"` — a figure the retraction
 *      was CONFIRMING — as the claim it withdrew.
 *
 * You cannot infer which half of a correction is the wrong half without reading it.
 *
 * Run `pnpm research:coherence --self-test` to see the gate fail on planted defects.
 */
import { loadEntities } from "../app/_platform/research/engine";
import type { Entity } from "../app/_platform/research/types";
import { productsWithResearch } from "./_scan";

/**
 * Every string a human wrote, with its path — EXCEPT the retraction record itself, which is
 * the one place a withdrawn string is allowed to appear. That exemption is the whole trick:
 * it lets a retraction name what it kills without tripping the gate that enforces it.
 */
function assertions(e: Entity): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const skip = new Set(["slug", "url", "tags", "edges", "citations", "diagram_svg", "retractions"]);
  const walk = (v: unknown, key?: string, p = "") => {
    if (key && skip.has(key)) return;
    if (typeof v === "string") out.push([p || key || "?", v]);
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, key, `${p}[${i}]`));
    else if (v && typeof v === "object")
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) walk(x, k, p ? `${p}.${k}` : k);
  };
  walk(e);
  return out;
}

/**
 * A fingerprint matches on word boundaries, never as a bare substring. `Vox` must not fire on
 * "voxel", and `$531M` must not fire on Oracle's "+531% YoY" — which is live in two entities
 * right now and has nothing to do with Black Forest Labs.
 */
function fingerprintRe(s: string): RegExp {
  const esc = s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const lead = /^[\w$]/.test(s) ? "(?<![\\w$])" : "";
  const tail = /[\w%]$/.test(s) ? "(?![\\w%])" : "";
  return new RegExp(`${lead}${esc}${tail}`, "i");
}

/**
 * The check, as a pure function over entities, so the self-test below can plant a defect
 * without touching the working tree. The previous version of this file claimed a `--self-test`
 * flag in its own header and never implemented one — an assertion made without checking the
 * thing it asserts, in the file written to stop exactly that.
 */
export function check(product: string, entities: Entity[]): { errors: string[]; warnings: string[]; declared: number } {
  const errors: string[] = [];
  const warnings: string[] = [];
  let declared = 0;

  const withdrawn: Array<{ by: string; claim: string; needle: string; rx: RegExp; allow: Set<string> }> = [];

  for (const e of entities) {
    for (const r of e.retractions ?? []) {
      const at = `[${product}] ${e.slug}.retractions`;

      // The claim is what the READER sees, struck through. A fragment struck through says
      // something the author did not mean, so it has to stand alone as a false proposition.
      if (!r.claim?.trim()) {
        errors.push(`${at}: a retraction with no claim withdraws nothing`);
        continue;
      }
      // A sentence, not a noun phrase: ends in a full stop, and long enough to carry a subject
      // and a verb. "a multilingual TTS product" is four words and passed the first version of
      // this rule — struck through, it tells the reader Cartesia has no multilingual TTS
      // product, which is false and which the retraction's own body contradicts.
      const c = r.claim.trim();
      if (!/[.?!]$/.test(c) || c.split(/\s+/).length < 4)
        errors.push(
          `${at}: "${r.claim}" is a fragment. It renders STRUCK THROUGH — write the whole false ` +
            `proposition as a sentence, subject and all ("Madhive acquired Bombora in 2023."), or the ` +
            `strike asserts something you did not mean.`,
        );
      if (!r.why?.trim()) errors.push(`${at}: "${r.claim}" — say what was checked and what the source said`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(r.on ?? ""))
        errors.push(`${at}: "${r.claim}" — needs an ISO date (got "${r.on ?? ""}")`);

      // A replacement is a new claim on an old page. It carries the same burden of proof as
      // any other claim, so it cites a source or it does not ship.
      if (r.replaces?.trim() && !/https?:\/\/\S+/.test(r.replaces))
        errors.push(
          `${at}: the replacement "${r.replaces}" cites nothing. A retraction that asserts a ` +
            `replacement is making a NEW claim — cite it or withdraw without replacing.`,
        );

      const prints = r.fingerprints?.length ? r.fingerprints : [r.claim];
      for (const f of prints) {
        if (!f.trim()) continue;
        declared += 1;
        withdrawn.push({
          by: e.slug,
          claim: r.claim,
          needle: f,
          rx: fingerprintRe(f),
          allow: new Set(r.allow ?? []),
        });
      }
    }
  }

  for (const e of entities) {
    for (const w of withdrawn) {
      if (w.allow.has(e.slug)) continue;
      for (const [p, s] of assertions(e)) {
        if (!w.rx.test(s)) continue;
        errors.push(
          e.slug === w.by
            ? `[${product}] ${e.slug}.${p}: "${w.needle}" is still here — the retraction on this very page withdrew it\n` +
              `      (withdrawn claim: ${w.claim})`
            : `[${product}] ${e.slug}.${p}: "${w.needle}" is still here — withdrawn by ${w.by}, never withdrawn here\n` +
              `      (withdrawn claim: ${w.claim})`,
        );
      }
    }
  }

  for (const e of entities)
    for (const r of e.retractions ?? [])
      if (r.replaces?.trim())
        warnings.push(`[${product}] ${e.slug}: asserts a replacement — read the page, nothing here can check it fits`);

  return { errors, warnings, declared };
}

/* ── the self-test. A gate that has never failed is indistinguishable from one that does not run. ── */

function selfTest(): void {
  const base = (slug: string, extra: Partial<Entity> = {}): Entity =>
    ({ slug, title: slug, depth_score: 5, last_updated: "2026-07-14", ...extra }) as Entity;

  const retraction = {
    claim: "Vox is Cartesia's multilingual TTS product, covering 16 languages.",
    why: "Cartesia ships no product called Vox.",
    on: "2026-07-14",
    fingerprints: ["Vox"],
  };

  const cases: Array<[string, Entity[], boolean]> = [
    [
      "a clean corpus passes",
      [base("cartesia", { retractions: [retraction] }), base("elevenlabs", { summary: "Sonic covers 42 languages." })],
      false,
    ],
    [
      "the withdrawn string, re-asserted in ANOTHER entity",
      [
        base("cartesia", { retractions: [retraction] }),
        base("elevenlabs", { summary: "Vox is closing the gap on our language breadth." }),
      ],
      true,
    ],
    [
      "the withdrawn string, still on its OWN page",
      [base("cartesia", { retractions: [retraction], summary: "Vox is the multilingual line." })],
      true,
    ],
    [
      "a SHORT fingerprint — the one the old gate could not even declare",
      [base("cartesia", { retractions: [retraction] }), base("recraft", { summary: "Rivals ship Vox." })],
      true,
    ],
    [
      "a fingerprint inside a word does NOT fire (Vox vs voxel)",
      [base("cartesia", { retractions: [retraction] }), base("recraft", { summary: "We render voxel grids." })],
      false,
    ],
    [
      "an allowed entity does NOT fire (Vox Media is real)",
      [
        base("cartesia", { retractions: [{ ...retraction, allow: ["vox-media"] }] }),
        base("vox-media", { summary: "Vox Media publishes The Verge." }),
      ],
      false,
    ],
    [
      "a fragment claim is refused — it renders struck through",
      [base("cartesia", { retractions: [{ ...retraction, claim: "a multilingual TTS product" }] })],
      true,
    ],
    [
      "a replacement that cites nothing is refused",
      [base("cartesia", { retractions: [{ ...retraction, replaces: "Sonic is the multilingual line." }] })],
      true,
    ],
  ];

  let failed = 0;
  for (const [name, entities, shouldFail] of cases) {
    const { errors } = check("selftest", entities);
    const didFail = errors.length > 0;
    const ok = didFail === shouldFail;
    if (!ok) failed += 1;
    console.log(`   ${ok ? "✓" : "✗"} ${name}${ok ? "" : `  — expected ${shouldFail ? "FAIL" : "PASS"}, got ${didFail ? "FAIL" : "PASS"}`}`);
    if (!ok && errors.length) errors.forEach((e) => console.log(`       ${e.split("\n")[0]}`));
  }

  if (failed) {
    console.error(`\n✗ self-test: ${failed}/${cases.length} case(s) wrong. The gate does not do what it says.\n`);
    process.exit(1);
  }
  console.log(`\n✓ self-test: ${cases.length}/${cases.length} — the gate fails on every defect it exists to catch.\n`);
}

if (process.argv.includes("--self-test")) {
  console.log("  validate-coherence --self-test\n");
  selfTest();
  process.exit(0);
}

const errors: string[] = [];
const warnings: string[] = [];
let declared = 0;

for (const product of productsWithResearch()) {
  const r = check(product, loadEntities(product));
  errors.push(...r.errors);
  warnings.push(...r.warnings);
  declared += r.declared;
}

console.log(`  ✓ validate-coherence: ${declared} withdrawn string(s) enforced across the corpus`);

if (warnings.length)
  console.warn(`\n! validate-coherence: ${warnings.length} replacement(s) to read\n` + warnings.map((w) => "  - " + w).join("\n"));

if (errors.length) {
  console.error(
    `\n✗ validate-coherence: ${errors.length} error(s)\n` +
      errors.map((e) => "  - " + e).join("\n") +
      `\n\n  A fabrication does not live in a file. It lives in the corpus, and it survives in\n` +
      `  whichever entity you were not looking at. Withdraw it everywhere, or withdraw the\n` +
      `  retraction.\n`,
  );
  process.exit(1);
}
console.log("✓ validate-coherence: no withdrawn string is asserted anywhere");
