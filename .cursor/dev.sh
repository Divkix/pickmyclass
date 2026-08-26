#!/usr/bin/env bash
# Cloud Agent dev-server terminal (long-running).
#
# Runs the vinext dev server (localhost:3000) with all Cloudflare bindings
# emulated locally.
set -euo pipefail

# Use the .nvmrc-pinned node (see install.sh for why /exec-daemon/node is unfit).
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm use >/dev/null 2>&1 || true
[ -n "${NVM_BIN:-}" ] && export PATH="$NVM_BIN:$PATH"

# Run every Cloudflare binding locally. Without this the @cloudflare/vite-plugin
# tries to open a remote proxy session for the remote-only EMAIL binding and
# fails in non-interactive environments (needs CLOUDFLARE_API_TOKEN).
export CLOUDFLARE_VITE_FORCE_LOCAL=true

exec pnpm run dev
