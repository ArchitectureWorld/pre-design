/** Offline synthetic acceptance sample. It never calls the public routing service. */
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { buildRegionalAuditBundle, replayRegionalAuditBundle } from '../src/research-v2/regional-bundle.ts'
import { runRegionalOd } from '../src/research-v2/regional-od.ts'
import { saveRegionalAuditBundle } from '../src/research-v2/run-store.ts'
import { regionalRequest, osrmResponse, jsonResponse } from '../tests/helpers/regional-od-fixture.ts'

const root = resolve('work/research-regional-demo')
await mkdir(root, { recursive: true })
const input = regionalRequest()
input.scope = '纯合成演示：坐标与路由响应均为测试夹具，未调用真实公开服务；不能用作任何实际项目的策划依据。'
const now = () => new Date('2026-09-24T01:00:00Z')
const outputs = []
for (const mode of ['injected', 'offline'] as const) {
  const result = await runRegionalOd(input, { now, allowNetwork: mode === 'injected', fetch: async () => jsonResponse(osrmResponse()) })
  const bundle = buildRegionalAuditBundle(result)
  const replay = await replayRegionalAuditBundle(bundle)
  const saved = await saveRegionalAuditBundle(root, bundle)
  outputs.push({ mode, ...saved, replay })
}
await writeFile(resolve(root, 'DEMO.json'), JSON.stringify({ purpose: input.scope, outputs }, null, 2) + '\n')
console.log(JSON.stringify({ root, outputs }, null, 2))
