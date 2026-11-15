#!/usr/bin/env bash
# A disposable PostgreSQL instance. Never run against a production service.
set -euo pipefail
ROOT="$(pwd)"
OUT="${RUNNER_TEMP:-/tmp}/layout-evidence"
PG_BIN="$(pg_config --bindir)"
DATA="${RUNNER_TEMP:-/tmp}/layout-pg-$RANDOM"
SOCKET="/tmp/pre-design-pg-1000"
mkdir -p "$OUT" "$SOCKET"
"$PG_BIN/initdb" -D "$DATA" -U zetta --auth=trust > "$OUT/initdb.log"
"$PG_BIN/pg_ctl" -D "$DATA" -o "-k $SOCKET -p 55439 -h 127.0.0.1" -l "$OUT/postgres.log" -w start
trap '"$PG_BIN/pg_ctl" -D "$DATA" -m fast -w stop || true' EXIT
"$PG_BIN/createdb" -h "$SOCKET" -p 55439 -U zetta pre_design_web
export PRE_DOSSIER_TEST_DATABASE='{"host":"/tmp/pre-design-pg-1000","port":55439,"database":"pre_design_web","user":"zetta"}'
export PRE_LAYOUT_SCREENSHOTS="$OUT/screens"
# Only this isolated CI is allowed to use no-sandbox for distro restrictions.
export PRE_LAYOUT_TEST_NO_SANDBOX=1
node --check web/app/src/server.mjs
node --check web/worker/layout-reference-runner.mjs
node --test --test-concurrency=1 web/app/tests/layout-library*.test.mjs | tee "$OUT/layout-postgres.tap"
node --test --test-concurrency=1 web/app/tests/workflow-contract.test.mjs web/app/tests/workflow-section-pages.test.mjs web/app/tests/material-policy.test.mjs web/app/tests/material-storage.test.mjs web/app/tests/workflow-api.test.mjs web/app/tests/workflow-structured-api.test.mjs web/app/tests/recovery.test.mjs | tee "$OUT/regression.tap"
PRE_WEB_BUILD_DIR="$OUT/dist" node web/app/build-prototype.mjs | tee "$OUT/build.log"
env -u PRE_DOSSIER_TEST_DATABASE node web/app/tests/layout-library-ui.browser.mjs | tee "$OUT/ui.json"
node --input-type=module - "$OUT" <<'NODE'
import {writeFileSync,readFileSync} from 'node:fs';import {execFileSync} from 'node:child_process';import {createHash} from 'node:crypto';
const root=process.argv[2];const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const receipt={schema:'pre-design.layout-ci.v1',testedAt:new Date().toISOString(),sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),node:process.version,database:'disposable PostgreSQL, isolated schemas',result:'passed',realModelVerified:false,productionDeployed:false,tests:['native layout PostgreSQL contracts/API/server/scheduler','selected existing Web regressions','actual Chromium rendering and UI','existing Web build'],files:{postgres:hash(root+'/layout-postgres.tap'),regression:hash(root+'/regression.tap'),ui:hash(root+'/ui.json')}};
writeFileSync(root+'/receipt.json',JSON.stringify(receipt,null,2)+'\n');
NODE
