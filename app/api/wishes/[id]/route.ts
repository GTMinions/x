import { NextResponse, type NextRequest } from "next/server";
import {
  getWish, approveWish, rejectWish, cancelWish, prioritizeWish, modifyWish, upvote, setWishPublic,
  setWishStatus, commentOnWish, PRIORITIES, STAGE_IDS, type Priority, type WishStatus,
} from "@/app/_platform/wishes";
import { getSession, displayName } from "@/app/lib/auth";
import { canApproveScope } from "@/app/lib/approval";

/** Every stage is settable by an admin. `nextStages` shapes the DROPDOWN; this
 *  route stays permissive so a person can always correct a board that is wrong. */
const STATUSES: WishStatus[] = STAGE_IDS;

/**
 * PATCH /api/wishes/<id> — every action in a wish's life, in one place.
 *
 * The site board used to reach a wish through a server action and a product board
 * through this route, which is how the two ended up with different powers. There
 * is one route now, and the permission check lives here rather than in either UI:
 * a hidden button is a fact about a page, not a permission.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = await params;
  const id = Number(raw);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });

  const wish = await getWish(id);
  if (!wish) return NextResponse.json({ error: "no such wish" }, { status: 404 });

  const session = await getSession();
  const me = session ? displayName(session) : null;

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* an action with no payload is fine */ }
  const action = String(body.action ?? "");

  /**
   * One predicate for "runs this board", shared with the filing route and the
   * review queue. It has to be the same function in all three: the queue lists
   * what you may approve, and if this asked a narrower question you would be
   * shown a wish and then refused when you clicked. The owning team's admin is
   * exactly the case where the two used to disagree.
   */
  const isAdmin = await canApproveScope(session?.email, wish.scope);
  const isAuthor = !!me && me === wish.nickname;
  const who = me ?? "guest";

  const denied = NextResponse.json({ error: "not allowed" }, { status: 403 });
  const text = String(body.text ?? "").trim();

  switch (action) {
    // Anyone reading a board can back a wish or add to its thread. Those are the
    // two moves that cost nothing to undo and are worth nothing if gated.
    case "upvote":
      return NextResponse.json({ ok: true, wish: await upvote(id) });
    case "comment":
      if (!text) return NextResponse.json({ error: "empty comment" }, { status: 400 });
      return NextResponse.json({ ok: true, wish: await commentOnWish(id, text, who) });

    // The author owns their wish; an admin owns the board.
    case "modify": {
      if (!isAuthor && !isAdmin) return denied;
      const title = String(body.title ?? "").trim();
      if (!title) return NextResponse.json({ error: "title required" }, { status: 400 });
      return NextResponse.json({ ok: true, wish: await modifyWish(id, title, String(body.body ?? ""), who) });
    }
    case "cancel":
      if (!isAuthor && !isAdmin) return denied;
      return NextResponse.json({ ok: true, wish: await cancelWish(id, who, text || undefined) });

    // Rank and workflow are the admin's. They are claims about what the loop does
    // next, and everyone ranks their own wish first.
    case "prioritize": {
      if (!isAdmin) return denied;
      const p = body.priority;
      const priority: Priority = (PRIORITIES as readonly string[]).includes(String(p)) ? (p as Priority) : null;
      if (p != null && p !== "" && priority === null) {
        return NextResponse.json({ error: "priority must be p0, p1, p2, or null" }, { status: 400 });
      }
      return NextResponse.json({ ok: true, wish: await prioritizeWish(id, priority, who) });
    }
    case "status": {
      if (!isAdmin) return denied;
      const status = String(body.status ?? "") as WishStatus;
      if (!STATUSES.includes(status)) return NextResponse.json({ error: "unknown status" }, { status: 400 });
      return NextResponse.json({ ok: true, wish: await setWishStatus(id, status, who) });
    }
    case "approve": {
      if (!isAdmin) return denied;
      const approved = await approveWish(id, who);
      // "Publish while you're approving it" — one click, because that is the
      // moment a reviewer has actually read the thing and can judge whether it
      // is worth showing. Ignored off the site board, where the flag is meaningless.
      if (body.publish === true && wish.scope === "site") {
        return NextResponse.json({ ok: true, wish: await setWishPublic(id, true, who) });
      }
      return NextResponse.json({ ok: true, wish: approved });
    }
    case "publish": {
      if (!isAdmin) return denied;
      if (wish.scope !== "site") {
        return NextResponse.json(
          { error: "Only a platform wish can be published — every other board is gated by its product." },
          { status: 422 },
        );
      }
      return NextResponse.json({ ok: true, wish: await setWishPublic(id, body.public !== false, who) });
    }
    case "reject":
      if (!isAdmin) return denied;
      // The reason the review queue collected. Optional — a required field gets
      // "n/a" typed into it — but it is what the filer will read.
      return NextResponse.json({ ok: true, wish: await rejectWish(id, who, text || undefined) });

    default:
      return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }
}
