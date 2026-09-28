/**
 * What each channel physically accepts, and what it is actually good at.
 *
 * The constraints are the useful part. Most launch plans fail not because the
 * strategy was wrong but because the strategy was never checked against the
 * medium: a claim that needs two sentences of caveat cannot ship on a channel
 * that gives you one line, and a founder discovers this the night before launch.
 *
 * `works_for` / `fails_at` exist to stop cargo-culting. A channel is not a place
 * to put content; it is a specific bet about how a specific audience discovers
 * things, and it has a failure mode.
 */
import type { ChannelSpec, ChannelId } from "./types";

export const CHANNELS: Record<ChannelId, ChannelSpec> = {
  telegram: {
    id: "telegram",
    name: "Telegram",
    medium: "text",
    max_chars: 4096,
    works_for:
      "Reaching a group that already opted in — a community you belong to, your own channel's subscribers, a beta list.",
    fails_at:
      "Cold reach. Unsolicited messages to groups you are not part of are spam, they get the account banned, and they are the fastest way to make a launch look desperate.",
  },
  x: {
    id: "x",
    name: "X",
    medium: "text",
    max_chars: 280,
    works_for:
      "A single sharp claim aimed at people who already follow the space. Best when the claim is contrarian and you can defend it in the replies.",
    fails_at: "Explaining anything. 280 characters cannot carry a mechanism, only a conclusion.",
  },
  linkedin: {
    id: "linkedin",
    name: "LinkedIn",
    medium: "text",
    max_chars: 3000,
    works_for:
      "B2B, and specifically the buyer rather than the user. A dated number with a named source travels here.",
    fails_at:
      "Anything that reads as marketing. The feed's immune system is tuned against it, and the penalty is silence.",
  },
  youtube: {
    id: "youtube",
    name: "YouTube",
    medium: "video",
    house_seconds: [180, 600],
    aspect: "16:9",
    works_for:
      "The long demo: the one where you actually build something with the product in front of the viewer. It shows the thing working rather than describing it.",
    fails_at: "Reach from a standing start. Nobody finds a channel with four subscribers.",
  },
  email: {
    id: "email",
    name: "Email",
    medium: "long-form",
    works_for:
      "The list you own. It is the only channel no platform can take away from you, and it is the only one where you can say something long.",
    fails_at:
      "Anyone who did not ask. Cold email to a scraped list gets the domain blacklisted, and you will need that domain for the people who did ask.",
  },
  blog: {
    id: "blog",
    name: "Blog",
    medium: "long-form",
    works_for:
      "The claim that needs its evidence attached. This is where the research corpus ships directly — the depth IS the differentiator.",
    fails_at: "Distribution. A post nobody links to is a diary entry.",
  },
  producthunt: {
    id: "producthunt",
    name: "Product Hunt",
    medium: "text",
    max_chars: 260,
    works_for: "One day of concentrated attention from people who like trying new things.",
    fails_at:
      "Being a strategy. It is a single event with a long tail of nothing, and a launch that depends on it has no plan.",
  },
};

export const CHANNEL_IDS = Object.keys(CHANNELS) as ChannelId[];

/**
 * Channels that send to other people's inboxes or groups, rather than posting to
 * a surface people choose to visit.
 *
 * These carry a consent question that the others do not, and the platform treats
 * them differently: a plan that reaches into them has to say whose list it is.
 */
export const OUTBOUND_CHANNELS: ChannelId[] = ["telegram", "email"];

export function isOutbound(id: ChannelId): boolean {
  return OUTBOUND_CHANNELS.includes(id);
}
