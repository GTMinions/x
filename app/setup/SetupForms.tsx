"use client";

/**
 * The forms on /setup that collect what does not belong in the environment:
 * who administers the site, how sign-in codes are mailed, Google sign-in — and,
 * on Vercel, the database keys the site stores into its own environment.
 *
 * All post to /api/setup/settings. Before any account exists that route takes
 * the owner proof instead of a session: on Vercel, the Vercel token the
 * deployment runs with; on a computer, nothing — a request from localhost is
 * the owner's (app/lib/onboarding.ts). `needProof` says which case we are in.
 */
import { useState, type ReactNode } from "react";
import { useCopy } from "@/app/_platform/copy/client";

type Result = { ok: boolean; message: string; next?: { kind: string; url?: string } };

async function post(body: unknown): Promise<Result> {
  try {
    const r = await fetch("/api/setup/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = (await r.json().catch(() => ({}))) as Partial<Result> & { error?: string };
    if (!r.ok) return { ok: false, message: j.error ?? `HTTP ${r.status}` };
    return { ok: true, message: j.message ?? "Saved.", next: j.next };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

const field: React.CSSProperties = { display: "block", width: "100%", marginTop: 4 };

function Field({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <label className="muted" style={{ fontSize: 13 }}>
      {label}
      {children}
    </label>
  );
}

/** The Vercel-token field, shown only when the request cannot prove itself any other way. */
function Proof({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useCopy();
  return (
    <Field label={t("site.setup.setupforms.label-1")}>
      <input className="input" type="password" value={value} onChange={(e) => onChange(e.target.value)} required autoComplete="off" style={field} />
    </Field>
  );
}

function Outcome({ result }: { result: Result | null }) {
  const { T } = useCopy();
  if (!result) return null;
  return (
    <div style={{ marginTop: 12, padding: "10px 12px", borderRadius: 8, background: result.ok ? "var(--bg-sunk)" : "var(--status-bad-bg, var(--bg-sunk))" }}>
      <p style={{ margin: 0, fontSize: 14, color: result.ok ? "inherit" : "var(--status-bad)" }}>{result.message}</p>
      {result.ok && !result.next && (
        <p className="muted" style={{ margin: "6px 0 0", fontSize: 13 }}><T id="site.setup.setupforms.p-1" /></p>
      )}
    </div>
  );
}

function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const submit = async (body: unknown) => {
    setBusy(true);
    setResult(await post(body));
    setBusy(false);
  };
  return { busy, result, submit };
}

/** Who administers the site. */
export function OwnerForm(props: { needProof: boolean; count: number; origin: "env" | "settings" | "none"; canEdit: boolean }) {
  const { T, t } = useCopy();
  const [emails, setEmails] = useState("");
  const [proof, setProof] = useState("");
  const { busy, result, submit } = useSubmit();
  const locked = !props.canEdit && !props.needProof;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit({ adminEmails: emails, proof: props.needProof ? proof : undefined });
      }}
      className="card"
      style={{ display: "grid", gap: 10, maxWidth: 520, marginTop: 14 }}
    >
      {props.origin === "env" && <p className="muted" style={{ margin: 0, fontSize: 13 }}><T id="site.setup.setupforms.p-2" /></p>}
      {props.origin === "settings" && <p className="muted" style={{ margin: 0, fontSize: 13 }}><T id="site.setup.setupforms.p-3" v={{ count: props.count }} /></p>}
      <Field label={t("site.setup.setupforms.label-2")}>
        <input className="input" type="text" value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="you@example.com" required style={field} />
      </Field>
      {props.needProof && <Proof value={proof} onChange={setProof} />}
      <div>
        <button className="btn" type="submit" disabled={busy || locked}>{busy ? t("site.setup.setupforms.button-1") : t("site.setup.setupforms.button-2")}</button>
      </div>
      {locked && <p className="muted" style={{ margin: 0, fontSize: 13 }}><T id="site.setup.setupforms.p-4" /></p>}
      <Outcome result={result} />
    </form>
  );
}

