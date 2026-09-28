# Security policy

## Reporting a vulnerability

**Use GitHub's private vulnerability reporting** — the *Report a vulnerability*
button under this repository's **Security** tab. It opens a private thread with
the maintainers that only becomes public if and when we publish an advisory.

If that is unavailable to you, email **gtminions.dev@gmail.com** with `SECURITY` in
the subject.

**Please do not open a public issue for a vulnerability.** A public issue is a
working exploit handed to everyone reading the repository, including anyone
running their own deployment of this code, before there is a fix for them to
apply.

What helps, in rough order of usefulness: what an attacker gains, the smallest
reproduction you have, the commit you tested, and whether it needs an account.
A rough report today beats a polished one next month.

Expect an acknowledgement within **3 working days** and an assessment within
**10**. This is a small project — that is a commitment to answer, not to a
same-week fix.

You are welcome to disclose publicly after a fix ships, or after 90 days if we
have gone quiet. We will credit you in the advisory unless you would rather we
did not.

---

## What is in scope

The code in this repository, and the deployed instance at the URL in the
repository description.

Out of scope: findings against **your own** deployment that follow from your
configuration rather than from this code (an unset `BYOK_ENCRYPTION_KEY`, a
world-readable `.env.local`, a Turso token with wider scope than it needs).
Those are real problems, but they are yours to fix and we cannot.

---

## The security model, so you can aim

Two things carry the weight, and it is worth knowing which:

**A wish is untrusted input.** Anyone with an account can file one, and the
build loop reads it and acts on it. Anything that gets a wish to make the loop
step outside the product it was filed against, exfiltrate a credential, or write
somewhere it should not, is a real finding and a serious one.

**Products are isolated from each other.** `app/lib/access.ts` decides who may
read a product; per-product databases hold each product's data behind its own
scoped token, and `.githooks/check-product-scope.sh` keeps a product's agent
inside its own folder. Anything that reads one product's wishes, corpus or
workspace from another product's context — or without a grant at all — is a
finding.

**What is deliberately *not* secret:** the existence, slug and route of every
product, and the whole codebase. This is an open-source project; a `git clone`
tells you all of it. Access control here protects a product's **data**, never
the fact that it exists. A refusal page says "you do not have access" rather
than faking a 404 for exactly that reason.

Credentials are never returned to a browser. One endpoint returns a decrypted
API key — `POST /api/internal/wish-key` — and it is keyed on a **single named
wish**, authenticated with `WISH_WORKER_TOKEN`, so a caller cannot enumerate.
An unset token makes it refuse everything rather than open up.

---

## Known, assessed, not being fixed

**`image-size` — GHSA-5p2g-fcmc-qvqq (2 × high), reached via `pptxgenjs`.**
Unreachable in this codebase: the only call path is
`app/_platform/slides/toPptx.ts`, which builds decks from text and passes no
images, so the vulnerable code never runs. It stays on the audit report until
`pptxgenjs` updates its dependency. If you find a path that *does* reach it,
that is a finding — please report it.

---

## If you run your own instance

Four things decide whether your deployment is safe, and none of them are
defaults this repository can set for you:

- **`BYOK_ENCRYPTION_KEY`** encrypts users' API keys at rest. Unset means the
  feature is **off** — the platform refuses to store a key it cannot encrypt
  rather than keeping one in the clear. Do not work around that.
- **`SITE_ADMIN_EMAILS`** is your bootstrap admin list. Unset means nobody can
  administer the platform, which is the safe failure. Set it to your own
  address before you first sign in.
- **Rate limits are per-instance and in-memory** (`app/lib/rateLimit.ts`), so on
  serverless the real ceiling is `limit × instances`. Put a real WAF in front if
  you are exposed to the public.
- **The build loop needs no production credentials.** If yours has them, a wish
  that talks the loop into misbehaving reaches your database. Give it a
  least-privilege token and let a human merge its work.
