"use client";

/**
 * The product buttons on /setup. Each one calls an /api/setup route and shows
 * what came back. The owner and sign-in forms are in SetupForms.tsx.
 */
import { useState } from "react";
import { useCopy } from "@/app/_platform/copy/client";

type Result = { ok: boolean; message: string; vars?: Record<string, string>; next?: { kind: string; url?: string; command?: string; slug?: string } };

async function post(path: string, body?: unknown): Promise<Result> {
  try {
    const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
    const j = (await r.json().catch(() => ({}))) as Partial<Result> & { error?: string };
    if (!r.ok) return { ok: false, message: j.error ?? `HTTP ${r.status}` };
    return { ok: true, message: j.message ?? "Done.", vars: j.vars, next: j.next };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

function NextStep({ next, onVercel }: { next?: Result["next"]; onVercel: boolean }) {
  const { T, t } = useCopy();
  if (!next) return null;
  if (next.kind === "redeployed") {
    return <p className="muted" style={{ margin: "8px 0 0", fontSize: 13 }}><T id="site.setup.setupactions.p-1" /></p>;
  }
  if (next.kind === "pulled") {
    return (
      <p className="muted" style={{ margin: "8px 0 0", fontSize: 13 }}>
        <T id="site.setup.setupactions.p-7" c={[<a href={`/${next.slug}`} />]} />
      </p>
    );
  }
  if (next.kind === "redeploy") {
    return <p className="muted" style={{ margin: "8px 0 0", fontSize: 13 }}><T id="site.setup.setupactions.p-2" /></p>;
  }
  return (
    <p className="muted" style={{ margin: "8px 0 0", fontSize: 13 }}>
      {onVercel ? t("site.setup.setupactions.p-3") : t("site.setup.setupactions.p-4")} <code>{next.command}</code>{!onVercel && t("site.setup.setupactions.p-5")}
    </p>
  );
}

function Vars({ vars }: { vars?: Record<string, string> }) {
  const { T } = useCopy();
  if (!vars) return null;
  const text = Object.entries(vars).map(([k, v]) => `${k}=${v}`).join("\n");
  return (
    <div style={{ marginTop: 10 }}>
      <p className="muted" style={{ margin: "0 0 6px", fontSize: 13 }}>
        <T id="site.setup.setupactions.p-6" c={[<code />]} />
      </p>
      <pre className="mono" style={{ fontSize: 12, padding: "10px 12px", background: "var(--bg-sunk)", borderRadius: 8, overflowX: "auto", margin: 0, userSelect: "all" }}>{text}</pre>
    </div>
  );
}

export function SetupActions(props: {
  kind: "products";
  enabled: boolean;
  signedIn: boolean;
  demoSlug?: string;
  demoLoaded?: boolean;
  demoAvailable?: boolean;
  canRedeploy?: boolean;
  onVercel?: boolean;
}) {
  const { T, t } = useCopy();
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [form, setForm] = useState({ slug: "", name: "", tagline: "", accent: "#356a4d" });

  const run = async (label: string, path: string, body?: unknown) => {
    setBusy(label);
    setResult(await post(path, body));
    setBusy(null);
  };

  const disabledNote = !props.signedIn
    ? t("site.setup.setupactions.disablednote-1")
    : !props.enabled
      ? t("site.setup.setupactions.disablednote-2")
      : null;

  return (
    <div style={{ marginTop: 14 }}>
      {props.kind === "products" && (
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <button
              className="btn"
              disabled={!props.enabled || busy !== null || !props.demoAvailable}
              onClick={() => run("demo", "/api/setup/demo")}
            >
              {busy === "demo" ? t("site.setup.setupactions.button-3") : props.demoLoaded ? t("site.setup.setupactions.button-4", { demoSlug: props.demoSlug }) : t("site.setup.setupactions.button-5", { demoSlug: props.demoSlug })}
            </button>
            {!props.demoAvailable && <span className="muted" style={{ fontSize: 13 }}><T id="site.setup.setupactions.span-1" /></span>}
            {props.canRedeploy && (
              <button className="btn ghost" disabled={busy !== null} onClick={() => run("deploy", "/api/setup/deploy")}>
                {busy === "deploy" ? t("site.setup.setupactions.button-6") : t("site.setup.setupactions.button-7")}
              </button>
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run("product", "/api/setup/product", form);
            }}
            className="card"
            style={{ display: "grid", gap: 10, maxWidth: 520 }}
          >
            <strong style={{ fontSize: 14 }}><T id="site.setup.setupactions.strong-1" /></strong>
            <label className="muted" style={{ fontSize: 13 }}>
              <T id="site.setup.setupactions.label-1" c={[<code />, <input className="input" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} placeholder="my-product" required style={{ display: "block", width: "100%", marginTop: 4 }} />]} />
            </label>
            <label className="muted" style={{ fontSize: 13 }}>
              <T id="site.setup.setupactions.label-2" c={[<input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t("site.setup.setupactions.placeholder-1")} required style={{ display: "block", width: "100%", marginTop: 4 }} />]} />
            </label>
            <label className="muted" style={{ fontSize: 13 }}>
              <T id="site.setup.setupactions.label-3" c={[<input className="input" value={form.tagline} onChange={(e) => setForm({ ...form, tagline: e.target.value })} placeholder={t("site.setup.setupactions.placeholder-2")} style={{ display: "block", width: "100%", marginTop: 4 }} />]} />
            </label>
            <label className="muted" style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
              <T id="site.setup.setupactions.label-4" c={[<input type="color" value={form.accent} onChange={(e) => setForm({ ...form, accent: e.target.value })} />]} />
            </label>
            <div>
              <button className="btn" type="submit" disabled={!props.enabled || busy !== null}>
                {busy === "product" ? t("site.setup.setupactions.button-8") : t("site.setup.setupactions.button-9")}
              </button>
            </div>
          </form>
        </div>
      )}

      {disabledNote && <p className="muted" style={{ margin: "8px 0 0", fontSize: 13 }}>{disabledNote}</p>}

      {result && (
        <div style={{ marginTop: 12, padding: "10px 12px", borderRadius: 8, background: result.ok ? "var(--bg-sunk)" : "var(--status-bad-bg, var(--bg-sunk))" }}>
          <p style={{ margin: 0, fontSize: 14, color: result.ok ? "inherit" : "var(--status-bad)" }}>{result.message}</p>
          <Vars vars={result.vars} />
          <NextStep next={result.next} onVercel={!!props.onVercel} />
        </div>
      )}
    </div>
  );
}
