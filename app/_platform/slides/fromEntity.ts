/**
 * Entity → deck. The deterministic generator.
 *
 * x has no LLM key and no backend, so nothing here writes prose. It doesn't need
 * to: a researched entity is ALREADY a deck outline. abstract → background →
 * mechanism → components → benchmarks → discussion → conclusion is the shape of
 * a talk, and the schema puts a claim (`kicker`) at the head of each section with
 * the evidence that defends it underneath. The generator's whole job is to walk
 * that structure and lay it out.
 *
 * Two rules hold the output honest:
 *
 *   1. Every word on a slide comes from the entity JSON. Nothing is invented,
 *      summarised, or padded — there is no "Key Takeaways", no "Thank You".
 *   2. A section with no data produces no slide. A thin entity yields a short
 *      deck, and that is the correct answer rather than a failure to paper over.
 *
 * The consequence is that deck quality is a function of research depth, which is
 * the incentive we want: the way to get a better deck is to do better research.
 */
import type { Entity, Benchmark, Component, Citation } from "../research/types";
import { depthLabel } from "../research/types";

/** A deck past this length is a document, not a talk. */
const MAX_SLIDES = 20;
/** Citations per Sources slide. */
const SOURCES_PER_SLIDE = 12;

/* ---------------------------------------------------------------------- */
/* Text helpers                                                           */
/* ---------------------------------------------------------------------- */

/** Resolve [[slug]] pills to entity display names; fall back to the bare slug. */
function pills(text: string, names?: Map<string, string>): string {
  return text.replace(/\[\[([^\]]+)\]\]/g, (_m, slug: string) => names?.get(slug.trim()) ?? slug.trim());
}

/**
 * A table cell: pills resolved, pipes escaped, newlines flattened.
 *
 * `pills` was applied to every prose path and to no table cell, SWOT item or formula
 * note, so a benchmark value that ends with a see-also pill reached the .pptx with the
 * brackets still on it — six of them in the 11x deck. A deck is the one artefact that
 * leaves the site, where a raw marker cannot be explained away by a link that would
 * have worked.
 *
 * `**` and backticks are left alone. toPptx renders prose blocks through inlineRuns(),
 * which turns them into real bold and code runs, and table cells through plain(), which
 * strips them. Stripping here would destroy formatting on the first path and change
 * nothing on the second. Balanced is what makes that safe, and validate-content gates it.
 */
function cell(text: string | undefined, names?: Map<string, string>): string {
  if (!text) return "—";
  return pills(text, names).replace(/\s*\n\s*/g, " ").replace(/\|/g, "\\|").trim() || "—";
}

/** A source URL as a Markdown link, or plain text when it isn't a URL. */
function sourceCell(source: string | undefined, names?: Map<string, string>): string {
  if (!source) return "—";
  if (/^https?:\/\//.test(source)) {
    let host = source;
    try {
      host = new URL(source).hostname.replace(/^www\./, "");
    } catch {
      /* keep the raw string */
    }
    return `[${host}](${source})`;
  }
  return cell(source, names);
}

function table(head: string[], rows: string[][]): string[] {
  return [
    `| ${head.join(" | ")} |`,
    `| ${head.map(() => "---").join(" | ")} |`,
    ...rows.map((r) => `| ${r.join(" | ")} |`),
  ];
}

/* ---------------------------------------------------------------------- */
/* Section builders — each returns a slide's Markdown, or null when empty  */
/* ---------------------------------------------------------------------- */

function titleSlide(e: Entity, productName: string): string {
  const lines = [`# ${e.name}`];
  if (e.subtitle) lines.push("", e.subtitle);
  const meta = [
    productName,
    `${depthLabel(e.depth_score)} · depth ${e.depth_score}/10`,
    `updated ${e.last_updated}`,
  ];
  lines.push("", `_${meta.join(" · ")}_`);
  return lines.join("\n");
}

/**
 * The claim slide. `abstract.kicker` is the sentence the entity is willing to be
 * wrong about, so it becomes the headline; the bullets underneath are what
 * defends it. An entity with no abstract falls back to its summary — one claim
 * slide either way, never both.
 */
