/** Developer CLI: no network, verifies an existing stored run without changing it. */
import { readRegionalAuditBundle } from '../src/research-v2/run-store.ts'
import { replayRegionalAuditBundle } from '../src/research-v2/regional-bundle.ts'
import { resolve } from 'node:path'
const [workspace,runId,...rest]=process.argv.slice(2)
if(!workspace||!runId||rest.length)throw new Error('Usage: pnpm exec tsx scripts/verify-regional-audit.ts WORKSPACE RUN-ID')
console.log(JSON.stringify(await replayRegionalAuditBundle(await readRegionalAuditBundle(resolve(workspace),runId)),null,2))
