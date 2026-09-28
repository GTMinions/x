"use client";

import { useEffect, useState } from "react";
import { useCopy } from "@/app/_platform/copy/client";

type Status = { light: "green" | "yellow" | "red"; label: string; state: string; sha: string | null; ref: string | null; built: string | null };
const HUE = { green: "#3fae6a", yellow: "#e0a53c", red: "#d0554a" };

/** Build-status pill dot for the product top bar. Polls /api/deploy-status. */
export function DeployLight() {
  const { t } = useCopy();
  const [s, setS] = useState<Status | null>(null);
  useEffect(() => {
    let alive = true;
    const tick = () => fetch("/api/deploy-status").then((r) => r.json()).then((d) => alive && setS(d)).catch(() => alive && setS({ light: "red", label: "offline", state: "?", sha: null, ref: null, built: null }));
    tick();
    const id = setInterval(tick, 30000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  if (!s) return null;
  const title = t("site.platform.deploylight.title-2", { label: s.label, state: s.state, sha: s.sha ? ` · ${s.sha}` : "", ref: s.ref ? ` @ ${s.ref}` : "", v: s.built ? t("site.platform.deploylight.title-1", { v: new Date(s.built).toLocaleString() }) : "" });
  return (
    <span title={title} style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "rgba(255,255,255,0.7)", fontSize: 12 }}>
      <span style={{ width: 8, height: 8, borderRadius: 999, background: HUE[s.light], animation: s.light === "yellow" ? "spin 1.4s linear infinite" : "none" }} />
      {s.label}
    </span>
  );
}
