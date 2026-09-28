/** Product settings detail — meta, status, approval policy, members, workspace
 *  layout, and export (downloads + typed-export queue). */
import Link from "next/link";
import { notFound } from "next/navigation";
import { SettingsShell } from "@/app/_platform/SettingsShell";
import { MembersGrid } from "@/app/_platform/MembersGrid";
import { MetaForm, FreezeButton, WorkspaceLayout, ExportPanel } from "@/app/_platform/settings/ProductAdminWidgets";
import { getSession } from "@/app/lib/auth";
import { getProduct, getTeam } from "@/app/lib/products";
import {
  roleAtLeast, onboardToProduct, listMembers, membershipStoreInfo, getProductMeta,
  getWorkspaceLayout, listExportRequests, EXPORT_KINDS,
} from "@/app/lib/platform";
import { listWishes } from "@/app/_platform/wishes";
import { isClosed, stageCategory, stageLabel } from "@/app/_platform/wishes/stages";
import { T } from "@/app/_platform/copy";

export default async function ProductSettings({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const product = await getProduct(slug);
  if (!product) notFound();
  const session = await getSession();
  const email = session?.email;
  if (email) await onboardToProduct(email, slug);

  const canView = await roleAtLeast(email, "product", slug, "reader");
  const canEdit = await roleAtLeast(email, "product", slug, "editor");
  const canManage = await roleAtLeast(email, "product", slug, "admin");
  const members = await listMembers("product", slug);
  const meta = await getProductMeta(slug);
  const team = await getTeam(product.teamSlug);

  // The board this product's admin actually runs. Tolerant of the store being
  // down: the rest of the page is still useful without it.
  const wishes = canView ? await listWishes(slug).catch(() => []) : [];
  const open = wishes.filter((w) => !isClosed(w.status));
  const byStage = new Map<(typeof open)[number]["status"], number>();
  for (const w of open) byStage.set(w.status, (byStage.get(w.status) ?? 0) + 1);
  const waiting = open.filter((w) => w.needsApproval).length;
  const building = open.filter((w) => stageCategory(w.status) === "active").length;

  return (
    <SettingsShell active="/settings/products">
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ width: 12, height: 12, borderRadius: 3, background: product.accent }} />
        <h1>{product.name}</h1>
        <span className="mono muted">/{slug}</span>
        <FreezeButton slug={slug} status={meta.status} canManage={canManage} />
      </div>
      <p className="muted" style={{ marginTop: 6 }}>{product.tagline} · {team?.name}</p>

      {!canView ? (
        <div className="card" style={{ marginTop: 24 }}><p className="muted" style={{ margin: 0 }}><T id="site.settings.products.slug.p-3" /></p></div>
      ) : (
        <div className="grid" style={{ gap: 28, marginTop: 24 }}>
          {/* The numbers an admin checks daily, before the settings they check
              yearly. Each figure links into the board pre-filtered. */}
          <section className="card">
            <div className="eyebrow" style={{ marginBottom: 10 }}><T id="site.settings.products.slug.div-5" /></div>
            <div style={{ display: "flex", gap: 28, flexWrap: "wrap", alignItems: "baseline" }}>
              <Link href={`/wishes?scope=${slug}`} style={{ textDecoration: "none", color: "inherit" }}>
                <div style={{ fontSize: 30, fontWeight: 600 }}>{open.length}</div>
                <div className="muted" style={{ fontSize: 13 }}><T id="site.settings.products.slug.div-6" /></div>
              </Link>
              <Link href="/wishes/review" style={{ textDecoration: "none", color: waiting ? "var(--accent, inherit)" : "inherit" }}>
                <div style={{ fontSize: 30, fontWeight: 600 }}>{waiting}</div>
                <div className="muted" style={{ fontSize: 13 }}><T id="site.settings.products.slug.div-7" /></div>
              </Link>
              <div>
                <div style={{ fontSize: 30, fontWeight: 600 }}>{building}</div>
                <div className="muted" style={{ fontSize: 13 }}><T id="site.settings.products.slug.div-8" /></div>
              </div>
            </div>
            {open.length > 0 ? (
              <p className="muted" style={{ margin: "10px 0 0", fontSize: 13 }}>
                {[...byStage.entries()].map(([st, n2]) => `${stageLabel(st).toLowerCase()} ${n2}`).join(" · ")}
                {" — "}
                <Link href={`/wishes?scope=${slug}`}><T id="site.settings.products.slug.link-1" /></Link>
              </p>
            ) : (
              <p className="muted" style={{ margin: "10px 0 0", fontSize: 13 }}>
                <T id="site.settings.products.slug.p-4" v={{ name: product.name }} />
              </p>
            )}
          </section>

          <section><MembersGrid scopeType="product" scopeId={slug} members={members} canManage={canManage} store={membershipStoreInfo()} /></section>

          <section className="card">
            <div className="eyebrow" style={{ marginBottom: 10 }}><T id="site.settings.products.slug.div-9" /></div>
            <MetaForm slug={slug} prdUrl={meta.prdUrl ?? ""} figmaUrl={meta.figmaUrl ?? ""} canEdit={canEdit} />
          </section>

          {/* Not a setting any more. Approval follows from who is asking
              (app/lib/approval.ts), so there is no mode to choose — only the
              rule, said plainly, and the queue it feeds. */}
          <section className="card">
            <div className="eyebrow" style={{ marginBottom: 10 }}><T id="site.settings.products.slug.div-10" /></div>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6 }}>
              <T id="site.settings.products.slug.p-5" v={{ name: product.name }} />
            </p>
            <p className="muted" style={{ margin: "8px 0 0", fontSize: 13.5 }}>
              {canManage ? (
                <><T id="site.settings.products.slug.fragment-1" c={[<Link href="/wishes/review" />]} /></>
              ) : (
                <><T id="site.settings.products.slug.fragment-2" /></>
              )}
            </p>
          </section>

          <section>
            <div className="eyebrow" style={{ marginBottom: 8 }}><T id="site.settings.products.slug.div-11" /></div>
            <WorkspaceLayout slug={slug} rows={getWorkspaceLayout(slug)} canEdit={canEdit} />
          </section>

          <section className="card">
            <div className="eyebrow" style={{ marginBottom: 10 }}><T id="site.settings.products.slug.div-12" /></div>
            <ExportPanel slug={slug} kinds={[...EXPORT_KINDS]} requests={listExportRequests(slug)} />
          </section>
        </div>
      )}
    </SettingsShell>
  );
}
