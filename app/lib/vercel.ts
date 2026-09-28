/**
 * Vercel API — enough of it for the site to finish its own setup when it is
 * running on Vercel: store a variable, and redeploy so the next build pulls a
 * product it did not have.
 *
 *   VERCEL_TOKEN        https://vercel.com/account/tokens
 *   VERCEL_PROJECT_ID   Project → Settings → General
 *   VERCEL_ORG_ID       the team id, when the project is under a team
 *
 * Without these, /setup still works — it prints what to add and where, and the
 * redeploy is a button in the Vercel dashboard instead of here.
 */
const API = "https://api.vercel.com";

export function vercelConfigured(): boolean {
  return Boolean(process.env.VERCEL_TOKEN);
}

let _projectId: Promise<string> | null = null;

/**
 * This project's id. VERCEL_PROJECT_ID when set; otherwise found through the
 * API by matching the production URL Vercel gives every deployment, so a
 * deployment that has only the token can still write to itself.
 */
export function projectId(): Promise<string> {
  if (process.env.VERCEL_PROJECT_ID) return Promise.resolve(process.env.VERCEL_PROJECT_ID);
  if (!_projectId) {
    _projectId = (async () => {
      const prodUrl = (process.env.VERCEL_PROJECT_PRODUCTION_URL ?? "").toLowerCase();
      const depUrl = (process.env.VERCEL_URL ?? "").toLowerCase();
      const r = await call<{ projects: { id: string; name: string; targets?: { production?: { alias?: string[] } } }[] }>("GET", "/v9/projects?limit=100");
      const byAlias = r.projects.find((p) => (p.targets?.production?.alias ?? []).some((a) => a.toLowerCase() === prodUrl));
      const byName = r.projects.find((p) => depUrl.startsWith(`${p.name.toLowerCase()}-`) || depUrl === `${p.name.toLowerCase()}.vercel.app`);
      const found = byAlias ?? byName;
      if (!found) throw new Error("could not tell which Vercel project this is — set VERCEL_PROJECT_ID");
      return found.id;
    })().catch((err) => {
      _projectId = null;
      throw err;
    });
  }
  return _projectId;
}

/** True when this process is running on Vercel (build or runtime). */
export const onVercel = () => Boolean(process.env.VERCEL);

const team = () => (process.env.VERCEL_ORG_ID ? `teamId=${encodeURIComponent(process.env.VERCEL_ORG_ID)}` : "");

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${API}${path}${team() ? sep + team() : ""}`, {
    method,
    headers: { authorization: `Bearer ${process.env.VERCEL_TOKEN}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(`Vercel ${method} ${path}: ${json.error?.message ?? `HTTP ${res.status}`}`);
  return json;
}

/** Upsert encrypted variables on every target. */
export async function setVercelEnv(entries: { key: string; value: string }[]): Promise<void> {
  if (!vercelConfigured()) throw new Error("VERCEL_TOKEN must be set to store variables on Vercel");
  await call("POST", `/v10/projects/${await projectId()}/env?upsert=true`,
    entries.map((e) => ({ key: e.key, value: e.value, type: "encrypted", target: ["production", "preview", "development"] })));
}

type Project = { name: string; link?: { type: string; repoId?: number; productionBranch?: string } };

/**
 * A production deployment from the linked repository's production branch —
 * what makes a product created at runtime appear, because content is pulled
 * at build time.
 */
export async function redeploy(): Promise<{ id: string; url: string }> {
  if (!vercelConfigured()) throw new Error("VERCEL_TOKEN must be set to redeploy from here");
  const id = await projectId();
  const p = await call<Project>("GET", `/v9/projects/${id}`);
  if (!p.link?.repoId) throw new Error("the Vercel project is not linked to a git repository, so it cannot be redeployed from here");
  const d = await call<{ id: string; url: string }>("POST", `/v13/deployments`, {
    name: p.name,
    project: id,
    target: "production",
    gitSource: { type: p.link.type, repoId: p.link.repoId, ref: p.link.productionBranch ?? "main" },
  });
  return { id: d.id, url: d.url };
}
