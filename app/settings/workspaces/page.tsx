/** Workspaces settings — the leaf scope, one per product. */
import Link from "next/link";
import { SettingsShell } from "@/app/_platform/SettingsShell";
import { listWorkspaces, listProducts } from "@/app/lib/products";
import { T } from "@/app/_platform/copy";

export default async function WorkspacesSettings() {
  const products = await listProducts();
  const workspaces = listWorkspaces(products);
  return (
    <SettingsShell active="/settings/workspaces">
      <h1><T id="site.settings.workspaces.h1-1" /></h1>
      <p className="muted" style={{ marginTop: 6 }}><T id="site.settings.workspaces.p-1" /></p>
      <div className="card" style={{ marginTop: 24, padding: 0 }}>
        {workspaces.map((w, i) => {
          const product = products.find((p) => p.slug === w.productSlug);
          return (
            <div key={`${w.productSlug}/${w.slug}`} style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 18px", borderTop: i ? "1px solid var(--rule)" : "none" }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: product?.accent ?? "var(--accent)", flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <strong>{w.name}</strong>
                <span className="mono muted" style={{ fontSize: 12, marginLeft: 8 }}>{w.productSlug}/{w.slug}</span>
              </div>
              <Link className="btn ghost" href={`/${w.productSlug}/workspace`}><T id="site.settings.workspaces.link-1" /></Link>
            </div>
          );
        })}
      </div>
    </SettingsShell>
  );
}
