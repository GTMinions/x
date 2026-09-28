/**
 * Billing — the operator's one page for money.
 *
 * Everything here reads from the database (tiers, settings, ledger, roster) or
 * the environment (which key slots are filled). Site admins only: the numbers on
 * this page are the deployment's own, and the reason they are not in the
 * repository is the reason they are not on a public page.
 */
import { SettingsShell } from "@/app/_platform/SettingsShell";
import { getSession } from "@/app/lib/auth";
import { creditSettings } from "@/app/lib/credits";
import { roleAtLeast } from "@/app/lib/memberships";
import { keyShapeMismatch, modeConfigured, stripeModeDetail } from "@/app/lib/stripe";
import { listTiers, money } from "@/app/lib/tiers";
import { emailsFor, ledgerRecent, listWorkers, spendByAccount, wishCostStats } from "@/app/lib/workers";
import { paywallOn } from "@/app/lib/settings";
import { ModeSwitch, PaywallSwitch, SettingField } from "./controls";
import { T, t as copyText } from "@/app/_platform/copy";

export const dynamic = "force-dynamic";

const ago = (unixSeconds: number) => {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - unixSeconds);
  if (s < 90) return copyText("site.settings.billing.s-1", { s });
  if (s < 5400) return copyText("site.settings.billing.s-2", { s: Math.round(s / 60) });
  if (s < 129600) return copyText("site.settings.billing.s-3", { s: Math.round(s / 3600) });
  return copyText("site.settings.billing.s-4", { s: Math.round(s / 86400) });
};

const tokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(/\.0$/, "")}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : `${n}`);

