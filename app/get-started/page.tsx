/**
 * /get-started — the landing page, and the page ads point at.
 *
 * It has two jobs in one scroll: say what this is to somebody who has never
 * heard of it, and let a reader who is already convinced buy without hunting.
 * A price table alone converts nobody who arrived from an ad — they do not yet
 * know what a "wish" is — and a pitch with the prices on a second page loses
 * the reader who was ready.
 *
 * The order is the argument: what you get, how it works in three steps, the
 * tiers, then the honest limits. Objections are answered on the page rather
 * than left for support, because the one that goes unanswered ("what stops
 * this from being slop?") is the one that decides.
 *
 * Every figure comes from the `tiers` table. Nothing here hardcodes a price —
 * a deployment with no tiers renders the pitch and says plainly that nothing is
 * for sale, which is a true page rather than a broken one.
 */
import Link from "next/link";
import { ArrowRight, GitPullRequest, ListChecks, Sparkles } from "lucide-react";

import { SiteChrome } from "@/app/_platform/SiteChrome";
import { SiteDockMount } from "@/app/_platform/SiteDockMount";
import { SiteNav } from "@/app/_platform/SiteNav";
import { getSession } from "@/app/lib/auth";
import { findAccountByEmail } from "@/app/lib/identity/accounts";
import { accountTier, money, priceIdFor, sellableTiers, type Tier } from "@/app/lib/tiers";
import { membershipFor } from "@/app/lib/membership";
import { listableProducts } from "@/app/lib/access";
import { listTeams } from "@/app/lib/products";
import { canDesign } from "@/app/lib/platform";
import { modeConfigured, stripeMode } from "@/app/lib/stripe";
import { CheckoutButton } from "./CheckoutButton";
import { T, t as copyText } from "@/app/_platform/copy";

export const dynamic = "force-dynamic";

export const metadata = {
  title: copyText("site.getstarted.title-1"),
  description:
    copyText("site.getstarted.description-1"),
};

function guaranteeLine(t: Tier): string {
  const g = t.guarantee;
  if (g.perDay !== null) return copyText("site.getstarted.s-1", { perDay: g.perDay, v: g.perDay === 1 ? "wish" : "wishes" });
  if (g.perMonth !== null) return copyText("site.getstarted.s-2", { perMonth: g.perMonth, v: g.perMonth === 1 ? "wish" : "wishes" });
  return copyText("site.getstarted.s-3");
}

const HOW = [
  {
    icon: ListChecks,
    title: copyText("site.getstarted.title-2"),
    body:
      copyText("site.getstarted.body-1"),
  },
  {
    icon: Sparkles,
    title: copyText("site.getstarted.title-3"),
    body:
      copyText("site.getstarted.body-2"),
  },
  {
    icon: GitPullRequest,
    title: copyText("site.getstarted.title-4"),
    body:
      copyText("site.getstarted.body-3"),
  },
];


