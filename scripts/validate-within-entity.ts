/**
 * validate-within-entity — does a single entity contradict ITSELF?
 *
 * validate-cross-entity catches company B's number disagreeing across files. But the
 * sharper, more common rot is one file disagreeing with itself: a summary quoting a
 * price its own benchmark corrected, a citation label dated a month off the prose it
 * cites, a diagram caption frozen on last quarter's figure, two key_takeaways copied
 * from each other that drifted to different GA dates. Every one of those shipped this
 * arc (langfuse $59-vs-$199, glean Mar-vs-Feb, perplexity SVG, autogen Apr-3-vs-Apr-9)
 * and none is visible to a gate that reads across files or reads numbers in isolation —
 * the contradiction lives WITHIN one entity, in prose the number-crosscheck never binds.
 *
 * The precise, low-false-positive signal is COPY-PASTE DRIFT: two spans in the same
 * entity that are byte-identical once their dates/money/counts are blanked to
 * placeholders — same skeleton — but whose blanked tokens disagree. Same words, one
 * number changed. That is almost never a coincidence and almost always a drift: a
 * duplicated row, a restated takeaway, a caption that fell behind its own table.
 *
 * It does NOT try to bind a fact stated two DIFFERENT ways (a summary sentence vs a
 * benchmark cell) — that needs reading, not a skeleton, and a fuzzy version would drown
 * the real hits in noise. This gate stays narrow so its every hit is worth acting on.
 *
 * Warn-only, always exits 0 — same posture as validate-cross-entity / -sources / -voice:
 * a self-contradiction is a lead to reconcile, and a legitimate multi-phase set (a
 * time-series, a "preview X then GA Y") can share a skeleton without being wrong. Read
 * each hit; fix the stale side against the subject's own primary.
 *
 *   npx tsx scripts/validate-within-entity.ts          # console report
 *   npx tsx scripts/validate-within-entity.ts --json   # machine-readable
 */
import { loadEntities } from "../app/_platform/research/engine";
import { productsWithResearch } from "./_scan";

const MONTHS =
  "january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec";
// "April 3, 2026" / "Apr 3 2026" / "March 2025" / "2026-04-03"
const DATE_FULL = new RegExp(`\\b(?:${MONTHS})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+20\\d{2}\\b`, "gi");
const DATE_MY = new RegExp(`\\b(?:${MONTHS})\\.?\\s+20\\d{2}\\b`, "gi");
const DATE_ISO = /\b20\d{2}-\d{2}-\d{2}\b/g;
const MONEY = /\$\s*\d+(?:\.\d+)?\s*[kmbt]?\+?/gi;
const PCT = /\b\d+(?:\.\d+)?\s*%/g;
const NUM = /\b\d+(?:\.\d+)?\s*[kmbt]\b/gi; // a count with a magnitude suffix: 8k, 32.6k, 97m

const MONTH_NUM: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};
function monthNum(word: string): string {
  return MONTH_NUM[word.slice(0, 3).toLowerCase()] ?? "00";
}
/** Canonicalise a date so "April 3, 2026" == "Apr 3 2026" but != "April 9 2026". */
function normDate(raw: string): string {
  const iso = raw.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const full = raw.match(new RegExp(`\\b(${MONTHS})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(20\\d{2})`, "i"));
  if (full) return `${full[3]}-${monthNum(full[1])}-${full[2].padStart(2, "0")}`;
  const my = raw.match(new RegExp(`\\b(${MONTHS})\\.?\\s+(20\\d{2})`, "i"));
  if (my) return `${my[2]}-${monthNum(my[1])}`;
  return raw.toLowerCase().replace(/\s+/g, " ").trim();
}
const SUFFIX: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9, t: 1e12 };
function normMoney(raw: string): string {
  const m = raw.match(/\$\s*(\d+(?:\.\d+)?)\s*([kmbt])?/i);
  if (!m) return raw.toLowerCase();
  return String(+m[1] * (m[2] ? SUFFIX[m[2].toLowerCase()] : 1));
}
function normNum(raw: string): string {
  const m = raw.match(/(\d+(?:\.\d+)?)\s*([kmbt])/i);
  return m ? String(+m[1] * SUFFIX[m[2].toLowerCase()]) : raw.toLowerCase();
}

type Span = { skel: string; tokens: string[]; text: string; path: string };

