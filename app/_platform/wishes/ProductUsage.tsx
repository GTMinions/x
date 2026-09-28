/**
 * ProductUsage — what the build loop has spent on this product, on its wishlist
 * (wish #20).
 *
 * The number comes from the same place the per-wish receipt reads: the run logs
 * in cronjobs/logs/, summed over every log whose `product` field names this
 * scope. Most logs kept no token record, and the strip says so — a total shown
 * without that caveat would read as the cost of everything when it is the cost
 * of the measured slice. When nothing was measured, it says that instead of
 * printing a zero that would read as "free".
 */
import { productUsage } from "./runs";
import { T, t } from "@/app/_platform/copy";

const fmt = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${Math.round(n / 1_000)}k` : `${n}`;

export async function ProductUsage({ scope }: { scope: string }) {
  const u = await productUsage(scope);
  if (u.totalRuns === 0) return null; // no loop has run against this scope — nothing to report

  const unmetered = u.totalRuns - u.meteredRuns;
  return (
    <div
      className="card"
      style={{ display: "flex", gap: "var(--space-3)", alignItems: "baseline", flexWrap: "wrap", padding: "var(--space-3) var(--space-4)", marginBottom: "var(--space-4)" }}
    >
      <span className="eyebrow"><T id="site.platform.wishes.productusage.span-1" /></span>
      {u.tokens ? (
        <>
          <span className="mono" style={{ fontWeight: 600 }}>
            <T id="site.platform.wishes.productusage.span-2" v={{ fmt: fmt(u.tokens.out), fmt2: fmt(u.tokens.in) }} />
          </span>
          <span className="muted" style={{ fontSize: 12 }}>
            <T id="site.platform.wishes.productusage.span-5" v={{ meteredRuns: u.meteredRuns, totalRuns: u.totalRuns, cacheRead: u.tokens.cacheRead && u.tokens.in > 0
              ? t("site.platform.wishes.productusage.span-3", { cacheRead: Math.round((u.tokens.cacheRead / u.tokens.in) * 100) })
              : "", unmetered: unmetered > 0 ? t("site.platform.wishes.productusage.span-4", { unmetered, v: unmetered === 1 ? "" : "s" }) : "" }} />
          </span>
        </>
      ) : (
        <span className="muted" style={{ fontSize: 12 }}>
          <T id="site.platform.wishes.productusage.span-6" v={{ totalRuns: u.totalRuns, v: u.totalRuns === 1 ? "" : "s" }} />
        </span>
      )}
    </div>
  );
}
