"use client";

/**
 * The receipt: what happened to a wish, in order, and what it cost.
 *
 * The user's complaint was that the receipt was "broken, not learned". It was
 * worse than broken. It printed a token count that came from a hash of the wish's
 * id and title — 40k to 500k, deterministic, labelled "estimate", sitting beside
 * a model name and a budget. It changed if you renamed the wish. Nothing metered
 * it — the wallet it pretended to read never existed — so every receipt ever
 * rendered fell through to that hash. A reader had no way to
 * tell it from a measurement, which is exactly what made it worth deleting rather
 * than fixing.
 *
 * What replaces it only shows what is written down somewhere:
 *
 *   the timeline — the issue's created_at, its comments, its closed_at, and the
 *                  run logs that name this wish. Each row is a record, not a
 *                  computation.
 *   the tokens   — the `tokens` block on the run that worked the wish. A run writes
 *                  one by running `pnpm tokens --run <id>`, which sums the `usage`
 *                  the API returned on every assistant message of that session —
 *                  the model's own bill, not our guess at it. A run that did not
 *                  measure still reads "not recorded", and says what would change
 *                  that. It is never a zero. A zero is a claim that the loop spent
 *                  nothing, and that claim would be false.
 *
 * The headline `in` counts every input token processed, and on a long run nearly
 * all of it is cache reads — the fresh share is routinely a rounding error
 * against the total. So the note carries the split. Printing the headline alone
 * would read as that many tokens of fresh context: true, and misleading, which is
 * the only kind of wrong this receipt exists to avoid.
 */
import { ExternalLink, Bot, MessageSquare, RotateCcw, Check, Ban, FilePlus2 } from "lucide-react";
import type { ReceiptEvent, Receipt } from "./wishes";
import { useCopy } from "@/app/_platform/copy/client";

export type ReceiptPayload = Receipt & { status: string; issueUrl?: string };

const KIND: Record<ReceiptEvent["kind"], { icon: typeof Bot; tone: string }> = {
  filed: { icon: FilePlus2, tone: "" },
  note: { icon: MessageSquare, tone: "" },
  update: { icon: Bot, tone: "info" },
  followup: { icon: RotateCcw, tone: "warn" },
  worked: { icon: Bot, tone: "info" },
  closed: { icon: Check, tone: "ok" },
};

