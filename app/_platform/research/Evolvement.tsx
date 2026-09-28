"use client";

/**
 * Evolvement — the research corpus, growing.
 *
 * The research site shows you the corpus as it stands. This shows you how it got
 * there: drag the cursor back and watch entities disappear, edges unwire, and the
 * committed volume fall away.
 *
 * ── The honesty constraint, and why the UI is shaped this way ────────────────
 * The only witness to the past is git. Git records which file changed, when, and
 * by how many lines. It does NOT record what was inside the file unless you go
 * read every historical revision of it. So there are two classes of number here
 * and they are kept visibly apart:
 *
 *   scrubbed   — recomputed at the cursor, from commit timestamps and numstat.
 *                entities, commits, net JSON lines, edges wired.
 *   as of today — read off HEAD. depth ladder, prose volume.
 *
 * A depth-over-time chart would be the obvious thing to draw here, and it is not
 * drawn, because `depth_score` at time T is not in the commit log — it is inside
 * the file at commit T. Inferring it from commit subjects ("broaden X …") would
 * produce a chart that looks measured and is not. The same goes for prose
 * characters over time: git counts lines of JSON, which is a different quantity
 * from characters of argument, and quietly relabelling one as the other is the
 * exact move this component refuses to make.
 *
 * Presentational and pure — the server component (EvolvementSection) does the
 * loading. Colour comes from CSS variables only.
 */

import React from "react";
import Link from "next/link";
import type { ProductHistory, TimedNode } from "./history-types";
import { useCopy } from "@/app/_platform/copy/client";

// ── formatting ──────────────────────────────────────────────────────────────
// Fixed UTC locale: this component is server-rendered before it hydrates, and a
// date formatted against the server's clock/zone and then reformatted against the
// browser's is a hydration mismatch waiting for a traveller.

const fmtDate = (sec: number): string =>
  new Date(sec * 1000).toLocaleDateString("en-GB", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    year: "numeric",
  });

const fmtDateTime = (sec: number): string =>
  `${fmtDate(sec)} · ${new Date(sec * 1000).toLocaleTimeString("en-GB", {
    timeZone: "UTC",
    hour: "2-digit",
    minute: "2-digit",
  })} UTC`;

const compact = (n: number): string =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

// ── small parts ─────────────────────────────────────────────────────────────

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontFamily: "var(--font-serif)", fontSize: 34, lineHeight: 1.1, color: "var(--ink)" }}>
        {value}
      </div>
      {note ? (
        <div style={{ fontSize: 12, color: "var(--ink-faded)", marginTop: 4 }}>{note}</div>
      ) : null}
    </div>
  );
}

/** Entity count over the commit timeline. A step chart, because growth is discrete. */
function GrowthChart({ series, cursor }: { series: number[]; cursor: number }) {
  const W = 1000;
  const H = 120;
  const n = series.length;
  if (n < 2) return null;

  const max = Math.max(...series, 1);
  const x = (i: number) => (i / (n - 1)) * W;
  const y = (v: number) => H - (v / max) * (H - 8) - 2;

  // Step path: hold the previous value until the commit that changes it.
  let d = `M ${x(0)} ${y(series[0])}`;
  for (let i = 1; i < n; i++) d += ` L ${x(i)} ${y(series[i - 1])} L ${x(i)} ${y(series[i])}`;
  const area = `${d} L ${W} ${H} L 0 ${H} Z`;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height={H}
      preserveAspectRatio="none"
      aria-hidden="true"
      style={{ display: "block", marginTop: 4 }}
    >
      <path d={area} fill="var(--accent-bg)" />
      <path d={d} fill="none" stroke="var(--accent)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      <line
        x1={x(cursor)}
        y1={0}
        x2={x(cursor)}
        y2={H}
        stroke="var(--ink-soft)"
        strokeWidth={1}
        strokeDasharray="3 3"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={x(cursor)} cy={y(series[cursor])} r={3.5} fill="var(--accent)" />
    </svg>
  );
}

