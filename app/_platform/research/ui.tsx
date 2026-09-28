/** Small presentational atoms shared across the research site. */
import React from "react";
import { depthLabel, gateFor, isStale, refreshDays, type DepthScore, type Status, type Entity } from "./types";
import { T, t as copyText } from "@/app/_platform/copy";

export function DepthMeter({ score }: { score: DepthScore }) {
  const filled = Math.min(10, Math.max(0, Math.round(score)));
  return (
    <span className="depth" title={copyText("site.platform.research.ui.title-1", { score, depthLabel: depthLabel(score) })}>
      {Array.from({ length: 10 }).map((_, i) => (
        <i key={i} className={i < filled ? "on" : ""} />
      ))}
      <span className="mono muted" style={{ marginLeft: 6, fontSize: 11 }}>
        {score}/10 · {depthLabel(score)}
      </span>
    </span>
  );
}

const STATUS_CLASS: Record<Status, string> = {
  shipped: "ok",
  building: "info",
  research: "warn",
  watch: "",
};

export function StatusPill({ status }: { status: Status }) {
  return <span className={`pill ${STATUS_CLASS[status]}`}>{status}</span>;
}

/**
 * The rung, and the open gate.
 *
 * A depth score printed on its own tells a reader nothing — 6 out of 10 against
 * what? This names the rung the page has reached and, more usefully, exactly what
 * it still owes to reach the next one. That turns the ladder from a private
 * metric into a public promise, and it tells a contributor where to start.
 *
 * When the score claims more than the content earns, it says so. A page that
 * overstates its own depth is the one failure the reader cannot detect unaided.
 */
export function DepthGate({
  entity,
  inbound = 0,
  outbound = 0,
  membersBelowWorking,
}: {
  entity: Entity;
  inbound?: number;
  outbound?: number;
  membersBelowWorking?: number;
}) {
  const gate = gateFor(entity, { inbound, outbound, membersBelowWorking });
  const stale = isStale(entity);
  const overclaimed = gate.overclaimed.length > 0;

  return (
    <section
      className="card"
      style={{ borderColor: overclaimed ? "var(--status-warn)" : undefined }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <div className="eyebrow"><T id="site.platform.research.ui.div-1" /></div>
        <strong>{gate.current.label}</strong>
        <span className="mono muted" style={{ fontSize: 11 }}>{entity.depth_score}/10</span>
        {stale && (
          <span className="pill warn" title={copyText("site.platform.research.ui.title-2", { label: gate.current.label, refreshDays: refreshDays(entity.depth_score) })}>
            <T id="site.platform.research.ui.span-1" />
          </span>
        )}
      </div>
      <p className="muted" style={{ marginTop: 6 }}>{gate.current.note}</p>

      {overclaimed && (
        <div style={{ marginTop: 12 }}>
          <div className="eyebrow" style={{ color: "var(--status-warn)" }}>
            <T id="site.platform.research.ui.div-2" v={{ label: gate.current.label }} />
          </div>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {gate.overclaimed.map((r) => (
              <li key={r.id} style={{ marginBottom: 6 }}>{r.label}</li>
            ))}
          </ul>
        </div>
      )}

      {gate.next && !overclaimed && (
        <div style={{ marginTop: 12 }}>
          <div className="eyebrow">
            {gate.unmet.length === 0 ? copyText("site.platform.research.ui.div-3", { label: gate.next.label }) : copyText("site.platform.research.ui.div-4", { label: gate.next.label })}
          </div>
          {gate.unmet.length === 0 ? (
            <p className="muted" style={{ marginTop: 6 }}>
              <T id="site.platform.research.ui.p-1" v={{ label: gate.next.label }} />
            </p>
          ) : (
            <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
              {gate.unmet.map((r) => (
                <li key={r.id} style={{ marginBottom: 6 }}>{r.label}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {!gate.next && !overclaimed && (
        <p className="muted" style={{ marginTop: 12 }}>
          <T id="site.platform.research.ui.p-2" v={{ refreshDays: refreshDays(entity.depth_score) }} />
        </p>
      )}
    </section>
  );
}

export function Tags({ tags }: { tags?: string[] }) {
  if (!tags?.length) return null;
  return (
    <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
      {tags.map((t) => (
        <span key={t} className="pill">
          {t}
        </span>
      ))}
    </span>
  );
}
