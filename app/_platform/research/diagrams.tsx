/**
 * Architecture diagrams — two shapes, because the two views are two different claims.
 *
 * A product architecture and a technical architecture are not the same kind of
 * thing, and drawing them the same way (seven identical boxes in a column) says
 * nothing about either. So:
 *
 *   product   → a FLOW. One unit of work enters on the left, moves through the
 *               stages, and hits a fork. Under the flow sits a substrate band the
 *               flow reads from and files into.
 *   technical → a TIERED BAR STACK. Vertical, because a substrate really is a
 *               stack — but each layer's WIDTH is how much of its research has
 *               reached the `working` rung, so the diagram is also a bar chart of
 *               what the stack can defend. A thin box is a thin layer.
 *
 * Everything below is derived from `architecture.json` alone. There is no
 * per-product hint file and no hard-coded slug. The derivations, in full:
 *
 *   tier(L)      the longest chain of `depends_on` under L. Tier 0 depends on nothing.
 *   substrate    a layer with no `depends_on`. The flow stands on it; work does not
 *                pass through it.
 *   flow         everything else, ordered by tier. The work moves along it.
 *   source       a flow stage whose dependencies are all substrate — it reads its
 *                work out of the substrate rather than taking it from a stage.
 *   fork         a flow stage that depends on a flow stage AND on a substrate. Work
 *                arrives from the flow, and the substrate is its second outlet: the
 *                place the work it declines to pass on goes. That is a gate.
 *   threshold    the first 0.xx in the fork stage's one_line, used only as an arm
 *                label. Absent, the arms fall back to words and the fork still draws.
 *
 * For gtm this resolves to: signal → account brief → draft → confidence gate, which
 * forks at 0.72 — over, the AE gets it; under, it goes into the audit trail and
 * nobody is asked to read it. That fork is the product's whole thesis, so it is the
 * one thing on the diagram drawn in the accent colour.
 *
 * Colour discipline: `--status-warn` means one thing on this page — nothing under
 * this layer has reached `working`. It is never spent on the reject arm of the
 * fork, because filing a weak draft is the behaviour the product wants.
 */
import React from "react";
import type { LayerDefence, ViewName } from "./architecture";
import { T, t as copyText } from "@/app/_platform/copy";

/* ── Text metrics ────────────────────────────────────────────────────────────
 * SVG does not wrap text, so every string is measured before it is placed. These
 * are advance widths per px of font-size for the three faces in use, taken with a
 * margin: overestimating costs a few pixels of slack, underestimating puts a word
 * through the side of a box.
 */
const CH = { sans: 0.53, bold: 0.58, mono: 0.61 } as const;
type Face = keyof typeof CH;

const textW = (s: string, size: number, face: Face) => s.length * size * CH[face];
const fitChars = (w: number, size: number, face: Face) =>
  Math.max(1, Math.floor(w / (size * CH[face])));

/** Hard cut, for the one case a word boundary cannot help: a single word wider than
 *  the whole line. Anything else goes through `markTruncated`. */
function ellipsise(word: string, maxChars: number): string {
  if (word.length <= maxChars || word.endsWith("…")) return word;
  return word.slice(0, Math.max(1, maxChars - 1)) + "…";
}

/** Close a line that ran out of room, dropping whole words to make space for the
 *  ellipsis. `slice(0, n)` lands mid-word and renders "The agent re…", which reads
 *  as a rendering bug rather than an abbreviation. */
function markTruncated(line: string, maxChars: number): string {
  if (line.endsWith("…")) return line;
  if (line.length + 1 <= maxChars) return `${line}…`;
  const head = line.slice(0, maxChars - 1);
  const cut = head.lastIndexOf(" ");
  return `${(cut > 0 ? head.slice(0, cut) : head).trimEnd()}…`;
}

/** Greedy word wrap into at most `maxLines`. Never breaks a word except one that
 *  cannot fit a line at all. */
