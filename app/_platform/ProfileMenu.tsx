"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, LogOut, LogIn } from "lucide-react";
import { useCopy } from "@/app/_platform/copy/client";

type LinkItem = { href: string; label: string; hint?: string; external?: boolean };
type Section = { label?: string; items: LinkItem[] };

/**
 * Profile dropdown — the avatar button + menu shared by the site nav and the
 * product nav. Shows identity, grouped links (context + Settings), and sign
 * in/out. Sign-in is this app's own (`/sign-in`). With no session there is no
 * avatar at all — a lettered circle reads as "somebody is signed in" (the "G"
 * of Guest was taken for a Google account more than once) — just a Sign in
 * button that brings the person back to the page they were on.
 */
export function ProfileMenu({
  name, email, accent = "#356a4d", sections, signedIn = false,
}: {
  name: string; email: string; accent?: string; sections: Section[]; signedIn?: boolean;
}) {
  const { T, t } = useCopy();
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const initial = (name || email || "?").trim().slice(0, 1).toUpperCase();

  if (!signedIn) {
    const next = pathname && pathname !== "/" && !pathname.startsWith("/sign-in") ? `?next=${encodeURIComponent(pathname)}` : "";
    return (
      <Link
        href={`/sign-in${next}`}
        style={{
          display: "inline-flex", alignItems: "center", gap: 6, flexShrink: 0,
          padding: "7px 14px", borderRadius: "var(--radius-sm)",
          background: "var(--nav-ink)", color: "var(--nav-bg)", fontSize: 13, fontWeight: 600, textDecoration: "none", whiteSpace: "nowrap",
        }}
      >
        <T id="site.platform.profilemenu.link-1" c={[<LogIn size={14} />]} />
      </Link>
    );
  }

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={t("site.platform.profilemenu.label-1")}
        style={{
          width: 30, height: 30, borderRadius: "50%", border: "1px solid rgba(255,255,255,0.2)",
          cursor: "pointer", background: `linear-gradient(135deg, ${accent}, #ffffff55)`,
          color: "#fff", fontSize: 12.5, fontWeight: 700, display: "grid", placeItems: "center",
        }}
      >
        {initial}
      </button>

      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 60 }} />
          <div
            style={{
              position: "absolute", top: "calc(100% + 8px)", right: 0, zIndex: 70, width: 244,
              background: "var(--bg-card)", color: "var(--ink)", border: "1px solid var(--rule)",
              borderRadius: 12, boxShadow: "var(--shadow-3)", overflow: "hidden",
              fontFamily: "var(--font-sans)",
            }}
          >
            <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--rule)" }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</div>
              <div className="muted" style={{ fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{email}</div>
            </div>
            {sections.map((section, si) => (
              <div key={si} style={{ padding: "6px 0", borderTop: si ? "1px solid var(--rule)" : "none" }}>
                {section.label && (
                  <div className="eyebrow" style={{ padding: "6px 16px 2px", fontSize: 10 }}>{section.label}</div>
                )}
                {section.items.map((l) => {
                  const inner = (
                    <>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 500 }}>{l.label}</div>
                        {l.hint && <div className="muted" style={{ fontSize: 11 }}>{l.hint}</div>}
                      </div>
                      <ChevronRight size={14} style={{ color: "var(--ink-faded)" }} />
                    </>
                  );
                  const style: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, padding: "8px 16px", color: "var(--ink)", fontSize: 13 };
                  return l.external ? (
                    <a key={l.href + l.label} href={l.href} onClick={() => setOpen(false)} style={style}>{inner}</a>
                  ) : (
                    <Link key={l.href + l.label} href={l.href} onClick={() => setOpen(false)} style={style}>{inner}</Link>
                  );
                })}
              </div>
            ))}
            {signedIn ? (
              <form action="/api/auth/signout" method="post" style={{ margin: 0, borderTop: "1px solid var(--rule)" }}>
                <button type="submit" style={rowBtn}><T id="site.platform.profilemenu.button-1" c={[<LogOut size={14} style={{ color: "var(--ink-faded)" }} />]} /></button>
              </form>
            ) : (
              <Link href="/sign-in" onClick={() => setOpen(false)} style={{ ...rowBtn, borderTop: "1px solid var(--rule)", textDecoration: "none" }}>
                <T id="site.platform.profilemenu.link-1" c={[<LogIn size={14} style={{ color: "var(--ink-faded)" }} />]} />
              </Link>
            )}
          </div>
        </>
      )}
    </div>
  );
}

const rowBtn: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "10px 16px",
  background: "transparent", border: "none", cursor: "pointer", color: "var(--ink)",
  fontSize: 13, fontWeight: 500, textAlign: "left",
};
