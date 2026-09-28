"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Sparkles, ArrowRight } from "lucide-react";
import { useCopy } from "@/app/_platform/copy/client";

type Stats = { total: number; open: number; byRole: Record<"PM" | "UX" | "Eng", number> };

const ROLES: { key: "PM" | "UX" | "Eng"; hue: string }[] = [
  { key: "PM", hue: "#7c5cff" },
  { key: "UX", hue: "#e0699f" },
  { key: "Eng", hue: "var(--accent)" },
];

/**
 * ViberBar — the self-evolving strip under the product nav. Shipped-wish counts
 * by builder role for THIS product,
 * with a CTA into the wishlist. Fetches /api/wishes/stats?scope=<slug>.
 */
export function ViberBar({ slug }: { slug: string }) {
  const { T, t } = useCopy();
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/wishes/stats?scope=${encodeURIComponent(slug)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d && typeof d.total === "number") setStats(d as Stats); })
      .catch(() => {});
    return () => { alive = false; };
  }, [slug]);

  return (
    <div
      style={{
        flexShrink: 0, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap",
        padding: "7px 20px", background: "var(--accent-bg)", borderBottom: "1px solid var(--rule)", fontSize: 12,
      }}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: 7, color: "var(--ink-soft)", minWidth: 0, flex: "1 1 320px" }}>
        <Sparkles size={14} style={{ color: "var(--accent)", flexShrink: 0 }} />
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {slug === "site"
            ? t("site.platform.viberbar.span-1")
            : t("site.platform.viberbar.span-2")}
        </span>
      </span>

      {stats && (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          {ROLES.map((r) => (
            <span key={r.key} title={t("site.platform.viberbar.title-1", { byRole: stats.byRole[r.key], key: r.key })} style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "var(--ink-faded)" }}>
              <span style={{ width: 6, height: 6, borderRadius: 999, background: r.hue, flexShrink: 0 }} />
              <span style={{ fontWeight: 600, color: "var(--ink-soft)" }}>{r.key}</span>
              <span style={{ fontFamily: "var(--font-mono)", color: "var(--ink)" }}>{stats.byRole[r.key]}</span>
            </span>
          ))}
          <span style={{ color: "var(--ink-faded)" }}>·</span>
          {/* Open wishes were invisible: the bar counted only what had shipped, so a
              product with two live wishes and nothing done read as a flat row of zeros
              under a promise that wishes get built. Waiting work is the number a
              reader wants; shipped is the number that proves the promise. */}
          {stats.open > 0 && (
            <span style={{ display: "inline-flex", alignItems: "baseline", gap: 4, color: "var(--ink-faded)" }}>
              <T id="site.platform.viberbar.span-3" v={{ open: stats.open }} c={[<span style={{ fontWeight: 700, color: "var(--status-warn)", fontFamily: "var(--font-mono)" }} />]} />
            </span>
          )}
          <span style={{ display: "inline-flex", alignItems: "baseline", gap: 4, color: "var(--ink-faded)" }}>
            <T id="site.platform.viberbar.span-4" v={{ total: stats.total }} c={[<span style={{ fontWeight: 700, color: "var(--accent)", fontFamily: "var(--font-mono)" }} />]} />
          </span>
        </span>
      )}

      <Link href={slug === "site" ? "/wishes" : `/${slug}/wishes`} style={{ display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0, color: "var(--accent)", fontWeight: 600, textDecoration: "none" }}>
        <T id="site.platform.viberbar.link-1" c={[<ArrowRight size={12} />]} />
      </Link>
    </div>
  );
}
