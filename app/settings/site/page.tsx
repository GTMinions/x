/** Site settings — the top scope: config + who runs the platform. */
import { SettingsShell } from "@/app/_platform/SettingsShell";
import { MembersGrid } from "@/app/_platform/MembersGrid";
import { CompsPanel } from "@/app/_platform/settings/CompsPanel";
import { listComps } from "@/app/lib/comps";
import { SITE } from "@/app/lib/products";
import { getSession } from "@/app/lib/auth";
import { roleAtLeast, listMembers, membershipStoreInfo } from "@/app/lib/platform";
import { googleStatus } from "@/app/lib/googleAuth";
import { keyShapeMismatch, modeConfigured, stripeModeDetail } from "@/app/lib/stripe";
import { ModeSwitch } from "@/app/settings/billing/controls";
import { T, t } from "@/app/_platform/copy";

export default async function SiteSettings() {
  const { enabled: googleEnabled, halfConfigured: googleHalfConfigured, missingHalf: googleMissingHalf } = await googleStatus();
  const session = await getSession();
  const canManage = await roleAtLeast(session?.email, "site", "site", "admin");
  const members = await listMembers("site", "site");
  const comps = await listComps();
  // AFTER the load, not before: storeInfo() reports the error from the last load that ran,
  // and reading it first meant the banner described a load that had not happened yet.
  const store = membershipStoreInfo();
  const payment = canManage ? await stripeModeDetail().catch(() => null) : null;
  const paymentModes = (["test", "live"] as const).map((m) => ({ mode: m, configured: modeConfigured(m), mismatch: keyShapeMismatch(m) }));
  const rows: [string, string][] = [
    [t("site.settings.site.rows-1"), SITE.name],
    [t("site.settings.site.rows-2"), SITE.domain],
    [t("site.settings.site.rows-3"), SITE.identityProvider],
  ];
  return (
    <SettingsShell active="/settings/site">
      <h1><T id="site.settings.site.h1-1" /></h1>
      <p className="muted" style={{ marginTop: 6 }}><T id="site.settings.site.p-1" /></p>
      <div className="card" style={{ marginTop: 24, padding: 0 }}>
        {rows.map(([k, v], i) => (
          <div key={k} style={{ display: "flex", gap: 16, padding: "14px 18px", borderTop: i ? "1px solid var(--rule)" : "none" }}>
            <div className="muted" style={{ width: 160, flexShrink: 0 }}>{k}</div>
            <div style={{ fontWeight: 500 }}>{v}</div>
          </div>
        ))}
        {/* Google SSO renders its state, not just its name. When it is off, the "Continue
            with Google" button hides itself on /sign-in with no explanation — so the reason
            it is off, and the one thing left to do about it, live here instead of being
            something the operator has to infer from an absent button. */}
        <div style={{ display: "flex", gap: 16, padding: "14px 18px", borderTop: "1px solid var(--rule)" }}>
          <div className="muted" style={{ width: 160, flexShrink: 0 }}><T id="site.settings.site.div-1" /></div>
          <div style={{ fontWeight: 500 }}>
            <span className={`pill ${googleEnabled ? "ok" : "warn"}`}>{googleEnabled ? t("site.settings.site.span-1") : t("site.settings.site.span-2")}</span>
          </div>
        </div>
      </div>

      {/* The fix names an env var and a console step, so it is shown only to an admin who
          owns the deploy — same rule the membership panel follows. Which half is missing is
          computed, not asserted: a page that says "the secret is missing" when the id is the
          absent one sends the operator to fix the wrong thing. */}
      {!googleEnabled && canManage && (
        <p className="muted" style={{ marginTop: 10, fontSize: 13, maxWidth: "var(--paper-measure)" }}>
          <T id="site.settings.site.p-2" v={{ node: googleHalfConfigured ? (
            <><T id="site.settings.site.fragment-1" v={{ googleMissingHalf }} c={[<code className="mono" />]} /></>
          ) : (
            <><T id="site.settings.site.fragment-2" c={[<code className="mono" />, <code className="mono" />]} /></>
          ), domain: SITE.domain }} c={[<code className="mono" />]} />
        </p>
      )}

      <div style={{ marginTop: 28 }}>
        <MembersGrid scopeType="site" scopeId="site" members={members} canManage={canManage} label={t("site.settings.site.label-1")} store={store} />
      </div>

      {payment && paymentModes.some((m) => m.configured) && (
        <div className="card" style={{ marginTop: 24 }}>
          <div className="eyebrow"><T id="site.settings.site.div-2" /></div>
          <p className="muted" style={{ margin: "6px 0 0", fontSize: 14 }}>
            <T id="site.settings.site.p-3" />
          </p>
          <ModeSwitch current={payment.site} modes={paymentModes} />
          {payment.source === "session" && (
            <p className="muted" style={{ margin: "10px 0 0", fontSize: 13 }}>
              <T id="site.settings.site.p-4" v={{ mode: payment.mode }} c={[<strong />]} />
            </p>
          )}
          <p className="muted" style={{ margin: "10px 0 0", fontSize: 13 }}>
            <T id="site.settings.site.p-5" />
          </p>
        </div>
      )}

      <div style={{ marginTop: 28 }}>
        <CompsPanel comps={comps} canManage={canManage} />
      </div>
    </SettingsShell>
  );
}
