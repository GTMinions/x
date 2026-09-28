/**
 * Go-to-market — the second half of the platform's arc.
 *
 * The arc is: research → demo → launch. This is the launch half, and its one
 * governing rule is that **a GTM claim carries the same burden of proof as a
 * research claim**.
 *
 * Marketing is where a company's discipline usually stops. The research corpus is
 * cited, dated, and gated; then someone writes "the fastest agent platform" on a
 * landing page and no one asks where that came from. So the claim here is a typed
 * object with an `evidence` field pointing back into the research corpus, and the
 * build gate refuses to ship one that cannot name its source.
 *
 * That is not a constraint bolted onto marketing. It is the reason the research
 * exists: a corpus you cannot sell from is a library, and a pitch you cannot
 * source is a liability.
 */
import type { Citation } from "../research/types";

/** How a claim is allowed to be backed. Ordered by how much weight it can carry. */
export type EvidenceKind =
  | "benchmark"   // a measured number from the product's own benchmarks[]
  | "entity"      // a mechanism or fact established on a research entity page
  | "voice"       // a named person said it, in public
  | "incident"    // it actually happened, and it is dated
  | "none";       // asserted, unbacked — cannot ship

/**
 * A marketing claim, and the receipt for it.
 *
 * `entity_slug` resolves into the product's own research corpus, so the claim is
 * one click from the page that establishes it. A reader — or a regulator, or a
 * competitor's lawyer — can follow it. That is the point.
 */
export type Claim = {
  id: string;
  /** The sentence as it would appear in an ad, a deck, or a landing page. */
  text: string;
  kind: EvidenceKind;
  /** The research entity this rests on. Must exist in the corpus. */
  entity_slug?: string;
  /** The specific receipt. A claim with a number needs the source of that number. */
  citation?: Citation;
  /** What would prove this wrong. A claim nobody can falsify is a slogan. */
  falsifier?: string;
  /** Channels this claim is cleared for. Some claims are too long for some formats. */
  channels?: ChannelId[];
};

/**
 * Who we are talking to, and what they already believe.
 *
 * Derived from the research corpus's `voices` where possible — a segment built
 * from what named practitioners actually said in public beats one built from a
 * workshop whiteboard.
 */
export type Audience = {
  id: string;
  name: string;
  /** The job they are trying to get done. */
  jtbd: string;
  /** What they currently do instead. The real competitor is usually a spreadsheet. */
  alternative: string;
  /** The belief that has to change for them to buy. */
  objection: string;
  /** Voices (by id) that evidence this segment exists. */
  voices?: string[];
};

export type ChannelId =
  | "telegram"
  | "x"
  | "linkedin"
  | "youtube"
  | "email"
  | "blog"
  | "producthunt";

/**
 * What a channel will physically accept.
 *
 * Kept as data because the constraints are the interesting part: a claim that
 * needs 40 words of caveat cannot ship on a channel that gives you 12. The
 * calendar validates against this, so a plan cannot quietly contain a post that
 * could never have been posted.
 */
export type ChannelSpec = {
  id: ChannelId;
  name: string;
  /** video · text · image · long-form */
  medium: "video" | "text" | "image" | "long-form";
  /** Hard character budget for the primary copy, where the platform imposes one. */
  max_chars?: number;
  /**
   * House convention for video length, not a measured optimum.
   *
   * Named honestly because the platform has no data on what converts, and a field
   * called `house_seconds` would assert one. It is a starting length to argue
   * with. Replace it with a measurement when you have one.
   */
  house_seconds?: [number, number];
  aspect?: string;
  /** What this channel is actually good at. Naming it stops cargo-culting. */
  works_for: string;
  /** The failure mode. Every channel has one and it is usually ignored. */
  fails_at: string;
};

/** A creative brief — the instruction that produces one asset. */
export type Brief = {
  id: string;
  channel: ChannelId;
  /** The single claim this asset carries. One asset, one claim. */
  claim_id: string;
  audience_id: string;
  /** The opening seconds or the first line. Where the asset lives or dies. */
  hook: string;
  /** Beat by beat. For video, each beat is a shot. */
  beats: string[];
  cta: string;
  /** Assets this needs that do not exist yet. Honest about what is missing. */
  needs?: string[];
};

export type PostStatus = "draft" | "queued" | "published" | "blocked";

/**
 * One scheduled post.
 *
 * `status: "blocked"` is load-bearing. A post whose claim has no evidence, or
 * whose copy exceeds the channel's budget, is blocked with a reason — it does not
 * silently ship and it does not silently disappear.
 */
export type Post = {
  id: string;
  channel: ChannelId;
  brief_id?: string;
  claim_id?: string;
  /** ISO date. The calendar is a plan, not a queue of jobs. */
  scheduled: string;
  copy: string;
  status: PostStatus;
  blocked_reason?: string;
  /** Set only after a real publish through a connected account. */
  published_url?: string;
};

/** The whole launch plan for one product. */
export type LaunchPlan = {
  product: string;
  /** The one sentence. If this is wrong, nothing downstream can be right. */
  positioning: string;
  /** Who it is not for. A positioning that excludes nobody is not positioning. */
  not_for?: string;
  audiences: Audience[];
  claims: Claim[];
  briefs: Brief[];
  calendar: Post[];
};
