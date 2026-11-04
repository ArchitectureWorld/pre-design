#!/usr/bin/env bash
set -euo pipefail
project_root=$(cd "$(dirname "$0")/../.." && pwd -P)
cd "$project_root"
export PATH="$project_root/web/worker/node_modules/node/bin:$PATH"
export PRE_WEB_CONFIG="${PRE_WEB_CONFIG:-$project_root/.local/web/config.json}"
[[ -f "$PRE_WEB_CONFIG" ]] || { echo '请先按 web/app/README.md 创建私有配置文件。' >&2; exit 1; }
node web/app/check-fixed-entry.mjs
exec node web/app/src/main.mjs
