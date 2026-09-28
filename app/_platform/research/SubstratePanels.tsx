/**
 * The three cited substrates, rendered.
 *
 * Each panel is a receipt table, not an essay. A voice row without a named speaker
 * never reaches the page (the loader drops it, and this file drops it again) —
 * an anonymous quote proves nothing and reads as evidence, which is the worst
 * combination. Every row carries its source link, so a reader can leave.
 *
 * Server components. Products drop them wherever the evidence belongs.
 */
import React from "react";
import Link from "next/link";
import type { Voice, BenchmarkRow, Incident } from "./types";
import { T, t as copyText } from "@/app/_platform/copy";

const CELL: React.CSSProperties = { padding: "8px 12px 8px 0", verticalAlign: "top", fontSize: 13 };
const HEAD: React.CSSProperties = {
  ...CELL,
  fontFamily: "var(--font-mono)",
  fontSize: 10,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--ink-faded)",
  fontWeight: 400,
  textAlign: "left",
  borderBottom: "1px solid var(--rule)",
};
const ROW: React.CSSProperties = { borderBottom: "1px solid var(--rule-soft)" };

function SourceLink({ url, date }: { url: string; date?: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="mono"
      style={{ fontSize: 11, color: "var(--accent)", whiteSpace: "nowrap" }}
    >
      {date ?? copyText("site.platform.research.substratepanels.a-1")} ↗
    </a>
  );
}

/** Scrolls the table instead of the page when the viewport is narrow. */
function Scroller({ children }: { children: React.ReactNode }) {
  return <div style={{ overflowX: "auto", marginTop: 8 }}>{children}</div>;
}

const TABLE: React.CSSProperties = { width: "100%", borderCollapse: "collapse", minWidth: 480 };