/** Today's depth ladder. Deliberately does NOT move with the cursor — see the file header. */
function DepthToday({ nodes }: { nodes: TimedNode[] }) {
  const { t: copyText } = useCopy();
  const buckets = Array.from({ length: 11 }, (_, i) => nodes.filter((e) => Math.round(e.depth_score) === i).length);
  const max = Math.max(1, ...buckets);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 72, marginTop: 12 }}>
      {buckets.map((count, i) => (
        <div key={i} style={{ flex: 1, textAlign: "center" }}>
          <div
            style={{
              height: `${(count / max) * 52}px`,
              minHeight: 2,
              borderRadius: 3,
              background: count ? "var(--accent)" : "var(--rule)",
            }}
            title={copyText("site.platform.research.evolvement.title-1", { i, count, v: count === 1 ? "entity" : "entities" })}
          />
          <div style={{ fontSize: 10, color: "var(--ink-mute)", marginTop: 4, fontFamily: "var(--font-mono)" }}>
            {i}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── the view ────────────────────────────────────────────────────────────────

export type EvolvementProps = {
  productSlug: string;
  nodes: TimedNode[];
  history: ProductHistory;
  generatedAt: string;
  shallow: boolean;
};

export function Evolvement({ productSlug, nodes, history, generatedAt, shallow }: EvolvementProps) {
  const { T, t: copyText } = useCopy();
  // Every commit that touched an entity file, flattened and ordered.
  const { stamps, cumEntities, cumLines, cumCommits, lastSubject } = React.useMemo(() => {
    const events = Object.values(history.entities).flatMap((h) => h.events);
    const stamps = [...new Set(events.map((e) => e.ts))].sort((a, b) => a - b);

    const firstSeen = nodes.map((n) => n.first_seen).sort((a, b) => a - b);
    const cumEntities: number[] = [];
    const cumLines: number[] = [];
    const cumCommits: number[] = [];
    const lastSubject: string[] = [];

    // Pre-bucket per stamp so scrubbing stays O(1) per frame rather than O(events).
    const byStamp = new Map<number, { lines: number; shas: Set<string>; subject: string }>();
    for (const e of events) {
      const b = byStamp.get(e.ts) ?? { lines: 0, shas: new Set<string>(), subject: e.subject };
      b.lines += e.added - e.removed;
      b.shas.add(e.sha);
      byStamp.set(e.ts, b);
    }

    let lines = 0;
    let commits = 0;
    let subject = "";
    let ei = 0;
    for (const ts of stamps) {
      const b = byStamp.get(ts)!;
      lines += b.lines;
      commits += b.shas.size;
      subject = b.subject;
      while (ei < firstSeen.length && firstSeen[ei] <= ts) ei++;
      cumEntities.push(ei);
      cumLines.push(lines);
      cumCommits.push(commits);
      lastSubject.push(subject);
    }
    return { stamps, cumEntities, cumLines, cumCommits, lastSubject };
  }, [history, nodes]);

  const [cursor, setCursor] = React.useState(() => Math.max(0, stamps.length - 1));

  // Untracked content has no past to scrub. Say that, rather than rendering a
  // slider with one notch and pretending it means something.
  if (stamps.length === 0) {
    return (
      <div className="card">
        <div className="eyebrow"><T id="site.platform.research.evolvement.div-1" /></div>
        <p style={{ marginTop: 10, color: "var(--ink-soft)", maxWidth: 620 }}>
          <T id="site.platform.research.evolvement.p-3" v={{ productSlug, nodes: nodes.length.toLocaleString("en-GB"), v: nodes.length === 1 ? copyText("site.platform.research.evolvement.p-1") : copyText("site.platform.research.evolvement.p-2") }} c={[<code />, <code />]} />
        </p>
      </div>
    );
  }

  const t = stamps[cursor];
  const atNow = cursor === stamps.length - 1;

  // "· scrubbed" means "recomputed at the cursor". With one commit there is no
  // cursor, so the tag would point at a control that is not on the page.
  const scrubbed = stamps.length > 1 ? copyText("site.platform.research.evolvement.scrubbed-1") : "";

  const edgeAt = (() => {
    let last: number | null = null;
    for (const p of history.edgeTimeline) {
      if (p.ts <= t) last = p.count;
      else break;
    }
    return last;
  })();

  const proseToday = nodes.reduce((n, x) => n + x.prose_chars, 0);
  const recentlyMoved = [...nodes].sort((a, b) => b.last_changed - a.last_changed).slice(0, 8);
  const subjectFor = (slug: string) => {
    const events = history.entities[slug]?.events;
    return events?.length ? events[events.length - 1].subject : "";
  };

  return (
    <div className="grid" style={{ gap: 28 }}>
      {/* ── the scrubber ─────────────────────────────────────────────────── */}
      <section className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 16 }}>
          <label htmlFor="evo-cursor" className="eyebrow" style={{ margin: 0 }}>
            <T id="site.platform.research.evolvement.label-1" />
          </label>
          <div style={{ fontSize: 13, color: "var(--ink-faded)", fontFamily: "var(--font-mono)" }}>
            <T id="site.platform.research.evolvement.div-3" v={{ cumCommits: cumCommits[cursor], cumCommits2: cumCommits[cumCommits.length - 1], v: atNow ? copyText("site.platform.research.evolvement.div-2") : "" }} />
          </div>
        </div>

        <div
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: 26,
            marginTop: 6,
            marginBottom: 2,
            color: "var(--ink)",
          }}
        >
          {fmtDateTime(t)}
        </div>

        {/* One commit is not a timeline. A range input with min=max=0 is a control
            that cannot be operated: it invites a drag, ignores it, and teaches the
            reader that the cursor is decorative. Below two stamps there is nothing
            to scrub, so the scrubber does not appear — the figures still stand, they
            just all describe the single commit that produced them. */}
        {stamps.length > 1 ? (
          <>
            <input
              id="evo-cursor"
              className="range"
              type="range"
              min={0}
              max={stamps.length - 1}
              step={1}
              value={cursor}
              onChange={(e) => setCursor(Number(e.target.value))}
              aria-valuetext={copyText("site.platform.research.evolvement.valuetext-1", { fmtDate: fmtDate(t), cumEntities: cumEntities[cursor], cumCommits: cumCommits[cursor] })}
              aria-describedby="evo-cursor-help"
              style={{ marginTop: 10 }}
            />
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 2 }}>
              <span style={{ fontSize: 11, color: "var(--ink-mute)", fontFamily: "var(--font-mono)" }}>
                {fmtDate(stamps[0])}
              </span>
              <span style={{ fontSize: 11, color: "var(--ink-mute)", fontFamily: "var(--font-mono)" }}>
                {fmtDate(stamps[stamps.length - 1])}
              </span>
            </div>
            <p id="evo-cursor-help" style={{ fontSize: 12, color: "var(--ink-faded)", marginTop: 10, marginBottom: 0 }}>
              <T id="site.platform.research.evolvement.p-4" c={[<em />]} />
            </p>
          </>
        ) : (
          <p style={{ fontSize: 12, color: "var(--ink-faded)", marginTop: 10, marginBottom: 0 }}>
            <T id="site.platform.research.evolvement.p-5" />
          </p>
        )}

        <GrowthChart series={cumEntities} cursor={cursor} />

        <div className="grid cols-3" style={{ gap: 24, marginTop: 18 }}>
          <Stat
            label={copyText("site.platform.research.evolvement.label-2", { scrubbed })}
            value={cumEntities[cursor].toLocaleString("en-GB")}
            note={copyText("site.platform.research.evolvement.note-1", { nodes: nodes.length.toLocaleString("en-GB") })}
          />
          <Stat
            label={copyText("site.platform.research.evolvement.label-3", { scrubbed })}
            value={edgeAt === null ? "—" : edgeAt.toLocaleString("en-GB")}
            note={
              edgeAt === null
                ? copyText("site.platform.research.evolvement.stat-1")
                : copyText("site.platform.research.evolvement.stat-2")
            }
          />
          <Stat
            label={copyText("site.platform.research.evolvement.label-4", { scrubbed })}
            value={compact(Math.max(0, cumLines[cursor]))}
            note={copyText("site.platform.research.evolvement.note-2")}
          />
        </div>

        {lastSubject[cursor] ? (
          <div
            style={{
              marginTop: 18,
              paddingTop: 14,
              borderTop: "1px solid var(--rule-soft)",
              fontSize: 13,
              color: "var(--ink-soft)",
            }}
          >
            <span className="eyebrow" style={{ marginRight: 8 }}>
              <T id="site.platform.research.evolvement.span-1" />
            </span>
            {lastSubject[cursor]}
          </div>
        ) : null}
      </section>

      {/* ── what the scrubber does and does not know ─────────────────────── */}
      <section
        className="card"
        style={{ background: "var(--bg-sunk)", borderColor: "var(--rule)" }}
      >
        <div className="eyebrow"><T id="site.platform.research.evolvement.div-4" /></div>
        <p style={{ marginTop: 10, color: "var(--ink-soft)", fontSize: 14, maxWidth: 720 }}>
          <T id="site.platform.research.evolvement.p-6" c={[<code />, <code />]} />
        </p>
        <p style={{ marginTop: 10, color: "var(--ink-soft)", fontSize: 14, maxWidth: 720 }}>
          <T id="site.platform.research.evolvement.p-7" c={[<em />]} />
        </p>
        <p style={{ marginTop: 10, color: "var(--ink-faded)", fontSize: 12, marginBottom: 0 }}>
          <T id="site.platform.research.evolvement.p-9" v={{ fmtDate: fmtDate(Math.floor(Date.parse(generatedAt) / 1000)), v: shallow ? copyText("site.platform.research.evolvement.p-8") : "" }} />
        </p>
      </section>

      {/* ── HEAD-only panels ─────────────────────────────────────────────── */}
      <div className="grid cols-2" style={{ gap: 20, alignItems: "start" }}>
        <section className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div className="eyebrow" style={{ margin: 0 }}>
              <T id="site.platform.research.evolvement.div-5" />
            </div>
            <span className="pill info"><T id="site.platform.research.evolvement.span-2" /></span>
          </div>
          <DepthToday nodes={nodes} />
          <p style={{ fontSize: 12, color: "var(--ink-faded)", marginTop: 12, marginBottom: 0 }}>
            <T id="site.platform.research.evolvement.p-10" v={{ compact: compact(proseToday), nodes: nodes.length.toLocaleString("en-GB") }} />
          </p>
        </section>

        <section className="card">
          <div className="eyebrow"><T id="site.platform.research.evolvement.div-6" /></div>
          <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
            {recentlyMoved.map((n) => (
              <div
                key={n.slug}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  alignItems: "baseline",
                  paddingBottom: 10,
                  borderBottom: "1px solid var(--rule-soft)",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <Link
                    href={`/${productSlug}/research/${n.slug}`}
                    style={{ color: "var(--ink)", fontWeight: 600, fontSize: 14 }}
                  >
                    {n.name}
                  </Link>
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--ink-faded)",
                      marginTop: 2,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {subjectFor(n.slug) || copyText("site.platform.research.evolvement.div-7", { commits: history.entities[n.slug]?.commits ?? 0 })}
                  </div>
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--ink-mute)",
                    fontFamily: "var(--font-mono)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {fmtDate(n.last_changed)}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
