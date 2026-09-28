/**
 * The launch gate — what may be said, and where.
 *
 * Two checks, and they fail for different reasons.
 *
 * **Evidence.** A claim must name the research that backs it, and that research
 * must exist and be deep enough to bear the weight. This is `citation-discipline`
 * applied to marketing: earned, dated, falsifiable. The usual objection — "it's
 * just marketing copy" — is exactly the attitude that produces a landing page the
 * product cannot live up to and a support queue full of people who believed it.
 *
 * **Fit.** A post must physically fit the channel it is scheduled on. A 300-word
 * claim on a 280-character channel is not a post, and discovering that at launch
 * is a self-inflicted wound.
 *
 * Both produce a *blocked* post with a reason, never a silent drop.
 */
import { loadEntities } from "../research/engine";
import { gateFor } from "../research/depth";
import { CHANNELS, isOutbound } from "./channels";
import type { Claim, Post, LaunchPlan } from "./types";

export type Verdict = { ok: true } | { ok: false; reason: string };

/**
 * Can this claim ship at all?
 *
 * The rung check is the sharp edge: an entity below `working` has not established
 * a mechanism or grounded a single number. Selling from it means asserting in
 * public something the research could not assert in private.
 */
export function claimVerdict(claim: Claim, productSlug: string): Verdict {
  if (!claim.text?.trim()) return { ok: false, reason: "empty claim" };

  if (claim.kind === "none") {
    return { ok: false, reason: "asserted with no evidence — name the entity, benchmark, voice, or incident it rests on" };
  }
  if (!claim.citation?.url) {
    return { ok: false, reason: "no citation — a claim without a receipt is a slogan" };
  }
  if (!claim.falsifier?.trim()) {
    return { ok: false, reason: "no falsifier — say what evidence would prove this wrong, or it is not a claim" };
  }

  if (claim.entity_slug) {
    const e = loadEntities(productSlug).find((x) => x.slug === claim.entity_slug);
    if (!e) {
      return { ok: false, reason: `cites entity "${claim.entity_slug}", which does not exist in the corpus` };
    }
    const gate = gateFor(e);
    if (gate.overclaimed.length > 0) {
      return {
        ok: false,
        reason: `rests on ${e.slug}, which claims ${gate.current.label} but has not earned it (missing: ${gate.overclaimed
          .map((r) => r.label)
          .join("; ")})`,
      };
    }
    const rung = gate.current.label;
    if (rung !== "working" && rung !== "reference") {
      return {
        ok: false,
        reason: `rests on ${e.slug}, which is only at "${rung}". Selling from it asserts in public what the research could not establish in private — take it to "working" first`,
      };
    }
  }
  return { ok: true };
}

/** Will this post physically fit where it is going? */
export function postVerdict(post: Post, plan: LaunchPlan, productSlug: string): Verdict {
  const spec = CHANNELS[post.channel];
  if (!spec) return { ok: false, reason: `unknown channel "${post.channel}"` };

  if (spec.max_chars && post.copy.length > spec.max_chars) {
    return {
      ok: false,
      reason: `${post.copy.length} characters on ${spec.name}, which takes ${spec.max_chars}. ${spec.fails_at}`,
    };
  }

  if (post.claim_id) {
    const claim = plan.claims.find((c) => c.id === post.claim_id);
    if (!claim) return { ok: false, reason: `references claim "${post.claim_id}", which is not in the plan` };
    const v = claimVerdict(claim, productSlug);
    if (!v.ok) return { ok: false, reason: `claim cannot ship — ${v.reason}` };
  }

  /**
   * Outbound channels reach into somewhere that belongs to other people. The
   * platform will not pretend that is the same act as posting to your own feed:
   * a plan that sends into a group or an inbox has to say whose it is.
   */
  if (isOutbound(post.channel) && !/\b(own|owned|our|opt-in|opted[- ]in|subscriber|waitlist|list)\b/i.test(post.copy)) {
    return {
      ok: false,
      reason: `${spec.name} sends to other people's ${
        post.channel === "email" ? "inboxes" : "groups"
      }. Name the opted-in audience this goes to. ${spec.fails_at}`,
    };
  }

  return { ok: true };
}

/** Apply both gates across a plan, marking what cannot ship and why. */
export function gatePlan(plan: LaunchPlan, productSlug: string): LaunchPlan {
  const calendar = plan.calendar.map((p): Post => {
    if (p.status === "published") return p;
    const v = postVerdict(p, plan, productSlug);
    return v.ok
      ? { ...p, status: p.status === "blocked" ? "draft" : p.status, blocked_reason: undefined }
      : { ...p, status: "blocked", blocked_reason: v.reason };
  });
  return { ...plan, calendar };
}

export type ClaimAudit = { claim: Claim; verdict: Verdict };

export function auditClaims(plan: LaunchPlan, productSlug: string): ClaimAudit[] {
  return plan.claims.map((claim) => ({ claim, verdict: claimVerdict(claim, productSlug) }));
}