function claimSlide(e: Entity, names?: Map<string, string>): string | null {
  const a = e.abstract;
  if (a?.kicker || a?.bullets?.length) {
    const lines: string[] = [];
    if (a.kicker) lines.push(`## ${pills(a.kicker, names)}`);
    else lines.push("## Abstract");
    if (a.bullets?.length) {
      lines.push("");
      lines.push(...a.bullets.map((b) => `- ${pills(b, names)}`));
    }
    return lines.join("\n");
  }
  if (e.summary) return [`## ${e.name}`, "", pills(e.summary, names)].join("\n");
  return null;
}

/** A paper section (background / results / discussion / conclusion). */
function sectionSlide(
  title: string,
  section: Entity["background"],
  names?: Map<string, string>,
): string | null {
  if (!section?.kicker && !section?.bullets?.length) return null;
  const lines = [`## ${title}`];
  if (section.kicker) lines.push("", `**${pills(section.kicker, names)}**`);
  if (section.bullets?.length) {
    lines.push("");
    lines.push(...section.bullets.map((b) => `- ${pills(b, names)}`));
  }
  return lines.join("\n");
}

function dataSlide(e: Entity, names?: Map<string, string>): string | null {
  const entries = Object.entries(e.data_points ?? {});
  if (!entries.length) return null;
  return [`## Data`, "", ...table(["Fact", "Value"], entries.map(([k, v]) => [cell(k, names), cell(v, names)]))].join("\n");
}

function positioningSlide(e: Entity, names?: Map<string, string>): string | null {
  if (!e.positioning) return null;
  return [`## Where it fits`, "", pills(e.positioning, names)].join("\n");
}

function mechanismSlide(e: Entity, names?: Map<string, string>): string | null {
  const m = e.mechanism;
  if (!m?.kicker && !m?.bullets?.length && !e.architecture_summary && !e.diagram_svg) return null;
  const lines = [`## Mechanism`];
  if (m?.kicker) lines.push("", `**${pills(m.kicker, names)}**`);
  if (e.architecture_summary) lines.push("", pills(e.architecture_summary, names));
  if (m?.bullets?.length) {
    lines.push("");
    lines.push(...m.bullets.map((b) => `- ${pills(b, names)}`));
  }
  // Repo-authored SVG. The viewer renders it; the .pptx writer skips it (no
  // rasteriser in a Node route), which is why it rides in its own block.
  if (e.diagram_svg) lines.push("", e.diagram_svg.replace(/\n{2,}/g, "\n"));
  return lines.join("\n");
}

/**
 * One slide per component — the substance of the deck.
 *
 * A component's `numbers[]` and `prior_art[]` are what separate a real
 * engineering claim from a brochure: the numbers carry their own receipt, and
 * the prior art names what was chosen against and what the choice costs. Both
 * render as tables because that is what they are.
 */
function componentSlide(c: Component, names?: Map<string, string>): string | null {
  const hasBody = c.purpose || c.numbers?.length || c.prior_art?.length || c.recommended;
  if (!hasBody) return null;

  const lines = [`## ${c.name}`];
  if (c.purpose) lines.push("", pills(c.purpose, names));

  if (c.numbers?.length) {
    const withSource = c.numbers.some((n) => n.source);
    const head = withSource ? ["Anchor", "Value", "Source"] : ["Anchor", "Value"];
    const rows = c.numbers.map((n) =>
      withSource ? [cell(n.label, names), cell(n.value, names), sourceCell(n.source, names)] : [cell(n.label, names), cell(n.value, names)],
    );
    lines.push("", ...table(head, rows));
  }

  if (c.prior_art?.length) {
    const withApproach = c.prior_art.some((p) => p.approach);
    const head = withApproach ? ["Prior art", "Approach", "Tradeoff"] : ["Prior art", "Tradeoff"];
    const rows = c.prior_art.map((p) =>
      withApproach
        ? [cell(p.name, names), cell(p.approach, names), cell(p.tradeoff, names)]
        : [cell(p.name, names), cell(p.tradeoff, names)],
    );
    lines.push("", ...table(head, rows));
  }

  if (c.recommended) lines.push("", `**Pick —** ${pills(c.recommended, names)}`);
  return lines.join("\n");
}

