/**
 * Sources index — the audit trail for a product's research corpus.
 *
 * Every claim on the research site rests on a URL somewhere. This page counts
 * them, splits them by the kind of receipt they are, and ranks the publishers by
 * how much of the corpus each one carries.
 *
 * The concentration banner is the point of the page. Research that cites one
 * vendor's blog forty times and everyone else once looks, page by page, exactly
 * like research that read the field — the imbalance is only visible in aggregate.
 * So the aggregate is rendered, and crossing 30% names the publisher out loud.
 * It is a review flag, not a build break: a corpus about one company will lean on
 * that company, and that can be the honest answer. What it can't do is go unsaid.
 */
import React from "react";
import Link from "next/link";
import {
  CONCENTRATION_LIMIT,
  collectCitations,
  countByKind,
  publisherConcentration,
  opaqueShare,
  type CitationKind,
} from "./substrates";
import { T, t } from "@/app/_platform/copy";

const KIND_LABEL: Record<CitationKind, string> = {
  entity: "entity pages",
  benchmark: "benchmarks",
  voice: "voices",
  incident: "incidents",
};

const pct = (share: number) => `${(share * 100).toFixed(1)}%`;

const CELL: React.CSSProperties = { padding: "7px 12px 7px 0", verticalAlign: "middle", fontSize: 13 };
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

export function SourcesIndex({ productSlug }: { productSlug: string }) {
  const citations = collectCitations(productSlug);

  if (!citations.length) {
    return (
      <div className="card">
        <p className="muted">
          <T id="site.platform.research.sourcesindex.p-1" v={{ productSlug }} c={[<code />, <code />, <code />, <code />]} />
        </p>
      </div>
    );
  }

  const byKind = countByKind(citations);
  const publishers = publisherConcentration(citations);
  const distinctUrls = new Set(citations.map((c) => c.url)).size;
  const top = publishers[0];
  const concentrated = publishers.filter((p) => p.share > CONCENTRATION_LIMIT);
  const opaque = opaqueShare(citations);

  return (
    <div className="grid" style={{ gap: 24 }}>
      {/* A DOI or a short link is not a publisher — it is a door in front of one.
          Counting it as a source would report concentration where there is none,
          so it gets named for what it is: the part of the corpus whose publisher
          we cannot see. */}
      {opaque.share > 0.15 && (
        <section
          className="card"
          style={{ borderColor: "var(--rule)", borderRadius: "var(--radius-sm)" }}
        >
          <div className="eyebrow"><T id="site.platform.research.sourcesindex.div-1" /></div>
          <p style={{ margin: "8px 0 0", fontSize: 14 }}>
            <T id="site.platform.research.sourcesindex.p-2" v={{ pct: pct(opaque.share), count: opaque.count }} />
          </p>
        </section>
      )}

      {concentrated.length > 0 && (
        <section
          className="card"
          style={{
            borderColor: "var(--status-warn)",
            background: "var(--status-warn-bg)",
            borderRadius: "var(--radius-sm)",
          }}
        >
          <div className="eyebrow" style={{ color: "var(--status-warn)" }}>
            <T id="site.platform.research.sourcesindex.div-2" />
          </div>
          {concentrated.map((p) => (
            <p key={p.publisher} style={{ margin: "8px 0 0", fontSize: 14 }}>
              <T id="site.platform.research.sourcesindex.p-3" v={{ publisher: p.publisher, pct: pct(p.share), count: p.count, citations: citations.length }} c={[<strong className="mono" />]} />
            </p>
          ))}
        </section>
      )}

      <section className="grid cols-3">
        <div className="card">
          <div className="eyebrow"><T id="site.platform.research.sourcesindex.div-3" /></div>
          <div style={{ fontFamily: "var(--font-serif)", fontSize: 34, marginTop: 4 }}>
            {citations.length}
          </div>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            <T id="site.platform.research.sourcesindex.p-4" v={{ distinctUrls, publishers: publishers.length }} />
          </p>
        </div>
        <div className="card">
          <div className="eyebrow"><T id="site.platform.research.sourcesindex.div-4" /></div>
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 6 }}>
            <tbody>
              {(Object.keys(KIND_LABEL) as CitationKind[]).map((k) => (
                <tr key={k}>
                  <td className="muted" style={CELL}>
                    {KIND_LABEL[k]}
                  </td>
                  <td className="mono" style={{ ...CELL, textAlign: "right" }}>
                    {byKind[k]}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <div className="eyebrow"><T id="site.platform.research.sourcesindex.div-5" /></div>
          <div style={{ fontFamily: "var(--font-serif)", fontSize: 26, marginTop: 4 }}>
            {top.publisher}
          </div>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            <T id="site.platform.research.sourcesindex.p-7" v={{ count: top.count, pct: pct(top.share), v: top.share > CONCENTRATION_LIMIT ? t("site.platform.research.sourcesindex.p-5") : t("site.platform.research.sourcesindex.p-6") }} />
          </p>
        </div>
      </section>

      <section className="card">
        <div className="eyebrow"><T id="site.platform.research.sourcesindex.div-6" v={{ publishers: publishers.length }} /></div>
        <div style={{ overflowX: "auto", marginTop: 8 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 420 }}>
            <thead>
              <tr>
                <th style={HEAD}><T id="site.platform.research.sourcesindex.th-1" /></th>
                <th style={HEAD}><T id="site.platform.research.sourcesindex.th-2" /></th>
                <th style={HEAD}><T id="site.platform.research.sourcesindex.th-3" /></th>
                <th style={{ ...HEAD, width: "40%" }}>{""}</th>
              </tr>
            </thead>
            <tbody>
              {publishers.map((p) => {
                const over = p.share > CONCENTRATION_LIMIT;
                return (
                  <tr key={p.publisher} style={{ borderBottom: "1px solid var(--rule-soft)" }}>
                    <td className="mono" style={{ ...CELL, color: over ? "var(--status-warn)" : "var(--ink)" }}>
                      {p.publisher}
                    </td>
                    <td className="mono" style={CELL}>
                      {p.count}
                    </td>
                    <td className="mono" style={CELL}>
                      {pct(p.share)}
                    </td>
                    <td style={CELL}>
                      <div
                        style={{
                          height: 6,
                          width: `${Math.max(2, p.share * 100)}%`,
                          background: over ? "var(--status-warn)" : "var(--accent)",
                          borderRadius: 3,
                        }}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <p className="muted" style={{ fontSize: 13, margin: 0 }}>
        <Link className="wikilink" href={`/${productSlug}/research`}>
          <T id="site.platform.research.sourcesindex.link-1" />
        </Link>
      </p>
    </div>
  );
}
