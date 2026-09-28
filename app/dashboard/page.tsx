/**
 * The dashboard — a member's home.
 *
 * `/` redirects here once somebody has entered the product. It is the directory
 * of what THIS reader may open, not of what exists: `listProducts()` is the
 * registry and lists everything, and rendering that would advertise other
 * people's products to anybody who signed up.
 *
 * The pitch that used to sit above it moved to `/get-started`, where it belongs
 * — a member does not need to be sold to every time they open their home.
 */
import Link from "next/link";
import { listTeams } from "@/app/lib/products";
import { listableProducts } from "@/app/lib/access";
import { getSession } from "@/app/lib/auth";
import { readingSession } from "@/app/lib/impersonation";
import { canDesign } from "@/app/lib/platform";
import { SiteNav } from "@/app/_platform/SiteNav";
import { SiteDockMount } from "@/app/_platform/SiteDockMount";
import { SiteChrome } from "@/app/_platform/SiteChrome";
import { T, t as copyText } from "@/app/_platform/copy";


export default async function Home() {
  // Two sessions, on purpose. `session` is whose SCREEN this is — borrowed when
  // an admin is debugging. `real` is who is actually here, and it is what tool
  // access hangs off: borrowing a user's view must not take the admin's own
  // tools away, or they cannot get back out of it.
  const session = await readingSession();
  const real = await getSession();
  // The directory shows what THIS reader may open. `listProducts()` is the
  // registry and lists everything — rendering it here would advertise other
  // people's products to every visitor, which is the leak `visibility` was
  // always meant to close and never did.
  const products = await listableProducts(session?.email);
  const teams = await listTeams();
  const signedIn = !!session;

  return (
    <div>
      <SiteChrome canDesign={await canDesign(real)} dock={<SiteDockMount canDesign={await canDesign(real)} />}>
        <SiteNav />

      <main className="wrap" style={{ padding: "48px 24px 96px" }}>
        <div className="eyebrow"><T id="site.dashboard.div-1" /></div>
        <h1 style={{ marginTop: 10 }}><T id="site.dashboard.h2-2" /></h1>
        <p className="muted" style={{ fontSize: 14, marginBottom: 16 }}>
          {signedIn ? copyText("site.dashboard.p-3") : copyText("site.dashboard.p-4")}
        </p>
        <div className="grid cols-2">
          {products.map((p) => {
            const team = teams.find((t) => t.slug === p.teamSlug);
            return (
              <Link key={p.slug} href={signedIn ? `/${p.slug}` : "/sign-in"} className="card" style={{ display: "block" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: p.accent, display: "inline-block" }} />
                  <h3>{p.name}</h3>
                  {p.hasResearch && <span className="pill info"><T id="site.dashboard.span-1" /></span>}
                </div>
                <p className="muted" style={{ margin: "8px 0 12px", fontSize: 14 }}>{p.tagline}</p>
                <div className="mono muted" style={{ fontSize: 12 }}>
                  {team?.name} · {signedIn ? copyText("site.dashboard.div-2") : copyText("site.dashboard.div-3")}
                </div>
              </Link>
            );
          })}
        </div>
      </main>

      {/* AGPL §13: anyone interacting with this over a network must be offered the
          source of the version they are using. That obligation falls on whoever
          deploys it, so the link is part of the app rather than the README —
          a fork that changes the code inherits the duty along with the footer. */}
      <footer style={{ borderTop: "1px solid var(--rule)", marginTop: 24 }}>
        <div className="wrap muted" style={{ padding: "24px", fontSize: 13, display: "flex", gap: 16, flexWrap: "wrap" }}>
          <span>
            <T id="site.dashboard.span-2" c={[<a href="https://github.com/GTMinions/x/blob/main/LICENSE" />]} />
          </span>
          <a href="https://github.com/GTMinions/x"><T id="site.dashboard.a-1" /></a>
          <a href="https://github.com/GTMinions/x/blob/main/COMMERCIAL-LICENSE.md"><T id="site.dashboard.a-2" /></a>
          <Link href="/about"><T id="site.dashboard.link-4" /></Link>
        </div>
      </footer>
      </SiteChrome>
    </div>
  );
}
