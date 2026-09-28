/**
 * ShareTopicPage — one share topic: the cards to save, and the text to paste.
 *
 * The cards render at their true 3:4 and download as PNG, because the job here is
 * not to look at them: it is to get them onto a phone, and Xiaohongshu does not
 * take SVG. The SVG is the source; the product's `card/[n]/route.ts` is the
 * export. The caption and hashtags sit under them in a `<pre>` so they survive a
 * copy without smart-quoting the punctuation.
 *
 * The link back to the entity is the load-bearing part. A card makes a claim in
 * one line; the entity is where the citations live. Without that link this page
 * is just marketing, which is the thing the platform exists to refuse.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { loadShareTopic, CARD_W, CARD_H } from "./sharing";
import { ShareCard } from "./ShareCard";
import { T, t as copyText } from "@/app/_platform/copy";

export function ShareTopicPage({ productSlug, topic }: { productSlug: string; topic: string }) {
  const t = loadShareTopic(productSlug, topic);
  if (!t) notFound();

  return (
    <>
      <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "baseline", flexWrap: "wrap" }}>
        <Link href={`/${productSlug}/research/share`} className="muted mono" style={{ fontSize: 11, textDecoration: "none" }}>
          <T id="site.platform.research.share.sharetopicpage.link-1" />
        </Link>
        <span className="mono muted" style={{ fontSize: 11 }}>{t.published}</span>
        <Link href={`/${productSlug}/research/${t.entity}`} className="pill mono" style={{ fontSize: 11, textDecoration: "none" }}>
          {t.entity} ↗
        </Link>
      </div>

      <h1 style={{ marginTop: "var(--space-3)", lineHeight: 1.35 }}>{t.title}</h1>
      <p className="muted" style={{ maxWidth: 660, marginTop: "var(--space-2)", fontSize: 15 }}>{t.hook}</p>

      {/* The editorial call, in English. It is why the loop chose this, and it is
          not part of the post — a reader of the post should never see it. */}
      <div
        className="card"
        style={{ marginTop: "var(--space-5)", padding: "var(--space-4)", borderLeft: "2px solid var(--rule)" }}
      >
        <div className="eyebrow"><T id="site.platform.research.share.sharetopicpage.div-1" /></div>
        <p className="muted" style={{ margin: "var(--space-2) 0 0", fontSize: 13, lineHeight: 1.7 }}>{t.angle}</p>
      </div>

      <div className="eyebrow" style={{ marginTop: "var(--space-6)" }}>
        <T id="site.platform.research.share.sharetopicpage.div-2" v={{ CARD_W, CARD_H }} />
      </div>
      <div
        style={{
          marginTop: "var(--space-3)",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: "var(--space-4)",
        }}
      >
        {t.cards.map((c, i) => (
          <figure key={i} style={{ margin: 0 }}>
            {/* The card is authored SVG from this repo's own content, not user input.
                The intrinsic width/height are stripped for the INLINE render only: the
                export needs them (a downloaded file has no container to size against),
                but on the page they would lay the card out at 1080×1440 CSS px inside a
                ~250px column, and `overflow: hidden` would clip it to a sliver of its own
                left edge. The download href keeps the original string, at full size — and
                the drag hands the browser that same PNG route (see ShareCard). */}
            <ShareCard
              svg={c.svg.replace(`width="${CARD_W}" height="${CARD_H}"`, 'width="100%" height="100%"')}
              href={`/${productSlug}/research/share/${t.slug}/card/${i + 1}`}
              filename={copyText("site.platform.research.share.sharetopicpage.filename-1", { slug: t.slug, i: i + 1 })}
              width={CARD_W}
              height={CARD_H}
            />
            <figcaption style={{ fontSize: 12, marginTop: "var(--space-2)", lineHeight: 1.5 }}>
              {/* Downloading is the verb on this page. It gets the accent and the
                  underline; the role is a footnote and reads like one. */}
              <a
                href={`/${productSlug}/research/share/${t.slug}/card/${i + 1}`}
                download={`${t.slug}-${i + 1}.png`}
                className="mono"
                style={{ color: "var(--accent)", textDecoration: "underline", fontWeight: 600 }}
              >
                <T id="site.platform.research.share.sharetopicpage.a-1" v={{ i: i + 1 }} />
              </a>
              <span className="muted" style={{ fontSize: 11 }}> — {c.role}</span>
            </figcaption>
          </figure>
        ))}
      </div>

      <div className="eyebrow" style={{ marginTop: "var(--space-6)" }}><T id="site.platform.research.share.sharetopicpage.div-3" /></div>
      <pre
        className="card"
        style={{
          marginTop: "var(--space-3)",
          padding: "var(--space-4)",
          whiteSpace: "pre-wrap",
          fontSize: 13,
          lineHeight: 1.8,
          fontFamily: "inherit",
        }}
      >
        {t.caption}
        {"\n\n"}
        {t.hashtags.join(" ")}
      </pre>
    </>
  );
}
