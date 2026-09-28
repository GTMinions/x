/**
 * A research entity, rendered as a paper.
 *
 * The shape is the argument: abstract → background → mechanism → results →
 * discussion → limitations → conclusion → references. A reader who has read one
 * paper knows where to look for the thing they came for, and a page that follows
 * the convention needs no navigation instructions.
 *
 * Sections auto-omit when their content is absent, so an entity's depth is
 * legible from its silhouette. A stub is a short paper. A reference-grade entity
 * is a long one with figures, tables, and a reference list — and the difference
 * is visible before a word is read.
 *
 * All prose resolves [[pills]] and `**bold**` against the product's entity set. Two earlier
 * versions of this line claimed that and were wrong: section kickers, bullets, key_takeaways
 * and open_questions rendered raw, printing `**` and `[[slug]]` at the reader on 52 entities.
 * Two renderers make it true. `Prose` is for block prose and emits one <p> per paragraph;
 * `Inline` is for text already inside a <p> or an <li> and emits bare inline nodes. Putting
 * `Prose` where `Inline` belongs nests <p> in <p>, and the parser closes the outer tag — the
 * style then lands on an empty remnant and the text escapes it unstyled.
 */
import React from "react";
import Link from "next/link";
import { loadEntities, relationsFor } from "./engine";
import { ProseWithPills, renderInline } from "./pills";
import { DepthGate, StatusPill } from "./ui";
import { SectionDive } from "./SectionDive";
import { SlidesLink } from "../slides/SlidesLink";
import { ShareGenerate } from "./share/ShareGenerate";
import { Sections, PaperToc, PaperSection, Figure, Table, counter } from "./PaperShell";
import { rungFor } from "./depth";
import type { Rel, Section, Entity } from "./types";
import { T, t as copyText } from "@/app/_platform/copy";

const REL_LABEL: Record<Rel, string> = {
  uses: "uses",
  "depends-on": copyText("site.platform.research.entitypage.dependson-1"),
  "peer-of": copyText("site.platform.research.entitypage.peerof-1"),
  "cited-by": copyText("site.platform.research.entitypage.citedby-1"),
  "acquired-by": copyText("site.platform.research.entitypage.acquiredby-1"),
};

/**
 * A benchmark `values` cell keeps the numeric treatment (monospace, no wrap)
 * only when it is short enough to sit on one line as a figure. The same table
 * also carries qualitative comparison matrices whose cells are phrases rather
 * than numbers, like "AWS, Google Cloud (joint preview announcements)". Under
 * `td.num`'s `white-space: nowrap` a 400-character phrase becomes one unbreakable
 * mono line the table can only scroll past, so a value that reads as prose gets
 * the `prose` cell instead: body font, wrapping. The cutoff is by length (figures
 * in this corpus run under ~32 characters, phrases run longer), and it leaves
 * `td.num` alone so the cells that hold numbers keep their nowrap.
 */
function isTabularValue(v: string): boolean {
  return v.length <= 32;
}

type Dive = { productSlug: string; entitySlug: string; entityName: string };

/** The kicker is the claim; the bullets defend it. */
/**
 * A section's kicker and bullets.
 *
 * `render` is not optional, and that is the point: this component used to emit `{b}` — the
 * raw string — so a bullet carrying `**bold**` or a `[[pill]]` printed the asterisks and
 * the brackets to the reader. The file's own header claimed "all prose resolves [[pills]]"
 * while two of its prose fields did not, and the gap only surfaced when an argument long
 * enough to need emphasis was moved into a bullet. Taking the renderer as a required prop
 * means a future section cannot be added that quietly skips it.
 */
