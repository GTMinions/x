/**
 * /wishes/<id> — one site-scope wish, with its thread and its token receipt.
 * The product wishlist already links here for site-scope wishes; before this
 * route existed that link 404'd.
 */
import { getSession } from "@/app/lib/auth";
import { canDesign } from "@/app/lib/platform";
import { SiteChrome } from "@/app/_platform/SiteChrome";
import { SiteDockMount } from "@/app/_platform/SiteDockMount";
import { SiteNav } from "@/app/_platform/SiteNav";
import { WishDetail } from "@/app/_platform/WishDetail";

export const dynamic = "force-dynamic";

export default async function SiteWishPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const design = await canDesign(await getSession());
  return (
    <SiteChrome canDesign={design} dock={<SiteDockMount canDesign={design} />}>
      <SiteNav />
      <main className="wrap" style={{ padding: "48px 24px 96px" }}>
        <WishDetail id={Number(id)} scope="site" backHref="/wishes" />
      </main>
    </SiteChrome>
  );
}
