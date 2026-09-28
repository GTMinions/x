"use client";

import { useState } from "react";
import { Plus, Check, Loader2 } from "lucide-react";
import { useCopy } from "@/app/_platform/copy/client";

/** "Add as wish" — turns a roadmap item / researched opportunity into a wish. */
export function RoadmapWish({ scope, title, body }: { scope: string; title: string; body: string }) {
  const { t } = useCopy();
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  return (
    <button
      className="btn ghost"
      style={{ padding: "4px 10px", fontSize: 12 }}
      disabled={state !== "idle"}
      onClick={async () => {
        setState("busy");
        try {
          await fetch("/api/wishes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope, title, body, source: "roadmap" }) });
          setState("done");
        } catch { setState("idle"); }
      }}
    >
      {state === "busy" ? <Loader2 size={12} className="spin" /> : state === "done" ? <Check size={12} /> : <Plus size={12} />}
      {state === "done" ? t("site.platform.roadmapwish.button-1") : t("site.platform.roadmapwish.button-2")}
    </button>
  );
}