function wrap(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";

  for (const raw of words) {
    const w = ellipsise(raw, maxChars);
    const next = line ? `${line} ${w}` : w;
    if (next.length <= maxChars) {
      line = next;
      continue;
    }
    if (line) lines.push(line);
    if (lines.length === maxLines) {
      lines[maxLines - 1] = markTruncated(lines[maxLines - 1], maxChars);
      return lines;
    }
    line = w;
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Fit prose to a box, preferring the author's own cut.
 *
 * A one-liner's first sentence is its summary and the rest is qualification, so the
 * sentence boundary is a cut the author already made and it costs nothing. The
 * lookbehind is load-bearing: a naive /[.?!]/ cuts at the decimal point in "under
 * 0.72" and prints "files anything under 0." — not an abbreviation, a wrong number,
 * and the kind that ships unnoticed because it still looks like a sentence.
 */
function fitProse(text: string, maxChars: number, maxLines: number): string[] {
  const t = text.trim();
  const room = maxChars * maxLines;
  if (t.length <= room) return wrap(t, maxChars, maxLines);
  const sentence = t.match(/^.*?(?<!\d)[.?!](?=\s|$)/)?.[0]?.trim();
  if (sentence && sentence.length <= room) return wrap(sentence, maxChars, maxLines);
  return wrap(t, maxChars, maxLines);
}

/* ── Shape of the architecture, derived ──────────────────────────────────────── */

/** Longest dependency chain under each layer. A cycle is a content bug; it resolves
 *  to 0 rather than hanging the render. */
function tiers(defences: LayerDefence[]): Map<string, number> {
  const bySlug = new Map(defences.map((d) => [d.layer.slug, d.layer]));
  const memo = new Map<string, number>();
  const onStack = new Set<string>();

  const rank = (slug: string): number => {
    const hit = memo.get(slug);
    if (hit !== undefined) return hit;
    if (onStack.has(slug)) return 0;
    onStack.add(slug);
    let r = 0;
    for (const dep of bySlug.get(slug)?.depends_on ?? []) {
      if (dep !== slug && bySlug.has(dep)) r = Math.max(r, rank(dep) + 1);
    }
    onStack.delete(slug);
    memo.set(slug, r);
    return r;
  };

  return new Map(defences.map((d) => [d.layer.slug, rank(d.layer.slug)]));
}

const isSubstrate = (d: LayerDefence) => !d.layer.depends_on?.length;

type FlowShape = {
  flow: LayerDefence[];
  substrate: LayerDefence[];
  /** Index in `flow` of the stage that forks, or -1. */
  forkAt: number;
  /** Slug of the substrate layer the fork files into. */
  forkTo: string | null;
  /** Substrate slugs each flow stage reads its work out of, keyed by flow index. */
  reads: Map<number, string[]>;
  threshold: string | null;
};

function flowShape(defences: LayerDefence[]): FlowShape {
  const rank = tiers(defences);
  const subSlugs = new Set(defences.filter(isSubstrate).map((d) => d.layer.slug));

  const flow = defences
    .filter((d) => !isSubstrate(d))
    .sort((a, b) => (rank.get(a.layer.slug) ?? 0) - (rank.get(b.layer.slug) ?? 0));

  // Every layer standing on nothing means there is no pipeline to draw — only a
  // set. Degrade to a plain left-to-right run of all of them, with no band.
  if (!flow.length) {
    return {
      flow: defences,
      substrate: [],
      forkAt: -1,
      forkTo: null,
      reads: new Map(),
      threshold: null,
    };
  }

  const reads = new Map<number, string[]>();
  let forkAt = -1;
  let forkTo: string | null = null;

  flow.forEach((d, i) => {
    const deps = d.layer.depends_on ?? [];
    const subDeps = deps.filter((s) => subSlugs.has(s));
    if (!subDeps.length) return;

    if (subDeps.length === deps.length) {
      reads.set(i, subDeps);
    } else if (forkAt === -1) {
      forkAt = i;
      forkTo = subDeps[0];
    }
  });

  const threshold = forkAt >= 0 ? (flow[forkAt].layer.one_line.match(/\b0\.\d{1,3}\b/)?.[0] ?? null) : null;

  // Substrate reads left to right in the order the flow first touches it, so the
  // ties below tend to fall straight rather than crab sideways.
  const touchedAt = (slug: string) => {
    const i = flow.findIndex((d) => (d.layer.depends_on ?? []).includes(slug));
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  const substrate = defences
    .filter(isSubstrate)
    .sort((a, b) => touchedAt(a.layer.slug) - touchedAt(b.layer.slug));

  return { flow, substrate, forkAt, forkTo, reads, threshold };
}

/** Layers grouped by tier, deepest tier last. Content order breaks ties. */
function tierGroups(defences: LayerDefence[]): { tier: number; layers: LayerDefence[] }[] {
  const rank = tiers(defences);
  const byTier = new Map<number, LayerDefence[]>();
  for (const d of defences) {
    const t = rank.get(d.layer.slug) ?? 0;
    const bucket = byTier.get(t);
    if (bucket) bucket.push(d);
    else byTier.set(t, [d]);
  }
  return [...byTier.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([tier, layers]) => ({ tier, layers }));
}

/**
 * The order the page prints its layer cards in — the same order the diagram draws
 * them, so box 04 and card 04 are the same layer. Content order is neither order:
 * the product view reads along the flow, the technical view reads down the tiers.
 */
export function orderedDefences(view: ViewName, defences: LayerDefence[]): LayerDefence[] {
  if (view === "technical") return tierGroups(defences).flatMap((g) => g.layers);
  const { flow, substrate } = flowShape(defences);
  return [...flow, ...substrate];
}

const num = (i: number) => String(i + 1).padStart(2, "0");
const countOf = (d: LayerDefence) => `${d.defensibleCount}/${d.entities.length}`;
const NUM_W = textW("00", 10, "mono");

/* ── Product view: the flow ──────────────────────────────────────────────────── */

const PAD = 14;
const STAGE_H = 84;
const GAP = 20;
const FORK_GAP = 130; // room for the fork's arm label and the hand-off rule
const FLOW_Y = 26;
const MID_Y = FLOW_Y + STAGE_H / 2;
const FLOW_B = FLOW_Y + STAGE_H;
const BAND_Y = 176;
const BAND_PAD = 12;
const SUB_H = 74;
const SUB_Y = BAND_Y + BAND_PAD;
const BAND_H = BAND_PAD * 2 + SUB_H;
const STAND = 4; // arrow tips stop this far short of an edge

function FlowDiagram({ view, defences }: { view: ViewName; defences: LayerDefence[] }) {
  const { flow, substrate, forkAt, forkTo, reads, threshold } = flowShape(defences);
  const forks = forkAt >= 0 && forkTo !== null && forkAt + 1 < flow.length;

  // A stage box is as wide as its longest single word needs, floored at 124 and
  // capped so a wordy product cannot push the flow off the canvas. Names wrap to two
  // lines; what must never happen is a name broken mid-word to fit a fixed box.
  const longestWord = Math.max(
    0,
    ...flow.flatMap((d) => d.layer.name.split(/\s+/).map((w) => textW(w, 12.5, "bold"))),
  );
  const STAGE_W = Math.min(200, Math.max(124, Math.ceil(longestWord) + 20));

  const xs: number[] = [];
  let cursor = PAD;
  flow.forEach((_, i) => {
    xs.push(cursor);
    cursor += STAGE_W + (forks && i === forkAt ? FORK_GAP : GAP);
  });
  const vbW = (flow.length ? cursor - GAP : PAD) + PAD;
  const height = (substrate.length ? BAND_Y + BAND_H : FLOW_B) + PAD;

  const bandW = vbW - PAD * 2;
  const innerX = PAD + BAND_PAD;
  const innerW = bandW - BAND_PAD * 2;
  const subGap = 16;
  const subW = substrate.length
    ? (innerW - subGap * (substrate.length - 1)) / substrate.length
    : innerW;
  const subX = (i: number) => innerX + i * (subW + subGap);
  const subIndex = new Map(substrate.map((d, i) => [d.layer.slug, i]));

  const ink = `arr-${view}`;
  const acc = `arrA-${view}`;
  // The reject arm strokes --ink-faded, a shade heavier than the reads ties, because
  // it carries the fork. Its head needs a marker in the same ink: a marker filled
  // --ink-mute on an --ink-faded line reads as a separate mark stuck on the end.
  const faded = `arrF-${view}`;

  /** A tie between a stage and a substrate box. Straight when the stage sits over the
   *  box; an elbow when it does not, so the tip always lands inside the box. */
  const tie = (x: number, y1: number, y2: number, boxL: number, boxR: number) => {
    const tx = Math.min(Math.max(x, boxL + 18), boxR - 18);
    return Math.abs(tx - x) < 1
      ? `M ${x} ${y1} V ${y2}`
      : `M ${x} ${y1} V ${(y1 + y2) / 2} H ${tx} V ${y2}`;
  };

  const forkX = forks ? xs[forkAt] + STAGE_W + 14 : 0;
  const ruleX = forks ? xs[forkAt + 1] - 20 : 0;
  const passLabel = threshold ? copyText("site.platform.research.diagrams.passlabel-1", { threshold }) : copyText("site.platform.research.diagrams.passlabel-2");
  const filedLabel = threshold ? `under ${threshold}` : copyText("site.platform.research.diagrams.filedlabel-1");
  const forkSub = forkTo ? subIndex.get(forkTo) : undefined;
  const nameOf = (slug: string) => defences.find((d) => d.layer.slug === slug)?.layer.name ?? slug;

  const aria = [
    copyText("site.platform.research.diagrams.aria-1", { flow: flow
      .map((d) => d.layer.name)
      .join(", then ") }),
    forks && forkTo
      ? copyText("site.platform.research.diagrams.aria-2", { name: flow[forkAt].layer.name, passLabel, name2: flow[forkAt + 1].layer.name, filedLabel, nameOf: nameOf(forkTo) })
      : "",
    substrate.length
      ? copyText("site.platform.research.diagrams.aria-3", { substrate: substrate.map((d) => d.layer.name).join(" and ") })
      : "",
    copyText("site.platform.research.diagrams.aria-4"),
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${vbW} ${height}`}
      width="100%"
      role="img"
      aria-label={aria}
      // minWidth is what makes the wrapper's overflow-x actually engage. Without it,
      // width="100%" on a viewBox never overflows — it scales, and in a 360px column
      // every 10px label lands at 4px. Nothing errors and nothing is readable. Held at
      // the viewBox width, the diagram scrolls on a narrow screen and the 10px floor
      // survives everywhere.
      style={{ display: "block", minWidth: vbW, maxWidth: 840, fontFamily: "var(--font-sans)" }}
    >
      <defs>
        <marker id={ink} markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 z" fill="var(--ink-mute)" />
        </marker>
        <marker id={acc} markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 z" fill="var(--accent)" />
        </marker>
        <marker id={faded} markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 z" fill="var(--ink-faded)" />
        </marker>
      </defs>

      {/* The substrate band, drawn first so the ties land on top of it. */}
      {substrate.length > 0 && (
        <>
          {/* One word, because the ties drop through this gutter and the leftmost tie
              a stage can make is at PAD + STAGE_W / 2. A longer label would be
              crossed by its own arrow. The caption under the figure carries the rest. */}
          <text
            x={PAD}
            y={BAND_Y - 8}
            fontSize={10}
            fontFamily="var(--font-mono)"
            fill="var(--ink-mute)"
          >
            <T id="site.platform.research.diagrams.text-1" />
          </text>
          <rect
            x={PAD}
            y={BAND_Y}
            width={bandW}
            height={BAND_H}
            rx={8}
            fill="var(--bg-sunk)"
            stroke="var(--rule-soft)"
          />
          {substrate.map((d, i) => {
            const x = subX(i);
            const warn = d.undefended;
            const inner = subW - 24;
            const ratio = d.entities.length ? d.defensibleCount / d.entities.length : 0;
            const count = `${countOf(d)} working+`;
            const countW = textW(count, 10, "mono");
            const labelW = NUM_W + 8 + textW(d.layer.name, 12.5, "bold");
            // The count is metadata; if the box is too narrow to carry both, the
            // name keeps the room and the count goes. The card below still has it.
            const showCount = labelW + 14 + countW <= inner;
            const nameRoom = inner - NUM_W - 8 - (showCount ? countW + 14 : 0);
            const name = wrap(d.layer.name, fitChars(nameRoom, 12.5, "bold"), 1)[0] ?? d.layer.slug;
            const lines = fitProse(d.layer.one_line, fitChars(inner, 11, "sans"), 2);

            return (
              <g key={d.layer.slug}>
                <rect
                  x={x}
                  y={SUB_Y}
                  width={subW}
                  height={SUB_H}
                  rx={6}
                  fill={warn ? "var(--status-warn-bg)" : "var(--bg-card)"}
                  stroke={warn ? "var(--status-warn)" : "var(--rule)"}
                  strokeWidth={warn ? 1.5 : 1}
                />
                <text x={x + 12} y={SUB_Y + 22} fontSize={12.5} fontWeight={600} fill="var(--ink)">
                  <tspan
                    fontSize={10}
                    fontWeight={400}
                    fontFamily="var(--font-mono)"
                    fill="var(--ink-mute)"
                  >
                    {num(flow.length + i)}
                  </tspan>
                  <tspan dx={8}>{name}</tspan>
                </text>
                {showCount && (
                  <text
                    x={x + subW - 12}
                    y={SUB_Y + 22}
                    fontSize={10}
                    textAnchor="end"
                    fontFamily="var(--font-mono)"
                    fill={warn ? "var(--status-warn)" : "var(--ink-mute)"}
                  >
                    {count}
                  </text>
                )}
                {lines.map((ln, k) => (
                  <text
                    key={k}
                    x={x + 12}
                    y={SUB_Y + 41 + k * 14}
                    fontSize={11}
                    fill="var(--ink-faded)"
                  >
                    {ln}
                  </text>
                ))}
                {/* Substrate boxes carry the same foot bar as the stages. One quantity,
                    one encoding, on all seven boxes — otherwise the caption has to
                    apologise for two of them. */}
                <rect
                  x={x + 12}
                  y={SUB_Y + 62}
                  width={inner}
                  height={4}
                  rx={2}
                  fill="var(--rule-soft)"
                />
                {ratio > 0 && (
                  <rect
                    x={x + 12}
                    y={SUB_Y + 62}
                    width={inner * ratio}
                    height={4}
                    rx={2}
                    fill="var(--accent)"
                  />
                )}
              </g>
            );
          })}
        </>
      )}

      {/* Only the ties the content declares get drawn. A dotted line from every stage
          down to the band would look tidy and assert something no layer said. */}
      {[...reads.entries()].map(([i, slugs]) =>
        slugs.map((slug) => {
          const s = subIndex.get(slug);
          if (s === undefined) return null;
          const x = xs[i] + STAGE_W / 2;
          return (
            <g key={`read-${i}-${slug}`}>
              <path
                d={tie(x, SUB_Y, FLOW_B + STAND, subX(s), subX(s) + subW)}
                fill="none"
                stroke="var(--ink-mute)"
                strokeWidth={1}
                markerEnd={`url(#${ink})`}
              />
              {/* Both tie labels ride the same register (see the fork's `filedLabel`),
                  which keeps `reads` clear of the band label sitting at BAND_Y - 8. */}
              <text
                x={x + 7}
                y={(MID_Y + SUB_Y) / 2}
                fontSize={10}
                fontFamily="var(--font-mono)"
                fill="var(--ink-mute)"
              >
                <T id="site.platform.research.diagrams.text-2" />
              </text>
            </g>
          );
        }),
      )}

      {/* Plain chevrons between stages. In a pipeline, an arrow needs no label. */}
      {flow.slice(0, -1).map((d, i) =>
        forks && i === forkAt ? null : (
          <path
            key={`link-${d.layer.slug}`}
            d={`M ${xs[i] + STAGE_W} ${MID_Y} H ${xs[i + 1] - STAND}`}
            fill="none"
            stroke="var(--ink-mute)"
            strokeWidth={1}
            markerEnd={`url(#${ink})`}
          />
        ),
      )}

      {/* The fork. The accent is spent here and nowhere else on this diagram. */}
      {forks && forkSub !== undefined && (
        <g>
          <line
            x1={ruleX}
            y1={FLOW_Y - 6}
            x2={ruleX}
            y2={FLOW_B + 8}
            stroke="var(--ink-mute)"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
          <text
            x={ruleX}
            y={14}
            fontSize={10}
            textAnchor="middle"
            fontFamily="var(--font-mono)"
            fill="var(--ink-mute)"
          >
            <T id="site.platform.research.diagrams.text-3" />
          </text>

          <path
            d={`M ${xs[forkAt] + STAGE_W} ${MID_Y} H ${xs[forkAt + 1] - STAND}`}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={1.5}
            markerEnd={`url(#${acc})`}
          />
          <text
            x={(forkX + ruleX) / 2}
            y={MID_Y - 9}
            fontSize={10}
            textAnchor="middle"
            fontFamily="var(--font-mono)"
            fill="var(--accent)"
          >
            {passLabel}
          </text>

          <path
            d={tie(forkX, MID_Y, SUB_Y - STAND, subX(forkSub), subX(forkSub) + subW)}
            fill="none"
            stroke="var(--ink-faded)"
            strokeWidth={1.5}
            markerEnd={`url(#${faded})`}
          />
          <text
            x={forkX - 7}
            y={(MID_Y + SUB_Y) / 2}
            fontSize={10}
            textAnchor="end"
            fontFamily="var(--font-mono)"
            fill="var(--ink-faded)"
          >
            {filedLabel}
          </text>
          <path
            d={`M ${forkX} ${MID_Y - 6} L ${forkX + 6} ${MID_Y} L ${forkX} ${MID_Y + 6} L ${forkX - 6} ${MID_Y} z`}
            fill="var(--accent)"
          />
        </g>
      )}

      {/* The stages. */}
      {flow.map((d, i) => {
        const x = xs[i];
        const warn = d.undefended;
        const ratio = d.entities.length ? d.defensibleCount / d.entities.length : 0;
        const inner = STAGE_W - 20;
        const lines = wrap(d.layer.name, fitChars(inner, 12.5, "bold"), 2);
        return (
          <g key={d.layer.slug}>
            <rect
              x={x}
              y={FLOW_Y}
              width={STAGE_W}
              height={STAGE_H}
              rx={6}
              fill={warn ? "var(--status-warn-bg)" : "var(--bg-card)"}
              stroke={warn ? "var(--status-warn)" : i === forkAt ? "var(--accent)" : "var(--rule)"}
              strokeWidth={warn || i === forkAt ? 1.5 : 1}
            />
            <text
              x={x + 10}
              y={FLOW_Y + 17}
              fontSize={10}
              fontFamily="var(--font-mono)"
              fill="var(--ink-mute)"
            >
              {num(i)}
            </text>
            <text
              x={x + STAGE_W - 10}
              y={FLOW_Y + 17}
              fontSize={10}
              textAnchor="end"
              fontFamily="var(--font-mono)"
              fill={warn ? "var(--status-warn)" : "var(--ink-mute)"}
            >
              {countOf(d)}
            </text>
            {lines.map((ln, k) => (
              <text
                key={k}
                x={x + 10}
                y={FLOW_Y + 41 + k * 15}
                fontSize={12.5}
                fontWeight={600}
                fill="var(--ink)"
              >
                {ln}
              </text>
            ))}
            <rect
              x={x + 10}
              y={FLOW_Y + 66}
              width={inner}
              height={4}
              rx={2}
              fill="var(--rule-soft)"
            />
            {ratio > 0 && (
              <rect
                x={x + 10}
                y={FLOW_Y + 66}
                width={inner * ratio}
                height={4}
                rx={2}
                fill="var(--accent)"
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}

/* ── Technical view: the tiered stack ────────────────────────────────────────── */

const T_PAD = 14;
const T_GUTTER = 50;
const T_BOX_H = 64;
const T_GAP_IN = 30; // between layers in the same tier
const T_GAP_OUT = 46; // where the tier changes — the bands need air between them
/**
 * The growth a layer earns by defending itself, in px, from a true zero.
 *
 * The plinth (`minW`) is not part of the encoding. It is the width the box needs to
 * print its own name, and a box that clipped its name to make a point would be a bug
 * rather than an argument. So each row is really two cells: the plinth carries the
 * label, and everything right of it is the measurement. The box grows into that
 * region by `defensibleCount / entities`, against a dashed track showing what a
 * fully-defended layer would earn.
 *
 * Making the whole box the bar is the tempting version and it lies. With a 300px
 * plinth, a layer with nothing at `working` would still be drawn at 58% of the track
 * — a bar chart with a non-zero baseline, which is the one chart crime a reader
 * clocks in a second.
 *
 * Fixing only the arithmetic is not enough, because the eye does not read arithmetic.
 * The growth region is therefore TINTED, so its left edge is a visible zero and the
 * length the reader actually measures is the length that carries the quantity. Nothing
 * defended means no tint at all, and the box stops dead at the mark.
 */
const T_GROWTH = 220;

function TierStack({ view, defences }: { view: ViewName; defences: LayerDefence[] }) {
  const groups = tierGroups(defences);
  const ordered = groups.flatMap((g) => g.layers);
  const rank = tiers(defences);
  const countText = (d: LayerDefence) => `${countOf(d)} working+`;

  // The plinth: the width at which the worst-case name and count still fit. Not part
  // of the encoding — see T_GROWTH. The count rides the plinth's right edge rather
  // than the box's, so it does not slide about as the bar grows.
  const minW = Math.max(
    260,
    ...ordered.map(
      (d) =>
        12 + NUM_W + 8 + textW(d.layer.name, 12.5, "bold") + 16 + textW(countText(d), 10, "mono") + 12,
    ),
  );
  const trackW = Math.ceil(minW + T_GROWTH);
  const boxX = T_PAD + T_GUTTER;
  const zeroX = boxX + minW; // the baseline the width encoding measures from
  const vbW = boxX + trackW + T_PAD;

  const ys: number[] = [];
  let y = 18;
  ordered.forEach((d, i) => {
    if (i > 0) {
      const changed = rank.get(d.layer.slug) !== rank.get(ordered[i - 1].layer.slug);
      y += T_BOX_H + (changed ? T_GAP_OUT : T_GAP_IN);
    }
    ys.push(y);
  });
  const height = (ys[ys.length - 1] ?? 0) + T_BOX_H + 12 + T_PAD;

  const indexOf = new Map(ordered.map((d, i) => [d.layer.slug, i]));
  const bands = groups.map((g) => {
    const first = indexOf.get(g.layers[0].layer.slug)!;
    const last = indexOf.get(g.layers[g.layers.length - 1].layer.slug)!;
    // The top box has no promise line above it, so its band does not reserve room for one.
    return {
      tier: g.tier,
      top: ys[first] - (first === 0 ? 10 : 24),
      bottom: ys[last] + T_BOX_H + 10,
      labelY: ys[first] + 20,
    };
  });

  const ratioOf = (d: LayerDefence) =>
    d.entities.length ? d.defensibleCount / d.entities.length : 0;
  const widthOf = (d: LayerDefence) => minW + T_GROWTH * ratioOf(d);

  const hollow = ordered.filter((d) => d.undefended).map((d) => d.layer.name);
  const aria = [
    copyText("site.platform.research.diagrams.aria-5", { ordered: ordered.length, groups: groups.length, ordered2: ordered.map((d) => d.layer.name).join(", ") }),
    copyText("site.platform.research.diagrams.aria-6"),
    hollow.length
      ? `${hollow.join(" and ")} ${hollow.length === 1 ? copyText("site.platform.research.diagrams.aria-7") : copyText("site.platform.research.diagrams.aria-8")}.`
      : "",
    copyText("site.platform.research.diagrams.aria-9"),
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${vbW} ${height}`}
      width="100%"
      role="img"
      aria-label={aria}
      // See FlowDiagram: without minWidth the wrapper's overflow-x never engages and
      // a narrow column silently renders the 10px labels at 6px.
      style={{ display: "block", minWidth: vbW, maxWidth: 680, fontFamily: "var(--font-sans)" }}
    >
      <defs>
        {ordered.map((d, i) => (
          <clipPath key={d.layer.slug} id={`tbox-${view}-${i}`}>
            <rect x={boxX} y={ys[i]} width={widthOf(d)} height={T_BOX_H} rx={6} />
          </clipPath>
        ))}
      </defs>

      {bands.map((b) => (
        <g key={b.tier}>
          <rect
            x={6}
            y={b.top}
            width={vbW - 12}
            height={b.bottom - b.top}
            rx={8}
            fill="var(--bg-sunk)"
          />
          <text
            x={T_PAD}
            y={b.labelY}
            fontSize={10}
            fontFamily="var(--font-mono)"
            fill="var(--ink-mute)"
          >
            <T id="site.platform.research.diagrams.text-4" v={{ tier: b.tier }} />
          </text>
        </g>
      ))}

      {ordered.map((d, i) => {
        const yy = ys[i];
        const warn = d.undefended;
        const w = widthOf(d);
        // Prose is measured against the plinth, never the grown box. Otherwise a
        // well-defended layer wraps to one line and a hollow one to two, and the text
        // starts encoding the same quantity as the width — badly, and by accident.
        const inner = minW - 24;
        const promise =
          i === 0 ? null : fitProse(d.layer.commitment, fitChars(trackW - 16, 11, "sans"), 1)[0];
        const lines = fitProse(d.layer.one_line, fitChars(inner, 11, "sans"), 2);

        return (
          <g key={d.layer.slug}>
            {promise && (
              <>
                <text
                  x={boxX}
                  y={yy - 9}
                  fontSize={11}
                  fontFamily="var(--font-mono)"
                  fill="var(--ink-mute)"
                >
                  ↑
                </text>
                <text x={boxX + 16} y={yy - 9} fontSize={11} fill="var(--ink-faded)">
                  {promise}
                </text>
              </>
            )}

            {/* The track runs from the zero mark, not from the box's left edge, so the
                eye measures the growth against a scale that starts where the encoding
                starts. What a fully-defended layer would earn. */}
            <rect
              x={zeroX}
              y={yy}
              width={T_GROWTH}
              height={T_BOX_H}
              rx={6}
              fill="none"
              stroke="var(--rule)"
              strokeWidth={1}
              strokeDasharray="3 4"
            />
            <rect
              x={boxX}
              y={yy}
              width={w}
              height={T_BOX_H}
              rx={6}
              fill={warn ? "var(--status-warn-bg)" : "var(--bg-card)"}
              stroke={warn ? "var(--status-warn)" : "var(--rule)"}
              strokeWidth={warn ? 1.5 : 1}
            />
            {/* The bar. Clipped to the box so it cannot overhang the rounded right
                corner, and starting at the zero mark so its length IS the quantity. */}
            {ratioOf(d) > 0 && (
              <rect
                x={zeroX}
                y={yy}
                width={T_GROWTH * ratioOf(d)}
                height={T_BOX_H}
                clipPath={`url(#tbox-${view}-${i})`}
                fill="var(--accent-bg)"
              />
            )}
            <rect
              x={boxX}
              y={yy + 1}
              width={3}
              height={T_BOX_H - 2}
              fill={warn ? "var(--status-warn)" : "var(--accent)"}
            />
            <text x={boxX + 12} y={yy + 22} fontSize={12.5} fontWeight={600} fill="var(--ink)">
              <tspan
                fontSize={10}
                fontWeight={400}
                fontFamily="var(--font-mono)"
                fill="var(--ink-mute)"
              >
                {num(i)}
              </tspan>
              <tspan dx={8}>{d.layer.name}</tspan>
            </text>
            {/* Anchored to the plinth, not the box's right edge: the count is a label,
                and a label that slides about as the bar grows is one more thing moving
                for no reason. It also keeps it off the growth region. */}
            <text
              x={zeroX - 12}
              y={yy + 22}
              fontSize={10}
              textAnchor="end"
              fontFamily="var(--font-mono)"
              fill={warn ? "var(--status-warn)" : "var(--ink-mute)"}
            >
              {countText(d)}
            </text>
            {lines.map((ln, k) => (
              <text key={k} x={boxX + 12} y={yy + 41 + k * 14} fontSize={11} fill="var(--ink-faded)">
                {ln}
              </text>
            ))}
          </g>
        );
      })}
    </svg>
  );
}

/* ── Entry point ─────────────────────────────────────────────────────────────── */

export function ArchitectureDiagram({
  view,
  defences,
}: {
  view: ViewName;
  defences: LayerDefence[];
}) {
  return view === "product" ? (
    <FlowDiagram view={view} defences={defences} />
  ) : (
    <TierStack view={view} defences={defences} />
  );
}
