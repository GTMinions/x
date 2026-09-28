/**
 * ShareIndex — a product's shareable-topics index, engine-side.
 *
 * The research index sorts by depth, because depth is what a researcher wants.
 * This one sorts by recency, because a feed is a stack. Same evidence, cut to
 * the shape a post accepts. The product route wraps this in its own shell, the
 * same three-line pattern as ResearchIndex.
 */
import Link from "next/link";
import { loadShareTopics } from "./sharing";
import { T } from "@/app/_platform/copy";

export function ShareIndex({ productSlug }: { productSlug: string }) {
  const topics = loadShareTopics(productSlug);

  return (
    <>
      <div className="eyebrow"><T id="site.platform.research.share.shareindex.div-1" /></div>
      <h1 style={{ marginTop: 8 }}><T id="site.platform.research.share.shareindex.h1-1" /></h1>
      <p className="muted" style={{ maxWidth: 660, marginTop: 8, fontSize: 15 }}>
        <T id="site.platform.research.share.shareindex.p-1" />
      </p>

      {topics.length === 0 ? (
        <p className="muted" style={{ marginTop: "var(--space-6)", fontSize: 14 }}>
          <T id="site.platform.research.share.shareindex.p-2" c={[<em />]} />
        </p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: "var(--space-6) 0 0", display: "grid", gap: "var(--space-3)" }}>
          {topics.map((t) => (
            <li key={t.slug}>
              <Link
                href={`/${productSlug}/research/share/${t.slug}`}
                className="card"
                style={{ display: "block", textDecoration: "none", padding: "var(--space-4)" }}
              >
                <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "baseline", flexWrap: "wrap" }}>
                  <span className="mono muted" style={{ fontSize: 11 }}>{t.published}</span>
                  <span className="pill mono" style={{ fontSize: 11 }}>{t.entity}</span>
                  <span className="muted mono" style={{ fontSize: 11 }}><T id="site.platform.research.share.shareindex.span-1" v={{ cards: t.cards.length }} /></span>
                </div>
                <div style={{ fontSize: 16, fontWeight: 600, marginTop: "var(--space-2)", lineHeight: 1.45 }}>
                  {t.title}
                </div>
                <p className="muted" style={{ margin: "var(--space-2) 0 0", fontSize: 13, lineHeight: 1.6 }}>
                  {t.hook}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
