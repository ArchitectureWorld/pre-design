#!/usr/bin/env bash
# A disposable PostgreSQL instance. Never run against a production service.
set -euo pipefail
ROOT="$(pwd)"
OUT="${RUNNER_TEMP:-/tmp}/layout-evidence"
PG_BIN="${PRE_LAYOUT_PG_BIN:-$(pg_config --bindir)}"
DATA="${RUNNER_TEMP:-/tmp}/layout-pg-$RANDOM"
SOCKET="/tmp/pre-design-pg-1000"
mkdir -p "$OUT" "$SOCKET"
"$PG_BIN/initdb" -D "$DATA" -U zetta --auth=trust --encoding=UTF8 --locale=C > "$OUT/initdb.log"
# Legacy Web API regressions use this isolated socket; newer fixtures use TCP.
"$PG_BIN/pg_ctl" -D "$DATA" -o "-k $SOCKET -p 55439 -h 127.0.0.1" -l "$OUT/postgres.log" -w start
trap '"$PG_BIN/pg_ctl" -D "$DATA" -m fast -w stop || true' EXIT
node --input-type=module <<'DB'
import pg from 'pg'
const client=new pg.Client({host:'127.0.0.1',port:55439,user:'zetta',database:'postgres'})
await client.connect();await client.query('CREATE DATABASE pre_design_web');await client.end()
DB
export PRE_DOSSIER_TEST_DATABASE='{"host":"127.0.0.1","port":55439,"database":"pre_design_web","user":"zetta"}'
export PRE_LAYOUT_SCREENSHOTS="$OUT/screens"
# Only this isolated CI is allowed to use no-sandbox for distro restrictions.
export PRE_LAYOUT_TEST_NO_SANDBOX=1
node --check web/app/src/server.mjs
node --check web/worker/layout-reference-runner.mjs
node --test --test-concurrency=1 web/app/tests/layout-*.test.mjs web/app/tests/research-model-runtime.test.mjs web/app/tests/service-policy.test.mjs | tee "$OUT/layout-postgres.tap"
node --test --test-concurrency=1 web/app/tests/workflow-contract.test.mjs web/app/tests/workflow-content.test.mjs web/app/tests/workflow-section-pages.test.mjs web/app/tests/material-policy.test.mjs web/app/tests/material-storage.test.mjs web/app/tests/workflow-api.test.mjs web/app/tests/workflow-structured-api.test.mjs web/app/tests/recovery.test.mjs | tee "$OUT/regression.tap"
node --test --test-concurrency=1 web/app/tests/layout-library-composition.browser.mjs | tee "$OUT/composition-browser.tap"
PRE_WEB_BUILD_DIR="$OUT/dist" node web/app/build-prototype.mjs | tee "$OUT/build.log"
PRE_WEB_BUILD_DIR="$OUT/dist" PRE_LAYOUT_SCREENSHOTS="$OUT/screens-postgres" node web/app/tests/layout-library-ui.browser.mjs | tee "$OUT/ui-postgres.json" "$OUT/ui.json"
PRE_WEB_BUILD_DIR="$OUT/dist" PRE_LAYOUT_SCREENSHOTS="$OUT/screens-upload" node web/app/tests/layout-upload.browser.mjs | tee "$OUT/upload-ui.json"
PRE_WEB_BUILD_DIR="$OUT/dist" PRE_LAYOUT_SCREENSHOTS="$OUT/screens-large-pdf" node web/app/tests/layout-large-pdf.browser.mjs | tee "$OUT/large-pdf-ui.json"
PRE_WEB_BUILD_DIR="$OUT/dist" PRE_LAYOUT_SCREENSHOTS="$OUT/screens-reference-review" node web/app/tests/layout-reference-review.browser.mjs | tee "$OUT/reference-review-ui.json"
node --input-type=module - "$OUT" <<'NODE'
import {writeFileSync,readFileSync} from 'node:fs';import {execFileSync} from 'node:child_process';import {createHash} from 'node:crypto';
const root=process.argv[2];const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const receipt={schema:'pre-design.layout-ci.v2',testedAt:new Date().toISOString(),sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),node:process.version,database:'disposable PostgreSQL, isolated schemas',result:'passed',realModelVerified:false,productionDeployed:false,tests:['V1 and V2 native layout PostgreSQL contracts/API/server/scheduler','PPTX ZIP and real LibreOffice parsing; reference evidence, stages and review gates','selected existing Web regressions','actual Chromium composition rendering and reference comparison UI','100 MiB binary PDF upload and 30-page batched analysis','existing Web build'],files:{postgres:hash(root+'/layout-postgres.tap'),regression:hash(root+'/regression.tap'),compositionBrowser:hash(root+'/composition-browser.tap'),uiPostgres:hash(root+'/ui-postgres.json'),ui:hash(root+'/ui.json'),uploadUi:hash(root+'/upload-ui.json'),largePdfUi:hash(root+'/large-pdf-ui.json'),referenceReviewUi:hash(root+'/reference-review-ui.json')}};
writeFileSync(root+'/receipt.json',JSON.stringify(receipt,null,2)+'\n');
NODE
