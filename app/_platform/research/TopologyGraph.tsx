"use client";

/**
 * TopologyGraph — the research corpus as a graph, replayed as it grew.
 *
 * Every entity is a node, every typed edge a line, and the time cursor hides
 * everything that did not exist yet. Drag it back and the corpus unbuilds itself.
 *
 * ── Why the positions come from the build, not from here ─────────────────────
 * `x`/`y` are computed in scripts/build-topology.ts by a seeded force layout and
 * shipped inside topology.json. Two things fall out of that, and both are the
 * point:
 *
 *   the layout never moves — same corpus, same picture, on every deploy. A live
 *     simulation reseeded per session would put a node the reader had learned the
 *     position of somewhere else on reload.
 *   nodes appear IN PLACE — a node's coordinates do not depend on which other
 *     nodes are currently visible, so advancing the cursor drops each new entity
 *     onto the spot it will occupy forever, next to the neighbours it will keep.
 *     Re-solving the layout per frame would hide the growth inside the churn.
 *
 * Nothing may be read off an axis. x is not a date and y is not a score; the only
 * thing the geometry encodes is adjacency.
 *
 * ── What the cursor can and cannot know ──────────────────────────────────────
 * The witness is git, and git dates FILES, not the contents of files. So:
 *
 *   honest    when an entity first appeared          → node visibility
 *   honest    when both ends of an edge existed      → edge visibility (see below)
 *   NOT       what an entity's depth score was then  → colour is depth TODAY, and
 *             what its prose length was then            the UI says so in as many words
 *
 * Colour does not animate. Fading a node from stub-grey up to accent as the cursor
 * advances would be the most satisfying thing on the screen and it would be
 * invented: the depth score at time T lives inside the file at commit T, not in the
 * log. See the docblock in history-types.ts, which this component is bound by.
 *
 * Edges are drawn once both endpoints exist. That is a bound, not a timestamp —
 * all edges live in one edges.json, so git can date the edge COUNT (the blob is
 * read back per commit, in ProductHistory.edgeTimeline) but not the arrival of any
 * individual edge. An edge cannot predate its endpoints, so this is the earliest
 * point it could have been wired, and the caption says which of the two it is.
 *
 * Presentational and pure. Colour comes from CSS variables only.
 */

import React from "react";
import { useRouter } from "next/navigation";
import type { TimedNode } from "./history-types";
import type { Edge, Rel } from "./types";
import { useCopy } from "@/app/_platform/copy/client";

// ── geometry ────────────────────────────────────────────────────────────────
// One square viewBox, scaled by the browser. Padding is in viewBox units so a node
// sitting at x=0 or x=1 is not clipped in half by its own radius.

const VB = 1000;
const PAD = 16;
const R_MIN = 3;
const R_MAX = 13;

const px = (v: number) => PAD + v * (VB - 2 * PAD);
/** The same mapping as a fraction of the box — for HTML overlays positioned in %. */
const pct = (v: number) => ((PAD + v * (VB - 2 * PAD)) / VB) * 100;

/**
 * Radius from sqrt(prose_chars): area tracks volume, which is what the eye reads.
 * Scaling the RADIUS linearly would make the biggest entity 350× the area of the
 * smallest and the graph would be one dot and a moon.
 */
function radiusOf(chars: number, maxChars: number): number {
  if (maxChars <= 0) return R_MIN;
  return R_MIN + (R_MAX - R_MIN) * Math.sqrt(Math.min(1, Math.max(0, chars) / maxChars));
}

/**
 * Depth 0..10 → a mix from muted ink to full accent. color-mix keeps this on the
 * design tokens: no hex is spelled here, so a product that re-themes --accent
 * re-themes the graph with it.
 */
function fillOf(depth: number): string {
  const t = Math.min(1, Math.max(0, depth / 10));
  return `color-mix(in srgb, var(--accent) ${Math.round(16 + t * 84)}%, var(--ink-mute))`;
}

