#!/usr/bin/env bash
#
# x — get it running with one command.
#
#   curl -fsSL https://raw.githubusercontent.com/GTMinions/x/main/install.sh | bash
#
# or, inside a checkout:   bash install.sh
#
# What it does, in order, and only what is missing:
#   1. checks for Node.js 20+ (tells you where to get it if not)
#   2. turns on pnpm, the package manager, which ships with Node
#   3. gets the code (skipped when you are already inside it)
#   4. installs dependencies
#   5. asks two questions, once — WHERE THE SITE RUNS (this computer, or
#      Vercel) and WHERE ITS DATA LIVES (SQLite files here, or Turso) — and
#      writes the keys those answers need to .env.local, which stays on your
#      machine. Everything else is asked on the site's own setup page.
#   6. starts the site (or deploys it) and opens /setup
#
# The two questions are independent, except that a site on Vercel cannot keep
# its data in files (a Vercel function has no disk that survives a request).
# The table of hosts and databases the site knows is app/lib/providers.ts.
#
# Run it again any time; it never overwrites .env.local.
set -euo pipefail

REPO="https://github.com/GTMinions/x.git"
DIR="${X_DIR:-x}"
PORT=4000

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
note() { printf '  %s\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }
# When piped through `curl | bash`, stdin is the script; questions go to the terminal.
ask()  { local __var="$1" __prompt="$2" __default="${3:-}"; local __ans; printf '  %s' "$__prompt"; read -r __ans 2>/dev/null < /dev/tty || __ans=""; printf -v "$__var" '%s' "${__ans:-$__default}"; }
# Same, without echoing what is typed — for tokens.
asks() { local __var="$1" __prompt="$2"; local __ans; printf '  %s' "$__prompt"; read -rs __ans 2>/dev/null < /dev/tty || __ans=""; echo; printf -v "$__var" '%s' "$__ans"; }
open_url() { ( sleep "${2:-4}"; { have xdg-open && xdg-open "$1"; } || { have open && open "$1"; } ) >/dev/null 2>&1 & }

# ── 1. Node ──────────────────────────────────────────────────────────────────
if ! have node || [ "$(node -p 'Number(process.versions.node.split(".")[0])')" -lt 20 ]; then
  say "Node.js 20 or newer is needed, and it is not installed."
  note "Get the LTS build from https://nodejs.org — one download, then run this again."
  exit 1
fi

# ── 2. pnpm ──────────────────────────────────────────────────────────────────
if ! have pnpm; then
  say "Turning on pnpm (it ships with Node) …"
  corepack enable >/dev/null 2>&1 || npm install -g pnpm >/dev/null 2>&1
  have pnpm || { note "Could not enable pnpm. Run: npm install -g pnpm — then run this again."; exit 1; }
fi

# ── 3. The code ──────────────────────────────────────────────────────────────
if [ -f package.json ] && grep -q '"name": "x"' package.json; then
  : # already inside a checkout
else
  have git || { say "git is needed to fetch the code."; note "https://git-scm.com — then run this again."; exit 1; }
  if [ ! -d "$DIR" ]; then
    say "Fetching the code into ./$DIR …"
    git clone --depth 1 "$REPO" "$DIR"
  fi
  cd "$DIR"
fi

# ── 4. Dependencies ──────────────────────────────────────────────────────────
say "Installing dependencies …"
pnpm install --silent 2>&1 | tail -1 || true

# ── 5. Two questions ─────────────────────────────────────────────────────────
HOST="computer"; DB="sqlite"
if [ -f .env.local ]; then
  # Answered before: read the answers back so step 6 does the right thing.
  grep -q '^VERCEL_TOKEN=.' .env.local && HOST="vercel"
  grep -q '^TURSO_API_TOKEN=.' .env.local && DB="turso"
else
  say "Two questions, once. The answers stay in .env.local on this machine."
  echo
  note "Where should the site run?"
  note "  1) On this computer — http://localhost:$PORT, nothing to sign up for."
  note "  2) On Vercel — a public site; needs a Vercel account and a database on Turso."
  ask H "1 or 2 [1]: " "1"
  [ "$H" = "2" ] && HOST="vercel"
  echo
  note "Where should its data live?"
  note "  1) In files on this computer — SQLite, no account, ready now."
  note "  2) On Turso (free) — hosted databases, created for each product on first use."
  if [ "$HOST" = "vercel" ]; then
    note "  (A site on Vercel has to use 2: its functions keep no files between requests.)"
    D="2"
  else
    ask D "1 or 2 [1]: " "1"
  fi
  [ "$D" = "2" ] && DB="turso"

  {
    echo "# Written by install.sh. The host and database keys live here; everything"
    echo "# else is asked on /setup and kept in the site's database. See .env.example."
  } > .env.local
  if [ "$DB" = "turso" ]; then
    echo
    note "Turso: https://app.turso.tech → Settings → API tokens gives the token; the organisation slug is top-left."
    asks TURSO_TOKEN "Turso API token: "
    ask  TURSO_ORG   "Turso organisation slug: "
    ask  TURSO_GROUP "Turso group (press Enter for 'default'): " "default"
    { echo "TURSO_API_TOKEN=$TURSO_TOKEN"; echo "TURSO_ORG=$TURSO_ORG"; echo "TURSO_GROUP=$TURSO_GROUP"; } >> .env.local
  fi
  if [ "$HOST" = "vercel" ]; then
    echo
    note "Vercel: https://vercel.com/account/tokens → Create. The site uses it to store its own settings and redeploy itself."
    asks VERCEL_TOKEN "Vercel token: "
    echo "VERCEL_TOKEN=$VERCEL_TOKEN" >> .env.local
  fi
  note "Saved."
fi

# ── 6. Run, or deploy ────────────────────────────────────────────────────────
if [ "$HOST" = "vercel" ]; then
  # Everything below goes through the Vercel CLI with the token from .env.local:
  # link (or create) the project, store the keys in its environment, deploy.
  set -a; . ./.env.local; set +a
  V="npx --yes vercel@latest --token $VERCEL_TOKEN"
  say "Linking this folder to a Vercel project …"
  $V link --yes >/dev/null
  say "Storing the keys in the project's environment …"
  for T in production preview; do
    for K in VERCEL_TOKEN TURSO_API_TOKEN TURSO_ORG TURSO_GROUP; do
      printf '%s' "${!K}" | $V env add "$K" "$T" --force >/dev/null 2>&1 || true
    done
  done
  say "Deploying … (a few minutes the first time)"
  URL=$($V deploy --prod --yes 2>/dev/null | tail -1)
  say "Deployed: $URL"
  note "Open $URL/setup — it asks for your email and how people sign in."
  note "Before anyone can sign in, the page accepts the Vercel token you just gave as proof that you own the site."
  note "To run the same site on this computer too:  pnpm dev"
  open_url "$URL/setup" 2
  exit 0
fi

say "Starting. Open http://localhost:$PORT/setup — it walks you through the rest."
note "On localhost you are signed in as the owner automatically; nothing to type."
note "Stop with Ctrl-C. Start again later with:  pnpm dev"
open_url "http://localhost:$PORT/setup"
exec pnpm dev
