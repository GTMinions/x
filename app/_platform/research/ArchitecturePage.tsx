/**
 * ArchitecturePage — how a product's research composes into the thing that got built.
 *
 * Two views over the same `Layer` type, and they are drawn as two different shapes
 * because they are two different claims. The product view is a flow: work enters,
 * moves through the stages, and hits the gate that decides whether a person ever
 * sees it. The technical view is a stack: tiers of substrate, each layer as wide as
 * the research holding it up. See ./diagrams for both.
 *
 * Each card carries the layer's commitment and the research entities it rests on,
 * every entity linked to its own page and printed with the rung it has reached on
 * the depth ladder. Cards run in the same order the diagram draws them, so box 04
 * and card 04 are the same layer.
 *
 * The rung is the reason this page exists. A layer whose entities all sit below
 * `working` gets flagged, because the depth ladder decides what the product is
 * allowed to claim: `working` is the first rung that demands a mechanism and a
 * number with a source under it. A promise resting on research thinner than that is
 * a promise nobody has earned.
 */
import React from "react";
import Link from "next/link";
import { getProduct } from "@/app/lib/products";
import { defencesFor, hasArchitecture, type LayerDefence, type ViewName } from "./architecture";
import { ArchitectureDiagram, orderedDefences } from "./diagrams";
import { T, t } from "@/app/_platform/copy";

const COPY: Record<
  ViewName,
  {
    eyebrow: string;
    title: string;
    lead: string;
    other: ViewName;
    otherLabel: string;
    figure: string;
  }
> = {
  // This table is the spine's, so it is read by every product. Keep it in the
  // register of the page, not of any one product: no accounts, no AEs, no 0.72.
  product: {
    eyebrow: t("site.platform.research.architecturepage.eyebrow-1"),
    title: t("site.platform.research.architecturepage.title-1"),
    lead: t("site.platform.research.architecturepage.lead-1"),
    other: "technical",
    otherLabel: t("site.platform.research.architecturepage.otherlabel-1"),
    figure: t("site.platform.research.architecturepage.figure-1"),
  },
  technical: {
    eyebrow: t("site.platform.research.architecturepage.eyebrow-2"),
    title: t("site.platform.research.architecturepage.title-2"),
    lead: t("site.platform.research.architecturepage.lead-2"),
    other: "product",
    otherLabel: t("site.platform.research.architecturepage.otherlabel-2"),
    figure: t("site.platform.research.architecturepage.figure-2"),
  },
};

const hrefFor = (productSlug: string, view: ViewName) =>
  view === "technical"
    ? `/${productSlug}/research/architecture/technical`
    : `/${productSlug}/research/architecture`;

/* ── Entity chips ───────────────────────────────────────────────────────────── */

function EntityChip({ productSlug, e }: { productSlug: string; e: LayerDefence["entities"][number] }) {
  if (!e.entity || !e.rung) {
    // The validator makes this unreachable on a green build; render it loudly if it ever lands.
    return <span className="pill bad"><T id="site.platform.research.architecturepage.span-1" v={{ slug: e.slug }} /></span>;
  }
  return (
    <Link
      href={`/${productSlug}/research/${e.slug}`}
      className={`pill ${e.defensible ? "ok" : ""}`}
      title={t("site.platform.research.architecturepage.title-3", { name: e.entity.name, depth_score: e.entity.depth_score, label: e.rung.label })}
    >
      <span style={{ fontWeight: 600 }}>{e.entity.name}</span>
      <span className="mono" style={{ fontSize: 10, opacity: 0.75 }}>
        {e.rung.label} {e.entity.depth_score}
      </span>
    </Link>
  );
}

/* ── One layer card ─────────────────────────────────────────────────────────── */

function LayerCard({
  productSlug,
  d,
  index,
  nameOf,
}: {
  productSlug: string;
  d: LayerDefence;
  index: number;
  nameOf: (slug: string) => string;
}) {
  const { layer, undefended } = d;
  const deps = (layer.depends_on ?? []).map(nameOf).filter(Boolean);

  return (
    <section className="card" style={{ borderColor: undefended ? "var(--status-warn)" : undefined }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <span className="mono muted" style={{ fontSize: 11 }}>
          {String(index + 1).padStart(2, "0")}
        </span>
        <h3 style={{ margin: 0 }}>{layer.name}</h3>
        {undefended && <span className="pill warn"><T id="site.platform.research.architecturepage.span-2" /></span>}
      </div>

      <p className="muted" style={{ margin: "8px 0 0", fontSize: 14 }}>
        {layer.one_line}
      </p>

      <div
        style={{
          marginTop: "var(--space-4)",
          paddingLeft: "var(--space-3)",
          borderLeft: "2px solid var(--accent)",
        }}
      >
        <div className="eyebrow"><T id="site.platform.research.architecturepage.div-1" /></div>
        <p style={{ margin: "4px 0 0", fontSize: 14, color: "var(--ink-soft)" }}>{layer.commitment}</p>
      </div>

      {/* The section that matters most gets the widest approach. */}
      <div style={{ marginTop: "var(--space-6)" }}>
        <div className="eyebrow">
          <T id="site.platform.research.architecturepage.div-2" v={{ defensibleCount: d.defensibleCount, entities: d.entities.length }} />
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: "var(--space-2)" }}>
          {d.entities.map((e) => (
            <EntityChip key={e.slug} productSlug={productSlug} e={e} />
          ))}
        </div>
      </div>

      {undefended && (
        <p
          style={{
            margin: "var(--space-4) 0 0",
            fontSize: 13,
            color: "var(--status-warn)",
            background: "var(--status-warn-bg)",
            padding: "var(--space-2) var(--space-3)",
            borderRadius: "var(--radius-sm)",
          }}
        >
          <T id="site.platform.research.architecturepage.p-1" c={[<strong />]} />
        </p>
      )}

      {deps.length > 0 && (
        <div
          style={{
            marginTop: "var(--space-3)",
            paddingTop: "var(--space-3)",
            borderTop: "1px solid var(--rule-soft)",
          }}
        >
          <span className="eyebrow"><T id="site.platform.research.architecturepage.span-3" /></span>{" "}
          <span className="mono muted" style={{ fontSize: 12 }}>
            {deps.join(" · ")}
          </span>
        </div>
      )}

      {layer.open_question && (
        <div style={{ marginTop: "var(--space-3)" }}>
          <div className="eyebrow"><T id="site.platform.research.architecturepage.div-3" /></div>
          <p className="muted" style={{ margin: "4px 0 0", fontSize: 13, fontStyle: "italic" }}>
            {layer.open_question}
          </p>
        </div>
      )}
    </section>
  );
}

