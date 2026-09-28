/**
 * The launch surface — what this product can truthfully say, and where.
 *
 * Reads the research corpus, derives every claim the evidence supports, runs each
 * one through the gate, and shows both halves: what is cleared to ship, and what
 * is not, with the reason. The blocked list is the more useful of the two.
 */
import React from "react";
import Link from "next/link";
import { deriveLaunchPlan, launchGaps, competitiveFrames } from "./derive";
import { loadEntities } from "../research/engine";
import { renderInline } from "../research/pills";
import { auditClaims } from "./gate";
import { CHANNELS, CHANNEL_IDS, isOutbound } from "./channels";
import type { ChannelId } from "./types";
import { T, t } from "@/app/_platform/copy";

const CELL: React.CSSProperties = { padding: "8px 12px 8px 0", verticalAlign: "top", fontSize: 13 };

export function LaunchPage({ productSlug }: { productSlug: string }) {
  const plan = deriveLaunchPlan(productSlug);
  // A claim's words are the corpus's own words — derive.ts lifts them from
  // `recommendation` and from benchmark values, which carry [[pills]] and **bold**.
  // Rendering them as a bare string printed the markers to the reader. It went uncaught
  // because the render sweep that found the same leak in EntityPage only walked entity
  // pages, and /launch renders corpus prose through a different component. A sweep scoped
  // to one page type proves nothing about the others.
  const slugs = new Set(loadEntities(productSlug).map((e) => e.slug));
  const Inline = ({ text }: { text: string }) => <>{renderInline(text, productSlug, slugs)}</>;
  const gaps = launchGaps(productSlug, plan);
  const frames = competitiveFrames(productSlug);
  const audit = auditClaims(plan, productSlug);

  const cleared = audit.filter((a) => a.verdict.ok);
  const blocked = audit.filter((a) => !a.verdict.ok);

  return (
    <div className="grid" style={{ gap: 24 }}>
      <section className="card">
        <div className="eyebrow"><T id="site.platform.gtm.launchpage.div-1" /></div>
        <h1 style={{ marginTop: 6 }}><T id="site.platform.gtm.launchpage.h1-1" /></h1>
        <p className="muted" style={{ marginTop: 8, maxWidth: "68ch" }}>
          <T id="site.platform.gtm.launchpage.p-1" />
        </p>
        <div style={{ display: "flex", gap: 24, marginTop: 16, flexWrap: "wrap" }}>
          <div>
            <div className="eyebrow"><T id="site.platform.gtm.launchpage.div-2" /></div>
            <div style={{ fontFamily: "var(--font-serif)", fontSize: 27 }}>{cleared.length}</div>
          </div>
          <div>
            <div className="eyebrow"><T id="site.platform.gtm.launchpage.div-3" /></div>
            <div style={{ fontFamily: "var(--font-serif)", fontSize: 27, color: blocked.length ? "var(--status-warn)" : undefined }}>
              {blocked.length}
            </div>
          </div>
          <div>
            <div className="eyebrow"><T id="site.platform.gtm.launchpage.div-4" /></div>
            <div style={{ fontFamily: "var(--font-serif)", fontSize: 27 }}>{plan.audiences.length}</div>
          </div>
        </div>
      </section>

      {gaps.length > 0 && (
        <section className="card" style={{ borderColor: "var(--status-warn)" }}>
          <h2 style={{ marginTop: 0, color: "var(--status-warn)" }}><T id="site.platform.gtm.launchpage.h2-1" v={{ gaps: gaps.length }} /></h2>
          <p className="muted" style={{ marginTop: 6, fontSize: 13 }}>
            <T id="site.platform.gtm.launchpage.p-2" />
          </p>
          {gaps.map((g) => (
            <div key={g.what} style={{ marginTop: 16 }}>
              <strong>{g.what}</strong>
              <p style={{ margin: "4px 0 0", fontSize: 13 }}><Inline text={g.why} /></p>
              <p className="muted mono" style={{ margin: "4px 0 0", fontSize: 11 }}>{g.fix}</p>
            </div>
          ))}
        </section>
      )}

      {frames.length > 0 && (
        <section className="card">
          <h2 style={{ marginTop: 0 }}><T id="site.platform.gtm.launchpage.h2-2" /></h2>
          <p className="muted" style={{ marginTop: 6, fontSize: 13 }}>
            <T id="site.platform.gtm.launchpage.p-3" />
          </p>
          {frames.map((f) => (
            <div key={f.moc_slug} style={{ marginTop: 16 }}>
              <Link href={`/${productSlug}/research/${f.moc_slug}`} style={{ color: "var(--accent)", fontWeight: 500 }}>
                {/* Strip, do not render: this sits inside a <Link>, and renderInline can emit
                    a <Link> of its own — nested anchors, which the parser hoists apart and
                    hydration then disagrees with. No MOC thesis carries a pill today; that is
                    luck, not a guarantee, and validate-content now enforces it. */}
                {f.thesis
                  .split(/(?<=[.?!])\s/)[0]
                  .replace(/\[\[([a-z0-9-]+)\]\]/g, "$1")
                  .replace(/\*\*|`/g, "")}
              </Link>
              <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                <T id="site.platform.gtm.launchpage.div-5" v={{ axes: f.axes.map((a) => a.name).join(" · ") }} />
              </div>
              <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                <T id="site.platform.gtm.launchpage.div-6" v={{ alternatives: f.alternatives.map((a) => a.slug).join(", ") }} />
              </div>
            </div>
          ))}
        </section>
      )}

      <section className="card">
        <h2 style={{ marginTop: 0 }}><T id="site.platform.gtm.launchpage.h2-3" v={{ cleared: cleared.length }} /></h2>
        {cleared.length === 0 ? (
          <p className="muted" style={{ marginTop: 8 }}>
            <T id="site.platform.gtm.launchpage.p-4" />
          </p>
        ) : (
          <div style={{ overflowX: "auto", marginTop: 8 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 520 }}>
              <tbody>
                {cleared.slice(0, 40).map(({ claim }) => (
                  <tr key={claim.id} style={{ borderBottom: "1px solid var(--rule-soft)" }}>
                    <td style={CELL}>
                      <span className="claim-text"><Inline text={claim.text} /></span>
                      {claim.falsifier && (
                        <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                          <T id="site.platform.gtm.launchpage.div-7" v={{ falsifier: claim.falsifier }} />
                        </div>
                      )}
                    </td>
                    <td style={{ ...CELL, whiteSpace: "nowrap" }}>
                      <span className="pill">{claim.kind}</span>
                    </td>
                    <td style={{ ...CELL, whiteSpace: "nowrap" }}>
                      {claim.entity_slug && (
                        <Link
                          className="mono"
                          style={{ fontSize: 11, color: "var(--accent)" }}
                          href={`/${productSlug}/research/${claim.entity_slug}`}
                        >
                          {claim.entity_slug}
                        </Link>
                      )}
                    </td>
                    <td style={{ ...CELL, whiteSpace: "nowrap" }}>
                      {claim.citation?.url && (
                        <a
                          className="mono"
                          style={{ fontSize: 11, color: "var(--accent)" }}
                          href={claim.citation.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <T id="site.platform.gtm.launchpage.a-1" />
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {cleared.length > 40 && (
              <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>
                <T id="site.platform.gtm.launchpage.p-5" v={{ cleared: cleared.length - 40 }} />
              </p>
            )}
          </div>
        )}
      </section>

      {blocked.length > 0 && (
        <section className="card">
          <h2 style={{ marginTop: 0 }}><T id="site.platform.gtm.launchpage.h2-4" v={{ blocked: blocked.length }} /></h2>
          <p className="muted" style={{ marginTop: 6, fontSize: 13 }}>
            <T id="site.platform.gtm.launchpage.p-6" />
          </p>
          <div style={{ marginTop: 8 }}>
            {blocked.slice(0, 15).map(({ claim, verdict }) => (
              <div key={claim.id} style={{ marginBottom: 12, paddingBottom: 12, borderBottom: "1px solid var(--rule-soft)" }}>
                <div className="claim-text" style={{ fontSize: 13 }}><Inline text={claim.text} /></div>
                <div className="mono" style={{ fontSize: 11, color: "var(--status-warn)", marginTop: 4 }}>
                  {!verdict.ok && verdict.reason}
                </div>
              </div>
            ))}
            {blocked.length > 15 && (
              <p className="muted" style={{ fontSize: 12 }}><T id="site.platform.gtm.launchpage.p-7" v={{ blocked: blocked.length - 15 }} /></p>
            )}
          </div>
        </section>
      )}

      <section className="card">
        <h2 style={{ marginTop: 0 }}><T id="site.platform.gtm.launchpage.h2-5" /></h2>
        <p className="muted" style={{ marginTop: 6, fontSize: 13 }}>
          <T id="site.platform.gtm.launchpage.p-8" />
        </p>
        <div style={{ overflowX: "auto", marginTop: 10 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
            <tbody>
              {CHANNEL_IDS.map((id: ChannelId) => {
                const c = CHANNELS[id];
                return (
                  <tr key={id} style={{ borderBottom: "1px solid var(--rule-soft)" }}>
                    <td style={{ ...CELL, whiteSpace: "nowrap" }}>
                      <strong>{c.name}</strong>
                      <div className="muted mono" style={{ fontSize: 11, marginTop: 4 }}>
                        {c.medium}
                        {c.max_chars ? ` · ${c.max_chars}c` : ""}
                        {c.house_seconds ? t("site.platform.gtm.launchpage.div-8", { house_seconds: c.house_seconds[0], house_seconds2: c.house_seconds[1] }) : ""}
                      </div>
                      {isOutbound(id) && (
                        <div className="pill warn" style={{ fontSize: 11, marginTop: 4 }}>
                          <T id="site.platform.gtm.launchpage.div-9" />
                        </div>
                      )}
                    </td>
                    <td style={CELL}>{c.works_for}</td>
                    <td style={{ ...CELL, color: "var(--ink-faded)" }}>{c.fails_at}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
