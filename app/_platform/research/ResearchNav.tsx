"use client";

/**
 * The research site's own navigation.
 *
 * The research site is several surfaces, not one, and until this existed only the
 * corpus was reachable: Sources and Evolvement had no inbound link from anywhere
 * and could be reached only by typing the URL. A page nobody can navigate to is a
 * page that does not exist, however well it renders.
 *
 * Competitors sits second because it is the surface a reader arrives wanting. It
 * is derived from the same entities as Corpus, so it costs the products nothing:
 * a product that files an entity as a peer gets a row in the comparison.
 *
 * It mounts in the product chrome rather than in each route, so a product that
 * adds a research surface gets the tab without editing anything, and an entity
 * page keeps the nav instead of stranding the reader at the bottom of a paper.
 *
 * Architecture carries a submenu because it is genuinely two views of one thing
 * (what the product does / how it is built) rather than two things — collapsing
 * them into sibling tabs would say they were unrelated, and promoting only one
 * would hide the other.
 */
import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ResearchSearch } from "./ResearchSearch";
import { useCopy } from "@/app/_platform/copy/client";

type Sub = { href: string; label: string; note: string };
type Item = { href: string; label: string; subs?: Sub[] };

// The labels are copy, so the list is built inside the component, where the
// copy hook is in scope. Ids are written out in full so the copy gate can see them.
function itemsFor(slug: string, t: (id: string) => string): Item[] {
  const r = `/${slug}/research`;
  return [
    { href: r, label: t("site.platform.research.researchnav.nav-1") },
    { href: `${r}/competitors`, label: t("site.platform.research.researchnav.nav-2") },
    {
      href: `${r}/architecture`,
      label: t("site.platform.research.researchnav.nav-3"),
      subs: [
        { href: `${r}/architecture`, label: t("site.platform.research.researchnav.nav-4"), note: t("site.platform.research.researchnav.nav-5") },
        { href: `${r}/architecture/technical`, label: t("site.platform.research.researchnav.nav-6"), note: t("site.platform.research.researchnav.nav-7") },
      ],
    },
    { href: `${r}/sources`, label: t("site.platform.research.researchnav.nav-8") },
    { href: `${r}/evolvement`, label: t("site.platform.research.researchnav.nav-9") },
  ];
}

export function ResearchNav({ slug }: { slug: string }) {
  const { t } = useCopy();
  const pathname = usePathname() ?? "";
  const [open, setOpen] = React.useState<string | null>(null);
  const root = `/${slug}/research`;

  // Only on the research site. An entity page is part of it; the roadmap is not.
  if (!pathname.startsWith(root)) return null;

  const items = itemsFor(slug, t);

  /**
   * The corpus tab owns every entity page too, so `/research/mcp` highlights
   * "Corpus" rather than nothing. Longest-prefix wins, so `/architecture/technical`
   * does not also light up a shorter sibling.
   */
  const activeHref = items
    .flatMap((i) => [i.href, ...(i.subs ?? []).map((s) => s.href)])
    .filter((h) => pathname === h || pathname.startsWith(h + "/"))
    .sort((a, b) => b.length - a.length)[0] ?? (pathname.startsWith(root) ? root : "");

  const isActive = (i: Item) =>
    activeHref === i.href || (i.subs ?? []).some((s) => s.href === activeHref);

  return (
    <nav
      aria-label={t("site.platform.research.researchnav.label-1")}
      onMouseLeave={() => setOpen(null)}
      style={{
        position: "sticky",
        top: 52, // clears the product top nav
        zIndex: 40,
        display: "flex",
        alignItems: "center",
        gap: "var(--space-1)",
        padding: "0 var(--space-6)",
        height: 40,
        background: "var(--bg-deep)",
        borderBottom: "1px solid var(--rule)",
        fontFamily: "var(--font-sans)",
      }}
    >
      {items.map((item) => {
        const active = isActive(item);
        const hasSubs = (item.subs?.length ?? 0) > 0;
        return (
          <div
            key={item.href}
            style={{ position: "relative" }}
            onMouseEnter={() => hasSubs && setOpen(item.href)}
          >
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              aria-expanded={hasSubs ? open === item.href : undefined}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "5px var(--space-3)",
                borderRadius: "var(--radius-sm)",
                fontSize: 13,
                fontWeight: active ? 600 : 400,
                color: active ? "var(--accent)" : "var(--ink-soft)",
                background: active ? "var(--accent-bg)" : "transparent",
              }}
            >
              {item.label}
              {hasSubs && (
                <span className="mono" style={{ fontSize: 9, color: "var(--ink-mute)" }}>
                  ▾
                </span>
              )}
            </Link>

            {hasSubs && open === item.href && (
              <div
                style={{
                  position: "absolute",
                  top: "100%",
                  left: 0,
                  marginTop: 4,
                  minWidth: 236,
                  background: "var(--bg-card)",
                  border: "1px solid var(--rule)",
                  borderRadius: "var(--radius)",
                  boxShadow: "var(--shadow-2)",
                  padding: "var(--space-1)",
                }}
              >
                {item.subs!.map((s) => (
                  <Link
                    key={s.href}
                    href={s.href}
                    onClick={() => setOpen(null)}
                    style={{
                      display: "block",
                      padding: "var(--space-2) var(--space-3)",
                      borderRadius: "var(--radius-sm)",
                      color: activeHref === s.href ? "var(--accent)" : "var(--ink)",
                      fontWeight: activeHref === s.href ? 600 : 400,
                      fontSize: 13,
                    }}
                  >
                    {s.label}
                    <div className="muted" style={{ fontSize: 11, fontWeight: 400, marginTop: 1 }}>
                      {s.note}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        );
      })}

      <ResearchSearch productSlug={slug} />
    </nav>
  );
}
