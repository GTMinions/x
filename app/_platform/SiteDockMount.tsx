/**
 * SiteDockMount — the server half of the dock.
 *
 * The payment mode and the admin scope can only be read on the server, and the dock is
 * a client component because Design Mode is client state. This reads the two facts and
 * hands them down; `SiteChrome` wraps it in `<Suspense fallback={null}>` so a convenience
 * only admins see never delays anyone's first paint — the same rule `AdminBar` followed.
 *
 * A signed-out visitor gets nothing at all, not an empty dock: every segment in it is
 * either owner-only or a count of work on a platform they have not joined.
 */
import { Suspense } from "react";

import { getSession } from "@/app/lib/auth";
import { roleAtLeast } from "@/app/lib/memberships";
import { deployStatus } from "@/app/lib/deployment";
import { viewingAs } from "@/app/lib/impersonation";
import { modeConfigured, stripeModeDetail } from "@/app/lib/stripe";
import { SiteDock } from "./SiteDock";

export function SiteDockMount({ canDesign }: { canDesign?: boolean }) {
  return (
    <Suspense fallback={null}>
      <SiteDockResolved canDesign={canDesign} />
    </Suspense>
  );
}

async function SiteDockResolved({ canDesign }: { canDesign?: boolean }) {
  const session = await getSession();
  if (!session?.email) return null;

  let paymentMode: "live" | "test" | null = null;
  let paymentSiteMode: "live" | "test" | null = null;
  let paymentOverride = false;
  const isAdmin = await roleAtLeast(session.email, "site", "site", "admin");
  if (isAdmin && (modeConfigured("test") || modeConfigured("live"))) {
    const d = await stripeModeDetail();
    paymentMode = d.mode;
    paymentSiteMode = d.site;
    paymentOverride = d.source === "session";
  }
  const borrowed = isAdmin ? await viewingAs().catch(() => null) : null;
  // Never allowed to fail the dock: a status light that takes the toolbar down
  // is worse than no status light.
  const deploy = isAdmin ? await deployStatus().catch(() => null) : null;

  return (
    <SiteDock
      canDesign={canDesign}
      paymentMode={paymentMode}
      paymentSiteMode={paymentSiteMode}
      paymentOverride={paymentOverride}
      paymentSwitchable={modeConfigured("test") && modeConfigured("live")}
      isSiteAdmin={isAdmin}
      viewingAs={borrowed?.email ?? null}
      deploy={deploy}
    />
  );
}