export default async function GetStarted() {
  const session = await getSession();
  const account = session?.email ? await findAccountByEmail(session.email) : null;
  const standing = account ? await accountTier(account.id) : null;
  const current = standing?.tier ?? null;

  // Cheapest first. `sellableTiers` sorts by queue rank, which is right for the
  // queue and backwards for a price table — a reader arriving cold should meet
  // the entry price before the top one, or the first number they see is the
  // largest one on the page.
  const tiers = (await sellableTiers()).slice().sort((a, b) => a.priceCents - b.priceCents);
  const mode = await stripeMode();
  const payable = modeConfigured(mode);
  // Whether this deployment is actually selling. An internal one shows the
  // pitch and a way in — a price table nobody can act on is furniture.
  const { member, selling } = await membershipFor(account?.id ?? null, session?.email);

  const design = await canDesign(session);
  const [products, teams] = await Promise.all([listableProducts(session?.email), listTeams()]);

  return (
    <SiteChrome canDesign={design} dock={<SiteDockMount canDesign={design} />}>
      <SiteNav />

      {/* ── the promise ─────────────────────────────────────────────── */}
      <section style={{ background: "var(--nav-bg)", color: "var(--nav-ink)", padding: "var(--space-12) var(--space-5)" }}>
        <div className="wrap" style={{ maxWidth: 860 }}>
          <span
            style={{
              fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.14em",
              color: "var(--nav-ink-faded)", textTransform: "uppercase",
            }}
          >
            <T id="site.getstarted.span-1" />
          </span>
          <h1
            style={{
              fontFamily: "var(--font-serif)", fontWeight: 700, letterSpacing: "-0.01em",
              fontSize: "clamp(34px, 6vw, 60px)", lineHeight: 1.08, margin: "14px 0 0", textWrap: "balance",
            }}
          >
            <T id="site.getstarted.h1-1" c={[<em style={{ color: "var(--nav-ink-soft)" }} />]} />
          </h1>
          <p style={{ maxWidth: "38em", margin: "18px 0 0", fontSize: 17, lineHeight: 1.65, color: "var(--nav-ink-soft)" }}>
            <T id="site.getstarted.p-1" />
          </p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 26 }}>
            {member ? (
              <Link
                href="/dashboard"
                className="btn"
                style={{ display: "inline-flex", alignItems: "center", gap: 7, textDecoration: "none" }}
              >
                <T id="site.getstarted.link-1" c={[<ArrowRight size={14} strokeWidth={2.5} />]} />
              </Link>
            ) : selling ? (
              <a
                href="#tiers"
                className="btn"
                style={{ display: "inline-flex", alignItems: "center", gap: 7, textDecoration: "none" }}
              >
                <T id="site.getstarted.a-1" c={[<ArrowRight size={14} strokeWidth={2.5} />]} />
              </a>
            ) : (
              <CheckoutButton endpoint="/api/account/start" label={copyText("site.getstarted.label-1")} signedIn={Boolean(account)} />
            )}
            <Link
              href="/wishes"
              style={{
                display: "inline-flex", alignItems: "center", height: 38, padding: "0 16px",
                borderRadius: "var(--radius-lg)", border: "1px solid var(--nav-rule)",
                color: "var(--nav-ink)", textDecoration: "none", fontSize: 13.5, fontWeight: 600,
              }}
            >
              <T id="site.getstarted.link-2" />
            </Link>
          </div>
        </div>
      </section>

      {/* ── how it works ────────────────────────────────────────────── */}
      <section className="wrap" style={{ maxWidth: 980, padding: "var(--space-12) var(--space-5) 0" }}>
        <div className="eyebrow"><T id="site.getstarted.div-1" /></div>
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 18, marginTop: 14 }}>
          {HOW.map((s, i) => (
            <div key={s.title} className="card" style={{ display: "grid", gap: 9, padding: 20 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <s.icon size={17} strokeWidth={1.9} style={{ color: "var(--accent)" }} />
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-mute)" }}>
                  {String(i + 1).padStart(2, "0")}
                </span>
              </div>
              <strong style={{ fontSize: 15.5 }}>{s.title}</strong>
              <p className="muted" style={{ margin: 0, fontSize: 14, lineHeight: 1.6 }}>{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── the tiers ───────────────────────────────────────────────── */}
      <section id="tiers" className="wrap" style={{ maxWidth: 980, padding: "var(--space-12) var(--space-5) 0", scrollMarginTop: 24 }}>
        <div className="eyebrow"><T id="site.getstarted.div-2" /></div>
        <h2 style={{ fontFamily: "var(--font-serif)", fontSize: 28, margin: "8px 0 0", letterSpacing: "-0.01em" }}>
          <T id="site.getstarted.h2-1" />
        </h2>
        <p className="muted" style={{ maxWidth: "42em", marginTop: 10, fontSize: 15, lineHeight: 1.65 }}>
          <T id="site.getstarted.p-2" />
        </p>

        {!selling ? (
          <div className="card" style={{ marginTop: 22, padding: 20 }}>
            <p style={{ margin: 0, fontSize: 15, lineHeight: 1.6 }}>
              <T id="site.getstarted.p-3" />
            </p>
          </div>
        ) : tiers.length === 0 ? (
          <div className="card" style={{ marginTop: 22, padding: 20 }}>
            <p style={{ margin: 0, fontSize: 15 }}>
              <T id="site.getstarted.p-4" />
            </p>
          </div>
        ) : (
          <div
            className="grid"
            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(238px, 1fr))", gap: 18, marginTop: 22, alignItems: "stretch" }}
          >
            {tiers.map((t) => {
              const mine = current === t.id;
              // A tier with no price in the current mode cannot be bought; show it
              // rather than sending somebody to a checkout that will 404.
              const buyable = payable && Boolean(priceIdFor(t, mode));
              // The middle paid tier carries the accent — one recommendation, not three.
              const featured = t.priceCents > 0 && t.rank === Math.max(...tiers.map((x) => x.rank));
              return (
                <section
                  key={t.id}
                  className="card"
                  style={{
                    display: "flex", flexDirection: "column", gap: 10, padding: 22,
                    borderColor: mine ? "var(--status-ok)" : featured ? "var(--accent)" : undefined,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span className="eyebrow">{t.name}</span>
                    {featured && !mine ? (
                      <span
                        style={{
                          fontFamily: "var(--font-mono)", fontSize: 9.5, letterSpacing: "0.08em",
                          padding: "2px 7px", borderRadius: 999, background: "var(--accent-bg)", color: "var(--accent)",
                        }}
                      >
                        <T id="site.getstarted.span-2" />
                      </span>
                    ) : null}
                    {mine ? (
                      <span
                        style={{
                          fontFamily: "var(--font-mono)", fontSize: 9.5, letterSpacing: "0.08em",
                          padding: "2px 7px", borderRadius: 999, background: "var(--status-ok-bg)", color: "var(--status-ok)",
                        }}
                      >
                        <T id="site.getstarted.span-3" />
                      </span>
                    ) : null}
                  </div>

                  <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                    <span style={{ fontFamily: "var(--font-serif)", fontSize: 34, fontWeight: 700, letterSpacing: "-0.02em" }}>
                      {money(t.priceCents)}
                    </span>
                    {t.priceCents > 0 ? <span className="muted" style={{ fontSize: 13 }}><T id="site.getstarted.span-4" /></span> : null}
                  </div>

                  <div style={{ fontWeight: 650, fontSize: 15 }}>{guaranteeLine(t)}</div>
                  {t.blurb ? <p className="muted" style={{ fontSize: 14, margin: 0, lineHeight: 1.6 }}>{t.blurb}</p> : null}

                  <div style={{ marginTop: "auto", paddingTop: 14 }}>
                    {/* Free goes through the same checkout as the paid tiers —
                        it is a $0 subscription — so there is one door and one
                        outcome: a tier the queue can order by and a card on
                        file. A second, different way in for the free tier
                        would be a second way for either to go missing. */}
                    {mine ? (
                      <span className="muted" style={{ fontSize: 13 }}><T id="site.getstarted.span-5" /></span>
                    ) : buyable ? (
                      <CheckoutButton
                        tier={t.id}
                        label={t.priceCents === 0 ? copyText("site.getstarted.checkoutbutton-1") : copyText("site.getstarted.checkoutbutton-2", { name: t.name })}
                        signedIn={Boolean(account)}
                      />
                    ) : (
                      <span className="muted" style={{ fontSize: 13 }}><T id="site.getstarted.span-6" /></span>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </section>

      {/* ── the products: the demo, and whatever this reader may open ── */}
      <section id="products" className="wrap" style={{ maxWidth: 980, padding: "var(--space-12) var(--space-5) 0", scrollMarginTop: 24 }}>
        <div className="eyebrow"><T id="site.getstarted.div-4" /></div>
        <h2 style={{ fontFamily: "var(--font-serif)", fontSize: 28, margin: "8px 0 0", letterSpacing: "-0.01em" }}>
          {session ? copyText("site.getstarted.h2-2") : copyText("site.getstarted.h2-3")}
        </h2>
        <p className="muted" style={{ margin: "8px 0 0", fontSize: 14, maxWidth: "60em" }}>
          {session
            ? copyText("site.getstarted.p-6")
            : copyText("site.getstarted.p-7")}
        </p>
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 18, marginTop: 16 }}>
          {products.map((p) => {
            const team = teams.find((t) => t.slug === p.teamSlug);
            return (
              <Link key={p.slug} href={session ? `/${p.slug}` : `/sign-in?next=/${p.slug}`} className="card" style={{ display: "grid", gap: 8, padding: 20, textDecoration: "none" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: p.accent, display: "inline-block" }} />
                  <strong style={{ fontSize: 15.5 }}>{p.name}</strong>
                  {p.visibility === "public" && <span className="pill info" style={{ fontSize: 10 }}><T id="site.getstarted.span-7" /></span>}
                </div>
                <p className="muted" style={{ margin: 0, fontSize: 14, lineHeight: 1.6 }}>{p.tagline}</p>
                <div className="mono muted" style={{ fontSize: 12 }}>
                  {team?.name ?? p.teamSlug} · {session ? copyText("site.getstarted.div-5") : copyText("site.getstarted.div-6")}
                </div>
              </Link>
            );
          })}
          {products.length === 0 && (
            <p className="muted" style={{ margin: 0, fontSize: 14 }}><T id="site.getstarted.p-8" /></p>
          )}
        </div>
      </section>

      {/* ── the disclaimer ──────────────────────────────────────────── */}
      <section className="wrap" style={{ maxWidth: 980, padding: "var(--space-5) var(--space-5) var(--space-12)" }}>
        <p className="muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.7, maxWidth: "60em" }}>
          <T id="site.getstarted.p-5" />
        </p>
      </section>

    </SiteChrome>
  );
}
