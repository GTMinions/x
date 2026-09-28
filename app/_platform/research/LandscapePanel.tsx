/**
 * The first screen of a product's research site.
 *
 * A reader landing on four hundred entities sorted by depth learns one thing: how
 * many there are. This answers the question they actually arrived with — what
 * matters here, and who else is doing it — in three shelves, all three derived
 * from the corpus by signals.ts rather than written down by anyone.
 *
 * The shelves are allowed to come back empty, and say so when they do. ai-edu
 * names two rivals and has drawn no map; pretending otherwise with a blank grid
 * would be the one failure a reader cannot catch.
 */
import React from "react";
import Link from "next/link";
import { buildLandscape } from "./landscape";
import { renderInline } from "./pills";
import { entitySlugSet } from "./engine";
import { depthLabel } from "./depth";
import type { Ranked } from "./signals";
import { T, t } from "@/app/_platform/copy";

function Card({ r, productSlug }: { r: Ranked; productSlug: string }) {
  const { entity: e, inbound } = r;
  return (
    <Link href={`/${productSlug}/research/${e.slug}`} className="card" style={{ display: "block" }}>
      <h3 style={{ margin: 0 }}>{e.name}</h3>
      {e.subtitle && (
        <p className="muted" style={{ margin: "6px 0 0", fontSize: 13, lineHeight: 1.45 }}>
          {e.subtitle}
        </p>
      )}
      <div
        className="mono"
        style={{
          marginTop: "var(--space-3)",
          fontSize: 11,
          color: "var(--ink-mute)",
          display: "flex",
          gap: "var(--space-2)",
        }}
      >
        <span style={{ color: "var(--accent)" }}>{depthLabel(e.depth_score)}</span>
        <span>·</span>
        <span>{e.depth_score}/10</span>
        <span>·</span>
        <span>
          <T id="site.platform.research.landscapepanel.span-1" v={{ inbound, v: inbound === 1 ? "" : "s" }} />
        </span>
      </div>
    </Link>
  );
}

function Shelf({ title, note, children }: { title: string; note: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <h2 style={{ margin: 0 }}>{title}</h2>
      <p
        className="muted"
        style={{ margin: "6px 0 var(--space-4)", fontSize: 13, maxWidth: "var(--paper-measure)" }}
      >
        {note}
      </p>
      {children}
    </section>
  );
}

const shelfGrid: React.CSSProperties = {
  display: "grid",
  gap: "var(--space-4)",
  gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
};

function Nothing({ children }: { children: React.ReactNode }) {
  return (
    <div className="card empty">
      <p style={{ margin: 0, fontSize: 14, maxWidth: "var(--paper-measure)" }}>{children}</p>
    </div>
  );
}

export function LandscapePanel({ productSlug }: { productSlug: string }) {
  const { techniques, players, maps, counts, thinPlayers } = buildLandscape(productSlug);
  const slugs = entitySlugSet(productSlug);

  return (
    <div className="grid" style={{ gap: "var(--space-12)" }}>
      <Shelf
        title={t("site.platform.research.landscapepanel.title-1")}
        note={
          <>
            <T id="site.platform.research.landscapepanel.fragment-1" v={{ techniques: counts.techniques }} />
          </>
        }
      >
        {techniques.length ? (
          <div style={shelfGrid}>
            {techniques.map((r) => (
              <Card key={r.entity.slug} r={r} productSlug={productSlug} />
            ))}
          </div>
        ) : (
          <Nothing>
            <T id="site.platform.research.landscapepanel.nothing-1" />
          </Nothing>
        )}
      </Shelf>

      <Shelf
        title={t("site.platform.research.landscapepanel.title-2")}
        note={
          <>
            {counts.players === 0
              ? t("site.platform.research.landscapepanel.shelf-1")
              : t("site.platform.research.landscapepanel.shelf-2", { players: counts.players, v: counts.players === 1 ? "entity" : "entities" })}{" "}
            {counts.players > 0 && thinPlayers > 0 && (
              <>
                <T id="site.platform.research.landscapepanel.fragment-2" v={{ thinPlayers }} c={[<strong />]} />
              </>
            )}
            <Link className="wikilink" href={`/${productSlug}/research/competitors`}><T id="site.platform.research.landscapepanel.link-1" /></Link>
          </>
        }
      >
        {players.length ? (
          <div style={shelfGrid}>
            {players.map((r) => (
              <Card key={r.entity.slug} r={r} productSlug={productSlug} />
            ))}
          </div>
        ) : (
          <Nothing>
            <T id="site.platform.research.landscapepanel.nothing-2" c={[<code />]} />
          </Nothing>
        )}
      </Shelf>

      <Shelf
        title={t("site.platform.research.landscapepanel.title-3")}
        note={t("site.platform.research.landscapepanel.note-1")}
      >
        {maps.length ? (
          <div className="grid" style={{ gap: "var(--space-4)" }}>
            {/* The card is not itself a link: a thesis carries [[pills]], and an anchor
                inside an anchor is not markup a browser will honour. */}
            {maps.map(({ entity: m, inbound }) => (
              <div key={m.slug} className="card">
                <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-4)" }}>
                  {/* The card is inert, so the title is the only way in — it has to look like
                      a way in. Inheriting --ink paints the escape hatch as a label, and the
                      pills inside the thesis then read as the only affordance on the card. */}
                  <h3 style={{ margin: 0 }}>
                    <Link href={`/${productSlug}/research/${m.slug}`} className="wikilink">
                      {m.name}
                    </Link>
                  </h3>
                  <span className="mono" style={{ fontSize: 11, color: "var(--ink-mute)", whiteSpace: "nowrap" }}>
                    <T id="site.platform.research.landscapepanel.span-2" v={{ members: m.members?.length ?? 0, axes: m.axes?.length ?? 0, inbound }} />
                  </span>
                </div>
                {m.thesis && (
                  <p
                    style={{
                      margin: "var(--space-2) 0 0",
                      fontSize: 14,
                      lineHeight: 1.55,
                      maxWidth: "var(--paper-measure)",
                    }}
                  >
                    {renderInline(m.thesis, productSlug, slugs)}
                  </p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <Nothing>
            <T id="site.platform.research.landscapepanel.nothing-3" v={{ entities: counts.entities }} />
          </Nothing>
        )}
      </Shelf>
    </div>
  );
}
