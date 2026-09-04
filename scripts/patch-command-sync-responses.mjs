import { readFile, writeFile } from 'node:fs/promises'

async function replaceOnce(path, before, after) {
  const current = await readFile(path, 'utf8')
  const count = current.split(before).length - 1
  if (count !== 1) throw new Error(`${path}: expected one replacement, found ${count}`)
  await writeFile(path, current.replace(before, after), 'utf8')
}

await replaceOnce(
  'src/commands/register.ts',
  "        return successWithStatus(\n          `Gate ${record.gateId} 已记录为 ${record.decision}。`,\n          repository.readContext(String(invocation.agent.id)),\n          dependencies,\n        )\n",
  "        return { kind: 'success', text: `Gate ${record.gateId} 已记录为 ${record.decision}。` }\n",
)

await replaceOnce(
  'src/commands/register.ts',
  "        return successWithStatus(\n          `已采用概念表现图 ${asset.assetId}，绑定 Revision ${asset.adoptedRevision}。`,\n          repository.readContext(String(invocation.agent.id)),\n          dependencies,\n        )\n",
  "        return { kind: 'success', text: `已采用概念表现图 ${asset.assetId}，绑定 Revision ${asset.adoptedRevision}。` }\n",
)

await replaceOnce(
  'src/commands/register.ts',
  "        return successWithStatus(\n          `已拒绝概念表现图 ${result.rejectedAssetId}，并由已采用资产 ${result.replacementAssetId} 替代。`,\n          repository.readContext(String(invocation.agent.id)),\n          dependencies,\n        )\n",
  "        return {\n          kind: 'success',\n          text: `已拒绝概念表现图 ${result.rejectedAssetId}，并由已采用资产 ${result.replacementAssetId} 替代。`,\n        }\n",
)

await replaceOnce(
  'src/commands/register.ts',
  "        return successWithStatus(\n          `场地边界 ${record.boundaryId} 已正式确认。`,\n          repository.readContext(String(invocation.agent.id)),\n          dependencies,\n        )\n",
  "        return { kind: 'success', text: `场地边界 ${record.boundaryId} 已正式确认。` }\n",
)

console.log('COMMAND_SYNC_RESPONSE_COMPATIBILITY_PATCH_APPLIED')
