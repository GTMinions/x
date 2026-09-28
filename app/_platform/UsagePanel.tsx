/**
 * The account's standing: tier, what the guarantee has left, storage.
 *
 * This used to render a credit balance. Credits are the pay-per-use layer that
 * is not live yet, and a meter for a currency nobody can spend reads as a bill
 * arriving for an unknown service — so the panel shows the model that IS live:
 * what the tier guarantees, and how much of today's (or this month's) guarantee
 * is already used.
 */
import Link from "next/link";

import { accountTier, standingFor, tierById } from "@/app/lib/tiers";
import { modeConfigured, stripeMode } from "@/app/lib/stripe";
import { allowanceFor } from "@/app/lib/usage";
import { T, t } from "@/app/_platform/copy";

/** Kilobytes until there are megabytes to show. */
const mb = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(/\.0$/, "")} MB` : `${Math.max(0, Math.round(n / 1e3))} KB`;

function Bar({ pct }: { pct: number }) {
  const tone = pct >= 100 ? "var(--danger, #b4232a)" : pct >= 80 ? "var(--warn, #a56a00)" : "var(--accent, #444)";
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.min(100, pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={t("site.platform.usagepanel.label-1", { pct })}
      style={{ height: 6, borderRadius: 999, background: "var(--surface-2, #eee)", overflow: "hidden" }}
    >
      <div style={{ width: `${Math.min(100, pct)}%`, height: "100%", background: tone }} />
    </div>
  );
}

export async function UsagePanel({ accountId, isAdmin }: { accountId: number; isAdmin: boolean }) {
  if (isAdmin) {
    return (
      <section className="card">
        <div className="eyebrow"><T id="site.platform.usagepanel.div-1" /></div>
        <p className="muted" style={{ margin: "6px 0 0", fontSize: 14 }}>
          <T id="site.platform.usagepanel.p-1" c={[<Link href="/settings/billing" />, <Link href="/get-started" />]} />
        </p>
      </section>
    );
  }

  const { tier: tierId, hasCard } = await accountTier(accountId);
  const [tier, standing, allowance] = await Promise.all([
    tierById(tierId),
    standingFor(accountId, tierId),
    allowanceFor(accountId, false),
  ]);
  const g = tier.guarantee;
  const needsCard = tier.requiresCard && !hasCard && modeConfigured(await stripeMode());

  // The guarantee line, in whichever period the tier promises.
  const period = g.perDay !== null ? "today" : g.perMonth !== null ? t("site.platform.usagepanel.period-1") : null;
  const used = g.perDay !== null ? standing.today : standing.month;
  const limit = g.perDay ?? g.perMonth;

  return (
    <section className="card">
      <div className="eyebrow"><T id="site.platform.usagepanel.div-2" /></div>

      <div style={{ display: "flex", alignItems: "baseline", gap: 10, margin: "6px 0 2px" }}>
        <strong style={{ fontSize: 18 }}>{tier.id === "unpriced" ? t("site.platform.usagepanel.strong-1") : tier.name}</strong>
        {tier.priceCents === 0 && tier.id !== "unpriced" ? (
          <Link href="/get-started" style={{ fontSize: 13 }}><T id="site.platform.usagepanel.link-1" /></Link>
        ) : null}
      </div>

      <p className="muted" style={{ margin: "0 0 var(--space-4)", fontSize: 14 }}>
        {limit !== null ? (
          <>
            <T id="site.platform.usagepanel.fragment-1" v={{ limit, v: limit === 1 ? t("site.platform.usagepanel.p-2") : t("site.platform.usagepanel.p-3"), period }} />
          </>
        ) : (
          <><T id="site.platform.usagepanel.fragment-2" /></>
        )}
      </p>

      <div style={{ display: "grid", gap: "var(--space-4)" }}>
        {limit !== null ? (
          <div style={{ display: "grid", gap: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5 }}>
              <span><T id="site.platform.usagepanel.span-1" v={{ period }} /></span>
              <span className="muted"><T id="site.platform.usagepanel.span-2" v={{ used, limit }} /></span>
            </div>
            <Bar pct={limit ? Math.round((used / limit) * 100) : 0} />
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              <T id="site.platform.usagepanel.p-4" />
            </p>
          </div>
        ) : null}

        <div style={{ display: "grid", gap: 6 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5 }}>
            <span><T id="site.platform.usagepanel.span-3" /></span>
            <span className="muted"><T id="site.platform.usagepanel.span-4" v={{ mb: mb(allowance.bytes.used), mb2: mb(allowance.bytes.limit) }} /></span>
          </div>
          <Bar pct={allowance.bytes.pct} />
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            <T id="site.platform.usagepanel.p-5" />
          </p>
        </div>
      </div>

      {needsCard ? (
        <p style={{ margin: "var(--space-4) 0 0", fontSize: 13.5 }}>
          <T id="site.platform.usagepanel.p-6" c={[<strong />, <Link href="/get-started" />]} />
        </p>
      ) : null}
    </section>
  );
}