/**
 * Edge style per relationship: dash pattern, not hue and not weight.
 *
 * Hue is out because colour is already saying depth, and five line colours over
 * 1,174 edges is a plaid on top of that.
 *
 * Weight is out for a subtler reason. An opacity ramp is an emphasis ramp, and any
 * fixed one is a claim about which relationships matter — a claim the data refuses
 * to support. In this corpus `peer-of` and `cited-by` are 93% of gtm's edges while
 * `acquired-by` is three of them; ranking rels by prominence therefore draws 93% of
 * the graph in whatever style got ranked last, and the picture becomes a haze with
 * three loud lines in it. So every rel gets the same wash and a shape of its own,
 * and emphasis is left to the one thing that actually knows what the reader cares
 * about: what they are pointing at. Hover lights the incident edges in accent.
 *
 * Each dash must be distinguishable from the others at a 26px legend swatch AND at
 * a 3px chord in the middle of the hairball, so no two share a pattern.
 */
const EDGE_WASH = 0.45;
const REL_STYLE: Record<Rel, { dash?: string; label: string }> = {
  "depends-on": { label: "depends-on" },              // solid
  uses: { dash: "6 3", label: "uses" },               // long dash
  "peer-of": { dash: "2 5", label: "peer-of" },       // sparse dot
  "cited-by": { dash: "1 3", label: "cited-by" },     // tight dot
  "acquired-by": { dash: "8 3", label: "acquired-by" }, // longest dash
};

const fmtDate = (sec: number): string =>
  new Date(sec * 1000).toLocaleDateString("en-GB", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });

const compact = (n: number): string =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

// ── layers ──────────────────────────────────────────────────────────────────
// Split and memoised so that hovering a node re-renders the highlight overlay
// only. Without this, one mousemove re-renders ~1,600 SVG elements.

type Placed = TimedNode & { cx: number; cy: number; r: number };
type Wire = Edge & { x1: number; y1: number; x2: number; y2: number; at: number };

const EdgeLayer = React.memo(function EdgeLayer({ wires }: { wires: Wire[] }) {
  return (
    <g stroke="var(--ink-faded)" fill="none" strokeWidth={1.2} strokeOpacity={EDGE_WASH}>
      {wires.map((w, i) => (
        <line key={i} x1={w.x1} y1={w.y1} x2={w.x2} y2={w.y2} strokeDasharray={REL_STYLE[w.rel].dash} />
      ))}
    </g>
  );
});

const NodeLayer = React.memo(function NodeLayer({
  nodes,
  onHover,
  onPick,
}: {
  nodes: Placed[];
  onHover: (slug: string | null) => void;
  onPick: (slug: string) => void;
}) {
  const { T } = useCopy();
  return (
    <g>
      {nodes.map((n) => (
        <circle
          key={n.slug}
          cx={n.cx}
          cy={n.cy}
          r={n.r}
          fill={fillOf(n.depth_score)}
          stroke="var(--bg-card)"
          strokeWidth={0.8}
          style={{ cursor: "pointer" }}
          onMouseEnter={() => onHover(n.slug)}
          onMouseLeave={() => onHover(null)}
          onClick={() => onPick(n.slug)}
        >
          <title><T id="site.platform.research.topologygraph.title-1" v={{ name: n.name, depth_score: n.depth_score, compact: compact(n.prose_chars), fmtDate: fmtDate(n.first_seen) }} /></title>
        </circle>
      ))}
    </g>
  );
});

// ── the view ────────────────────────────────────────────────────────────────

export type TopologyGraphProps = {
  productSlug: string;
  nodes: TimedNode[];
  edges: Edge[];
};

