import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/app/lib/auth";
import { hit, spend } from "@/app/lib/rateLimit";
import { findAccountByEmail } from "@/app/lib/identity/accounts";
import { roleAtLeast } from "@/app/lib/memberships";
import { allowanceFor, recordBytes } from "@/app/lib/usage";

/**
 * POST /api/wishes/upload?name=&type= — accept a raw file body and return a URL
 * the wish can reference. No Blob/GitHub backend here: the bytes come back as a
 * data: URL (in-memory demo), so attachments render without external storage.
 *
 * WHY THIS VALIDATES MORE THAN IT LOOKS LIKE IT SHOULD
 * The returned data: URL is embedded in a wish body, and a wish body is a row
 * in a billed database. So an unchecked upload here is a way to write arbitrary
 * content into the platform's storage, at megabytes a time, on somebody else's
 * bill. Three things follow:
 *
 *   1. A session is required. `proxy.ts` already gates this path, but the check
 *      is repeated here — a route that is only safe because of its position in
 *      a matcher is one refactor away from being unsafe.
 *   2. The content type is allow-listed. The caller supplies `type` and it goes
 *      straight into the data: URL, so an unfiltered value lets the caller pick
 *      what a browser will execute when the attachment is opened.
 *   3. Uploads are limited per account two ways — by COUNT and by BYTES. The
 *      count alone bounds nothing useful: twenty requests at the per-file cap is
 *      still tens of megabytes an hour, base64-inflated, into a billed database.
 *      The old comment below is kept because the rest of its reasoning stands.
 *
 *   3b. Uploads are rate-limited per account, because the size cap alone bounds
 *      one request rather than a thousand.
 */
export const runtime = "nodejs";

/**
 * Per file. 2 MB is generous for the screenshot or short clip a wish actually
 * needs, and the number people notice is the one they size an image against.
 */
const MAX_RAW_BYTES = Number(process.env.UPLOAD_MAX_BYTES ?? 2_000_000);

/**
 * Per account, per window — the cap that was missing.
 *
 * A per-file limit and a per-request-count limit together still allow
 * `count × size` bytes an hour, which for the old numbers was 86 MB. These
 * attachments are base64 inside a wish row, so a megabyte uploaded is about
 * 1.37 MB stored, in a database that is billed. 20 MB an hour is far past any
 * honest use of a wishlist and far short of a problem.
 */
const MAX_BYTES_PER_WINDOW = Number(process.env.UPLOAD_BYTES_PER_WINDOW ?? 20_000_000);

/** Images only. Attachments exist so a person can show what they mean; nothing
 *  in the wish UI renders a PDF or an archive, so accepting them buys the
 *  uploader nothing and costs the repo an arbitrary-file write. `svg` is
 *  excluded on purpose: it is a script-carrying format. */
const ALLOWED = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

const PER_ACCOUNT_LIMIT = Number(process.env.UPLOAD_LIMIT ?? 20);
const PER_ACCOUNT_WINDOW_MS = Number(process.env.UPLOAD_WINDOW_MS ?? 60 * 60 * 1000);

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.email) {
    return NextResponse.json({ error: "sign-in required" }, { status: 401 });
  }

  /**
   * The free allowance, before the bytes are read rather than after.
   *
   * The rate limits below bound a burst; this bounds a total. They answer
   * different questions and an account can be inside one and past the other.
   */
  const account = await findAccountByEmail(session.email);
  if (account) {
    const isAdmin = await roleAtLeast(session.email, "site", "site", "admin");
    const allowance = await allowanceFor(account.id, isAdmin);
    if (!allowance.ok) {
      return NextResponse.json({ error: allowance.reason, bytes: allowance.bytes }, { status: 402 });
    }
  }

  const rl = hit(`upload:${session.email.toLowerCase()}`, PER_ACCOUNT_LIMIT, PER_ACCOUNT_WINDOW_MS);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many uploads. Try again later." },
      { status: 429, headers: { "retry-after": String(rl.retryAfter) } },
    );
  }

  const name = (req.nextUrl.searchParams.get("name") || "file").slice(0, 120);
  const type = (req.nextUrl.searchParams.get("type") || "").toLowerCase().split(";")[0]!.trim();

  if (!ALLOWED.has(type)) {
    return NextResponse.json(
      { error: `"${name}" is a ${type || "unknown"} file. Attach a PNG, JPEG, GIF or WebP image.` },
      { status: 415 },
    );
  }

  const buf = await req.arrayBuffer();
  if (buf.byteLength === 0) {
    return NextResponse.json({ error: `"${name}" is empty.` }, { status: 400 });
  }
  const mb = (n: number) => (n / 1e6).toFixed(1).replace(/\.0$/, "");

  if (buf.byteLength > MAX_RAW_BYTES) {
    return NextResponse.json(
      { error: `"${name}" is ${mb(buf.byteLength)} MB — the limit is ${mb(MAX_RAW_BYTES)} MB per file.` },
      { status: 413 },
    );
  }

  // The budget is spent AFTER the per-file check and BEFORE anything is stored,
  // so an oversized file is refused without consuming the allowance, and an
  // accepted one is charged exactly what it costs.
  const budget = spend(
    `upload-bytes:${session.email.toLowerCase()}`,
    buf.byteLength,
    MAX_BYTES_PER_WINDOW,
    PER_ACCOUNT_WINDOW_MS,
  );
  if (!budget.ok) {
    return NextResponse.json(
      {
        error:
          `That would put you over ${mb(MAX_BYTES_PER_WINDOW)} MB of attachments this hour. ` +
          `${mb(budget.remaining)} MB left; the allowance resets in ${Math.ceil(budget.retryAfter / 60)} min.`,
      },
      { status: 413, headers: { "retry-after": String(budget.retryAfter) } },
    );
  }

  // Check the bytes, not the label. The `type` parameter is caller-supplied, so
  // agreeing with the allow-list proves nothing on its own.
  const head = new Uint8Array(buf.slice(0, 12));
  const is = (sig: number[], off = 0) => sig.every((b, i) => head[off + i] === b);
  const actual =
    is([0x89, 0x50, 0x4e, 0x47]) ? "image/png"
    : is([0xff, 0xd8, 0xff]) ? "image/jpeg"
    : is([0x47, 0x49, 0x46, 0x38]) ? "image/gif"
    : is([0x52, 0x49, 0x46, 0x46]) && is([0x57, 0x45, 0x42, 0x50], 8) ? "image/webp"
    : null;

  if (actual !== type) {
    return NextResponse.json(
      { error: `"${name}" is not a valid ${type.replace("image/", "").toUpperCase()} file.` },
      { status: 415 },
    );
  }

  const b64 = Buffer.from(buf).toString("base64");

  // Charge what is STORED, not what was uploaded: base64 inflates by ~4/3, and
  // the inflated string is the thing that occupies a row. Recording the smaller
  // number would under-count every attachment by a third, forever.
  if (account) await recordBytes(account.id, b64.length);

  return NextResponse.json({ url: `data:${type};base64,${b64}`, name, type });
}
