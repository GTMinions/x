/**
 * /setup — the first thing an operator sees on a fresh install, and the one
 * page that stays useful afterwards. Two host-and-database steps that read the
 * environment (names, never values), then the questions the site asks in a
 * form — who administers it, how people sign in — and the actions that give it
 * a product. Public to read; the forms and buttons need the owner: a site
 * admin, the automatic local session, or on Vercel the Vercel token as proof.
 */
import Link from "next/link";
import { getSession } from "@/app/lib/auth";
import { setupStatus } from "@/app/lib/setup";
import { demoBundleAvailable, isSetupAdmin } from "@/app/lib/provision";
import { SiteNav } from "@/app/_platform/SiteNav";
import { SiteChrome } from "@/app/_platform/SiteChrome";
import { SiteDockMount } from "@/app/_platform/SiteDockMount";
import { canDesign } from "@/app/lib/platform";
import { SetupActions } from "./SetupActions";
import { OwnerForm, SignInForm, TursoForm } from "./SetupForms";
import { T, t } from "@/app/_platform/copy";

export const dynamic = "force-dynamic";
export const metadata = { title: t("site.setup.title-1") };

export default async function Setup() {
  const session = await getSession();
  const status = await setupStatus();
  const admin = await isSetupAdmin(session);
  const firstOpen = status.steps.find((s) => !s.done && !s.optional);
  const design = await canDesign(session);
  // On Vercel before anyone can sign in, the forms take the Vercel token as proof.
  const needProof = !admin && status.onVercel;
  const canEdit = admin;

  return (
    <SiteChrome canDesign={design} dock={<SiteDockMount canDesign={design} />}>
      <SiteNav />
      <main className="wrap" style={{ padding: "48px 24px 96px", maxWidth: 860 }}>
        <div className="eyebrow"><T id="site.setup.div-1" /></div>
        <h1 style={{ marginTop: 8, maxWidth: 640 }}>
          {status.ready ? t("site.setup.h1-1") : t("site.setup.h1-2")}
        </h1>
        <p className="muted" style={{ maxWidth: 620, marginTop: 10, fontSize: 15 }}>
          {status.onVercel
            ? t("site.setup.p-3")
            : t("site.setup.p-4")}
        </p>
        {status.localSingleUser && (
          <p className="muted" style={{ maxWidth: 620, marginTop: 8, fontSize: 13 }}>
            <T id="site.setup.p-5" c={[<code />]} />
          </p>
        )}

        <ol style={{ listStyle: "none", padding: 0, margin: "32px 0 0", display: "grid", gap: 12 }}>
          {status.steps.map((s, i) => {
            const current = firstOpen?.id === s.id;
            return (
              <li
                key={s.id}
                className="card"
                style={{ borderLeft: `3px solid ${s.done ? "var(--status-ok)" : current ? "var(--accent)" : "var(--rule)"}` }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span className="mono muted" style={{ fontSize: 12 }}>{i + 1}</span>
                  <strong>{s.title}</strong>
                  <span className={`pill ${s.done ? "ok" : current ? "warn" : ""}`} style={{ fontSize: 10 }}>
                    {s.done ? t("site.setup.span-1") : s.optional ? t("site.setup.span-2") : current ? t("site.setup.span-3") : t("site.setup.span-4")}
                  </span>
                </div>
                <p className="muted" style={{ margin: "8px 0 0", fontSize: 14, maxWidth: 640 }}>{s.why}</p>
                <p className="muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
                  <span className="eyebrow"><T id="site.setup.span-5" /></span> {s.source}
                </p>
                {s.keys.length > 0 && (
                  <ul style={{ margin: "10px 0 0", padding: 0, listStyle: "none", display: "grid", gap: 6 }}>
                    {s.keys.map((k) => (
                      <li key={k.name} style={{ fontSize: 13, display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                        <span className={`pill ${k.present ? "ok" : k.required ? "bad" : ""}`} style={{ fontSize: 11 }}>
                          <code style={{ background: "transparent", padding: 0 }}>{k.name}</code>
                          {k.present ? t("site.setup.li-1") : k.required ? t("site.setup.li-2") : t("site.setup.span-6")}
                        </span>
                        {!k.present && <span className="muted">{k.where}</span>}
                      </li>
                    ))}
                  </ul>
                )}
                {s.id === "database" && status.onVercel && status.database.id !== "turso" && (
                  <TursoForm needProof={needProof} canEdit={canEdit} />
                )}
                {s.id === "owner" && (
                  <OwnerForm needProof={needProof} canEdit={canEdit} count={status.admins.count} origin={status.admins.origin} />
                )}
                {s.id === "signin" && (
                  <SignInForm needProof={needProof} canEdit={canEdit} onVercel={status.onVercel} mail={status.mail} google={status.google} />
                )}
                {s.id === "products" && (
                  <SetupActions
                    kind="products"
                    enabled={admin && status.canProvision && status.steps.find((x) => x.id === "database")!.done}
                    signedIn={!!session}
                    demoSlug={status.demoSlug}
                    demoLoaded={status.demoLoaded}
                    demoAvailable={demoBundleAvailable()}
                    canRedeploy={status.canRedeploy}
                    onVercel={status.onVercel}
                  />
                )}
              </li>
            );
          })}
        </ol>

        {status.products.length > 0 && (
          <section style={{ marginTop: 40 }}>
            <h2><T id="site.setup.h2-1" /></h2>
            <div className="grid cols-2" style={{ marginTop: 12 }}>
              {status.products.map((p) => (
                <Link key={p.slug} href={`/${p.slug}`} className="card" style={{ display: "block" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 3, background: p.accent, display: "inline-block" }} />
                    <strong>{p.name}</strong>
                    <span className="mono muted" style={{ fontSize: 12 }}>/{p.slug}</span>
                  </div>
                  <p className="muted" style={{ margin: "6px 0 0", fontSize: 13 }}>{p.tagline}</p>
                </Link>
              ))}
            </div>
          </section>
        )}

        {!admin && (
          <p className="muted" style={{ marginTop: 32, fontSize: 13, maxWidth: 620 }}>
            {status.onVercel
              ? t("site.setup.p-6")
              : t("site.setup.p-7")}
          </p>
        )}
      </main>
    </SiteChrome>
  );
}
