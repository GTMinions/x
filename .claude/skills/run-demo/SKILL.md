---
name: run-demo
description: Launch and smoke-test x locally. Use when asked to run, start, preview, or verify the platform, or to check that a change renders without runtime errors. Product state is in-memory; sign-in is x's own and needs no external service.
user-invocable: true
---

# run-demo

`x` is a standalone Next.js 16 (App Router) app. Product/research state is
in-memory — no database. **Port 4000 is fixed**, not incidental: the Google OAuth
client registers `http://localhost:4000/api/v1/auth/google/callback` as a
redirect URI, so Google sign-in only works on that port. (2002 belongs to
a sibling app; the two used to collide.)

## Dev
```bash
pnpm install        # first time only
pnpm dev            # http://localhost:4000
```

## Auth — the platform is private
`proxy.ts` gates every route except `/`, `/sign-in`, and `/api/{auth,v1/auth}/*`.
Signed-out requests to anything else 307 to `/sign-in`, so **a smoke test without
a session sees redirects, not pages**.

x is its own identity provider (`app/lib/identity/`) — no external service is
called, and sign-in works on a clone with no secrets:
- **Email code** — `/api/auth/otp/*`. With no `SMTP_HOST`, the code comes back in
  the response as `devCode` and is printed to the server log, so local testing
  needs no inbox. That fallback is off in production, where an unconfigured
  deployment reports the misconfiguration instead of leaking a code.
- **Google** — `/api/v1/auth/google/{start,callback}`. Needs `GOOGLE_CLIENT_ID` +
  `GOOGLE_CLIENT_SECRET` in `.env.local`; the button hides itself without them.

There is no QA account and no code that always works. A backdoor address used to
exist on the old provider; it was not carried over, because a shared bypass in a
public repo is a bypass for everyone who reads it. Use `devCode`.

The identity DB defaults to a local `identity.db`, created and migrated on first
use. Delete the file to reset every account and session.

## Smoke test with a real session
Server components render at request time, so a green build is not proof a page
works. Request a code, read it out of the JSON, verify, then curl the routes.

`curl -c` works here: with `SESSION_COOKIE_DOMAIN` unset the cookie is host-only,
so a jar stores it against `localhost` fine. (It did not always — the cookie was
once issued `Domain=<parent-domain>; Secure`, which curl silently refused to keep,
making every route look 307 when the jar was simply empty.)

Run with SMTP unset so the code comes back as `devCode` instead of being emailed.

```bash
pnpm build            # validate → slides → coherence → topology → search-index → next build
SMTP_HOST= pnpm start &   # :4000 — blank SMTP forces the devCode path
J=$(mktemp)

CODE=$(curl -s -X POST localhost:4000/api/auth/otp/request \
  -H 'content-type: application/json' -d '{"email":"you@example.com"}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin).get("devCode",""))')

curl -s -c "$J" -X POST localhost:4000/api/auth/otp/verify \
  -H 'content-type: application/json' \
  -d "{\"email\":\"you@example.com\",\"code\":\"$CODE\"}"

for r in / /gtm /gtm/research /gtm/research/mcp /ai-edu/research; do
  echo "$r $(curl -s -b "$J" -o /dev/null -w '%{http_code}' localhost:4000$r)"
done
kill %1
```
A route that 307s means the cookie is missing, not that the page is broken.

**A 200 is not the test.** Server components render at request time, so the page
you want to see is the HTML, not the status. Strip the scripts before you grep it —
the RSC flight payload embeds every raw field string, so grepping the response body
for `[[` or `**` finds the source, not what a reader sees, and reports a leak that
is not there:

```bash
curl -s -b "$J" localhost:4000/gtm/research/cartesia \
  | python3 -c "import sys,re,html; h=re.sub(r'<script.*?</script>','',sys.stdin.read(),flags=re.S); \
print(html.unescape(re.sub(r'<[^>]+>',' ',h)))"
```

## Key routes
- `/` — platform product directory (the only public page)
- `/gtm` — the platform · agentic GTM. `/gtm/research` is the large site (407 entities);
  `/gtm/research/mcp` and `/gtm/research/11x` show the full paper anatomy.
- `/ai-edu` — Atlas Learn · `/ai-edu/research`
- `/inference-economics` — Inference Economics (the game) · `/inference-economics/play` in its frame
- each product also has `workspace/`, `roadmap/`, `wishes/`, `changelog/`

Note: dev skips the research entity cache so content edits show up on reload —
entity pages are slower here than in a production build. That's intended.

See `design` for styling and `deploy-demo` to ship.