/** How people get in: sign-in codes by mail, Google, or both. */
export function SignInForm(props: {
  needProof: boolean;
  canEdit: boolean;
  onVercel: boolean;
  mail: { origin: "env" | "settings" | "none"; host: string; user: string; from: string; port: string };
  google: { origin: "env" | "settings" | "none"; clientId: string };
}) {
  const { T, t } = useCopy();
  const [proof, setProof] = useState("");
  const [smtp, setSmtp] = useState({ host: props.mail.host, port: props.mail.port, user: props.mail.user, pass: "", from: props.mail.from });
  const [google, setGoogle] = useState({ clientId: props.google.clientId, clientSecret: "" });
  const { busy, result, submit } = useSubmit();
  const locked = !props.canEdit && !props.needProof;
  const mailLocked = props.mail.origin === "env";
  const googleLocked = props.google.origin === "env";
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit({ smtp: mailLocked ? undefined : smtp, google: googleLocked ? undefined : google, proof: props.needProof ? proof : undefined });
      }}
      className="card"
      style={{ display: "grid", gap: 14, maxWidth: 520, marginTop: 14 }}
    >
      <div style={{ display: "grid", gap: 10 }}>
        <strong style={{ fontSize: 14 }}><T id="site.setup.setupforms.strong-1" /></strong>
        {mailLocked ? (
          <p className="muted" style={{ margin: 0, fontSize: 13 }}><T id="site.setup.setupforms.p-5" v={{ host: props.mail.host, user: props.mail.user }} /></p>
        ) : (
          <>
            <p className="muted" style={{ margin: 0, fontSize: 13 }}><T id="site.setup.setupforms.p-6" /></p>
            <Field label={t("site.setup.setupforms.label-3")}><input className="input" value={smtp.host} onChange={(e) => setSmtp({ ...smtp, host: e.target.value })} placeholder="smtp.gmail.com" style={field} /></Field>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10 }}>
              <Field label={t("site.setup.setupforms.label-4")}><input className="input" value={smtp.port} onChange={(e) => setSmtp({ ...smtp, port: e.target.value })} placeholder="465" style={field} /></Field>
              <Field label={t("site.setup.setupforms.label-5")}><input className="input" value={smtp.user} onChange={(e) => setSmtp({ ...smtp, user: e.target.value })} placeholder="you@gmail.com" style={field} /></Field>
            </div>
            <Field label={props.mail.origin === "settings" ? t("site.setup.setupforms.field-1") : t("site.setup.setupforms.field-2")}>
              <input className="input" type="password" value={smtp.pass} onChange={(e) => setSmtp({ ...smtp, pass: e.target.value })} autoComplete="off" style={field} />
            </Field>
            <Field label={t("site.setup.setupforms.label-6")}><input className="input" value={smtp.from} onChange={(e) => setSmtp({ ...smtp, from: e.target.value })} style={field} /></Field>
          </>
        )}
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        <strong style={{ fontSize: 14 }}><T id="site.setup.setupforms.strong-2" /></strong>
        {googleLocked ? (
          <p className="muted" style={{ margin: 0, fontSize: 13 }}><T id="site.setup.setupforms.p-7" /></p>
        ) : (
          <>
            <p className="muted" style={{ margin: 0, fontSize: 13 }}><T id="site.setup.setupforms.p-8" /></p>
            <Field label={t("site.setup.setupforms.label-7")}><input className="input" value={google.clientId} onChange={(e) => setGoogle({ ...google, clientId: e.target.value })} style={field} /></Field>
            <Field label={props.google.origin === "settings" ? t("site.setup.setupforms.field-3") : t("site.setup.setupforms.field-4")}>
              <input className="input" type="password" value={google.clientSecret} onChange={(e) => setGoogle({ ...google, clientSecret: e.target.value })} autoComplete="off" style={field} />
            </Field>
          </>
        )}
      </div>

      {props.needProof && <Proof value={proof} onChange={setProof} />}
      <div>
        <button className="btn" type="submit" disabled={busy || locked || (mailLocked && googleLocked)}>{busy ? t("site.setup.setupforms.button-3") : t("site.setup.setupforms.button-4")}</button>
      </div>
      {locked && <p className="muted" style={{ margin: 0, fontSize: 13 }}><T id="site.setup.setupforms.p-9" /></p>}
      <Outcome result={result} />
    </form>
  );
}

/** On Vercel without database keys: the site stores them in its own environment and redeploys. */
export function TursoForm(props: { needProof: boolean; canEdit: boolean }) {
  const { T, t } = useCopy();
  const [proof, setProof] = useState("");
  const [turso, setTurso] = useState({ token: "", org: "", group: "" });
  const { busy, result, submit } = useSubmit();
  const locked = !props.canEdit && !props.needProof;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit({ turso, proof: props.needProof ? proof : undefined });
      }}
      className="card"
      style={{ display: "grid", gap: 10, maxWidth: 520, marginTop: 14 }}
    >
      <strong style={{ fontSize: 14 }}><T id="site.setup.setupforms.strong-3" /></strong>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}><T id="site.setup.setupforms.p-10" /></p>
      <Field label={t("site.setup.setupforms.label-8")}><input className="input" type="password" value={turso.token} onChange={(e) => setTurso({ ...turso, token: e.target.value })} required autoComplete="off" style={field} /></Field>
      <Field label={t("site.setup.setupforms.label-9")}><input className="input" value={turso.org} onChange={(e) => setTurso({ ...turso, org: e.target.value })} required style={field} /></Field>
      <Field label={t("site.setup.setupforms.label-10")}><input className="input" value={turso.group} onChange={(e) => setTurso({ ...turso, group: e.target.value })} style={field} /></Field>
      {props.needProof && <Proof value={proof} onChange={setProof} />}
      <div>
        <button className="btn" type="submit" disabled={busy || locked}>{busy ? t("site.setup.setupforms.button-5") : t("site.setup.setupforms.button-6")}</button>
      </div>
      {locked && <p className="muted" style={{ margin: 0, fontSize: 13 }}><T id="site.setup.setupforms.p-11" /></p>}
      <Outcome result={result} />
    </form>
  );
}
