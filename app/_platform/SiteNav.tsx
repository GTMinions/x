/**
 * SiteNav — the platform (site-level) top nav, shown on non-product pages like the
 * landing directory and the Settings tree. Server component so it can read the session
 * for the profile menu.
 *
 * The bar is the site's signature: charcoal surface, bone type, mono labels. Nothing in
 * it is coloured. The Sign in button used to be ember, which put a saturated brand hue
 * in the one piece of chrome that appears above every product's own accent; it is bone
 * on charcoal now, and the frame spends its one non-neutral on type.
 */
import Link from "next/link";
import { getSession, displayName } from "@/app/lib/auth";
import { listProducts } from "@/app/lib/products";
import { approvableScopes } from "@/app/lib/approval";
import { ProfileMenu } from "./ProfileMenu";
import { settingsSection } from "./profileSections";
import { T, t } from "@/app/_platform/copy";

const LINK: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 12,
  letterSpacing: "0.02em",
  color: "var(--nav-ink-soft)",
  textDecoration: "none",
  padding: "8px 11px",
};

export async function SiteNav() {
  const session = await getSession();
  const products = await listProducts();
  // Only reviewers get the link. For everyone else it would be a door onto a page that
  // can only ever say "nothing waits on you".
  const reviews = session ? (await approvableScopes(session.email)).length > 0 : false;

  const sections = [
    {
      items: [
        { href: "/dashboard", label: t("site.platform.sitenav.label-4"), hint: t("site.platform.sitenav.hint-4") },
        ...products.slice(0, 4).map((p) => ({ href: `/${p.slug}`, label: p.name, hint: p.tagline })),
        { href: "/wishes", label: t("site.platform.sitenav.label-5"), hint: t("site.platform.sitenav.hint-5") },
        { href: "/get-started", label: t("site.platform.sitenav.label-6"), hint: t("site.platform.sitenav.hint-6") },
        ...(reviews ? [{ href: "/wishes/review", label: t("site.platform.sitenav.label-7"), hint: t("site.platform.sitenav.hint-7") }] : []),
        { href: "/about", label: t("site.platform.sitenav.label-8"), hint: t("site.platform.sitenav.hint-8") },
      ],
    },
    settingsSection(),
  ];

  return (
    <header
      style={{
        position: "sticky", top: 0, zIndex: 50, display: "flex", alignItems: "center", gap: 18,
        height: 52, padding: "0 22px", background: "var(--nav-bg)", color: "var(--nav-ink)",
        borderBottom: "1px solid var(--nav-rule)", fontFamily: "var(--font-sans)",
        whiteSpace: "nowrap",
      }}
    >
      <Link href="/" style={{ display: "inline-flex", alignItems: "center", gap: 10, flexShrink: 0, color: "var(--nav-ink)", textDecoration: "none" }}>
        <span style={{ fontFamily: "var(--font-serif)", fontWeight: 700, fontSize: 21, lineHeight: 1, letterSpacing: "-0.01em" }}><T id="site.platform.sitenav.span-2" /></span>
        <span aria-hidden style={{ width: 1, height: 16, background: "var(--nav-rule)" }} />
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--nav-ink-faded)" }}>
          <T id="site.platform.sitenav.span-3" />
        </span>
      </Link>

      <span style={{ flex: 1 }} />

      <nav style={{ display: "inline-flex", alignItems: "center", gap: 2, flexShrink: 0 }}>
        <Link href="/" style={LINK}><T id="site.platform.sitenav.link-6" /></Link>
        <Link href="/wishes" style={LINK}><T id="site.platform.sitenav.link-7" /></Link>
        <Link href="/get-started" style={LINK}><T id="site.platform.sitenav.link-8" /></Link>
        {reviews && <Link href="/wishes/review" style={LINK}><T id="site.platform.sitenav.link-9" /></Link>}
        <Link href="/about" style={LINK}><T id="site.platform.sitenav.link-10" /></Link>
        {session && <Link href="/settings" style={LINK}><T id="site.platform.sitenav.link-11" /></Link>}
      </nav>

      <span aria-hidden style={{ width: 1, height: 20, background: "var(--nav-rule)", flexShrink: 0 }} />
      <ProfileMenu
        name={displayName(session)}
        email={session?.email || t("site.platform.sitenav.profilemenu-2")}
        accent="var(--accent)"
        signedIn={!!session}
        sections={sections}
      />
    </header>
  );
}