export function VoicesPanel({ voices }: { voices: Voice[] }) {
  // The loader already drops the unnamed. Repeat the check here so a panel handed
  // a hand-built array can't smuggle one in.
  const rows = voices.filter((v) => v.who?.trim() && v.quote?.trim());
  if (!rows.length) return null;

  return (
    <section className="card">
      <div className="eyebrow"><T id="site.platform.research.substratepanels.div-1" v={{ rows: rows.length }} /></div>
      <p className="muted" style={{ margin: "8px 0 0", fontSize: 13 }}>
        <T id="site.platform.research.substratepanels.p-1" />
      </p>
      <div style={{ marginTop: 12 }}>
        {rows.map((v, i) => (
          <figure
            key={v.id ?? i}
            style={{
              margin: 0,
              padding: "14px 0",
              borderTop: i > 0 ? "1px solid var(--rule-soft)" : "none",
            }}
          >
            <blockquote
              style={{
                margin: 0,
                paddingLeft: 14,
                borderLeft: "2px solid var(--accent)",
                fontSize: 15,
                lineHeight: 1.5,
              }}
            >
              “{v.quote}”
            </blockquote>
            <figcaption
              style={{
                display: "flex",
                gap: 10,
                alignItems: "center",
                flexWrap: "wrap",
                marginTop: 8,
                paddingLeft: 16,
              }}
            >
              <strong style={{ fontSize: 13 }}>{v.who}</strong>
              {v.role && (
                <span className="muted" style={{ fontSize: 13 }}>
                  {v.role}
                </span>
              )}
              {v.perspective && <span className="pill">{v.perspective}</span>}
              <SourceLink url={v.source_url} date={v.source_date} />
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}

/** `productSlug` is optional: pass it to turn `entity_slug` into a link home. */
export function BenchmarksPanel({ rows, productSlug }: { rows: BenchmarkRow[]; productSlug?: string }) {
  if (!rows.length) return null;
  return (
    <section className="card">
      <div className="eyebrow"><T id="site.platform.research.substratepanels.div-2" v={{ rows: rows.length }} /></div>
      <p className="muted" style={{ margin: "8px 0 0", fontSize: 13 }}>
        <T id="site.platform.research.substratepanels.p-2" />
      </p>
      <Scroller>
        <table style={TABLE}>
          <thead>
            <tr>
              <th style={HEAD}><T id="site.platform.research.substratepanels.th-1" /></th>
              <th style={HEAD}><T id="site.platform.research.substratepanels.th-2" /></th>
              <th style={HEAD}><T id="site.platform.research.substratepanels.th-3" /></th>
              <th style={HEAD}><T id="site.platform.research.substratepanels.th-4" /></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((b, i) => (
              <tr key={b.id ?? i} style={ROW}>
                <td style={CELL}>{b.metric}</td>
                <td className="mono" style={{ ...CELL, whiteSpace: "nowrap" }}>
                  {b.value}
                </td>
                <td style={{ ...CELL, color: "var(--ink-soft)" }}>
                  {b.backs_claim}
                  {b.entity_slug && productSlug && (
                    <>
                      {" "}
                      <Link className="wikilink" href={`/${productSlug}/research/${b.entity_slug}`}>
                        {b.entity_slug}
                      </Link>
                    </>
                  )}
                </td>
                <td style={CELL}>
                  <SourceLink url={b.source_url} date={b.source_date} />
                  {b.source_kind && (
                    <div className="muted mono" style={{ fontSize: 10, marginTop: 2 }}>
                      {b.source_kind}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Scroller>
    </section>
  );
}

export function IncidentsPanel({ incidents }: { incidents: Incident[] }) {
  if (!incidents.length) return null;
  return (
    <section className="card">
      <div className="eyebrow"><T id="site.platform.research.substratepanels.div-3" v={{ incidents: incidents.length }} /></div>
      <p className="muted" style={{ margin: "8px 0 0", fontSize: 13 }}>
        <T id="site.platform.research.substratepanels.p-3" />
      </p>
      <div style={{ marginTop: 12 }}>
        {incidents.map((inc, i) => (
          <div
            key={inc.id ?? i}
            style={{
              padding: "14px 0",
              borderTop: i > 0 ? "1px solid var(--rule-soft)" : "none",
            }}
          >
            <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
              <strong style={{ fontSize: 14 }}>{inc.title}</strong>
              <SourceLink url={inc.source_url} date={inc.source_date} />
            </div>
            {inc.parties?.length ? (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                {inc.parties.map((p) => (
                  <span key={p} className="pill">
                    {p}
                  </span>
                ))}
              </div>
            ) : null}

            {inc.timeline?.length ? (
              <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 10 }}>
                <tbody>
                  {inc.timeline.map((t, j) => (
                    <tr key={j}>
                      <td
                        className="mono muted"
                        style={{ ...CELL, fontSize: 11, whiteSpace: "nowrap", width: 1 }}
                      >
                        {t.date}
                      </td>
                      <td style={CELL}>
                        {t.event}
                        {t.source_url && (
                          <>
                            {" "}
                            <a
                              href={t.source_url}
                              target="_blank"
                              rel="noreferrer"
                              className="mono"
                              style={{ fontSize: 11, color: "var(--accent)" }}
                            >
                              ↗
                            </a>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}

            {inc.outcome && (
              <p style={{ margin: "10px 0 0", fontSize: 13 }}>
                <span className="mono muted" style={{ fontSize: 11 }}>
                  <T id="site.platform.research.substratepanels.span-1" />
                </span>
                {inc.outcome}
              </p>
            )}
            {inc.lesson && (
              <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--ink-soft)" }}>
                <span className="mono muted" style={{ fontSize: 11 }}>
                  <T id="site.platform.research.substratepanels.span-2" />
                </span>
                {inc.lesson}
              </p>
            )}
            {inc.response && (
              <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--ink-soft)" }}>
                <span className="mono muted" style={{ fontSize: 11 }}>
                  <T id="site.platform.research.substratepanels.span-3" />
                </span>
                {inc.response}
              </p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