export function TopologyGraph({ productSlug, nodes, edges }: TopologyGraphProps) {
  const { T, t: copyText } = useCopy();
  const router = useRouter();
  const [hovered, setHovered] = React.useState<string | null>(null);
  const [playing, setPlaying] = React.useState(false);
  const [reduced, setReduced] = React.useState(false);

  // matchMedia in an effect, not in render: the server has no window, and reading
  // it during render would hydrate to a different tree than it served.
  React.useEffect(() => {
    const mq = window.matchMedia(copyText("site.platform.research.topologygraph.mq-1"));
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  /**
   * The cursor steps over the distinct first_seen dates, not over evenly-spaced
   * clock time. Research lands in bursts; a linear time axis spends most of its
   * travel on the quiet stretches where nothing appears, and a slider whose middle
   * 60% does nothing teaches the reader to stop dragging it. Every notch here
   * changes the picture.
   */
  const { stamps, placed, wires } = React.useMemo(() => {
    const stamps = [...new Set(nodes.map((n) => n.first_seen))].sort((a, b) => a - b);
    const maxChars = Math.max(1, ...nodes.map((n) => n.prose_chars));
    const placed: Placed[] = nodes
      // Big nodes first so the small ones land on top and stay clickable.
      .map((n) => ({ ...n, cx: px(n.x), cy: px(n.y), r: radiusOf(n.prose_chars, maxChars) }))
      .sort((a, b) => b.r - a.r);

    const at = new Map(nodes.map((n) => [n.slug, n]));
    const wires: Wire[] = [];
    for (const e of edges) {
      const a = at.get(e.from);
      const b = at.get(e.to);
      if (!a || !b) continue; // the build gate rejects dangling edges; belt and braces
      wires.push({
        ...e,
        x1: px(a.x),
        y1: px(a.y),
        x2: px(b.x),
        y2: px(b.y),
        // An edge cannot predate either endpoint. This is that bound, not a date.
        at: Math.max(a.first_seen, b.first_seen),
      });
    }
    return { stamps, placed, wires };
  }, [nodes, edges]);

  const last = stamps.length - 1;
  const [cursor, setCursor] = React.useState(last);

  // A corpus committed in one go has one distinct date, and a slider with one notch
  // is a lie about having a time dimension. Show the graph, drop the scrubber.
  const scrubbable = stamps.length > 1;
  const t = stamps[Math.min(cursor, last)] ?? 0;

  const visibleNodes = React.useMemo(
    () => (scrubbable ? placed.filter((n) => n.first_seen <= t) : placed),
    [placed, t, scrubbable],
  );
  const visibleWires = React.useMemo(
    () => (scrubbable ? wires.filter((w) => w.at <= t) : wires),
    [wires, t, scrubbable],
  );

  React.useEffect(() => {
    if (!playing) return;
    if (cursor >= last) {
      setPlaying(false);
      return;
    }
    const id = window.setTimeout(() => setCursor((c) => c + 1), Math.max(70, 7000 / Math.max(1, stamps.length)));
    return () => window.clearTimeout(id);
  }, [playing, cursor, last, stamps.length]);

  const onHover = React.useCallback((slug: string | null) => setHovered(slug), []);
  const onPick = React.useCallback(
    (slug: string) => router.push(`/${productSlug}/research/${slug}`),
    [router, productSlug],
  );

  const play = () => {
    if (playing) return setPlaying(false);
    if (cursor >= last) setCursor(0); // replay from the beginning
    setPlaying(true);
  };

  const hot = hovered ? visibleNodes.find((n) => n.slug === hovered) ?? null : null;
  const hotWires = hot ? visibleWires.filter((w) => w.from === hot.slug || w.to === hot.slug) : [];
  const proseInView = visibleNodes.reduce((s, n) => s + n.prose_chars, 0);

  // Only the rels on screen, commonest first, with their counts.
  const relCounts = React.useMemo(() => {
    const c = new Map<Rel, number>();
    for (const w of visibleWires) c.set(w.rel, (c.get(w.rel) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]);
  }, [visibleWires]);

  if (!nodes.length) return null;

  return (
    <section className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 16, flexWrap: "wrap" }}>
        <div>
          <div className="eyebrow"><T id="site.platform.research.topologygraph.div-1" /></div>
          {/* No inline font-size: h2 is 27px on the scale, and it must out-rank the
              readouts it heads. The card title was previously knocked down to 24 to
              stop it colliding with 30px metrics — which fixed the collision by
              demoting the heading. The metrics came down instead. */}
          <h2 style={{ marginTop: 4 }}><T id="site.platform.research.topologygraph.h2-1" /></h2>
        </div>
        {/* The cursor's date is the state of the whole surface, so it reads as a
            value, not as a caption. */}
        <div style={{ fontFamily: "var(--font-serif)", fontSize: 20, color: "var(--ink)" }}>
          {scrubbable ? fmtDate(t) : copyText("site.platform.research.topologygraph.div-2", { nodes: nodes.length.toLocaleString("en-GB") })}
          {scrubbable && cursor >= last ? (
            <span style={{ color: "var(--ink-faded)", fontFamily: "var(--font-mono)", fontSize: 12 }}><T id="site.platform.research.topologygraph.span-1" /></span>
          ) : null}
        </div>
      </div>

      {/* ── readouts ──────────────────────────────────────────────────────── */}
      <div
        className="grid cols-3"
        style={{ gap: "var(--space-5)", marginTop: "var(--space-4)" }}
        aria-live="polite"
        aria-atomic="true"
      >
        <Readout label={copyText("site.platform.research.topologygraph.label-1")} value={visibleNodes.length.toLocaleString("en-GB")} note={copyText("site.platform.research.topologygraph.note-1", { nodes: nodes.length.toLocaleString("en-GB") })} />
        <Readout label={copyText("site.platform.research.topologygraph.label-2")} value={visibleWires.length.toLocaleString("en-GB")} note={copyText("site.platform.research.topologygraph.note-2", { wires: wires.length.toLocaleString("en-GB") })} />
        <Readout label={copyText("site.platform.research.topologygraph.label-3")} value={compact(proseInView)} note={copyText("site.platform.research.topologygraph.note-3")} />
      </div>

      {/* ── the graph ─────────────────────────────────────────────────────── */}
      {/* The figure is the subject of the card, so it gets more air than anything
          around it. Fenced with the same 16px as a stat row, it read as one more
          item in a list. */}
      <div style={{ position: "relative", maxWidth: 760, margin: "var(--space-8) auto 0" }}>
        <svg
          viewBox={`0 0 ${VB} ${VB}`}
          width="100%"
          preserveAspectRatio={copyText("site.platform.research.topologygraph.preserveaspectratio-1")}
          role="img"
          aria-label={
            copyText("site.platform.research.topologygraph.svg-1", { productSlug, visibleNodes: visibleNodes.length, nodes: nodes.length }) +
            copyText("site.platform.research.topologygraph.svg-2", { visibleWires: visibleWires.length, wires: wires.length, fmtDate: scrubbable ? fmtDate(t) : "today" }) +
            copyText("site.platform.research.topologygraph.svg-3")
          }
          style={{
            display: "block",
            width: "100%",
            height: "auto",
            aspectRatio: "1 / 1",
            background: "var(--bg-sunk)",
            border: "1px solid var(--rule)",
            borderRadius: "var(--radius)",
            touchAction: "pan-y", // never trap a mobile scroll inside the graph
          }}
          onMouseLeave={() => setHovered(null)}
        >
          <EdgeLayer wires={visibleWires} />
          <NodeLayer nodes={visibleNodes} onHover={onHover} onPick={onPick} />

          {/* highlight: the hovered node's own edges, drawn over the top */}
          {hot ? (
            <g>
              <g stroke="var(--accent)" fill="none" strokeWidth={1.6} strokeOpacity={0.9}>
                {hotWires.map((w, i) => (
                  <line key={i} x1={w.x1} y1={w.y1} x2={w.x2} y2={w.y2} />
                ))}
              </g>
              <circle
                cx={hot.cx}
                cy={hot.cy}
                r={hot.r + 3.5}
                fill="none"
                stroke="var(--accent)"
                strokeWidth={1.6}
                style={reduced ? undefined : { transition: "r 120ms ease-out" }}
              />
            </g>
          ) : null}
        </svg>

        {/* The label is HTML, not <text>: inside a scaled viewBox the type would
            shrink with the graph on a phone. Out here it stays 12px. */}
        {hot ? (
          <div
            role="status"
            style={{
              position: "absolute",
              left: `${pct(hot.x)}%`,
              top: `${pct(hot.y)}%`,
              transform: "translate(-50%, calc(-100% - 12px))",
              pointerEvents: "none",
              whiteSpace: "nowrap",
              maxWidth: "90%",
              overflow: "hidden",
              textOverflow: "ellipsis",
              background: "var(--bg-card)",
              border: "1px solid var(--rule)",
              borderRadius: "var(--radius-sm)",
              boxShadow: "var(--shadow-2)",
              padding: "6px 10px",
              fontSize: 12,
              color: "var(--ink)",
              fontWeight: 600,
              zIndex: 2,
            }}
          >
            {hot.name}
            <span style={{ color: "var(--ink-faded)", fontWeight: 400, marginLeft: 8, fontFamily: "var(--font-mono)", fontSize: 11 }}>
              <T id="site.platform.research.topologygraph.span-2" v={{ depth_score: hot.depth_score, compact: compact(hot.prose_chars), inbound: hot.inbound + hot.outbound }} />
            </span>
          </div>
        ) : null}
      </div>

      {/* ── the scrubber ──────────────────────────────────────────────────── */}
      {scrubbable ? (
        <div style={{ maxWidth: 760, margin: "var(--space-5) auto 0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
            <button
              type="button"
              className="btn ghost"
              onClick={play}
              aria-label={playing ? copyText("site.platform.research.topologygraph.button-1") : copyText("site.platform.research.topologygraph.button-2")}
              style={{ flexShrink: 0, minWidth: 78, justifyContent: "center" }}
            >
              {playing ? copyText("site.platform.research.topologygraph.button-3") : cursor >= last ? copyText("site.platform.research.topologygraph.button-4") : copyText("site.platform.research.topologygraph.button-5")}
            </button>
            <input
              id="topo-cursor"
              className="range"
              type="range"
              min={0}
              max={last}
              step={1}
              value={Math.min(cursor, last)}
              onChange={(e) => {
                setPlaying(false);
                setCursor(Number(e.target.value));
              }}
              aria-label={copyText("site.platform.research.topologygraph.label-4")}
              aria-valuetext={copyText("site.platform.research.topologygraph.valuetext-1", { fmtDate: fmtDate(t), visibleNodes: visibleNodes.length, visibleWires: visibleWires.length })}
            />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
            <span style={{ fontSize: 11, color: "var(--ink-mute)", fontFamily: "var(--font-mono)" }}>{fmtDate(stamps[0])}</span>
            <span style={{ fontSize: 11, color: "var(--ink-mute)", fontFamily: "var(--font-mono)" }}>{fmtDate(stamps[last])}</span>
          </div>
        </div>
      ) : null}

      {/* ── legend ────────────────────────────────────────────────────────────
          Keyed off the edges ACTUALLY ON SCREEN, not off the five members of the
          Rel union. A legend built from the type system announces `acquired-by` on
          a corpus that has never acquired anything — which is what the schema-keyed
          version did on two of the three products. Carrying the count as well turns
          the key into a readout: it now says what the graph is made of, and it
          empties as the cursor rewinds. */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "var(--space-3) var(--space-8)",
          alignItems: "center",
          marginTop: "var(--space-8)",
          paddingTop: "var(--space-4)",
          borderTop: "1px solid var(--rule-soft)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          <span className="eyebrow"><T id="site.platform.research.topologygraph.span-3" /></span>
          {[0, 2, 4, 6, 8, 10].map((d) => (
            <span
              key={d}
              title={`depth ${d}`}
              style={{ width: 14, height: 14, borderRadius: "50%", background: fillOf(d) }}
            />
          ))}
          <span style={{ fontSize: 11, color: "var(--ink-faded)", fontFamily: "var(--font-mono)" }}>0 → 10</span>
        </div>

        {relCounts.length ? (
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "var(--space-2) var(--space-4)" }}>
            <span className="eyebrow"><T id="site.platform.research.topologygraph.span-4" /></span>
            {relCounts.map(([rel, n]) => (
              <span key={rel} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <svg width="26" height="8" aria-hidden="true" style={{ flexShrink: 0 }}>
                  <line
                    x1={0}
                    y1={4}
                    x2={26}
                    y2={4}
                    stroke="var(--ink-faded)"
                    strokeWidth={1.4}
                    strokeOpacity={EDGE_WASH + 0.3}
                    strokeDasharray={REL_STYLE[rel].dash}
                  />
                </svg>
                <span style={{ fontSize: 11, color: "var(--ink-faded)", fontFamily: "var(--font-mono)" }}>
                  {REL_STYLE[rel].label} · {n.toLocaleString("en-GB")}
                </span>
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {/* ── what the picture claims, and what it does not ─────────────────── */}
      <p
        style={{
          fontSize: 13,
          color: "var(--ink-faded)",
          marginTop: "var(--space-4)",
          marginBottom: 0,
          maxWidth: "var(--paper-measure)", // prose holds the measure, even in a card
        }}
      >
        <T id="site.platform.research.topologygraph.p-2" v={{ v: scrubbable ? copyText("site.platform.research.topologygraph.p-1") : "", node: scrubbable ? (
          <>
            <T id="site.platform.research.topologygraph.fragment-1" c={[<code />]} />
          </>
        ) : (
          <>
            <T id="site.platform.research.topologygraph.fragment-2" />
          </>
        ) }} c={[<strong />]} />
      </p>
    </section>
  );
}

function Readout({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontFamily: "var(--font-serif)", fontSize: 24, lineHeight: 1.1, color: "var(--ink)" }}>{value}</div>
      <div style={{ fontSize: 12, color: "var(--ink-faded)", marginTop: 2 }}>{note}</div>
    </div>
  );
}
