/**
 * Publishing — the omni-channel operations layer.
 *
 * Every channel reduces to the same four steps, which is why the reference
 * implementation could bolt on a second video platform without rewriting anything:
 *
 *   1. authorise   the *user's own* account, via that platform's OAuth
 *   2. upload      the asset somewhere the platform can fetch it
 *   3. publish     create the post, which returns an async job
 *   4. poll        until the platform says it is live, or says why it is not
 *
 * So an adapter is that shape, and nothing more.
 *
 * ── Two rules this module will not bend ──────────────────────────────────────
 *
 * **The platform ships no credentials.** Every adapter takes the user's token as
 * an argument. x never holds a platform key, never posts as itself, and cannot post
 * on behalf of a user who has not connected their own account. (The system this
 * pattern was learned from had live API keys hardcoded in its source. That is the
 * thing not to copy.)
 *
 * **Dry-run is the default.** Without a token, `publish()` returns exactly what it
 * *would* have sent — the copy, the asset spec, the endpoint, the audience — and
 * sends nothing. Publishing is irreversible and public; it is the one operation
 * where the safe default matters more than the convenient one.
 *
 * And one thing this module deliberately does not do: reach strangers. There is no
 * list-scraping, no cold-DM, no posting into groups the user does not belong to.
 * Outbound channels (`email`, `telegram`) require the plan to name an opted-in
 * audience, and the gate blocks them otherwise. That is not squeamishness — cold
 * blasting is how an account gets banned and a domain gets burned, which ends the
 * launch it was meant to serve.
 */
import { CHANNELS, isOutbound } from "./channels";
import type { ChannelId, Post } from "./types";

/** A user's connection to one channel. Supplied at runtime; never stored in the repo. */
export type Connection = {
  channel: ChannelId;
  /** The user's own token. Absent means: not connected, so dry-run. */
  token?: string;
  /** The account or group this posts to, in the user's words. Shown before sending. */
  account?: string;
};

export type PublishResult =
  | { mode: "dry-run"; channel: ChannelId; would_send: string; endpoint: string; note: string }
  | { mode: "live"; channel: ChannelId; url: string }
  | { mode: "refused"; channel: ChannelId; reason: string };

/** Where each channel's post actually goes. Documented so a dry-run can name it. */
const ENDPOINT: Record<ChannelId, string> = {
  telegram: "POST https://api.telegram.org/bot<token>/sendMessage",
  x: "POST https://api.x.com/2/tweets",
  linkedin: "POST https://api.linkedin.com/rest/posts",
  youtube: "POST https://www.googleapis.com/upload/youtube/v3/videos",
  email: "your ESP's send API",
  blog: "your own site",
  producthunt: "manual — Product Hunt has no publish API",
};

/**
 * What would go out, and where.
 *
 * A dry-run is not a stub. It is the actual payload, the actual endpoint, and the
 * actual destination account — everything except the irreversible part. If this
 * does not look right, nothing downstream will be.
 */
export function dryRun(post: Post, conn?: Connection): PublishResult {
  const spec = CHANNELS[post.channel];
  return {
    mode: "dry-run",
    channel: post.channel,
    would_send: post.copy,
    endpoint: ENDPOINT[post.channel],
    note: conn?.account
      ? `Would post to ${conn.account} on ${spec.name}. No token present, so nothing was sent.`
      : `No ${spec.name} account connected. Connect one to publish; until then this is a plan, not a queue.`,
  };
}

/**
 * Publish a post — or, far more often, decline to.
 *
 * The refusals are the substance of this function. A blocked post is one the gate
 * already judged unshippable; publishing it anyway would make the gate ornamental.
 */
export async function publish(post: Post, conn?: Connection): Promise<PublishResult> {
  if (post.status === "blocked") {
    return {
      mode: "refused",
      channel: post.channel,
      reason: post.blocked_reason ?? "blocked by the launch gate",
    };
  }
  if (post.status === "published") {
    return { mode: "refused", channel: post.channel, reason: "already published — publishing twice is not a retry" };
  }

  if (!conn?.token) return dryRun(post, conn);

  if (isOutbound(post.channel) && !conn.account) {
    return {
      mode: "refused",
      channel: post.channel,
      reason: `${CHANNELS[post.channel].name} sends to other people. Name the opted-in audience before this can go out.`,
    };
  }

  /**
   * The live path is intentionally not implemented here.
   *
   * Wiring a real credential into a real publish endpoint is a decision for the
   * person whose account it is, taken deliberately, once — not something a
   * platform should quietly acquire the ability to do on their behalf. The adapter
   * shape above is the contract; the user brings the token and the last mile.
   */
  return {
    mode: "refused",
    channel: post.channel,
    reason:
      `A token is present, but x does not hold the live publish path for ${CHANNELS[post.channel].name}. ` +
      `Posting is public and irreversible: connect the channel deliberately in settings and confirm the payload from the dry-run first.`,
  };
}

/** Dry-run an entire calendar. The pre-flight a person actually reads before a launch. */
export async function dryRunCalendar(posts: Post[], conns: Connection[] = []): Promise<PublishResult[]> {
  const byChannel = new Map(conns.map((c) => [c.channel, c]));
  return Promise.all(posts.map((p) => publish(p, byChannel.get(p.channel))));
}
