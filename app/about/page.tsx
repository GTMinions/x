/**
 * /about — the platform, and the org that builds it.
 *
 * The agents and skills are markdown files under `.claude/`. A model reads one as
 * its system prompt before it works. Until this page they were invisible: you
 * could read a research site without ever learning who wrote it, or on what bar.
 *
 * The column that earns the page is TRACE — what each agent puts on a page a
 * reader can open. A roster of personas is a bio wall. An agent whose output you
 * cannot go and check is decoration, and the honest move is to say so on its card
 * and count it in the header rather than write it a job description.
 */
import React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { SiteNav } from "@/app/_platform/SiteNav";
import { SiteDockMount } from "@/app/_platform/SiteDockMount";
import { SiteChrome } from "@/app/_platform/SiteChrome";
import { getSession } from "@/app/lib/auth";
import { canDesign } from "@/app/lib/platform";
import { InlineMd } from "@/app/_platform/markdown";
import { loadSiteOrg, loadProductOrg, type Agent, type Skill } from "@/app/_platform/team";
import { listProducts } from "@/app/lib/products";
import { T, t } from "@/app/_platform/copy";

/** Derived, like every other count on the page. A hard-coded 21 goes stale the day hr hires. */
export function generateMetadata(): Metadata {
  const { agents } = loadSiteOrg();
  return {
    title: t("site.about.title-1"),
    description: t("site.about.description-1", { agents: agents.length }),
  };
}

// ── grouping ─────────────────────────────────────────────────────────────────

type GroupKey = "research" | "product" | "engineering" | "craft" | "ops" | "unfiled";

const GROUPS: { key: GroupKey; label: string; blurb: string }[] = [
  { key: "research", label: t("site.about.label-1"), blurb: t("site.about.blurb-1") },
  { key: "product", label: t("site.about.label-2"), blurb: t("site.about.blurb-2") },
  { key: "engineering", label: t("site.about.label-3"), blurb: t("site.about.blurb-3") },
  { key: "craft", label: t("site.about.label-4"), blurb: t("site.about.blurb-4") },
  { key: "ops", label: t("site.about.label-5"), blurb: t("site.about.blurb-5") },
  { key: "unfiled", label: t("site.about.label-6"), blurb: t("site.about.blurb-6") },
];

/**
 * Which function an agent belongs to. Keyed on the file name because that is the
 * one stable identifier — a persona can be renamed, a role line reworded. An
 * agent added to `.claude/agents` and not added here shows up under Unfiled,
 * which is the truth about it rather than a guess.
 */
const FUNCTION: Record<string, GroupKey> = {
  researcher: "research",
  site: "engineering",
  product: "engineering",
  "critic-voice": "craft",
  "critic-visual": "craft",
};

const groupOf = (a: Agent): GroupKey => FUNCTION[a.slug] ?? "unfiled";

/** Equipped by this many roles or more, a skill belongs to the org rather than to a function. */
const SHARED_AT = 3;

// ── the trace ────────────────────────────────────────────────────────────────

type Link_ = { label: string; href: string };
/** `page` — you can open its output. `gate` — it ships nothing; it blocks. `none` — nothing renders from it. */
type Trace =
  | { kind: "page"; does: string; links: Link_[] }
  | { kind: "gate"; does: string }
  | { kind: "none"; why: string };

const TRACE: Record<string, Trace> = {
  researcher: {
    kind: "page",
    does: t("site.about.does-1"),
    links: [
      { label: t("site.about.label-7"), href: "/inference-economics" },
      { label: t("site.about.label-8"), href: "/inference-economics" },
    ],
  },
  site: {
    kind: "page",
    does: t("site.about.does-9"),
    links: [
      { label: t("site.about.label-17"), href: "/" },
      { label: t("site.about.label-18"), href: "/inference-economics" },
    ],
  },
  "critic-voice": {
    kind: "gate",
    does: t("site.about.does-11"),
  },
  "critic-visual": {
    kind: "gate",
    does: t("site.about.does-12"),
  },
};


const traceOf = (a: Agent): Trace =>
  TRACE[a.slug] ?? { kind: "none", why: t("site.about.why-10") };

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

// ── card ─────────────────────────────────────────────────────────────────────