/** Every benchmark, flattened to one row per measured condition. */
function benchmarksSlide(benchmarks: Benchmark[] | undefined, names?: Map<string, string>): string | null {
  if (!benchmarks?.length) return null;
  const withSource = benchmarks.some((b) => b.source);
  const head = withSource ? ["Metric", "Condition", "Value", "Source"] : ["Metric", "Condition", "Value"];
  const rows: string[][] = [];
  for (const b of benchmarks) {
    const values = Object.entries(b.values ?? {});
    if (!values.length) {
      const r = [cell(b.metric, names), "—", "—"];
      if (withSource) r.push(sourceCell(b.source, names));
      rows.push(r);
      continue;
    }
    values.forEach(([k, v], i) => {
      // The metric spans its conditions; repeating it in every row is noise.
      const r = [i === 0 ? cell(b.metric, names) : "", cell(k, names), cell(String(v), names)];
      if (withSource) r.push(i === 0 ? sourceCell(b.source, names) : "");
      rows.push(r);
    });
  }
  if (!rows.length) return null;
  return [`## Benchmarks`, "", ...table(head, rows)].join("\n");
}

/** Discussion and the open questions it leaves — one slide, they are one thought. */
function discussionSlide(e: Entity, names?: Map<string, string>): string | null {
  const d = e.discussion;
  const open = e.open_questions ?? [];
  if (!d?.kicker && !d?.bullets?.length && !open.length) return null;
  const lines = [`## Discussion`];
  if (d?.kicker) lines.push("", `**${pills(d.kicker, names)}**`);
  if (d?.bullets?.length) {
    lines.push("");
    lines.push(...d.bullets.map((b) => `- ${pills(b, names)}`));
  }
  if (open.length) {
    lines.push("", `### Open questions`, "");
    lines.push(...open.map((q) => `- ${pills(q, names)}`));
  }
  return lines.join("\n");
}

/**
 * The call. `conclusion` states what is true, `recommendation` states what to do
 * about it — they belong on the same slide. An entity with neither falls back to
 * its key_takeaways, so the deck still lands somewhere rather than trailing off.
 */
function conclusionSlide(e: Entity, names?: Map<string, string>): string | null {
  const c = e.conclusion;
  const has = c?.kicker || c?.bullets?.length || e.recommendation;
  if (!has) {
    if (!e.key_takeaways?.length) return null;
    return [`## Conclusion`, "", ...e.key_takeaways.map((t) => `- ${pills(t, names)}`)].join("\n");
  }
  const lines = [`## Conclusion`];
  if (c?.kicker) lines.push("", `**${pills(c.kicker, names)}**`);
  if (c?.bullets?.length) {
    lines.push("");
    lines.push(...c.bullets.map((b) => `- ${pills(b, names)}`));
  }
  if (e.recommendation) {
    lines.push("", `### Recommendation`, "", pills(e.recommendation, names));
  }
  return lines.join("\n");
}

function swotSlide(e: Entity, names?: Map<string, string>): string | null {
  const s = e.swot;
  if (!s) return null;
  const keys = (["strengths", "weaknesses", "opportunities", "threats"] as const).filter(
    (k) => s[k]?.length,
  );
  if (!keys.length) return null;
  const lines = [`## SWOT`];
  for (const k of keys) {
    lines.push("", `### ${k[0].toUpperCase()}${k.slice(1)}`, "");
    lines.push(...s[k]!.map((v) => `- ${pills(v, names)}`));
  }
  return lines.join("\n");
}

function formulasSlide(e: Entity, names?: Map<string, string>): string | null {
  if (!e.formulas?.length) return null;
  const lines = [`## Formulas`];
  for (const f of e.formulas) {
    lines.push("", `**${f.name}** — \`${f.expr}\``);
    if (f.note) lines.push("", pills(f.note, names));
  }
  return lines.join("\n");
}

/** The receipts. Chunked so a deeply-cited entity doesn't overrun one slide. */
function sourceSlides(citations: Citation[] | undefined, names?: Map<string, string>): string[] {
  if (!citations?.length) return [];
  const chunks: Citation[][] = [];
  for (let i = 0; i < citations.length; i += SOURCES_PER_SLIDE) {
    chunks.push(citations.slice(i, i + SOURCES_PER_SLIDE));
  }
  return chunks.map((chunk, ci) => {
    const heading = chunks.length > 1 ? `## Sources (${ci + 1}/${chunks.length})` : `## Sources`;
    const rows = chunk.map((c, i) => {
      const n = ci * SOURCES_PER_SLIDE + i + 1;
      return `- ${n}. [${cell(c.label, names)}](${c.url})${c.date ? ` · ${c.date}` : ""}`;
    });
    return [heading, "", ...rows].join("\n");
  });
}

/* ---------------------------------------------------------------------- */
/* MOC                                                                    */
/* ---------------------------------------------------------------------- */

