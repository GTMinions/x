/** /about/<agent> — one platform agent's doctrine, rendered whole. */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSession } from "@/app/lib/auth";
import { canDesign } from "@/app/lib/platform";
import { SiteChrome } from "@/app/_platform/SiteChrome";
import { SiteDockMount } from "@/app/_platform/SiteDockMount";
import { SiteNav } from "@/app/_platform/SiteNav";
import { AgentPage } from "@/app/_platform/AgentPage";
import { loadSiteAgent, siteAgentSlugs } from "@/app/_platform/team";
import { t } from "@/app/_platform/copy";

export function generateStaticParams() {
  return siteAgentSlugs().map((agent) => ({ agent }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ agent: string }>;
}): Promise<Metadata> {
  const { agent } = await params;
  const a = loadSiteAgent(agent);
  if (!a) return { title: t("site.about.agent.title-1") };
  return { title: `${a.persona ?? a.name} · ${a.role} — x`, description: a.description };
}

export default async function Agent({ params }: { params: Promise<{ agent: string }> }) {
  const { agent } = await params;
  if (!loadSiteAgent(agent)) notFound();
  const design = await canDesign(await getSession());
  return (
    <SiteChrome canDesign={design} dock={<SiteDockMount canDesign={design} />}>
      <SiteNav />
      <main className="wrap" style={{ padding: "72px 24px 96px" }}>
        <AgentPage agentSlug={agent} />
      </main>
    </SiteChrome>
  );
}
