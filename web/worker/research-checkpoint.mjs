import { readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { safeProjectPath } from './project-boundary.mjs'
import { readBoundFile } from './research-artifacts.mjs'

async function originalFiles(workspace) {
  async function collect(folder, depth=0, rows=[]) {
    if (depth > 4 || rows.length > 256) throw new Error('MATERIAL_IDENTITY_INCOMPLETE')
    let entries
    try { entries=await readdir(safeProjectPath(workspace,folder),{withFileTypes:true}) }
    catch (error) { if (error.code === 'ENOENT') return rows; throw error }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) throw new Error('MATERIAL_IDENTITY_INCOMPLETE')
      const path=`${folder}/${entry.name}`
      if (entry.isDirectory()) await collect(path,depth+1,rows)
      else if (entry.isFile()) rows.push({path,contentHash:createHash('sha256').update(await readBoundFile(workspace,path)).digest('hex')})
      else throw new Error('MATERIAL_IDENTITY_INCOMPLETE')
      if (rows.length > 256) throw new Error('MATERIAL_IDENTITY_INCOMPLETE')
    }
    return rows
  }
  const originals=await collect('原始资料')
  return originals.length ? originals : collect('source-materials')
}
function genuineStatements(agent) {
  const session=agent?.session
  if (!session?.id || !session.snapshotEvents) return []
  return session.snapshotEvents().filter(event=>event.type === 'user/message' && event.data?.source?.kind === 'user').flatMap(event=>{
    const text=event.data.content?.filter(part=>part.type === 'text').map(part=>part.text ?? '').join('\n') ?? ''
    const timestamp=typeof event.time === 'number' ? event.time : Date.parse(event.time)
    return text.trim() && Number.isFinite(timestamp) ? [JSON.stringify({sessionId:String(session.id),seq:event.seq,time:new Date(timestamp).toISOString(),text})] : []
  })
}
/** Proof only. Core still verifies the complete frozen corpus and native receipts
 * on replay. Missing/limited evidence never grants automatic reuse. */
export async function checkpointCompatibility(workspace, checkpoint, agent) {
  try {
    if (!/^RUN-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(checkpoint?.manifestRunId)) return {compatible:false,reason:'unverified'}
    const snapshot=JSON.parse((await readBoundFile(workspace,`research/runs/${checkpoint.manifestRunId}/snapshot.json`)).toString('utf8'))
    const frozen=snapshot.corpus?.documents?.filter(row=>!row.provenance && /^(?:原始资料|source-materials)\//u.test(row.path))
    if (!frozen?.length || frozen.some(row=>!/^[a-f0-9]{64}$/u.test(row.contentHash))) return {compatible:false,reason:'unverified'}
    const current=await originalFiles(workspace)
    if (current.length !== frozen.length || current.some(row=>!frozen.some(prior=>prior.path === row.path && prior.contentHash === row.contentHash))) return {compatible:false,reason:'source_changed'}
    const statements=genuineStatements(agent)
    if (!statements.length || typeof snapshot.taskBrief !== 'string') return {compatible:false,reason:'unverified'}
    if (statements.some(row=>!snapshot.taskBrief.split('\n').includes(row))) return {compatible:false,reason:'task_changed'}
    return {compatible:true}
  } catch { return {compatible:false,reason:'unverified'} }
}