/** The verdict, as an object rather than a caption. An agent with no page reads as absence at a glance. */
const VERDICT: Record<Trace["kind"], { pill: string; label: string }> = {
  page: { pill: t("site.about.pill-1"), label: "page" },
  gate: { pill: t("site.about.pill-2"), label: "gate" },
  none: { pill: t("site.about.pill-3"), label: t("site.about.label-19") },
};

/** The card shows a kit, not a catalogue. The full list is one click away, on the card's own link. */
const KIT_SHOWN = 4;

function AgentCard({ agent }: { agent: Agent }) {
  const trace = traceOf(agent);
  const verdict = VERDICT[trace.kind];
  const shown = agent.skills.slice(0, KIT_SHOWN);
  const rest = agent.skills.length - shown.length;

  return (
    <article
      className={trace.kind === "none" ? "card empty" : "card"}
      style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", alignSelf: "start" }}
    >
      <header>
        <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-2)", flexWrap: "wrap" }}>
          <h3>
            <Link href={`/about/${agent.slug}`} style={{ color: "var(--ink)", textDecoration: "none" }}>
              {agent.persona ?? agent.name}
            </Link>
          </h3>
          <span style={{ fontSize: 13, color: "var(--ink-soft)" }}>{agent.role}</span>
          <span style={{ flex: 1 }} />
          <span className={verdict.pill}>{verdict.label}</span>
        </div>
        {/* The roster is deliberately public — this org is part of the product,
            not a workshop showing through. What it does NOT print is the model
            each agent runs on: which one that is belongs to whoever deployed
            this, and differs between deployments. `model` stays in the
            frontmatter, where the runner needs it, and off the page. */}
        <div className="eyebrow" style={{ marginTop: "var(--space-1)" }}>
          {agent.name}
        </div>
      </header>

      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: "var(--ink-soft)" }}>
        <InlineMd source={agent.description} />
      </p>

      <div style={{ borderTop: "1px solid var(--rule-soft)", paddingTop: "var(--space-3)", fontSize: 14, lineHeight: 1.55 }}>
        {trace.kind === "none" ? (
          <p className="muted" style={{ margin: 0 }}>{trace.why}</p>
        ) : (
          <>
            <p style={{ margin: 0, color: "var(--ink-soft)" }}>{trace.does}</p>
            {trace.kind === "page" && (
              <div style={{ marginTop: "var(--space-2)", display: "flex", flexWrap: "wrap", gap: "var(--space-3)" }}>
                {trace.links.map((l) => (
                  <Link key={l.href} href={l.href} style={{ color: "var(--accent)", fontSize: 13 }}>
                    {l.label} →
                  </Link>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {agent.skills.length > 0 && (
        <div>
          <div className="eyebrow" style={{ marginBottom: "var(--space-2)" }}><T id="site.about.div-1" v={{ skills: agent.skills.length }} /></div>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "var(--space-2)" }}>
            {shown.map((s) => (
              <span key={s} className="pill">{s}</span>
            ))}
            {/* The card's only escape hatch. In --ink-faded it read as inert text,
                the same grey as the descriptions beside it. */}
            {rest > 0 && (
              <Link href={`/about/${agent.slug}`} className="mono" style={{ color: "var(--accent)" }}>
                +{rest}
              </Link>
            )}
          </div>
        </div>
      )}
    </article>
  );
}

// ── skills ───────────────────────────────────────────────────────────────────

type SkillBucket = GroupKey | "shared" | "unequipped";

/**
 * Where a skill files. Carried by three roles or more it is the org's, and pinning
 * it to whichever function holds the most copies would be an arbitrary answer to a
 * question that has a real one. Below that it files under the function that carries
 * it. Carried by nobody, it says so.
 */
function skillGroup(skill: Skill, agentGroup: Map<string, GroupKey>): SkillBucket {
  if (!skill.equippedBy.length) return "unequipped";
  if (skill.equippedBy.length >= SHARED_AT) return "shared";
  const tally = new Map<GroupKey, number>();
  for (const slug of skill.equippedBy) {
    const g = agentGroup.get(slug);
    if (g) tally.set(g, (tally.get(g) ?? 0) + 1);
  }
  let best: SkillBucket = "shared";
  let top = 0;
  for (const [g, n] of tally) if (n > top) { top = n; best = g; }
  return best;
}

function SkillBlock({ title, note, skills }: { title: string; note?: string; skills: Skill[] }) {
  if (!skills.length) return null;
  return (
    <div style={{ marginTop: "var(--space-8)" }}>
      <h3>
        {title}{" "}
        <span className="mono" style={{ color: "var(--ink-faded)", fontWeight: 400 }}>{skills.length}</span>
      </h3>
      {note && (
        <p className="muted" style={{ margin: "var(--space-1) 0 0", fontSize: 13, maxWidth: "var(--paper-measure)" }}>
          {note}
        </p>
      )}
      <div className="grid cols-2" style={{ rowGap: 0, columnGap: "var(--space-8)", marginTop: "var(--space-2)" }}>
        {skills.map((s) => (
          <div key={s.slug} style={{ padding: "var(--space-3) 0", borderTop: "1px solid var(--rule-soft)" }}>
            {/* .mono is 0.9em, so the row's anchor was rendering smaller than the body
                text under it. Weight carries the hierarchy the size was fighting. */}
            <div className="mono" style={{ color: "var(--ink)", fontWeight: 500 }}>{s.slug}</div>
            <div style={{ fontSize: 13, lineHeight: 1.5, color: "var(--ink-faded)", marginTop: "var(--space-1)" }}>
              <InlineMd source={s.description} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── page ─────────────────────────────────────────────────────────────────────

export default async function About() {
  const session = await getSession();
  const org = loadSiteOrg();
  const products = await listProducts();
  const owners = products
    .map((p) => ({ product: p, own: loadProductOrg(p.slug) }))
    .filter((o) => o.own.agents.length || o.own.skills.length);

  const agentGroup = new Map<string, GroupKey>(org.agents.map((a) => [a.slug, groupOf(a)]));
  const untraced = org.agents.filter((a) => traceOf(a).kind === "none").length;

  const skillsByGroup = new Map<SkillBucket, Skill[]>();
  for (const s of org.skills) {
    const g = skillGroup(s, agentGroup);
    if (!skillsByGroup.has(g)) skillsByGroup.set(g, []);
    skillsByGroup.get(g)!.push(s);
  }

  const counts: { label: string; n: number; warn?: boolean }[] = [
    { label: "agents", n: org.agents.length },
    { label: "skills", n: org.skills.length },
    { label: t("site.about.label-20"), n: org.memory.length },
    { label: "products", n: products.length },
    { label: t("site.about.label-21"), n: untraced, warn: untraced > 0 },
  ];

  return (
    <div>
      <SiteChrome canDesign={await canDesign(session)} dock={<SiteDockMount canDesign={await canDesign(session)} />}>
        <SiteNav />

      <main className="wrap" style={{ padding: "72px 24px 96px" }}>
        <div className="eyebrow"><T id="site.about.div-2" /></div>
        <h1 style={{ maxWidth: 680, marginTop: "var(--space-2)" }}><T id="site.about.h1-1" /></h1>

        <p className="paper-lede" style={{ marginTop: "var(--space-4)" }}>
          <T id="site.about.p-1" />
        </p>

        <p style={{ maxWidth: "var(--paper-measure)", marginTop: "var(--space-4)", fontSize: 14, lineHeight: 1.65, color: "var(--ink-soft)" }}>
          <T id="site.about.p-2" v={{ agents: org.agents.length, skills: org.skills.length, untraced }} />
        </p>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "var(--space-8)",
            marginTop: "var(--space-6)",
            padding: "var(--space-4) var(--space-5)",
            background: "var(--bg-sunk)",
            borderRadius: "var(--radius)",
          }}
        >
          {counts.map((c) => (
            <div key={c.label}>
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 22,
                  lineHeight: 1.12,
                  color: c.warn ? "var(--status-warn)" : "var(--ink)",
                }}
              >
                {c.n}
              </div>
              <div className="eyebrow" style={{ marginTop: "var(--space-1)", color: c.warn ? "var(--status-warn)" : undefined }}>
                {c.label}
              </div>
            </div>
          ))}
        </div>

        <section style={{ marginTop: "var(--space-16)" }}>
          <h2><T id="site.about.h2-1" /></h2>

          {/* The six functions are subsections of the roster, not peers of it. They carry
              an eyebrow and a rule, so the page's outline has three headings and not nine. */}
          {GROUPS.map((g) => {
            const members = org.agents.filter((a) => agentGroup.get(a.slug) === g.key);
            if (!members.length) return null;
            return (
              <div key={g.key} style={{ marginTop: "var(--space-10)" }}>
                <div style={{ borderTop: "1px solid var(--rule)", paddingTop: "var(--space-3)" }}>
                  <div className="eyebrow">
                    {g.label} · {members.length}
                  </div>
                  <p className="muted" style={{ margin: "var(--space-1) 0 var(--space-4)", fontSize: 13 }}>
                    {g.blurb}
                  </p>
                </div>
                <div className="grid cols-2">
                  {members.map((a) => (
                    <AgentCard key={a.slug} agent={a} />
                  ))}
                </div>
              </div>
            );
          })}
        </section>

        <section style={{ marginTop: "var(--space-16)" }}>
          <h2><T id="site.about.h2-2" /></h2>
          <p style={{ maxWidth: "var(--paper-measure)", marginTop: "var(--space-2)", fontSize: 14, lineHeight: 1.65, color: "var(--ink-soft)" }}>
            <T id="site.about.p-3" c={[<code />, <code />, <code />, <code />]} />
          </p>

          <div style={{ marginTop: "var(--space-6)", maxWidth: "var(--paper-wide)" }}>
            {owners.length === 0 ? (
              <p className="muted" style={{ fontSize: 13 }}><T id="site.about.p-4" /></p>
            ) : (
              owners.map(({ product, own }) => (
                <div key={product.slug} style={{ padding: "var(--space-4) 0", borderTop: "1px solid var(--rule-soft)" }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-3)", flexWrap: "wrap" }}>
                    <Link href={`/${product.slug}`} style={{ color: "var(--ink)", fontWeight: 600, fontSize: 16, textDecoration: "none" }}>
                      {product.name}
                    </Link>
                    <span className="mono" style={{ color: "var(--ink-faded)" }}>
                      <T id="site.about.span-1" v={{ slug: product.slug }} />
                    </span>
                  </div>
                  <p style={{ margin: "var(--space-2) 0 0", fontSize: 13, lineHeight: 1.55, color: "var(--ink-soft)" }}>
                    {count(own.agents.length, "agent")}, {count(own.skills.length, "skill")}.
                  </p>
                  <div style={{ marginTop: "var(--space-2)", display: "flex", flexWrap: "wrap", gap: "var(--space-2)" }}>
                    {own.agents.map((a) => (
                      <span key={`a-${a.slug}`} className="pill"><T id="site.about.span-2" v={{ name: a.name }} /></span>
                    ))}
                    {own.skills.map((s) => (
                      <span key={`s-${s.slug}`} className="pill"><T id="site.about.span-3" v={{ slug: s.slug }} /></span>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section style={{ marginTop: "var(--space-16)" }}>
          <h2><T id="site.about.h2-3" /></h2>
          <p style={{ margin: "var(--space-2) 0 0", maxWidth: "var(--paper-measure)", fontSize: 14, lineHeight: 1.65, color: "var(--ink-soft)" }}>
            <T id="site.about.p-5" v={{ skills: org.skills.length }} />
          </p>

          <SkillBlock
            title={t("site.about.title-2")}
            note={t("site.about.note-1", { SHARED_AT })}
            skills={skillsByGroup.get("shared") ?? []}
          />

          {GROUPS.map((g) => (
            <SkillBlock key={g.key} title={g.label} skills={skillsByGroup.get(g.key) ?? []} />
          ))}

          <SkillBlock
            title={t("site.about.title-3")}
            note={t("site.about.note-2")}
            skills={skillsByGroup.get("unequipped") ?? []}
          />
        </section>

        {org.memory.length > 0 && (
          <section style={{ marginTop: "var(--space-16)" }}>
            <h2><T id="site.about.h2-4" /></h2>
            <p style={{ margin: "var(--space-2) 0 0", maxWidth: "var(--paper-measure)", fontSize: 14, lineHeight: 1.65, color: "var(--ink-soft)" }}>
              <T id="site.about.p-6" v={{ memory: org.memory.length }} c={[<code />]} />
            </p>
            <div className="grid cols-2" style={{ rowGap: 0, columnGap: "var(--space-8)", marginTop: "var(--space-4)" }}>
              {org.memory.map((m) => (
                <div key={m.slug} style={{ padding: "var(--space-3) 0", borderTop: "1px solid var(--rule-soft)" }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>{m.name}</div>
                  <div style={{ fontSize: 13, lineHeight: 1.5, color: "var(--ink-faded)", marginTop: "var(--space-1)" }}>
                    <InlineMd source={m.description} />
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
      </SiteChrome>
    </div>
  );
}
