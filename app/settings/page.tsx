/**
 * Settings overview — what is on YOUR plate, then the scope hierarchy.
 *
 * The first screen of an admin surface answers "what needs me", not "what
 * exists". Static cards made every visitor read the same page; now a reviewer
 * sees their pending count, an operator sees whether billing and workers are
 * alive, and a person who just files wishes sees their plan. Everything
 * degrades to the plain cards when a store is unreachable — a dashboard that
 * can take the page down is worse than no dashboard.
 */
import Link from "next/link";
import { SettingsShell } from "@/app/_platform/SettingsShell";
import { listProducts, listTeams, listWorkspaces } from "@/app/lib/products";
import { getSession, displayName, isAdmin } from "@/app/lib/auth";
import { readingSession } from "@/app/lib/impersonation";
import { UsagePanel } from "@/app/_platform/UsagePanel";
import { findAccountByEmail } from "@/app/lib/identity/accounts";
import { approvableScopes } from "@/app/lib/approval";
import { listWishes } from "@/app/_platform/wishes";
import { isClosed } from "@/app/_platform/wishes/stages";
import { modeConfigured, stripeMode } from "@/app/lib/stripe";
import { sellableTiers } from "@/app/lib/tiers";
import { listWorkers } from "@/app/lib/workers";
import { T, t } from "@/app/_platform/copy";

export const dynamic = "force-dynamic";

/** Wishes waiting on this person's approval, across every scope they hold. */
async function pendingCount(email: string): Promise<number> {
  try {
    const scopes = await approvableScopes(email);
    if (!scopes.length) return -1; // not a reviewer — the card should not render
    const lists = await Promise.all(scopes.map((s) => listWishes(s).catch(() => [])));
    return lists.flat().filter((w) => w.needsApproval && !isClosed(w.status)).length;
  } catch {
    return -1;
  }
}

export default async function SettingsOverview() {
  // The READING session: a site admin debugging somebody's screen sees that
  // person's screen, refusals included. Writes still use the real session.
  const session = await readingSession();
  const account = session?.email ? await findAccountByEmail(session.email) : null;
  const admin = isAdmin(session);

  const [pending, workers, tiers, mode] = session?.email
    ? await Promise.all([
        pendingCount(session.email),
        admin ? listWorkers().catch(() => []) : Promise.resolve([]),
        admin ? sellableTiers().catch(() => []) : Promise.resolve([]),
        admin ? stripeMode().catch(() => "test" as const) : Promise.resolve("test" as const),
      ])
    : [-1, [], [], "test" as const];

  const alive = workers.filter((w) => w.alive).length;

  /** The attention row: rendered only when something on it concerns this person. */
  const attention: { href: string; label: string; value: string; hint: string; loud?: boolean }[] = [];
  if (pending >= 0) {
    attention.push({
      href: "/wishes/review",
      label: t("site.settings.label-5"),
      value: String(pending),
      hint: pending === 0 ? t("site.settings.hint-5") : t("site.settings.hint-6"),
      loud: pending > 0,
    });
  }
  if (admin) {
    attention.push({
      href: "/settings/billing",
      label: t("site.settings.label-6"),
      value: modeConfigured(mode) ? (mode === "live" ? "LIVE" : "sandbox") : "internal",
      hint:
        tiers.length > 0
          ? t("site.settings.hint-7", { tiers: tiers.length, v: tiers.length === 1 ? "" : "s" })
          : t("site.settings.hint-8"),
      loud: mode === "live",
    });
    attention.push({
      href: "/settings/billing",
      label: t("site.settings.label-7"),
      value: String(alive),
      hint:
        workers.length === 0
          ? t("site.settings.hint-9")
          : alive > 0
            ? t("site.settings.hint-10")
            : t("site.settings.hint-11", { workers: workers.length }),
    });
  }

  const registry = await listProducts();
  const teams = await listTeams();
  const cards = [
    { href: "/settings/site", label: t("site.settings.label-8"), value: "1", hint: t("site.settings.hint-12") },
    { href: "/settings/teams", label: t("site.settings.label-9"), value: String(teams.length), hint: t("site.settings.hint-13") },
    { href: "/settings/products", label: t("site.settings.label-10"), value: String(registry.length), hint: t("site.settings.hint-14") },
    { href: "/settings/workspaces", label: t("site.settings.label-11"), value: String(listWorkspaces(registry).length), hint: t("site.settings.hint-15") },
  ];

  return (
    <SettingsShell active="/settings">
      <h1><T id="site.settings.h1-2" /></h1>
      <p className="muted" style={{ marginTop: 6 }}>
        {session
          ? t("site.settings.p-6", { displayName: displayName(session), v: admin ? t("site.settings.p-5") : "" })
          : t("site.settings.p-7")}
      </p>

      {attention.length > 0 ? (
        <>
          <div className="eyebrow" style={{ marginTop: 24 }}><T id="site.settings.div-1" /></div>
          <div className="grid cols-2" style={{ marginTop: 10 }}>
            {attention.map((c) => (
              <Link key={c.label} href={c.href} className="card" style={c.loud ? { borderColor: "var(--accent, #b4232a)" } : undefined}>
                <div className="eyebrow">{c.label}</div>
                <div style={{ fontSize: 30, fontWeight: 600, marginTop: 6 }}>{c.value}</div>
                <div className="muted" style={{ fontSize: 13 }}>{c.hint}</div>
              </Link>
            ))}
          </div>
        </>
      ) : null}

      <div className="eyebrow" style={{ marginTop: 24 }}><T id="site.settings.div-2" /></div>
      <div className="grid cols-2" style={{ marginTop: 10 }}>
        {cards.map((c) => (
          <Link key={c.href} href={c.href} className="card">
            <div className="eyebrow">{c.label}</div>
            <div style={{ fontSize: 30, fontWeight: 600, marginTop: 6 }}>{c.value}</div>
            <div className="muted" style={{ fontSize: 13 }}>{c.hint}</div>
          </Link>
        ))}
      </div>

      {/* Account-scoped, not product-scoped: a plan belongs to the person and
          follows their wishes into whichever product they file against. */}
      {account ? (
        <div style={{ marginTop: "var(--space-6)" }}>
          <UsagePanel accountId={account.id} isAdmin={admin} />
        </div>
      ) : null}
    </SettingsShell>
  );
}
