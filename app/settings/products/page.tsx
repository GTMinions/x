/** Products settings — manage and export each product. */
import Link from "next/link";
import { SettingsShell } from "@/app/_platform/SettingsShell";
import { listProducts, listTeams } from "@/app/lib/products";
import { T } from "@/app/_platform/copy";

export default async function ProductsSettings() {
  const products = await listProducts();
  const teams = await listTeams();
  return (
    <SettingsShell active="/settings/products">
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <h1><T id="site.settings.products.h1-1" /></h1>
        <span style={{ flex: 1 }} />
      </div>
      <p className="muted" style={{ marginTop: 6 }}><T id="site.settings.products.p-1" /></p>
      <div className="grid" style={{ marginTop: 24 }}>
        {products.map((p) => {
          const team = teams.find((t) => t.slug === p.teamSlug);
          return (
            <div key={p.slug} className="card" style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: p.accent, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <strong>{p.name}</strong>
                  <span className="mono muted" style={{ fontSize: 12 }}>/{p.slug}</span>
                  <span className={`pill ${p.status === "active" ? "ok" : ""}`}>{p.status}</span>
                  {p.hasResearch && <span className="pill info"><T id="site.settings.products.span-1" /></span>}
                </div>
                <div className="muted" style={{ fontSize: 13 }}>{p.tagline} · {team?.name}</div>
              </div>
              <Link className="btn ghost" href={`/${p.slug}`}><T id="site.settings.products.link-1" /></Link>
              <Link className="btn" href={`/settings/products/${p.slug}`}><T id="site.settings.products.link-2" /></Link>
            </div>
          );
        })}
      </div>
    </SettingsShell>
  );
}