// One left-to-right pass: dates (full → iso → month-year) win before money/pct/count at a
// given position, so a day-number inside a date is never mis-read as a count. Collecting in a
// SINGLE scan keeps tokens in DOCUMENT order — a two-pass approach reorders them when one span
// writes a date "Jan 28 2026" (full) and another "Jan 2026" (month-year), breaking positional
// comparison and inventing a conflict.
const COMBINED = new RegExp(
  [DATE_FULL, DATE_ISO, DATE_MY, MONEY, PCT, NUM].map((r) => r.source).join("|"),
  "gi",
);
function classify(tok: string): { ph: string; val: string } {
  if (/^\$/.test(tok)) return { ph: "⟨$⟩", val: "$:" + normMoney(tok) };
  if (/%$/.test(tok)) return { ph: "⟨%⟩", val: "%:" + tok.replace(/\s/g, "") };
  if (/^20\d{2}-\d{2}-\d{2}$/.test(tok) || new RegExp(`^(?:${MONTHS})`, "i").test(tok))
    return { ph: "⟨d⟩", val: "d:" + normDate(tok) };
  return { ph: "⟨n⟩", val: "n:" + normNum(tok) };
}
/** Blank every quantity to a typed placeholder; return the skeleton + the document-ordered tokens. */
function skeletonize(s: string): { skel: string; tokens: string[] } {
  const tokens: string[] = [];
  const skel = s
    .replace(/\s+/g, " ")
    .trim()
    .replace(COMBINED, (m) => {
      const { ph, val } = classify(m);
      tokens.push(val);
      return ph;
    });
  return { skel: skel.toLowerCase().replace(/\s+/g, " ").trim(), tokens };
}

/** A skeleton is worth comparing only if it carries a real sentence of context AND a quantity. */
function meaningful(skel: string): boolean {
  if (!/⟨[d$%n]⟩/.test(skel)) return false; // no quantity, nothing can drift
  const letters = (skel.match(/[a-z]/g) ?? []).length;
  return letters >= 25; // 25+ letters of surrounding words → not a bare "⟨d⟩: ⟨$⟩" template row
}

/** Split prose into sentences; leave short atomic strings (cells, list items) whole. */
function candidates(text: string): string[] {
  if (text.length <= 160) return [text];
  return text.split(/(?<=[.;])\s+(?=[A-Z(“"'\[])/).filter((s) => s.trim().length > 0);
}

/** Pull the human-readable <text> node contents out of an inline SVG (skip the coord soup). */
function svgTextNodes(svg: string): string[] {
  return [...svg.matchAll(/>([^<>]*[A-Za-z]{2}[^<>]*)</g)].map((m) => m[1].trim()).filter(Boolean);
}

/** Walk every string leaf of an entity, yielding (path, string). */
function* strings(obj: unknown, path = ""): Generator<{ path: string; value: string }> {
  if (typeof obj === "string") {
    yield { path, value: obj };
  } else if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) yield* strings(obj[i], path);
  } else if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) yield* strings(v, path ? `${path}.${k}` : k);
  }
}

/**
 * Benchmark VALUE cells are a comparison of DIFFERENT subjects (one row per vendor/tier),
 * so two cells sharing a skeleton ("$249/mo Pro" vs "$79/mo Pro") is the table doing its
 * job, not a self-contradiction — and cross-row drift there is validate-cross-entity's beat.
 * Skip them so the within-entity signal stays the prose/takeaway/caption drift that only
 * this gate can see. Benchmark metric labels, sources, and notes are kept.
 */
function excluded(path: string): boolean {
  return /(^|\.)benchmarks\.values(\.|$)/.test(path);
}

/** Two same-typed tokens are compatible when a month-year prefixes a full date (same fact, coarser). */
function tokenCompatible(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.startsWith("d:") && b.startsWith("d:")) {
    const x = a.slice(2), y = b.slice(2);
    return x.startsWith(y + "-") || y.startsWith(x + "-"); // 2026-01 vs 2026-01-28 → compatible
  }
  return false; // money / pct / count must match exactly
}
/** Same skeleton ⇒ same token positions/types; they conflict if any position is incompatible. */
function tokensConflict(a: string[], b: string[]): boolean {
  for (let i = 0; i < a.length; i++) if (!tokenCompatible(a[i], b[i])) return true;
  return false;
}

type Finding = { product: string; entity: string; skel: string; spans: Span[] };

/**
 * Fixtures drawn from the real contradictions this gate exists to catch (autogen s723,
 * langfuse s716) and the compatible near-miss it must NOT flag (cresta precision). A `pair`
 * shares a skeleton by construction; `conflict` is whether the tokens should disagree.
 */
