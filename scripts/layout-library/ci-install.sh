#!/usr/bin/env bash
# Isolated CI only: no production credentials or services.
set -euo pipefail
ROOT="$(pwd)"
DEPS="${RUNNER_TEMP:-/tmp}/pre-layout-deps"
mkdir -p "$DEPS"
(cd "$DEPS" && test -f package.json || printf '{"private":true}\n' > "$DEPS/package.json")
npm install --prefix "$DEPS" --ignore-scripts --no-audit --no-fund fastify@5.12.8 @fastify/static@10.1.8 pg@8.23.1 zod@4.4.3 typescript@5.9.3 @playwright/test@1.58.2 playwright-core@1.58.2 yaml@2.8.1 sharp@0.34.5 exifr@7.1.3 pdf-lib@1.17.1 pdfjs-dist@6.3.289 jszip@3.10.1 pptxgenjs@4.0.1 pngjs@7.0.0 jpeg-js@0.4.4 jsdom@26.1.0 @deepseek-ai/dsh-sdk-client@0.2.1-rc.5
if [[ -e "$ROOT/node_modules" ]]; then echo 'CI requires clean isolated workspace' >&2; exit 1; fi
ln -s "$DEPS/node_modules" "$ROOT/node_modules"