function SectionProse({ s, inline }: { s?: Section; inline: (text: string) => React.ReactNode }) {
  if (!s?.kicker && !s?.bullets?.length) return null;
  return (
    <>
      {s.kicker && <p style={{ fontWeight: 500 }}>{inline(s.kicker)}</p>}
      {s.bullets?.length ? (
        <ul>
          {s.bullets.map((b, i) => (
            <li key={i}>{inline(b)}</li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

export function EntityPage({ productSlug, slug }: { productSlug: string; slug: string }) {
  // One pass over the corpus — the slug set, the display names, and this entity
  // all come out of it. Resolving each cross-link with its own loadEntity() call
  // re-reads every file per link, which is quadratic in entity count.
  const entities = loadEntities(productSlug);
  const e = entities.find((x) => x.slug === slug);
  if (!e) {
    return (
      <div className="card">
        <p className="muted">
          <T id="site.platform.research.entitypage.p-1" v={{ slug }} c={[<code />]} />
        </p>
        <Link className="btn ghost" href={`/${productSlug}/research`}>
          <T id="site.platform.research.entitypage.link-1" />
        </Link>
      </div>
    );
  }

  const slugs = new Set(entities.map((x) => x.slug));
  const names = new Map(entities.map((x) => [x.slug, x.name] as const));
  const rel = relationsFor(productSlug, slug);
  const dive: Dive = { productSlug, entitySlug: e.slug, entityName: e.name };
  const isMoc = e.entity_kind === "moc";
  const rung = rungFor(e.depth_score);
  const num = counter();

  // Two renderers, and the difference is the reason a kicker lost its weight for a while.
  // `Prose` is for block prose and emits one <p> per paragraph. `Inline` is for the fields
  // that are ALREADY inside a <p> or an <li> — kickers, list items, the recommendation — and
  // emits bare inline nodes. Wrapping Inline's content in a <p> again nests <p> inside <p>,
  // which the HTML parser resolves by closing the outer one: the style then lands on an empty
  // remnant and the text escapes unstyled. Same class of bug as the one .paper-note fixes.
  const Prose = ({ text }: { text: string }) => (
    <ProseWithPills text={text} productSlug={productSlug} slugs={slugs} />
  );
  const Inline = ({ text }: { text: string }) => <>{renderInline(text, productSlug, slugs)}</>;

  const S = new Sections();

  // ── The map's own sections come first: a MOC argues before it explains. ──
  if (isMoc) {
    S.add(
      "thesis",
      "Thesis",
      e.thesis && (
        <p className="paper-lede">
          <Prose text={e.thesis} />
        </p>
      ),
    );
    S.add(
      "axes",
      "The axes",
      e.axes?.length ? (
        <>
          <p className="muted"><T id="site.platform.research.entitypage.p-2" /></p>
          {e.axes.map((a, i) => (
            <div key={i} style={{ marginTop: "var(--space-4)" }}>
              <h3>{a.name}</h3>
              <p style={{ margin: 0 }}>{a.question}</p>
              {a.note && (
                <p className="muted" style={{ margin: "var(--space-1) 0 0", fontSize: 13 }}>
                  <Inline text={a.note} />
                </p>
              )}
            </div>
          ))}
        </>
      ) : null,
    );
    S.add(
      "members",
      "The members",
      e.members?.length ? (
        <>
          {e.members.map((m, i) => (
            <div
              key={m.slug}
              style={{
                marginTop: "var(--space-5)",
                paddingTop: i === 0 ? 0 : "var(--space-4)",
                borderTop: i === 0 ? "none" : "1px solid var(--rule-soft)",
              }}
            >
              <h3>
                {slugs.has(m.slug) ? (
                  <Link href={`/${productSlug}/research/${m.slug}`} style={{ color: "var(--accent)" }}>
                    {names.get(m.slug) ?? m.slug}
                  </Link>
                ) : (
                  m.slug
                )}
              </h3>
              <p style={{ margin: "var(--space-1) 0 0" }}>
                <Prose text={m.claim} />
              </p>
              {m.primary_source?.url && (
                <p className="mono muted" style={{ margin: "var(--space-2) 0 0", fontSize: 11 }}>
                  <T id="site.platform.research.entitypage.p-3" v={{ label: m.primary_source.label || m.primary_source.url, date: m.primary_source.date && ` · ${m.primary_source.date}` }} c={[<a href={m.primary_source.url} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }} />]} />
                </p>
              )}
            </div>
          ))}
        </>
      ) : null,
    );
  }

  // ── 1. Introduction ──
  S.add("intro", isMoc ? "Scope" : "Introduction", e.summary && <p><Prose text={e.summary} /></p>);

  // ── 2. Where it fits ──
  S.add(
    "fits",
    "Where it fits",
    (e.positioning || (e.data_points && Object.keys(e.data_points).length > 0)) && (
      <>
        {e.positioning && (
          <p>
            <Prose text={e.positioning} />
          </p>
        )}
        {e.data_points && Object.keys(e.data_points).length > 0 && (
          <Table n={num.tab()} caption={copyText("site.platform.research.entitypage.caption-1", { name: e.name })}>
            <table className="paper-table">
              <tbody>
                {Object.entries(e.data_points).map(([k, v]) => (
                  <tr key={k}>
                    <td className="muted" style={{ width: "40%" }}>
                      {k}
                    </td>
                    <td className="num">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Table>
        )}
      </>
    ),
  );

  // ── 3. Background ──
  S.add("background", "Background", <SectionProse s={e.background} inline={(x) => <Inline text={x} />} />);

  // ── 4. Mechanism — the part that decides whether this is research or a summary ──
  const hasMechanism =
    e.architecture_summary || e.mechanism?.kicker || e.mechanism?.bullets?.length || e.components?.length || e.diagram_svg;
  S.add(
    "mechanism",
    "Mechanism",
    hasMechanism && (
      <>
        <SectionProse s={e.mechanism} inline={(x) => <Inline text={x} />} />
        {e.architecture_summary && (
          <p>
            <Prose text={e.architecture_summary} />
          </p>
        )}

        {e.diagram_svg && (
          <Figure n={num.fig()} caption={copyText("site.platform.research.entitypage.caption-2", { name: e.name })}>
            <div dangerouslySetInnerHTML={{ __html: e.diagram_svg }} />
          </Figure>
        )}

        {e.components?.map((c, i) => (
          <div key={i} style={{ marginTop: "var(--space-6)" }}>
            <h3>{c.name}</h3>
            {c.purpose && <p style={{ margin: "var(--space-1) 0 0" }}><Inline text={c.purpose} /></p>}

            {/* Each number carries its own receipt. A paragraph with one citation
                at the end and six numbers inside it is six unsourced numbers. */}
            {c.numbers?.length ? (
              <Table n={num.tab()} caption={copyText("site.platform.research.entitypage.caption-3", { name: c.name })}>
                <table className="paper-table">
                  <thead>
                    <tr>
                      <th><T id="site.platform.research.entitypage.th-1" /></th>
                      <th><T id="site.platform.research.entitypage.th-2" /></th>
                      <th><T id="site.platform.research.entitypage.th-3" /></th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.numbers.map((nu, j) => (
                      <tr key={j}>
                        <td>{nu.label}</td>
                        <td className="num">{nu.value}</td>
                        <td>
                          {nu.source ? (
                            <a
                              href={nu.source}
                              target="_blank"
                              rel="noreferrer"
                              className="mono"
                              style={{ fontSize: 11, color: "var(--accent)" }}
                            >
                              <T id="site.platform.research.entitypage.a-1" />
                            </a>
                          ) : (
                            <span className="mono muted" style={{ fontSize: 11 }}>
                              <T id="site.platform.research.entitypage.span-1" />
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Table>
            ) : null}

            {c.prior_art?.length ? (
              <>
                <p className="muted" style={{ margin: "var(--space-3) 0 0", fontSize: 13 }}>
                  <T id="site.platform.research.entitypage.p-4" />
                </p>
                <ul>
                  {c.prior_art.map((p, j) => (
                    <li key={j} style={{ fontSize: 13 }}>
                      <span className="mono">{p.name}</span>
                      {p.approach && <span className="muted"> — <Inline text={p.approach} /></span>}
                      {p.tradeoff && (
                        <div className="muted" style={{ fontSize: 12, marginTop: "var(--space-1)" }}>
                          <T id="site.platform.research.entitypage.div-1" c={[<Inline text={p.tradeoff} />]} />
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}

            {c.recommended && (
              <p style={{ margin: "var(--space-2) 0 0", fontSize: 13 }}>
                <span className="eyebrow"><T id="site.platform.research.entitypage.span-2" /></span> {c.recommended}
              </p>
            )}
          </div>
        ))}

        {e.formulas?.length ? (
          <div style={{ marginTop: "var(--space-6)" }}>
            {e.formulas.map((f, i) => (
              <div key={i} style={{ marginBottom: "var(--space-3)" }}>
                <h3>{f.name}</h3>
                <div
                  className="mono paper-formula"
                  style={{
                    background: "var(--bg-sunk)",
                    padding: "8px 12px",
                    borderRadius: "var(--radius-sm)",
                    margin: "4px 0",
                  }}
                >
                  {f.expr}
                </div>
                {f.note && (
                  <span className="muted" style={{ fontSize: 13 }}>
                    <Inline text={f.note} />
                  </span>
                )}
              </div>
            ))}
          </div>
        ) : null}
      </>
    ),
  );

  // ── 5. Results ──
  const hasResults = e.results?.kicker || e.results?.bullets?.length || e.benchmarks?.length;
  S.add(
    "results",
    "Results",
    hasResults && (
      <>
        <SectionProse s={e.results} inline={(x) => <Inline text={x} />} />
        {e.benchmarks?.map((b, i) =>
          b.values && Object.keys(b.values).length ? (
            <Table
              key={i}
              n={num.tab()}
              caption={b.metric}
              note={b.note ? <Prose text={b.note} /> : undefined}
            >
              <table className="paper-table">
                <tbody>
                  {Object.entries(b.values).map(([k, v]) => (
                    <tr key={k}>
                      <td className="muted" style={{ width: "50%" }}>
                        {k}
                      </td>
                      <td className={isTabularValue(String(v)) ? "num" : "prose"}>
                        <Inline text={String(v)} />
                      </td>
                    </tr>
                  ))}
                  {b.source && (
                    <tr>
                      <td className="muted"><T id="site.platform.research.entitypage.td-1" /></td>
                      <td>
                        {/^https?:\/\//.test(b.source) ? (
                          <a
                            href={b.source}
                            target="_blank"
                            rel="noreferrer"
                            className="mono"
                            style={{ fontSize: 11, color: "var(--accent)" }}
                          >
                            {b.source.replace(/^https?:\/\/(www\.)?/, "").slice(0, 44)} ↗
                          </a>
                        ) : (
                          // A non-URL source is a category or a description, not a link.
                          // Render it as plain muted text — never an <a href> pointing at a
                          // bogus relative path with a fake ↗ that reaches nothing.
                          <span
                            className="mono"
                            style={{ fontSize: 11, color: "var(--ink-faded)" }}
                          >
                            {b.source}
                          </span>
                        )}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </Table>
          ) : null,
        )}
      </>
    ),
  );

  // ── 6. Discussion, and the SWOT that belongs inside it ──
  const hasSwot = e.swot && Object.values(e.swot).some((v) => v?.length);
  S.add(
    "discussion",
    "Discussion",
    (e.discussion?.kicker || e.discussion?.bullets?.length || hasSwot) && (
      <>
        <SectionProse s={e.discussion} inline={(x) => <Inline text={x} />} />
        {hasSwot && (
          <div className="paper-wide" style={{ marginTop: "var(--space-5)" }}>
            <div className="grid cols-2">
              {(["strengths", "weaknesses", "opportunities", "threats"] as const).map((k) =>
                e.swot?.[k]?.length ? (
                  <div key={k}>
                    <div className="eyebrow">{k}</div>
                    <ul style={{ margin: "var(--space-2) 0 0", paddingLeft: "var(--space-5)" }}>
                      {e.swot[k]!.map((s, i) => (
                        <li key={i} style={{ fontSize: 13, marginBottom: "var(--space-1)" }}>
                          <Inline text={s} />
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null,
              )}
            </div>
          </div>
        )}
      </>
    ),
  );

  // ── 7. Limitations. What the page does not know is part of what it says. ──
  //
  // Retractions render FIRST and render loudest. A withdrawn claim that only a validator can
  // see is not withdrawn — it is hidden, which is strictly worse than the error, because the
  // page still reads as if it were sound. `retractions[]` exists so a gate can enforce the
  // withdrawal across the corpus; this block exists so the reader is told. Both, or neither.
  S.add(
    "limits",
    "Limitations and open questions",
    e.retractions?.length || e.open_questions?.length ? (
      <>
        {/* --status-bad, not --status-warn. Brass is bound across this corpus to stale and
            degraded — the caution register. A fabrication that has been withdrawn is not a
            caution, it is the terminal state, and the system already spends --status-bad on
            exactly that: .wikilink.dead, and the struck stale line on devmentor/comment-fix. */}
        {e.retractions?.map((r, i) => (
          <div
            key={i}
            className="card"
            style={{
              marginBottom: "var(--space-3)",
              borderLeft: "3px solid var(--status-bad)",
              background: "var(--status-bad-bg)",
              boxShadow: "none",
            }}
          >
            <div className="eyebrow" style={{ color: "var(--status-bad)" }}>
              <T id="site.platform.research.entitypage.div-2" v={{ on: r.on }} />
            </div>

            {/* The claim is the loudest thing in the block, not the quietest. It was struck AND
                muted in the first cut, which made the false line the faintest text on the page
                and the confession the largest — a retraction the reader skips is the failure
                this whole change exists to close. Strike it; do not whisper it. */}
            <p style={{ margin: "var(--space-2) 0 0", fontSize: 15, fontWeight: 600, lineHeight: 1.6, maxWidth: "var(--paper-measure)" }}>
              <s>
                <Inline text={r.claim} />
              </s>
            </p>

            {/* What is true now ranks with the withdrawal, not beneath the explanation of it:
                the reader's question is what to believe, not how we got it wrong. */}
            {r.replaces ? (
              <p style={{ margin: "var(--space-2) 0 0", fontSize: 15, fontWeight: 600, lineHeight: 1.6, maxWidth: "var(--paper-measure)" }}>
                <span className="mono muted" style={{ fontSize: 11, fontWeight: 400 }}><T id="site.platform.research.entitypage.span-3" /></span>
                <Inline text={r.replaces} />
              </p>
            ) : null}

            <p
              style={{
                margin: "var(--space-3) 0 0",
                fontSize: 13,
                lineHeight: 1.6,
                maxWidth: "var(--paper-measure)",
                color: "var(--ink-soft)",
              }}
            >
              <Inline text={r.why} />
            </p>
          </div>
        ))}
        {e.open_questions?.length ? (
          <ul>
            {e.open_questions.map((q, i) => (
              <li key={i}>
                <Inline text={q} />
              </li>
            ))}
          </ul>
        ) : null}
      </>
    ) : null,
  );

  // ── 8. Conclusion ──
  S.add(
    "conclusion",
    "Conclusion",
    (e.conclusion?.kicker || e.conclusion?.bullets?.length || e.recommendation || e.key_takeaways?.length) && (
      <>
        <SectionProse s={e.conclusion} inline={(x) => <Inline text={x} />} />
        {e.recommendation && (
          <p style={{ fontWeight: 500 }}>
            <Inline text={e.recommendation} />
          </p>
        )}
        {e.key_takeaways?.length ? (
          <ul>
            {e.key_takeaways.map((t, i) => (
              <li key={i}>
                <Inline text={t} />
              </li>
            ))}
          </ul>
        ) : null}
      </>
    ),
  );

  // ── What we looked at and chose not to add. A named omission is research. ──
  S.add(
    "not-added",
    "Looked at, not added",
    e.discovered_not_added?.length ? (
      <ul>
        {e.discovered_not_added.map((d, i) => (
          <li key={i}>
            <strong>{d.name}</strong> <span className="muted">— <Inline text={d.why_not} /></span>
          </li>
        ))}
      </ul>
    ) : null,
  );

  // ── 9. Related work — the graph, stated as prose would state it ──
  S.add(
    "related",
    "Related work",
    (rel.out.length || rel.in.length) && (
      <ul style={{ listStyle: "none", paddingLeft: 0 }}>
        {[...rel.out.map((r) => ({ r, dir: "out" as const })), ...rel.in.map((r) => ({ r, dir: "in" as const }))].map(
          ({ r, dir }, i) => {
            const other = dir === "out" ? r.to : r.from;
            return (
              <li key={i} style={{ marginBottom: "var(--space-2)" }}>
                <span className="mono muted" style={{ fontSize: 11 }}>
                  {dir === "out" ? `${REL_LABEL[r.rel]} →` : copyText("site.platform.research.entitypage.span-4", { REL_LABEL: REL_LABEL[r.rel] })}
                </span>{" "}
                <Link className="wikilink" href={`/${productSlug}/research/${other}`}>
                  {names.get(other) ?? other}
                </Link>
                {r.note && <span className="muted"> — <Inline text={r.note} /></span>}
              </li>
            );
          },
        )}
      </ul>
    ),
  );

  // ── 10. References ──
  S.add(
    "references",
    "References",
    e.citations?.length ? (
      <ol className="paper-refs">
        {e.citations.map((c, i) => (
          <li key={i}>
            <a href={c.url} target="_blank" rel="noreferrer">
              {c.label || c.url}
            </a>
            {c.date && <span className="date"> · {c.date}</span>}
          </li>
        ))}
      </ol>
    ) : null,
  );

  const sections = S.all;

  return (
    <div className="paper">
      <PaperToc sections={sections} />

      <article className="paper-body">
        <header>
          <Link className="muted mono" style={{ fontSize: 11 }} href={`/${productSlug}/research`}>
            <T id="site.platform.research.entitypage.link-2" />
          </Link>
          <h1 className="paper-title" style={{ marginTop: "var(--space-3)" }}>
            {e.name}
          </h1>
          {e.subtitle && (
            <p className="muted" style={{ maxWidth: "var(--paper-measure)", marginTop: "var(--space-2)" }}>
              {e.subtitle}
            </p>
          )}
          <div className="paper-byline">
            <span>
              {rung.label} · {e.depth_score}/10
            </span>
            <span><T id="site.platform.research.entitypage.span-5" v={{ last_updated: e.last_updated }} /></span>
            {e.citations?.length ? <span><T id="site.platform.research.entitypage.span-6" v={{ citations: e.citations.length }} /></span> : null}
            <StatusPill status={e.status} />
            {e.url && (
              <a style={{ color: "var(--accent)" }} href={e.url} target="_blank" rel="noreferrer">
                <T id="site.platform.research.entitypage.a-2" />
              </a>
            )}
            <SlidesLink slug={e.slug} productSlug={productSlug} />
            {/* Present renders the corpus as-is; Share asks the loop to re-cut it,
                so it files a wish rather than pretending a post can be a view. */}
            <ShareGenerate productSlug={productSlug} entitySlug={e.slug} entityName={e.name} />
          </div>
        </header>

        {/* The abstract. Set narrow and italic so its role is legible before it is read. */}
        {(e.abstract?.kicker || e.abstract?.bullets?.length) && (
          <div className="paper-abstract">
            {e.abstract?.kicker && (
              <p style={{ margin: 0 }}>
                <Inline text={e.abstract.kicker} />
              </p>
            )}
            {e.abstract?.bullets?.length ? (
              <ul style={{ margin: "var(--space-3) 0 0", paddingLeft: "var(--space-5)" }}>
                {e.abstract.bullets.map((b, i) => (
                  <li key={i} style={{ marginBottom: "var(--space-1)" }}>
                    <Inline text={b} />
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        )}

        <div style={{ marginTop: "var(--space-8)" }}>
          <DepthGate
            entity={e}
            inbound={rel.in.length}
            outbound={rel.out.length}
            membersBelowWorking={
              isMoc
                ? (e.members ?? []).filter((m) => (entities.find((x) => x.slug === m.slug)?.depth_score ?? 0) < 7).length
                : undefined
            }
          />
        </div>

        {sections.map((spec, i) => (
          <PaperSection
            key={spec.id}
            n={i + 1}
            spec={spec}
            aside={
              spec.id === "references" || spec.id === "related" ? undefined : (
                <SectionDive
                  productSlug={dive.productSlug}
                  entitySlug={dive.entitySlug}
                  entityName={dive.entityName}
                  section={spec.title}
                />
              )
            }
          />
        ))}
      </article>
    </div>
  );
}