/* ── The page ───────────────────────────────────────────────────────────────── */

export async function ArchitecturePage({ productSlug, view }: { productSlug: string; view: ViewName }) {
  const copy = COPY[view];
  const product = await getProduct(productSlug);
  const productName = product?.name ?? productSlug;

  if (!hasArchitecture(productSlug)) {
    return (
      <>
        <div className="eyebrow">{copy.eyebrow}</div>
        <h1 style={{ marginTop: 8 }}>{copy.title}</h1>
        <div className="card" style={{ marginTop: "var(--space-6)", maxWidth: 660 }}>
          <p className="muted" style={{ margin: 0 }}>
            <T id="site.platform.research.architecturepage.p-2" v={{ productName, productSlug }} c={[<code />, <code />]} />
          </p>
        </div>
      </>
    );
  }

  const defences = defencesFor(productSlug, view);

  if (!defences.length) {
    return (
      <>
        <div className="eyebrow">{copy.eyebrow}</div>
        <h1 style={{ marginTop: 8 }}>{copy.title}</h1>
        <div className="card" style={{ marginTop: "var(--space-6)", maxWidth: 660 }}>
          <p className="muted" style={{ margin: 0 }}>
            <T id="site.platform.research.architecturepage.p-3" v={{ productName, view }} c={[<code />, <code />]} />
          </p>
          <p style={{ margin: "var(--space-3) 0 0" }}>
            <Link className="wikilink" href={hrefFor(productSlug, copy.other)}>
              {copy.otherLabel}
            </Link>
          </p>
        </div>
      </>
    );
  }

  const nameOf = (slug: string) => defences.find((d) => d.layer.slug === slug)?.layer.name ?? slug;
  const undefended = defences.filter((d) => d.undefended);
  // Cards run in the diagram's order, not the file's, so a numbered box maps onto a
  // numbered card without the reader having to hunt for it.
  const cards = orderedDefences(view, defences);

  return (
    <>
      <div className="eyebrow">{copy.eyebrow}</div>
      <h1 style={{ marginTop: 8 }}>{copy.title}</h1>
      <p className="muted" style={{ maxWidth: 660, marginTop: 8, fontSize: 15 }}>
        {copy.lead}
      </p>

      <div style={{ display: "flex", gap: 12, marginTop: "var(--space-4)", flexWrap: "wrap" }}>
        <Link className="btn ghost" href={hrefFor(productSlug, copy.other)}>
          {copy.otherLabel}
        </Link>
        <Link className="btn ghost" href={`/${productSlug}/research`}>
          <T id="site.platform.research.architecturepage.link-1" />
        </Link>
      </div>

      <section className="card" style={{ marginTop: "var(--space-8)" }}>
        <div className="eyebrow">{copy.figure}</div>
        <div style={{ marginTop: "var(--space-3)", overflowX: "auto" }}>
          <ArchitectureDiagram view={view} defences={defences} />
        </div>
        <p className="muted" style={{ margin: "var(--space-4) 0 0", fontSize: 13, maxWidth: 760 }}>
          {view === "product" ? (
            <>
              <T id="site.platform.research.architecturepage.fragment-1" c={[<strong />, <strong />]} />
            </>
          ) : (
            <>
              <T id="site.platform.research.architecturepage.fragment-2" c={[<em />, <em />, <strong />]} />
            </>
          )}
        </p>
      </section>

      <section
        className="card"
        style={{
          marginTop: "var(--space-5)",
          borderColor: undefended.length ? "var(--status-warn)" : "var(--status-ok)",
        }}
      >
        <div
          className="eyebrow"
          style={{ color: undefended.length ? "var(--status-warn)" : "var(--status-ok)" }}
        >
          {undefended.length
            ? t("site.platform.research.architecturepage.div-4", { undefended: undefended.length, defences: defences.length })
            : t("site.platform.research.architecturepage.div-5", { defences: defences.length })}
        </div>
        <p className="muted" style={{ margin: "8px 0 0", fontSize: 14, maxWidth: 700 }}>
          {undefended.length ? (
            <>
              <T id="site.platform.research.architecturepage.fragment-3" v={{ undefended: undefended.map((d) => d.layer.name).join(", "), v: undefended.length === 1 ? t("site.platform.research.architecturepage.p-4") : t("site.platform.research.architecturepage.p-5") }} />
            </>
          ) : (
            <>
              <T id="site.platform.research.architecturepage.fragment-4" />
            </>
          )}
        </p>
      </section>

      <div className="grid" style={{ gap: "var(--space-4)", marginTop: "var(--space-8)" }}>
        {cards.map((d, i) => (
          <LayerCard key={d.layer.slug} productSlug={productSlug} d={d} index={i} nameOf={nameOf} />
        ))}
      </div>
    </>
  );
}
