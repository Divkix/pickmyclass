#!/usr/bin/env bash
# Cloud Agent install phase (durable, idempotent).
#
# Prepares the base machine and project dependencies. Runs once when an
# environment build is created (captured in the snapshot) and again for
# just-in-time boots. Must terminate and be safe to re-run.
set -euo pipefail

# --- Node: use the version pinned in .nvmrc (22 -> 22.22.x). ------------------
# The Cloud Agent runtime ships an older node on PATH at /exec-daemon/node that
# lacks default TypeScript type-stripping, which breaks the oxlint `.ts` plugin
# and the vinext dev server. Force the nvm-managed node ahead of it. NVM_BIN is
# re-prepended after `nvm use` because the login shell re-adds /exec-daemon.
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm install >/dev/null 2>&1 || true
nvm use >/dev/null 2>&1 || true
[ -n "${NVM_BIN:-}" ] && export PATH="$NVM_BIN:$PATH"
node --version

# --- System dependency: local PostgreSQL. ------------------------------------
# The app talks to Postgres through the Cloudflare Hyperdrive binding, whose
# localConnectionString (wrangler.jsonc) points at localhost:5432. Install the
# server here so the schema/service can be brought up per boot in start.sh.
if ! command -v pg_ctlcluster >/dev/null 2>&1; then
  sudo apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postgresql postgresql-contrib
fi

# --- Project dependencies. ---------------------------------------------------
# pnpm-workspace.yaml pins the toolchain and the @clerk/shared public-hoist that
# the vinext dev server needs; the lockfile is authoritative.
corepack enable >/dev/null 2>&1 || true
pnpm install --frozen-lockfile
