/** Teams settings — tenants that own products. */
import { SettingsShell } from "@/app/_platform/SettingsShell";
import { listTeams, listProducts } from "@/app/lib/products";
import { T, t as copyText } from "@/app/_platform/copy";

export default async function TeamsSettings() {
  const products = await listProducts();
  const teams = await listTeams();
  return (
    <SettingsShell active="/settings/teams">
      <h1><T id="site.settings.teams.h1-1" /></h1>
      <p className="muted" style={{ marginTop: 6 }}><T id="site.settings.teams.p-1" /></p>
      <div className="grid" style={{ marginTop: 24 }}>
        {teams.map((t) => {
          const owned = products.filter((p) => p.teamSlug === t.slug);
          return (
            <div key={t.slug} className="card">
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <strong>{t.name}</strong>
                <span className="mono muted" style={{ fontSize: 12 }}>/{t.slug}</span>
                <span className="pill"><T id="site.settings.teams.span-1" v={{ owned: owned.length, v: owned.length === 1 ? "" : "s" }} /></span>
              </div>
              <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
                {owned.map((p) => p.name).join(" · ") || copyText("site.settings.teams.div-1")}
              </div>
            </div>
          );
        })}
      </div>
    </SettingsShell>
  );
}
