/**
 * ProductShell — the per-product layout wrapper (server). Sets the product
 * register (`data-shell="product"`) + accent, then hands off to ProductChrome
 * (client) which renders the black top nav, the viber bar, the Design Mode
 * overlay, and the page content. Every product page wraps itself in this.
 *
 * The `active` prop is accepted for backwards-compatibility but the nav now
 * derives the active tab from the pathname.
 */
import React from "react";
import Link from "next/link";
import { getProduct, PRODUCT_TABS } from "@/app/lib/products";
import { getSession, displayName, isSiteAdmin } from "@/app/lib/auth";
import { roleAtLeast } from "@/app/lib/memberships";
import { readProductOrDenial } from "@/app/lib/access";
import { canDesign } from "@/app/lib/platform";
import { ProductChrome } from "./ProductChrome";
import { T } from "@/app/_platform/copy";

export async function ProductShell({
  slug,
  active: _active,
  children,
  full,
}: {
  slug: string;
  active?: string;
  children: React.ReactNode;
  /** Full-bleed content under the product header (see ProductChrome). */
  full?: boolean;
}) {
  const session = await getSession();

  /**
   * The access gate, here because this is the one component every product page
   * wraps itself in — so a page cannot render a product's data without passing
   * through it.
   *
   * It returns BEFORE `children`, which matters: a page's body is a server
   * component that reads the product's database, and rendering it and then
   * hiding it would still have run the query. React would also have streamed
   * whatever it produced.
   */
  const access = await readProductOrDenial(session?.email, slug);
  if (!access.ok) return <ProductDenied slug={slug} denial={access} email={session?.email} />;

  const product = await getProduct(slug);
  const name = product?.name ?? slug;
  const accent = product?.accent ?? "#356a4d";
  const accentStyle = { ["--accent" as string]: accent } as React.CSSProperties;
  // Product settings shows only to someone who can change them: a product
  // admin, or a site admin. Everyone else would meet a locked page.
  const manages = !!session?.email && (isSiteAdmin(session) || (await roleAtLeast(session.email, "product", slug, "admin")));
  // A product without a research corpus has nothing to show under Research.
  const tabs = PRODUCT_TABS
    .filter((t) => t.key !== "research" || product?.hasResearch !== false)
    .filter((t) => !("manageOnly" in t && t.manageOnly) || manages)
    .map((t) => ({ key: t.key, label: t.label, href: "href" in t ? t.href(slug) : undefined }));

  return (
    <div data-shell="product" style={accentStyle}>
      <ProductChrome
        slug={slug}
        name={name}
        accent={accent}
        tabs={tabs}
        nickname={session ? displayName(session) : undefined}
        email={session?.email}
        signedIn={!!session}
        canDesign={await canDesign(session, slug)}
        full={full}
      >
        {children}
      </ProductChrome>
    </div>
  );
}

/**
 * The refusal.
 *
 * It says the product exists and that access is the missing piece, rather than
 * pretending to be a 404. Hiding existence would protect nothing — the
 * codebase is open source, so every slug is already public — while costing a
 * legitimate user the one thing they need to know: that there is someone to
 * ask. A dead end teaches people the site is broken; a locked door with a
 * label teaches them to knock.
 *
 * Deliberately renders WITHOUT ProductChrome. The chrome carries the product's
 * nav, accent and viber bar, all of which are that product's own material.
 */
function ProductDenied({
  slug,
  denial,
  email,
}: {
  slug: string;
  denial: { reason: "unknown" | "private"; product: { name: string; tagline: string } | null };
  email?: string;
}) {
  if (denial.reason === "unknown") {
    return (
      <main className="wrap" style={{ padding: "var(--space-10) 0" }}>
        <div className="card empty">
          <h1 style={{ fontSize: 22 }}><T id="site.platform.productshell.h1-1" v={{ slug }} /></h1>
          <p className="muted" style={{ margin: "var(--space-2) 0 0" }}>
            <Link href="/"><T id="site.platform.productshell.link-1" /></Link>
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="wrap" style={{ padding: "var(--space-10) 0" }}>
      <article className="card" style={{ display: "grid", gap: "var(--space-3)", maxWidth: "58ch" }}>
        <span className="eyebrow"><T id="site.platform.productshell.span-1" /></span>
        <h1 style={{ fontSize: 24 }}>{denial.product?.name ?? slug}</h1>
        <p className="muted" style={{ margin: 0 }}>
          <T id="site.platform.productshell.p-1" />
        </p>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          {email
            ? <><T id="site.platform.productshell.fragment-1" v={{ email }} c={[<span className="mono" />]} /></>
            : <><T id="site.platform.productshell.fragment-2" /></>}
        </p>
        <p style={{ margin: 0, fontSize: 13 }}>
          <Link href="/"><T id="site.platform.productshell.link-2" /></Link>
          {" · "}
          <Link href="/wishes"><T id="site.platform.productshell.link-3" /></Link>
        </p>
      </article>
    </main>
  );
}
