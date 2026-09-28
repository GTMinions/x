/**
 * Offline wish text helpers — no backend. Powers the voice-input title guess and
 * the "split a transcript into wishes" flow in the composer.
 */

const BUG_HINTS = /\b(doesn'?t|does not|broken|error|crash|can'?t|cannot|missing|fails?|wrong|bug|stuck|blank|empty)\b/i;
const INTENT_HINTS = /\b(add|fix|should|need|want|make|allow|support|show|hide|remove|change|improve|let|enable|create)\b/i;
const NOISE = /^(ok(ay)?|yeah|yep|sure|thanks|thank you|hi|hello|hey|got it|right|cool|nice|lol|haha|um+|uh+)\b/i;

export type Summary = { kind: "bug" | "feature"; title: string; label: string };

export function summarizeWish(text: string): Summary {
  const kind = BUG_HINTS.test(text) ? "bug" : "feature";
  const first = (text.split(/[.!?\n]/)[0] || text).trim();
  const title = first.length > 72 ? first.slice(0, 71).trimEnd() + "…" : first;
  return { kind, title: title || "New wish", label: kind === "bug" ? "Bug" : "Feature" };
}

export type Candidate = { kind: "bug" | "feature"; title: string; raw: string };

/** Split a meeting/discussion transcript into candidate wishes. */
export function extractWishes(transcript: string, max = 14): Candidate[] {
  const cleaned = transcript
    .split("\n")
    .map((l) =>
      l
        .replace(/^@?[A-Za-z][\w .'-]{0,30}\s+\d{1,2}:\d{2}(:\d{2})?\s*/, "") // "Name 09:12:00"
        .replace(/^\d{1,2}:\d{2}(:\d{2})?\s*/, "") // leading timestamp
        .replace(/^\s*[-*•]\s*/, "") // bullets
        .replace(/^\s*\d+[.)]\s*/, "") // "1." / "2)"
        .replace(/^[A-Za-z][\w .'-]{0,30}:\s*/, "") // "Speaker:"
        .trim(),
    )
    .join(" ");

  const sentences = cleaned.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const s of sentences) {
    if (out.length >= max) break;
    if (NOISE.test(s)) continue;
    if (!INTENT_HINTS.test(s)) continue;
    const key = s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 60);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const { kind, title } = summarizeWish(s);
    out.push({ kind, title: title.length > 64 ? title.slice(0, 63) + "…" : title, raw: s });
  }
  return out;
}
