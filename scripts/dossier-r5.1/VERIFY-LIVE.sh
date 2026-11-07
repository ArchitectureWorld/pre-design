#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
TARGET="${PRE_WEB_ROOT:-$(cd "$HERE/../.." && pwd)}"
ARGS=("$@")
for ((i=0;i<${#ARGS[@]};i++)); do
  if [[ "${ARGS[$i]}" == "--target" ]]; then TARGET="${ARGS[$((i+1))]:?--target需要目录}"; fi
done
NODE="$TARGET/web/worker/node_modules/node/bin/node"
if [[ ! -x "$NODE" ]]; then NODE="$(command -v node)"; fi
exec "$NODE" "$HERE/live-smoke.mjs" --target "$TARGET" "${ARGS[@]}"
