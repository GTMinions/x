/**
 * SettingsShell — the platform Settings chrome: the site nav on top, a left rail
 * of scopes (Overview · Site · Products · Teams · Workspaces), and the routed
 * content. Mirrors the site → team → product → workspace scope hierarchy.
 */
import Link from "next/link";
import { SiteNav } from "./SiteNav";
import { SiteDockMount } from "./SiteDockMount";
import { T, t } from "@/app/_platform/copy";

const NAV = [
  { href: "/settings", label: t("site.platform.settingsshell.label-7") },
  { href: "/settings/site", label: t("site.platform.settingsshell.label-8") },
  { href: "/settings/teams", label: t("site.platform.settingsshell.label-9") },
  { href: "/settings/products", label: t("site.platform.settingsshell.label-10") },
  { href: "/settings/workspaces", label: t("site.platform.settingsshell.label-11") },
  { href: "/settings/billing", label: t("site.platform.settingsshell.label-12") },
];

export function SettingsShell({ active, children }: { active: string; children: React.ReactNode }) {
  return (
    <div>
      <SiteNav />
      <div className="wrap" style={{ display: "flex", gap: 32, padding: "32px 24px 80px", alignItems: "start" }}>
        <nav style={{ width: 176, flexShrink: 0, display: "grid", gap: 2, position: "sticky", top: 76 }}>
          <div className="eyebrow" style={{ padding: "0 10px 8px" }}><T id="site.platform.settingsshell.div-2" /></div>
          {NAV.map((n) => {
            const on = active === n.href;
            return (
              <Link
                key={n.href}
                href={n.href}
                style={{
                  padding: "8px 10px", borderRadius: 8, fontSize: 13.5,
                  color: on ? "var(--ink)" : "var(--ink-faded)",
                  background: on ? "var(--bg-sunk)" : "transparent",
                  fontWeight: on ? 600 : 400,
                }}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>
        <main style={{ flex: 1, minWidth: 0 }}>{children}</main>
      </div>
      {/* The operator dock, same as every site-chrome page. Settings is where the
          site-wide payment switch lives, and the dock's chip is the per-browser
          one — the two have to be visible together or the second cannot be found. */}
      <SiteDockMount />
    </div>
  );
}
