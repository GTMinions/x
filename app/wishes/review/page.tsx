/**
 * /wishes/review — everything waiting on the person looking at it.
 *
 * WHY A PAGE AND NOT A FILTER ON THE BOARD
 * The board answers "what is happening"; this answers "what is stuck on me".
 * Those look similar and are not: a queue you are accountable for has to be
 * somewhere you can go directly, empty when it is empty, and reachable from one
 * link — otherwise reviewing depends on remembering to scroll a board that is
 * mostly other people's business. A pending wish is a person waiting on an
 * answer, and this is where that debt is visible.
 *
 * WHOSE QUEUE IT IS
 * `approvableScopes` — every scope this person administers, plus everything if
 * they are a site admin. A person who administers nothing gets a page saying
 * so, not a 404: the route is not a secret, and someone who was granted a role
 * a minute ago should see an empty queue rather than a missing page.
 *
 * WHY IT READS EVERY SCOPE IT MAY
 * One query per approvable scope, in parallel. That is bounded by how many
 * products a person administers, which is a small number, and it is the only
 * way to answer the question across databases that are deliberately separate.
 */
import type { Metadata } from "next";
import Link from "next/link";

import { SiteDockMount } from "@/app/_platform/SiteDockMount";
import { SiteChrome } from "@/app/_platform/SiteChrome";
import { SiteNav } from "@/app/_platform/SiteNav";
import { ReviewQueue, type PendingWish } from "@/app/_platform/ReviewQueue";
import { listWishes } from "@/app/_platform/wishes";
import { isClosed } from "@/app/_platform/wishes/stages";
import { getSession } from "@/app/lib/auth";
import { canDesign } from "@/app/lib/platform";
import { approvableScopes } from "@/app/lib/approval";
import { getProduct } from "@/app/lib/products";
import { T, t } from "@/app/_platform/copy";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: t("site.wishes.review.title-1"),
  description: t("site.wishes.review.description-1"),
};

const scopeName = async (slug: string) => (slug === "site" ? t("site.wishes.review.s-1") : (await getProduct(slug))?.name ?? slug);

export default async function ReviewPage() {
  const session = await getSession();
  const scopes = await approvableScopes(session?.email);

  const perScope = await Promise.all(scopes.map((s) => listWishes(s)));
  // Names are a registry read, so they are looked up once per scope, not per wish.
  const names = new Map(await Promise.all(scopes.map(async (s) => [s, await scopeName(s)] as const)));
  const pending: PendingWish[] = perScope
    .flat()
    .filter((w) => w.needsApproval && !isClosed(w.status))
    .sort((a, b) => b.id - a.id)
    .map((w) => ({
      id: w.id,
      scope: w.scope,
      scopeName: names.get(w.scope) ?? w.scope,
      title: w.title,
      body: w.body,
      nickname: w.nickname,
      createdAt: w.createdAt,
    }));

  return (
    <SiteChrome canDesign={await canDesign(session)} dock={<SiteDockMount canDesign={await canDesign(session)} />}>
      <SiteNav />
      <main className="wrap" style={{ padding: "var(--space-12) 0 var(--space-16)", maxWidth: "78ch" }}>
        <h1><T id="site.wishes.review.h1-1" /></h1>

        {!session ? (
          <p className="muted" style={{ marginTop: "var(--space-2)" }}>
            <T id="site.wishes.review.p-1" c={[<Link href="/sign-in" />]} />
          </p>
        ) : !scopes.length ? (
          <div className="card" style={{ marginTop: "var(--space-4)" }}>
            <p style={{ margin: 0 }}><T id="site.wishes.review.p-2" /></p>
            <p className="muted" style={{ margin: "6px 0 0", fontSize: 13.5 }}>
              <T id="site.wishes.review.p-3" c={[<Link href="/wishes" />]} />
            </p>
          </div>
        ) : (
          <>
            <p className="muted" style={{ marginTop: "var(--space-2)" }}>
              <T id="site.wishes.review.p-6" v={{ pending: pending.length
                ? t("site.wishes.review.p-4", { pending: pending.length, v: pending.length === 1 ? "" : "es" })
                : t("site.wishes.review.p-5"), scopes: scopes.map(scopeName).join(", ") }} />
            </p>
            <p className="muted" style={{ marginTop: "var(--space-1)", fontSize: 13.5 }}>
              <T id="site.wishes.review.p-7" />
            </p>

            <div style={{ marginTop: "var(--space-6)" }}>
              <ReviewQueue wishes={pending} />
            </div>
          </>
        )}
      </main>
    </SiteChrome>
  );
}
