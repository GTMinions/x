"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Wand2 } from "lucide-react";
import { useDesignMode } from "./design/DesignModeContext";
import { ProfileMenu } from "./ProfileMenu";
import { settingsSection } from "./profileSections";
import { DeployLight } from "./DeployLight";
import { useCopy } from "@/app/_platform/copy/client";

export type Tab = { key: string; label: string; href?: string };

/**
 * Product top nav — the dark bar every product carries. Brand + accent dot on
 * the left, tabs in the middle, and a "meta" cluster on the right: the deploy
 * light, the Design Mode toggle, and a profile avatar.
 *
 * The Design toggle is gated on `canDesign`, so for most signed-in readers that
 * cluster is the deploy light and the avatar. See ProductChrome for why it is
 * owner-only.
 */
export function ProductTopNav({
  slug, name, accent, tabs, nickname, email, signedIn, canDesign,
}: {
  slug: string; name: string; accent: string; tabs: Tab[]; nickname?: string; email?: string; signedIn?: boolean; canDesign?: boolean;
}) {
  const { T, t: copyText } = useCopy();
  const pathname = usePathname();
  const { on, toggle } = useDesignMode();
  const seg = pathname.startsWith(`/${slug}`) ? pathname.slice(slug.length + 1).split("/").filter(Boolean)[0] ?? "" : "";

  return (
    <header
      style={{
        position: "sticky", top: 0, zIndex: 50, display: "flex", alignItems: "center", gap: 16,
        height: 52, padding: "0 20px", background: "var(--nav-bg)", color: "var(--nav-ink)",
        borderBottom: "1px solid var(--nav-rule)", fontFamily: "var(--font-sans)",
      }}
    >
      <Link href="/" style={{ color: "var(--nav-ink-faded)", fontFamily: "var(--font-mono)", fontSize: 12, textDecoration: "none" }}>x</Link>
      <span style={{ color: "var(--nav-ink-mute)" }}>/</span>
      <Link href={`/${slug}`} style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "var(--nav-ink)", fontWeight: 700, fontSize: 14, letterSpacing: "-0.01em", textDecoration: "none" }}>
        <span style={{ width: 9, height: 9, borderRadius: 3, background: accent }} />
        {name}
      </Link>

      <nav style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: 8 }}>
        {tabs.map((t) => {
          const href = t.href ?? (t.key ? `/${slug}/${t.key}` : `/${slug}`);
          const active = seg === t.key;
          return (
            <Link
              key={t.key}
              href={href}
              style={{
                padding: "6px 10px", borderRadius: 7, fontSize: 13, textDecoration: "none",
                color: active ? "var(--nav-ink)" : "var(--nav-ink-soft)",
                background: active ? "var(--nav-hover)" : "transparent",
              }}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>

      <span style={{ flex: 1 }} />

      <DeployLight />

      {canDesign && (
      <button
        onClick={toggle}
        title={copyText("site.platform.producttopnav.title-1")}
        style={{
          display: "inline-flex", alignItems: "center", gap: 6, height: 30, padding: "0 12px",
          borderRadius: 8, cursor: "pointer", fontSize: 12.5, fontWeight: 600,
          border: on ? "1px solid var(--status-ok)" : "1px solid var(--nav-active)",
          background: on ? "var(--status-ok)" : "transparent", color: "var(--nav-ink)",
        }}
      >
        <T id="site.platform.producttopnav.button-2" v={{ v: on ? copyText("site.platform.producttopnav.button-1") : "" }} c={[<Wand2 size={14} />]} />
      </button>
      )}

      <span style={{ width: 1, height: 20, background: "var(--nav-rule)" }} />

      <ProfileMenu
        name={nickname || copyText("site.platform.producttopnav.profilemenu-1")}
        email={email || copyText("site.platform.producttopnav.profilemenu-2")}
        accent={accent}
        signedIn={signedIn}
        sections={[
          {
            items: [
              { href: `/${slug}`, label: name, hint: copyText("site.platform.producttopnav.hint-1") },
              { href: `/${slug}/workspace`, label: copyText("site.platform.producttopnav.label-1") },
              { href: "/", label: copyText("site.platform.producttopnav.label-2"), hint: copyText("site.platform.producttopnav.hint-2") },
            ],
          },
          settingsSection(),
        ]}
      />
    </header>
  );
}