export default async function BillingSettings() {
  const session = await getSession();
  const canManage = await roleAtLeast(session?.email, "site", "site", "admin");

  if (!canManage) {
    return (
      <SettingsShell active="/settings/billing">
        <h1><T id="site.settings.billing.h1-1" /></h1>
        <p className="muted" style={{ marginTop: 6 }}>
          <T id="site.settings.billing.p-1" />
        </p>
      </SettingsShell>
    );
  }

  const [detail, tiers, settings, workers, stats, ledger, accounts] = await Promise.all([
    stripeModeDetail(),
    listTiers(),
    creditSettings(),
    listWorkers(),
    wishCostStats(),
    ledgerRecent(15),
    spendByAccount(20),
  ]);
  const mode = detail.site;
  const wall = await paywallOn();
  const who = await emailsFor(ledger.map((r) => r.accountId));

  const modes = (["test", "live"] as const).map((m) => ({
    mode: m,
    configured: modeConfigured(m),
    mismatch: keyShapeMismatch(m),
  }));

  return (
    <SettingsShell active="/settings/billing">
      <h1><T id="site.settings.billing.h1-2" /></h1>
      <p className="muted" style={{ marginTop: 6 }}>
        <T id="site.settings.billing.p-2" />
      </p>

      {/* ── payment mode ─────────────────────────────────────────────── */}
      {modes.some((m) => m.configured) ? (
        <section className="card" style={{ marginTop: 24 }}>
          <div className="eyebrow"><T id="site.settings.billing.div-1" /></div>
          <ModeSwitch current={mode} modes={modes} />
          {detail.source === "session" && (
            <p style={{ margin: "10px 0 0", fontSize: 13, color: "var(--warn, #a56a00)" }}>
              <T id="site.settings.billing.p-17" v={{ mode: detail.mode }} c={[<strong />]} />
            </p>
          )}
          <p className="muted" style={{ margin: "10px 0 0", fontSize: 13 }}>
            <T id="site.settings.billing.p-3" c={[<code />, <code />]} />
          </p>
        </section>
      ) : (
        <section className="card" style={{ marginTop: 24 }}>
          <div className="eyebrow"><T id="site.settings.billing.div-2" /></div>
          <p style={{ margin: "8px 0 0", fontSize: 14 }}>
            <T id="site.settings.billing.p-4" c={[<strong />]} />
          </p>
          <p className="muted" style={{ margin: "8px 0 0", fontSize: 13 }}>
            <T id="site.settings.billing.p-5" c={[<code />, <code />]} />
          </p>
        </section>
      )}

      {/* ── the paywall ──────────────────────────────────────────────── */}
      <section className="card" style={{ marginTop: 16 }}>
        <div className="eyebrow"><T id="site.settings.billing.div-3" /></div>
        <PaywallSwitch on={wall} />
        <p className="muted" style={{ margin: "10px 0 0", fontSize: 13 }}>
          <T id="site.settings.billing.p-6" />
        </p>
      </section>

      {/* ── tiers ────────────────────────────────────────────────────── */}
      <section className="card" style={{ marginTop: 16 }}>
        <div className="eyebrow"><T id="site.settings.billing.div-4" /></div>
        {tiers.length === 0 ? (
          <p className="muted" style={{ margin: "8px 0 0", fontSize: 14 }}>
            <T id="site.settings.billing.p-7" c={[<code />]} />
          </p>
        ) : (
          <div style={{ overflowX: "auto", marginTop: 8 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr className="muted" style={{ fontSize: 12, textAlign: "left" }}>
                  <th style={{ padding: "6px 10px" }}><T id="site.settings.billing.th-1" /></th>
                  <th style={{ padding: "6px 10px" }}><T id="site.settings.billing.th-2" /></th>
                  <th style={{ padding: "6px 10px" }}><T id="site.settings.billing.th-3" /></th>
                  <th style={{ padding: "6px 10px" }}><T id="site.settings.billing.th-4" /></th>
                  <th style={{ padding: "6px 10px" }}><T id="site.settings.billing.th-5" /></th>
                  <th style={{ padding: "6px 10px" }}><T id="site.settings.billing.th-6" v={{ mode }} /></th>
                </tr>
              </thead>
              <tbody>
                {tiers.map((t) => {
                  const g = t.guarantee;
                  const line = g.perDay !== null ? `${g.perDay}/day` : g.perMonth !== null ? `${g.perMonth}/month` : "none";
                  return (
                    <tr key={t.id} style={{ borderTop: "1px solid var(--rule)" }}>
                      <td style={{ padding: "8px 10px", fontWeight: 600 }}>{t.name}</td>
                      <td style={{ padding: "8px 10px" }}>{money(t.priceCents)}</td>
                      <td style={{ padding: "8px 10px" }}>{line}</td>
                      <td style={{ padding: "8px 10px" }}>{t.rank}</td>
                      <td style={{ padding: "8px 10px" }}>{t.listed ? copyText("site.settings.billing.td-1") : copyText("site.settings.billing.td-2")}</td>
                      <td style={{ padding: "8px 10px" }}>
                        {t.stripePrice[mode] ? "✓" : <span style={{ color: "var(--danger, #b4232a)" }}><T id="site.settings.billing.span-1" /></span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted" style={{ margin: "10px 0 0", fontSize: 13 }}>
          <T id="site.settings.billing.p-8" c={[<code />]} />
        </p>
      </section>

      {/* ── operator numbers ─────────────────────────────────────────── */}
      <section className="card" style={{ marginTop: 16 }}>
        <div className="eyebrow"><T id="site.settings.billing.div-5" /></div>
        <div style={{ display: "grid", gap: 10, marginTop: 8 }}>
          {settings.map((s) => (
            <SettingField key={s.key} name={s.key} value={s.value} fallback={s.fallback} />
          ))}
        </div>
        <p className="muted" style={{ margin: "10px 0 0", fontSize: 13 }}>
          <T id="site.settings.billing.p-9" c={[<code />, <code />]} />
        </p>
      </section>

      {/* ── who is spending what ─────────────────────────────────────── */}
      <section className="card" style={{ marginTop: 16 }}>
        <div className="eyebrow"><T id="site.settings.billing.div-6" /></div>
        {accounts.length === 0 ? (
          <p className="muted" style={{ margin: "8px 0 0", fontSize: 14 }}>
            <T id="site.settings.billing.p-10" />
          </p>
        ) : (
          <div style={{ overflowX: "auto", marginTop: 8 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
              <thead>
                <tr className="muted" style={{ fontSize: 12, textAlign: "left" }}>
                  <th style={{ padding: "6px 10px" }}><T id="site.settings.billing.th-7" /></th>
                  <th style={{ padding: "6px 10px" }}><T id="site.settings.billing.th-8" /></th>
                  <th style={{ padding: "6px 10px" }}><T id="site.settings.billing.th-9" /></th>
                  <th style={{ padding: "6px 10px" }}><T id="site.settings.billing.th-10" /></th>
                  <th style={{ padding: "6px 10px" }}><T id="site.settings.billing.th-11" /></th>
                  <th style={{ padding: "6px 10px" }}><T id="site.settings.billing.th-12" /></th>
                  <th style={{ padding: "6px 10px" }}><T id="site.settings.billing.th-13" /></th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.accountId} style={{ borderTop: "1px solid var(--rule)" }}>
                    <td style={{ padding: "7px 10px" }}>{a.email ?? `#${a.accountId}`}</td>
                    <td style={{ padding: "7px 10px" }}>{a.tier}</td>
                    <td style={{ padding: "7px 10px" }}>{a.runs}</td>
                    <td style={{ padding: "7px 10px" }}>{tokens(a.freshIn)}</td>
                    <td style={{ padding: "7px 10px" }}>{tokens(a.cacheRead)}</td>
                    <td style={{ padding: "7px 10px" }}>{tokens(a.out)}</td>
                    <td style={{ padding: "7px 10px" }}>
                      {a.creditsPurchased || a.creditsSpent ? copyText("site.settings.billing.td-3", { creditsSpent: a.creditsSpent, creditsPurchased: a.creditsPurchased }) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted" style={{ margin: "10px 0 0", fontSize: 13 }}>
          <T id="site.settings.billing.p-11" />
        </p>
      </section>

      {/* ── what a wish costs ────────────────────────────────────────── */}
      <section className="card" style={{ marginTop: 16 }}>
        <div className="eyebrow"><T id="site.settings.billing.div-7" /></div>
        {stats ? (
          <p style={{ margin: "8px 0 0", fontSize: 14 }}>
            <T id="site.settings.billing.p-13" v={{ tokens: tokens(stats.medianTokens), tokens2: tokens(stats.meanTokens), tokens3: tokens(stats.p90Tokens), samples: stats.samples, v: stats.samples === 1 ? "" : copyText("site.settings.billing.p-12"), node: stats.samples < 20 ? (
              <span className="muted"><T id="site.settings.billing.span-2" /></span>
            ) : null }} c={[<strong />, <strong />]} />
          </p>
        ) : (
          <p className="muted" style={{ margin: "8px 0 0", fontSize: 14 }}>
            <T id="site.settings.billing.p-14" />
          </p>
        )}
      </section>

      {/* ── workers ──────────────────────────────────────────────────── */}
      <section className="card" style={{ marginTop: 16 }}>
        <div className="eyebrow"><T id="site.settings.billing.div-8" /></div>
        {workers.length === 0 ? (
          <p className="muted" style={{ margin: "8px 0 0", fontSize: 14 }}>
            <T id="site.settings.billing.p-15" c={[<code />]} />
          </p>
        ) : (
          <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
            {workers.map((w) => (
              <div key={w.id} style={{ display: "flex", gap: 10, alignItems: "baseline", fontSize: 14 }}>
                <span
                  aria-hidden
                  style={{
                    width: 8, height: 8, borderRadius: 999, flexShrink: 0, alignSelf: "center",
                    background: w.alive ? "var(--ok, #356a4d)" : "var(--rule, #ccc)",
                  }}
                />
                <code style={{ fontSize: 13 }}>{w.id}</code>
                {w.label ? <span className="muted" style={{ fontSize: 13 }}>{w.label}</span> : null}
                <span className="muted" style={{ marginLeft: "auto", fontSize: 12.5 }}>
                  {w.alive ? copyText("site.settings.billing.span-3") : copyText("site.settings.billing.span-4", { ago: ago(w.lastSeenAt) })}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── recent spend ─────────────────────────────────────────────── */}
      <section className="card" style={{ marginTop: 16 }}>
        <div className="eyebrow"><T id="site.settings.billing.div-9" /></div>
        {ledger.length === 0 ? (
          <p className="muted" style={{ margin: "8px 0 0", fontSize: 14 }}>
            <T id="site.settings.billing.p-16" />
          </p>
        ) : (
          <div style={{ overflowX: "auto", marginTop: 8 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
              <thead>
                <tr className="muted" style={{ fontSize: 12, textAlign: "left" }}>
                  <th style={{ padding: "6px 10px" }}><T id="site.settings.billing.th-14" /></th>
                  <th style={{ padding: "6px 10px" }}><T id="site.settings.billing.th-15" /></th>
                  <th style={{ padding: "6px 10px" }}><T id="site.settings.billing.th-16" /></th>
                  <th style={{ padding: "6px 10px" }}><T id="site.settings.billing.th-17" /></th>
                  <th style={{ padding: "6px 10px" }}><T id="site.settings.billing.th-18" /></th>
                  <th style={{ padding: "6px 10px" }}><T id="site.settings.billing.th-19" /></th>
                  <th style={{ padding: "6px 10px" }}><T id="site.settings.billing.th-20" /></th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((r) => (
                  <tr key={r.id} style={{ borderTop: "1px solid var(--rule)" }}>
                    <td style={{ padding: "7px 10px", whiteSpace: "nowrap" }}>{ago(r.createdAt)}</td>
                    <td style={{ padding: "7px 10px" }}>{r.wishId ? `#${r.wishId}` : "—"}</td>
                    <td style={{ padding: "7px 10px" }}>{who.get(r.accountId) ?? `#${r.accountId}`}</td>
                    <td style={{ padding: "7px 10px" }}>{r.model ?? "—"}</td>
                    <td style={{ padding: "7px 10px" }}>{tokens(r.inputTokens + r.cacheWriteTokens)}</td>
                    <td style={{ padding: "7px 10px" }}>{tokens(r.cacheReadTokens)}</td>
                    <td style={{ padding: "7px 10px" }}>{tokens(r.outputTokens)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </SettingsShell>
  );
}
