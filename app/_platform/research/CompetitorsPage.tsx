/**
 * The competitor analysis — one table, and the honesty that has to sit next to it.
 *
 * Every column is derived (competitors.ts); nothing on this page was typed by hand.
 * The arrangement is the argument: the reader meets the weakness (how many rivals
 * sit below the `working` rung, how many carry no sourced number) before the
 * comparison itself.
 *
 * On colour: most of the table is thin, so marking the thin rows would colour the
 * majority of a corpus's peers and the signal would carry no bits. The scarce thing
 * is a rival researched to `working` AND carrying a number with a receipt, which few
 * peers are. Those get the mark — as a badge, so it survives a reader who cannot see
 * the hue — and the caption under the table counts them. Everything else reads
 * neutral, and the aggregate weakness is counted at the top where it cannot be
 * scrolled past.
 */
import React from "react";
import Link from "next/link";
import { buildCompetitors, type CompetitorRow } from "./competitors";
import { renderInline } from "./pills";
import { entitySlugSet } from "./engine";
import { T, t } from "@/app/_platform/copy";

function Stat({ n, label, warn }: { n: number; label: string; warn?: boolean }) {
  return (
    <div className="card" style={{ padding: "var(--space-4)" }}>
      <div
        className="mono"
        style={{ fontSize: 27, color: warn && n > 0 ? "var(--status-warn)" : "var(--ink)" }}
      >
        {n}
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: 4, lineHeight: 1.4 }}>
        {label}
      </div>
    </div>
  );
}

/** Researched to `working` and carrying a number with a receipt: a row you could quote. */
const quotable = (r: CompetitorRow) => r.entity.depth_score >= 7 && Boolean(r.claim);

function Row({ row, productSlug }: { row: CompetitorRow; productSlug: string }) {
  const { entity: e } = row;
  const solid = quotable(row);
  return (
    <tr>
      <td>
        <Link href={`/${productSlug}/research/${e.slug}`} className="wikilink" style={{ fontWeight: 600 }}>
          {e.name}
        </Link>
        {row.mocClaim && (
          <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>
            {row.mocClaim.claim}
          </div>
        )}
      </td>
      <td className="num">
        {/* Shape, not just hue. A quotable rung is a badge; the rest is plain text. Encoding
            the one state that matters in colour alone loses it for a red-green reader, and
            --status-ok against --ink at 13px is exactly that pair. */}
        {solid ? (
          <span className="pill ok">{row.rung.label}</span>
        ) : (
          <span>{row.rung.label}</span>
        )}{" "}
        <span className="muted">{e.depth_score}/10</span>
        {row.overclaimed && (
          <div className="mono" style={{ fontSize: 11, color: "var(--ink-mute)", marginTop: 3 }}>
            <T id="site.platform.research.competitorspage.div-1" v={{ label: row.earned.label }} />
          </div>
        )}
      </td>
      <td className="num">{row.inbound}</td>
      <td className="num">
        {row.strengths}/{row.weaknesses}
      </td>
      <td className="num">{row.benchmarks || "—"}</td>
      <td>
        {row.claim ? (
          <>
            <span className="muted">{row.claim.metric}: </span>
            <strong style={{ fontWeight: 600 }}>{row.claim.value}</strong>{" "}
            <a
              href={row.claim.source}
              target="_blank"
              rel="noreferrer"
              className="mono"
              style={{ fontSize: 11, color: "var(--accent)" }}
            >
              <T id="site.platform.research.competitorspage.a-1" />
            </a>
          </>
        ) : (
          <span className="muted"><T id="site.platform.research.competitorspage.span-1" /></span>
        )}
      </td>
      <td className="num">
        <span className="muted">{e.last_updated}</span>
        {/* A fainter grey would have been a rule nobody stated. Two greys that differ
            by no learnable rule are noise; the word is readable. */}
        {row.stale && (
          <span
            className="mono"
            style={{ color: "var(--ink-mute)", marginLeft: 6, fontSize: 10 }}
            title={t("site.platform.research.competitorspage.title-1")}
          >
            <T id="site.platform.research.competitorspage.span-2" />
          </span>
        )}
      </td>
    </tr>
  );
}