function selftest(): void {
  const cases: { name: string; a: string; b: string; conflict: boolean }[] = [
    {
      name: "autogen GA date drift (s723)",
      a: "superseded by Microsoft Agent Framework 1.0 GA on April 3 2026; AutoGen still maintained as research-tier substrate.",
      b: "superseded by Microsoft Agent Framework 1.0 GA on April 9, 2026; AutoGen still maintained as research-tier substrate.",
      conflict: true,
    },
    {
      name: "price drift across surfaces (s716-style)",
      a: "Langfuse Cloud Pro starts at $59/month with Units metering on the managed tier.",
      b: "Langfuse Cloud Pro starts at $199/month with Units metering on the managed tier.",
      conflict: true,
    },
    {
      name: "coarser date prefixes finer — compatible, must NOT flag (cresta)",
      a: "Decagon last-disclosed Oct 2025 (Series D Jan 2026, Bloomberg) at the reported mark.",
      b: "Decagon last-disclosed Oct 2025 (Series D Jan 28 2026, Bloomberg) at the reported mark.",
      conflict: false,
    },
  ];
  let ok = true;
  for (const c of cases) {
    const A = skeletonize(c.a), B = skeletonize(c.b);
    const sameSkel = A.skel === B.skel;
    const got = sameSkel && tokensConflict(A.tokens, B.tokens);
    const pass = sameSkel && got === c.conflict;
    console.log(`  ${pass ? "✓" : "✗"} ${c.name}${sameSkel ? "" : " (SKELETON MISMATCH)"}`);
    if (!pass) ok = false;
  }
  console.log(ok ? "✓ validate-within-entity selftest: detection logic correct" : "✗ selftest FAILED");
  process.exit(ok ? 0 : 1);
}

function main() {
  if (process.argv.includes("--selftest")) selftest();
  const findings: Finding[] = [];
  let spansChecked = 0;

  for (const product of productsWithResearch()) {
    for (const e of loadEntities(product)) {
      const groups = new Map<string, Span[]>();
      for (const { path, value } of strings(e as unknown)) {
        if (excluded(path)) continue;
        const raw = path.endsWith("diagram_svg") ? svgTextNodes(value) : candidates(value);
        for (const c of raw) {
          const { skel, tokens } = skeletonize(c);
          if (!meaningful(skel)) continue;
          spansChecked++;
          const label = path.split(".").slice(0, 2).join(".");
          (groups.get(skel) ?? groups.set(skel, []).get(skel)!).push({ skel, tokens, text: c.trim(), path: label });
        }
      }
      for (const [skel, spans] of groups) {
        if (spans.length < 2) continue;
        // de-dupe to one span per distinct token signature; a group of identical signatures
        // is mere duplication (the same sentence twice), never a drift.
        const seen = new Set<string>();
        const rep = spans.filter((s) => {
          const sig = s.tokens.join("|");
          if (seen.has(sig)) return false;
          seen.add(sig);
          return true;
        });
        if (rep.length < 2) continue;
        // real conflict only if some pair is incompatible (a coarser date prefixing a finer one
        // is the SAME fact, not a drift) — otherwise it is a precision difference, not a bug.
        let conflict = false;
        for (let i = 0; i < rep.length && !conflict; i++)
          for (let j = i + 1; j < rep.length; j++)
            if (tokensConflict(rep[i].tokens, rep[j].tokens)) { conflict = true; break; }
        if (conflict) findings.push({ product, entity: e.slug, skel, spans: rep });
      }
    }
  }

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(findings, null, 2));
    process.exit(0);
  }

  console.log(`  within-entity: ${spansChecked} quantity-bearing spans checked`);
  if (findings.length === 0) {
    console.log("✓ validate-within-entity: no entity contradicts itself on a copy-paste-drift skeleton");
    process.exit(0);
  }
  console.warn(`\n! validate-within-entity: ${findings.length} entity span-group(s) share a skeleton but disagree on a number/date\n`);
  for (const f of findings.slice(0, 25)) {
    console.warn(`  [${f.product}] ${f.entity}`);
    for (const s of f.spans) console.warn(`       (${s.path}) ${s.text.slice(0, 120)}`);
  }
  if (findings.length > 25) console.warn(`  … and ${findings.length - 25} more`);
  console.warn("\n  Same wording, drifted number/date, inside one file. One side is stale — reconcile against the primary.");
  process.exit(0);
}

main();
