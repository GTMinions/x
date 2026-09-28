/**
 * AgentPage — one agent's doctrine, rendered.
 *
 * The body of an agent file is not a bio. It is the system prompt the model reads
 * before it works: the bar it holds, the tables it grades against, the sections it
 * may rewrite when it learns something. Rendering it whole is the point — a
 * summary would be the one thing the reader cannot check.
 */
import React from "react";
import Link from "next/link";
import { loadSiteAgent, loadSiteOrg, type Agent, type Skill } from "./team";
import { Markdown, InlineMd } from "./markdown";
import { T, t } from "@/app/_platform/copy";

/** Scoped to `.md`, tokens only. Kept here so globals.css does not grow for one page. */
const DOCTRINE_CSS = t("site.platform.agentpage.doctrinecss-2");

/**
 * One agent of the platform org, at /about/<agent>. The org is the site's, so this
 * page takes no product: there is one roster, and every product inherits it.
 */
export function AgentPage({ agentSlug }: { agentSlug: string }) {
  const agent: Agent | null = loadSiteAgent(agentSlug);

  if (!agent) {
    return (
      <>
        <div className="eyebrow"><T id="site.platform.agentpage.div-6" /></div>
        <h1 style={{ marginTop: "var(--space-2)" }}><T id="site.platform.agentpage.h1-2" /></h1>
        <p className="muted" style={{ marginTop: "var(--space-2)", fontSize: 14 }}>
          <T id="site.platform.agentpage.p-2" v={{ agentSlug }} c={[<code />, <code />]} />
        </p>
        <p style={{ marginTop: "var(--space-4)" }}>
          <Link href="/about" className="btn ghost">
            <T id="site.platform.agentpage.link-3" />
          </Link>
        </p>
      </>
    );
  }

  const skills: Skill[] = loadSiteOrg().skills;
  const equipped = agent.skills
    .map((slug) => skills.find((s) => s.slug === slug))
    .filter((s): s is NonNullable<typeof s> => !!s);
  const file = t("site.platform.agentpage.file-2", { name: agent.name });

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: DOCTRINE_CSS }} />

      <div style={{ marginBottom: "var(--space-5)" }}>
        <Link href="/about" className="eyebrow" style={{ color: "var(--accent)" }}>
          <T id="site.platform.agentpage.link-4" />
        </Link>
      </div>

      <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-3)", flexWrap: "wrap" }}>
        <h1>{agent.persona ?? agent.name}</h1>
        <span style={{ fontSize: 16, color: "var(--ink-soft)" }}>{agent.role}</span>
      </div>

      {/* No model name here either — see the note on the roster card. */}
      <div className="eyebrow" style={{ marginTop: "var(--space-2)" }}>
        <T id="site.platform.agentpage.div-7" />
      </div>

      <p style={{ maxWidth: "var(--paper-measure)", marginTop: "var(--space-4)", fontSize: 14, lineHeight: 1.65, color: "var(--ink-soft)" }}>
        <InlineMd source={agent.description} />
      </p>

      <div
        style={{
          display: "grid",
          gap: "var(--space-4)",
          maxWidth: "var(--paper-measure)",
          marginTop: "var(--space-6)",
          padding: "var(--space-4) var(--space-5)",
          background: "var(--bg-sunk)",
          borderRadius: "var(--radius)",
        }}
      >
        <div>
          <div className="eyebrow"><T id="site.platform.agentpage.div-8" /></div>
          <code style={{ color: "var(--ink-soft)" }}>{file}</code>
        </div>

        {agent.tools && (
          <div>
            <div className="eyebrow"><T id="site.platform.agentpage.div-9" v={{ tools: agent.tools.length }} /></div>
            <div style={{ marginTop: "var(--space-1)", fontSize: 13, color: "var(--ink-soft)" }}>
              {agent.tools.join(", ")}
            </div>
          </div>
        )}

        {equipped.length > 0 && (
          <div>
            <div className="eyebrow" style={{ marginBottom: "var(--space-2)" }}>
              <T id="site.platform.agentpage.div-10" v={{ equipped: equipped.length }} />
            </div>
            <div style={{ display: "grid", gap: "var(--space-2)" }}>
              {equipped.map((s) => (
                <div key={s.slug} style={{ fontSize: 13, lineHeight: 1.5 }}>
                  <span className="pill" style={{ marginRight: "var(--space-2)" }}>
                    {s.slug}
                  </span>
                  <span style={{ color: "var(--ink-faded)" }}>
                    <InlineMd source={s.description} />
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div style={{ marginTop: "var(--space-10)" }}>
        <Markdown source={agent.body} />
      </div>
    </>
  );
}
