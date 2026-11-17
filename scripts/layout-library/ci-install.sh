#!/usr/bin/env bash
# Isolated CI only: install the same locked dependency graphs as the application.
set -euo pipefail
pnpm install --frozen-lockfile --ignore-scripts
npm ci --prefix web/app --ignore-scripts --no-audit --no-fund
npm ci --prefix web/worker --ignore-scripts --no-audit --no-fund
# Full Web regression imports the built core and accepted prototype assets.
pnpm build
node web/app/build-prototype.mjs