function mocSlides(e: Entity, names?: Map<string, string>): { fixed: string[]; run: string[]; sources: string[] } {
  const fixed: string[] = [];
  const run: string[] = [];

  const thesis = e.thesis ?? e.abstract?.kicker ?? e.summary;
  if (thesis) fixed.push([`## ${pills(thesis, names)}`, "", `_the claim this map makes_`].join("\n"));

  // One slide per axis — the axis IS the argument, so it gets the room.
  for (const a of e.axes ?? []) {
    const lines = [`## ${a.name}`, "", `**${pills(a.question, names)}**`];
    if (a.note) lines.push("", pills(a.note, names));
    run.push(lines.join("\n"));
  }

  // One slide per member: what the map asserts about it, and who says so.
  for (const m of e.members ?? []) {
    const name = names?.get(m.slug) ?? m.slug;
    const lines = [`## ${name}`, "", pills(m.claim, names)];
    if (m.primary_source) {
      lines.push("", `[${cell(m.primary_source.label, names)}](${m.primary_source.url})${m.primary_source.date ? ` · ${m.primary_source.date}` : ""}`);
    }
    run.push(lines.join("\n"));
  }

  return { fixed, run, sources: sourceSlides(e.citations, names) };
}

/* ---------------------------------------------------------------------- */
/* The generator                                                          */
/* ---------------------------------------------------------------------- */

/**
 * Build the deck.
 *
 * `names` maps entity slug → display name so [[pills]] in prose resolve to the
 * thing they point at instead of leaking a slug onto a slide. Optional: without
 * it the pill degrades to its bare slug rather than breaking.
 */
export function deckFromEntity(entity: Entity, productName: string, names?: Map<string, string>): string {
  const isMoc = entity.entity_kind === "moc";

  const head = titleSlide(entity, productName);
  let fixed: string[];
  let run: string[];
  let sources: string[];

  if (isMoc) {
    const m = mocSlides(entity, names);
    fixed = m.fixed;
    run = m.run;
    sources = m.sources;
  } else {
    const before = [
      claimSlide(entity, names),
      dataSlide(entity, names),
      positioningSlide(entity, names),
      sectionSlide("Background", entity.background, names),
      mechanismSlide(entity, names),
    ];
    // The unbounded run: one slide per component.
    run = (entity.components ?? []).map((c) => componentSlide(c, names)).filter(isPresent);
    const after = [
      sectionSlide("Results", entity.results, names),
      benchmarksSlide(entity.benchmarks, names),
      discussionSlide(entity, names),
      conclusionSlide(entity, names),
      swotSlide(entity, names),
      formulasSlide(entity, names),
    ];
    fixed = before.filter(isPresent);
    sources = sourceSlides(entity.citations, names);
    // `after` slides must survive the cap, so they are fixed too — but they sit
    // AFTER the run, so keep them separate until assembly.
    return assemble(head, fixed, run, after.filter(isPresent), sources);
  }

  return assemble(head, fixed, run, [], sources);
}

function isPresent(s: string | null): s is string {
  return s !== null;
}

/**
 * Lay the deck out and enforce the cap.
 *
 * When an entity is too deep to fit in 20 slides, something has to go, and the
 * choice is made once, here, rather than being an accident of ordering: the
 * component run is trimmed from the tail first (components are ordered
 * most-load-bearing first, and the entity page still carries all of them), then
 * the overflow Sources slides. The title, the claim, and the conclusion are
 * never dropped — a deck that loses its argument is worse than a long one.
 */
function assemble(head: string, fixed: string[], run: string[], after: string[], sources: string[]): string {
  const fixedCount = 1 + fixed.length + after.length;
  let keptSources = sources;
  let keptRun = run;

  let budget = MAX_SLIDES - fixedCount;
  if (budget < 0) budget = 0;

  // Sources earn at least one slide when there are any — a deck without its
  // receipts is exactly the artefact this platform exists to not produce.
  const sourceFloor = sources.length ? 1 : 0;
  const runBudget = Math.max(0, budget - sourceFloor);
  if (keptRun.length > runBudget) keptRun = keptRun.slice(0, runBudget);

  const sourceBudget = Math.max(sourceFloor, budget - keptRun.length);
  if (keptSources.length > sourceBudget) keptSources = keptSources.slice(0, sourceBudget);

  return [head, ...fixed, ...keptRun, ...after, ...keptSources].join("\n\n---\n\n") + "\n";
}