const day = (at: string) => (at.length >= 10 ? at.slice(0, 10) : at);
const fmt = (n: number) => (n >= 1_000_000 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

export function WishTimeline({ receipt }: { receipt: ReceiptPayload | null }) {
  const { T, t } = useCopy();
  if (!receipt) return <p className="muted" style={{ fontSize: 13, margin: 0 }}><T id="site.platform.wishtimeline.p-1" /></p>;

  const { events, tokens, tokensNote, runs } = receipt;
  const cancelled = receipt.status === "wontfix";

  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: "var(--space-3)" }}><T id="site.platform.wishtimeline.div-1" /></div>

      <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {events.map((e, i) => {
          const spec = KIND[e.kind];
          const Icon = e.kind === "closed" && cancelled ? Ban : spec.icon;
          const tone = e.kind === "closed" && cancelled ? "" : spec.tone;
          const last = i === events.length - 1;

          return (
            <li key={`${e.kind}-${e.at}-${i}`} style={{ display: "flex", gap: "var(--space-3)" }}>
              {/* The rail: a dot per event, joined by a line that stops at the last
                  one. It is what makes this read as a life rather than a log. */}
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
                <span
                  aria-hidden
                  style={{
                    display: "grid", placeItems: "center", width: 22, height: 22,
                    borderRadius: "50%", flexShrink: 0,
                    background: tone ? `var(--status-${tone}-bg)` : "var(--bg-sunk)",
                    color: tone ? `var(--status-${tone})` : "var(--ink-faded)",
                    border: "1px solid var(--rule)",
                  }}
                >
                  <Icon size={11} />
                </span>
                {!last && <span aria-hidden style={{ flex: 1, width: 1, background: "var(--rule)", minHeight: 12 }} />}
              </div>

              <div style={{ flex: 1, minWidth: 0, paddingBottom: last ? 0 : "var(--space-4)" }}>
                <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "baseline", flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{e.title}</span>
                  {e.author && <span className="muted" style={{ fontSize: 12 }}>{e.author}</span>}
                  <span className="muted mono" style={{ fontSize: 11 }}>{day(e.at)}</span>
                </div>
                {e.body && (
                  <p className="muted" style={{ margin: "var(--space-1) 0 0", fontSize: 13, whiteSpace: "pre-wrap" }}>{e.body}</p>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {/* Tokens in and out — the thing the user asked to see. It is a record or it
          is nothing; there is no third option where we make one up. */}
      <div
        style={{
          marginTop: "var(--space-5)",
          paddingTop: "var(--space-4)",
          borderTop: "1px solid var(--rule-soft)",
          display: "flex",
          // Split, not shorthand. The row wraps below ~514px — every phone — and a
          // single `gap` would drop the note 32px under the figures while the pill
          // row sits 12px under the note, binding the caveat to the pills it does
          // not describe. The cache-read sentence is the only thing stopping the
          // headline from reading as fresh context; it has to stay by the number.
          columnGap: "var(--space-8)",
          rowGap: "var(--space-2)",
          flexWrap: "wrap",
          alignItems: "baseline",
        }}
      >
        {/* The empty state is quieter, not typographically different: an em dash on
            the same scale as a figure, with the sentence beside it carrying the
            reason. Shrinking the type when the data is missing shifts the whole
            row's baseline between two states of the same wish. */}
        <Figure label={t("site.platform.wishtimeline.label-1")} value={tokens ? fmt(tokens.in) : "—"} absent={!tokens} />
        <Figure label={t("site.platform.wishtimeline.label-2")} value={tokens ? fmt(tokens.out) : "—"} absent={!tokens} />
        <p className="muted" style={{ margin: 0, fontSize: 12, flex: 1, minWidth: 220, maxWidth: "60ch", lineHeight: 1.5 }}>
          {tokensNote}{" "}
          {!tokens && (
            <>
              <T id="site.platform.wishtimeline.fragment-1" c={[<span className="mono" />, <span className="mono" />]} />
            </>
          )}
        </p>
      </div>

      {/* The run ids link to the log files themselves, not to a summary page. The
          log is the record the figures above were read out of, so it is the thing
          a reader has to be able to open in order to check them. */}
      {runs.length > 0 && (
        <div style={{ marginTop: "var(--space-3)", fontSize: 12, display: "flex", gap: "var(--space-2)", flexWrap: "wrap", alignItems: "center" }}>
          <span className="eyebrow"><T id="site.platform.wishtimeline.span-1" /></span>
          {runs.map((r) =>
            r.logUrl ? (
              <a key={r.runId} className="pill" href={r.logUrl} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
                {r.runId} <ExternalLink size={10} aria-hidden />
              </a>
            ) : (
              <span key={r.runId} className="pill mono">{r.runId}</span>
            ),
          )}
        </div>
      )}

      {receipt.issueUrl && (
        <a
          href={receipt.issueUrl}
          target="_blank"
          rel="noreferrer"
          className="muted"
          style={{ display: "inline-flex", alignItems: "center", gap: 4, marginTop: "var(--space-3)", fontSize: 12, color: "var(--accent)" }}
        >
          <T id="site.platform.wishtimeline.a-1" c={[<ExternalLink size={11} aria-hidden />]} />
        </a>
      )}
    </div>
  );
}

function Figure({ label, value, absent }: { label: string; value: string; absent?: boolean }) {
  return (
    <div>
      <div className="eyebrow">{label}</div>
      <div
        className="mono"
        style={{ fontSize: 22, fontWeight: 600, marginTop: "var(--space-1)", color: absent ? "var(--ink-mute)" : undefined }}
      >
        {value}
      </div>
    </div>
  );
}
