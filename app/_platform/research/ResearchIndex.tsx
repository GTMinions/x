/**
 * Research site index for a product — the "large site" landing.
 *
 * It opens with the derived orientation (LandscapePanel, which owns the shelves and
 * the reasoning behind them), then the full corpus grouped by category. The order is
 * the argument: the first screen has to answer "what matters here" before it offers
 * the list.
 *
 * Rendered by app/(products)/<slug>/research/page.tsx via the shared engine.
 */
import React from "react";
import Link from "next/link";
import { buildTopology, loadEntities } from "./engine";
import { defencesFor, hasArchitecture } from "./architecture";
import { LandscapePanel } from "./LandscapePanel";
import { DepthMeter, StatusPill, Tags } from "./ui";
import type { Category } from "./types";
import { T, t } from "@/app/_platform/copy";

const CATEGORY_ORDER: Category[] = ["frontier", "peer", "landscape", "internal"];
const CATEGORY_LABEL: Record<Category, string> = {
  frontier: t("site.platform.research.researchindex.frontier-1"),
  peer: t("site.platform.research.researchindex.peer-1"),
  landscape: t("site.platform.research.researchindex.landscape-1"),
  internal: t("site.platform.research.researchindex.internal-1"),
};

export function ResearchIndex({ productSlug }: { productSlug: string }) {
  const entities = loadEntities(productSlug);
  const topo = buildTopology(productSlug);

  if (!entities.length) {
    return (
      <div className="card">
        <p className="muted">
          <T id="site.platform.research.researchindex.p-1" v={{ productSlug }} c={[<code />, <code />]} />
        </p>
      </div>
    );
  }

  const byCategory = CATEGORY_ORDER.map((cat) => ({
    cat,
    items: entities.filter((e) => e.category === cat),
  })).filter((g) => g.items.length);

  const maxBucket = Math.max(1, ...Object.values(topo.depthHistogram));

  // The architecture is where the corpus stops being reading and starts being a
  // build. Only offered when the product has actually described one.
  // Counted per view, never summed: the product and technical views are two readings
  // of ONE stack, so adding them would double-count the architecture on the very card
  // whose thesis is that depth decides what you may claim.
  const showArchitecture = hasArchitecture(productSlug);
  const productLayers = showArchitecture ? defencesFor(productSlug, "product") : [];
  const technicalLayers = showArchitecture ? defencesFor(productSlug, "technical") : [];
  const undefendedProduct = productLayers.filter((d) => d.undefended).length;
  const undefendedTechnical = technicalLayers.filter((d) => d.undefended).length;

  return (
    <div className="grid" style={{ gap: "var(--space-16)" }}>
      <LandscapePanel productSlug={productSlug} />

      <section className="card">
        <div className="eyebrow"><T id="site.platform.research.researchindex.div-1" /></div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 80, marginTop: 12 }}>
          {Array.from({ length: 11 }).map((_, i) => {
            const n = topo.depthHistogram[String(i)] ?? 0;
            return (
              <div key={i} style={{ flex: 1, textAlign: "center" }}>
                <div
                  style={{
                    height: `${(n / maxBucket) * 60}px`,
                    background: n ? "var(--accent)" : "var(--rule)",
                    borderRadius: 3,
                    minHeight: 2,
                  }}
                  title={t("site.platform.research.researchindex.title-1", { i, n, v: n === 1 ? "y" : "ies" })}
                />
                <div className="mono muted" style={{ fontSize: 10, marginTop: 4 }}>
                  {i}
                </div>
              </div>
            );
          })}
        </div>
        <p className="muted" style={{ margin: "12px 0 0", fontSize: 13 }}>
          <T id="site.platform.research.researchindex.p-2" v={{ entities: entities.length, edges: topo.edges.length }} />
        </p>
      </section>

      {showArchitecture && (
        <section className="card">
          <div className="eyebrow"><T id="site.platform.research.researchindex.div-2" /></div>
          <h2 style={{ margin: "8px 0 0" }}><T id="site.platform.research.researchindex.h2-1" /></h2>
          <p className="muted" style={{ margin: "8px 0 0", fontSize: 14, maxWidth: "var(--paper-measure)" }}>
            <T id="site.platform.research.researchindex.p-3" c={[<strong />]} />
          </p>
          <div style={{ display: "flex", gap: "var(--space-3)", marginTop: "var(--space-4)", flexWrap: "wrap" }}>
            <Link className="btn" href={`/${productSlug}/research/architecture`}>
              <T id="site.platform.research.researchindex.link-1" />
            </Link>
            <Link className="btn ghost" href={`/${productSlug}/research/architecture/technical`}>
              <T id="site.platform.research.researchindex.link-2" />
            </Link>
          </div>
          <p className="mono muted" style={{ margin: "var(--space-3) 0 0", fontSize: 12 }}>
            <T id="site.platform.research.researchindex.p-4" v={{ productLayers: productLayers.length, node: undefendedProduct > 0 ? (
              <span style={{ color: "var(--status-warn)" }}><T id="site.platform.research.researchindex.span-1" v={{ undefendedProduct }} /></span>
            ) : (
              <span style={{ color: "var(--status-ok)" }}><T id="site.platform.research.researchindex.span-2" /></span>
            ), technicalLayers: technicalLayers.length, node2: undefendedTechnical > 0 ? (
              <span style={{ color: "var(--status-warn)" }}><T id="site.platform.research.researchindex.span-3" v={{ undefendedTechnical }} /></span>
            ) : (
              <span style={{ color: "var(--status-ok)" }}><T id="site.platform.research.researchindex.span-4" /></span>
            ) }} />
          </p>
        </section>
      )}

      <section className="grid" style={{ gap: "var(--space-8)" }}>
        <div>
          <h2 style={{ margin: 0 }}><T id="site.platform.research.researchindex.h2-2" /></h2>
          <p className="muted" style={{ margin: "6px 0 0", fontSize: 13, maxWidth: "var(--paper-measure)" }}>
            <T id="site.platform.research.researchindex.p-5" />
          </p>
        </div>

        {/* h2 (serif 27) → h3 (sans 16) → h4 (sans 14) on the cards. The group label
            has to outrank the entities it governs, which it does not do if both are h3. */}
        {byCategory.map((group) => (
          <div key={group.cat}>
            <h3 style={{ marginBottom: 12 }}>
              {CATEGORY_LABEL[group.cat]}{" "}
              <span className="mono muted" style={{ fontSize: 11, fontWeight: 400 }}>
                {group.items.length}
              </span>
            </h3>
            <div className="grid cols-2">
              {group.items.map((e) => (
                <Link key={e.slug} href={`/${productSlug}/research/${e.slug}`} className="card">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: 8 }}>
                    <h4>{e.name}</h4>
                    <StatusPill status={e.status} />
                  </div>
                  {e.subtitle && (
                    <p className="muted" style={{ margin: "6px 0 10px", fontSize: 13 }}>
                      {e.subtitle}
                    </p>
                  )}
                  <DepthMeter score={e.depth_score} />
                  <div style={{ marginTop: 10 }}>
                    <Tags tags={e.tags} />
                  </div>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