export function CompetitorsPage({ productSlug }: { productSlug: string }) {
  const { rows, thin, moc, axes, otherMaps, counts } = buildCompetitors(productSlug);
  const slugs = entitySlugSet(productSlug);

  if (!rows.length) {
    return (
      <>
        <div className="eyebrow"><T id="site.platform.research.competitorspage.div-2" /></div>
        <h1 style={{ marginTop: 8 }}><T id="site.platform.research.competitorspage.h1-1" /></h1>
        <p className="paper-lede" style={{ marginTop: 8 }}>
          <T id="site.platform.research.competitorspage.p-1" c={[<code />]} />
        </p>
      </>
    );
  }

  const unsourced = counts.total - counts.sourced;

  // What the thin half is owed, most-common first. Forty cards restating the table
  // would be the same data twice; the pattern across them is the thing the table
  // cannot show, and it is what a researcher would act on.
  const owed = new Map<string, number>();
  for (const r of thin) for (const m of r.missing) owed.set(m, (owed.get(m) ?? 0) + 1);
  const owedRanked = [...owed.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

  return (
    <>
      <div className="eyebrow"><T id="site.platform.research.competitorspage.div-3" /></div>
      <h1 style={{ marginTop: 8 }}><T id="site.platform.research.competitorspage.h1-2" /></h1>
      <p className="paper-lede" style={{ marginTop: 8 }}>
        <T id="site.platform.research.competitorspage.p-4" v={{ total: counts.total, v: counts.total === 1 ? t("site.platform.research.competitorspage.p-2") : t("site.platform.research.competitorspage.p-3") }} />
      </p>

      <div
        style={{
          display: "grid",
          gap: "var(--space-4)",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          margin: "var(--space-8) 0",
        }}
      >
        <Stat n={counts.total} label={t("site.platform.research.competitorspage.label-1")} />
        <Stat n={counts.thin} label={t("site.platform.research.competitorspage.label-2")} warn />
        <Stat n={unsourced} label={t("site.platform.research.competitorspage.label-3")} />
        <Stat n={counts.overclaimed} label={t("site.platform.research.competitorspage.label-4")} />
      </div>

      {moc ? (
        <section className="card" style={{ marginBottom: "var(--space-8)" }}>
          <div className="eyebrow"><T id="site.platform.research.competitorspage.div-4" /></div>
          <h2 style={{ margin: "6px 0 0" }}>
            <T id="site.platform.research.competitorspage.h2-1" v={{ name: moc.name }} c={[<Link href={`/${productSlug}/research/${moc.slug}`} className="wikilink" />]} />
          </h2>
          {moc.thesis && (
            <p style={{ margin: "var(--space-2) 0 0", fontSize: 14, lineHeight: 1.6, maxWidth: "var(--paper-measure)" }}>
              {renderInline(moc.thesis, productSlug, slugs)}
            </p>
          )}
          <ul style={{ margin: "var(--space-4) 0 0", paddingLeft: 18, maxWidth: "var(--paper-measure)" }}>
            {axes.map((a) => (
              <li key={a.name} style={{ marginBottom: 6, fontSize: 14 }}>
                <strong>{a.name}</strong> <span className="muted">— {a.question}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <section className="card empty" style={{ marginBottom: "var(--space-8)" }}>
          <div className="eyebrow"><T id="site.platform.research.competitorspage.div-5" /></div>
          <p style={{ margin: "6px 0 0", fontSize: 14, maxWidth: "var(--paper-measure)", lineHeight: 1.6 }}>
            {otherMaps.length ? (
              <>
                <T id="site.platform.research.competitorspage.fragment-1" v={{ otherMaps: otherMaps.map((m, i) => (
                  <React.Fragment key={m.slug}>
                    {i > 0 && ", "}
                    <Link className="wikilink" href={`/${productSlug}/research/${m.slug}`}>{m.name}</Link>
                  </React.Fragment>
                )) }} />
              </>
            ) : (
              <>
                <T id="site.platform.research.competitorspage.fragment-2" />
              </>
            )}
          </p>
        </section>
      )}

      <div style={{ overflowX: "auto" }}>
        <table className="paper-table" style={{ minWidth: 780 }}>
          <thead>
            <tr>
              <th><T id="site.platform.research.competitorspage.th-1" /></th>
              <th><T id="site.platform.research.competitorspage.th-2" /></th>
              <th><T id="site.platform.research.competitorspage.th-3" /></th>
              <th><T id="site.platform.research.competitorspage.th-4" /></th>
              <th><T id="site.platform.research.competitorspage.th-5" /></th>
              <th><T id="site.platform.research.competitorspage.th-6" /></th>
              <th><T id="site.platform.research.competitorspage.th-7" /></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Row key={r.entity.slug} row={r} productSlug={productSlug} />
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: "var(--space-3)", maxWidth: "var(--paper-measure)" }}>
        <T id="site.platform.research.competitorspage.p-5" v={{ rows: rows.filter(quotable).length, total: counts.total }} c={[<span className="pill ok" />, <strong />]} />
      </p>

      {thin.length > 0 && (
        <section style={{ marginTop: "var(--space-12)" }}>
          <div className="eyebrow" style={{ color: "var(--status-warn)" }}>
            <T id="site.platform.research.competitorspage.div-6" />
          </div>
          <h2 style={{ margin: "6px 0 0" }}>
            <T id="site.platform.research.competitorspage.h2-2" v={{ thin: thin.length, total: counts.total }} c={[<em />]} />
          </h2>
          <p
            className="muted"
            style={{ margin: "8px 0 var(--space-5)", maxWidth: "var(--paper-measure)", fontSize: 14, lineHeight: 1.6 }}
          >
            <T id="site.platform.research.competitorspage.p-6" c={[<strong />]} />
          </p>

          <div className="grid" style={{ gap: "var(--space-2)", maxWidth: "var(--paper-measure)" }}>
            {owedRanked.map(([label, n]) => (
              <div key={label} style={{ display: "flex", gap: "var(--space-3)", alignItems: "baseline" }}>
                <span className="mono" style={{ fontSize: 13, color: "var(--status-warn)", minWidth: 28 }}>
                  {n}
                </span>
                <span style={{ fontSize: 14 }}>{label}</span>
              </div>
            ))}
          </div>

          <p className="muted" style={{ margin: "var(--space-5) 0 var(--space-2)", fontSize: 12 }}>
            <T id="site.platform.research.competitorspage.p-7" />
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)" }}>
            {thin.map((r) => (
              <Link
                key={r.entity.slug}
                href={`/${productSlug}/research/${r.entity.slug}`}
                className="pill"
                title={r.missing.length ? t("site.platform.research.competitorspage.link-1", { missing: r.missing.join(" · ") }) : undefined}
              >
                {r.entity.name}{" "}
                <span className="mono" style={{ color: "var(--ink-mute)" }}>{r.entity.depth_score}</span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
