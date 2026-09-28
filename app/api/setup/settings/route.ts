/**
 * POST /api/setup/settings — save what /setup collects: administrators, how
 * sign-in codes are mailed, Google sign-in; and, on Vercel, the database keys,
 * which the site writes into its own environment and redeploys to pick up.
 *
 * Reachable before any account exists (proxy.ts lists it as public), so it
 * authenticates here, three ways, any one of which is enough:
 *   - a signed-in site administrator;
 *   - local single-user — the request came from localhost on a computer-hosted
 *     site (app/lib/onboarding.ts), where the session above is automatic;
 *   - the owner proof: the Vercel token, compared in constant time with the
 *     site's own. Whoever holds the host key already owns the deployment.
 */
import { NextResponse } from "next/server";
import { getSession } from "@/app/lib/auth";
import { isSetupAdmin } from "@/app/lib/provision";
import { localSingleUserRequest, ownerProof, saveOnboarding, type OnboardingInput } from "@/app/lib/onboarding";
import { invalidateMemberships } from "@/app/lib/memberships";
import { onVercel, redeploy, setVercelEnv, vercelConfigured } from "@/app/lib/vercel";
import { fail } from "../_guard";

type Body = OnboardingInput & {
  proof?: string;
  turso?: { token?: string; org?: string; group?: string };
};

export async function POST(req: Request) {
  const body = ((await req.json().catch(() => ({}))) ?? {}) as Body;
  const session = await getSession();
  const by = (await isSetupAdmin(session))
    ? session?.email ?? "admin"
    : (await localSingleUserRequest())
      ? "owner@localhost"
      : ownerProof(body.proof)
        ? "owner (vercel token)"
        : null;
  if (!by) {
    return NextResponse.json(
      { error: onVercel() ? "sign in as a site administrator, or paste the Vercel token this deployment runs with" : "sign in as a site administrator" },
      { status: 403 },
    );
  }

  try {
    await saveOnboarding(body, by);
    invalidateMemberships();
    const notes: string[] = ["Saved."];

    const tk = body.turso;
    if (tk?.token?.trim() && tk.org?.trim()) {
      if (!vercelConfigured()) throw new Error("the database keys can only be stored from here on Vercel, with VERCEL_TOKEN set; on a computer put them in .env.local");
      const entries = [{ key: "TURSO_API_TOKEN", value: tk.token.trim() }, { key: "TURSO_ORG", value: tk.org.trim() }];
      if (tk.group?.trim()) entries.push({ key: "TURSO_GROUP", value: tk.group.trim() });
      await setVercelEnv(entries);
      const d = await redeploy();
      notes.push(`Database keys stored on Vercel; redeploying (${d.url}). Reload this page in a minute.`);
      return NextResponse.json({ message: notes.join(" "), next: { kind: "redeployed", url: d.url } });
    }
    return NextResponse.json({ message: notes.join(" ") });
  } catch (err) {
    return fail(err);
  }
}
