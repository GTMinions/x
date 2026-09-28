/**
 * /wishes — the platform's own board, and the way into every other one.
 *
 * This page used to be a different thing from a product's wishes page: it could
 * change a status and post a reply, and that was all. There was no way to file a
 * wish against the platform from the one page that exists to hold platform
 * wishes. So the site scope — where every cross-cutting ask belongs — was the
 * only scope you could not file into, and "wishes" meant one set of features here
 * and another set one click away.
 *
 * It renders the same `WishBoard` a product renders. Same compose, same comment,
 * same follow-up, same rank, same cancel, same receipt. The only thing this page
 * adds is `crossScope`, which lets a site admin switch the board to any product's
 * and act there — and that is a property of the admin, not a second product.
 */
import type { Metadata } from "next";
import { SiteDockMount } from "@/app/_platform/SiteDockMount";
import { SiteChrome } from "@/app/_platform/SiteChrome";
import { ProductUsage } from "@/app/_platform/wishes/ProductUsage";
import { getSession } from "@/app/lib/auth";
import { canDesign } from "@/app/lib/platform";
import { SiteNav } from "@/app/_platform/SiteNav";
import { WishBoard } from "@/app/_platform/WishBoard";
import { T, t } from "@/app/_platform/copy";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: t("site.wishes.title-1"),
  description: t("site.wishes.description-1"),
};

export default async function SiteWishes() {
  const session = await getSession();
  return (
    <SiteChrome canDesign={await canDesign(session)} dock={<SiteDockMount canDesign={await canDesign(session)} />}>
      <SiteNav />
      <main className="wrap" style={{ padding: "var(--space-12) 0 var(--space-16)" }}>
        <h1><T id="site.wishes.h1-1" /></h1>
        {/* This paragraph must not claim the wishes are kept anywhere. x runs with
            no secrets by default, and in that mode the board's own banner says a
            restart loses them — a promise here that contradicts the banner below
            it is the exact failure the banner exists to prevent. */}
        <p className="muted" style={{ marginTop: "var(--space-2)", maxWidth: "60ch" }}>
          <T id="site.wishes.p-1" />
        </p>

        <div style={{ marginTop: "var(--space-4)" }}>
          <ProductUsage scope="site" />
        </div>

        <div style={{ marginTop: "var(--space-8)" }}>
          <WishBoard scope="site" crossScope heading={t("site.wishes.heading-1")} />
        </div>
      </main>
    </SiteChrome>
  );
}
