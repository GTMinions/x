/**
 * One wish, full page: the ask, its attachments, and its receipt.
 *
 * The board carries the same receipt inline — this route exists so a wish has a
 * URL you can send someone. Both render `WishTimeline`, so there is one receipt
 * in the codebase and it cannot drift between the two places it appears.
 */
import Link from "next/link";
import { Clock, Film, FileText, Flag } from "lucide-react";
import { getWish, wishReceipt, PRIORITY_LABEL } from "./wishes";
import { getSession } from "@/app/lib/auth";
import { findAccountByEmail } from "@/app/lib/identity/accounts";
import { wishIdsFor } from "@/app/lib/wishOwners";
import { siteWishFilter } from "@/app/lib/access";
import { STAGES, isClosed, type WishStatus } from "./wishes/stages";
import { WishTimeline } from "./WishTimeline";
import { T } from "@/app/_platform/copy";

const LABEL: Record<WishStatus, string> = Object.fromEntries(
  STAGES.map((s) => [s.id, s.label]),
) as Record<WishStatus, string>;
const TONE: Record<WishStatus, string> = {
  triage: "warn", backlog: "", ready: "info", building: "info",
  review: "warn", done: "ok", declined: "", duplicate: "",
};
const PRIORITY_TONE: Record<"p0" | "p1" | "p2", string> = { p0: "bad", p1: "warn", p2: "" };

export async function WishDetail({ id, scope, backHref }: { id: number; scope: string; backHref: string }) {
  const w = await getWish(id, scope);

  /**
   * The same site-wish rule the board applies, applied again here.
   *
   * A filter on the list is not a permission — typing the number into the URL
   * reaches this component directly, and it reads the wish itself. Both paths
   * ask the one predicate so they cannot drift.
   */
  if (w && w.scope === "site") {
    const session = await getSession();
    const account = session?.email ? await findAccountByEmail(session.email) : null;
    const mine = account ? new Set(await wishIdsFor(account.id)) : new Set<number>();
    const visible = await siteWishFilter(session?.email, mine);
    if (!visible(w)) {
      return (
        <div className="card empty">
          <p style={{ margin: 0 }}><T id="site.platform.wishdetail.p-3" v={{ id }} /></p>
          <p className="muted" style={{ margin: "var(--space-2) 0 0", fontSize: 13 }}>
            <T id="site.platform.wishdetail.p-4" c={[<Link href={backHref} />]} />
          </p>
        </div>
      );
    }
  }

  if (!w || w.scope !== scope) {
    return (
      <div className="card empty">
        <p style={{ margin: 0 }}><T id="site.platform.wishdetail.p-5" v={{ id }} /></p>
        <p className="muted" style={{ margin: "var(--space-2) 0 0", fontSize: 13 }}>
          <Link href={backHref}><T id="site.platform.wishdetail.link-3" /></Link>
        </p>
      </div>
    );
  }

  const receipt = await wishReceipt(w);
  const closed = isClosed(w.status);

  return (
    <article className="grid" style={{ gap: "var(--space-5)" }}>
      <header>
        <Link className="muted mono" style={{ fontSize: 12 }} href={backHref}><T id="site.platform.wishdetail.link-4" /></Link>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginTop: "var(--space-2)", flexWrap: "wrap" }}>
          <span className="mono muted">#{w.id}</span>
          <span className={`pill ${TONE[w.status]}`}>{LABEL[w.status]}</span>
          {w.priority && (
            <span className={`pill ${PRIORITY_TONE[w.priority]}`}>
              <Flag size={11} aria-hidden /> {PRIORITY_LABEL[w.priority]}
            </span>
          )}
          {w.needsApproval && !closed && <span className="pill warn"><T id="site.platform.wishdetail.span-2" c={[<Clock size={11} aria-hidden />]} /></span>}
        </div>
        <h1 style={{ marginTop: "var(--space-2)" }}>{w.title}</h1>
        <div className="muted mono" style={{ fontSize: 12 }}>
          <T id="site.platform.wishdetail.div-3" v={{ nickname: w.nickname, createdAt: w.createdAt, votes: w.votes, v: w.votes === 1 ? "" : "s", scope }} />
        </div>
      </header>

      {w.body && (
        <section className="card">
          <div style={{ whiteSpace: "pre-wrap" }}>{w.body}</div>
        </section>
      )}

      {w.media.length > 0 && (
        <section className="card">
          <div className="eyebrow"><T id="site.platform.wishdetail.div-4" /></div>
          <div style={{ display: "flex", gap: "var(--space-3)", marginTop: "var(--space-3)", flexWrap: "wrap" }}>
            {w.media.map((m, i) =>
              m.type.startsWith("image/") ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={i} src={m.url} alt={m.name} style={{ maxWidth: 220, borderRadius: "var(--radius-sm)", border: "1px solid var(--rule)" }} />
              ) : (
                <a key={i} href={m.url} download={m.name} className="pill">
                  {m.type.startsWith("video/") ? <Film size={12} aria-hidden /> : <FileText size={12} aria-hidden />} {m.name}
                </a>
              ),
            )}
          </div>
        </section>
      )}

      <section className="card">
        <WishTimeline receipt={{ ...receipt, status: w.status, issueUrl: w.issueUrl }} />
      </section>

      <p className="muted" style={{ fontSize: 13, margin: 0 }}>
        <T id="site.platform.wishdetail.p-6" c={[<Link href={backHref} />]} />
      </p>
    </article>
  );
}
