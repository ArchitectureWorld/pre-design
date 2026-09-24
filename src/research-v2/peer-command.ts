import { sha256CanonicalJson } from '../presentation/canonical-json.ts'
import type { CommandDefinition } from '@deepseek-ai/dsh-commands'
import { RepositoryError } from '../state/repository.ts'
import { boundResearchContext, type RegionalCommandDependencies } from './regional-command.ts'
import { readResearchFile } from './run-store.ts'
import { captureWorkspaceSource, workspaceSourceDescriptorSchema } from './source-intake.ts'
import { analyzePeers } from './peer-analysis.ts'
import { buildPeerAuditBundle, readPeerAuditBundle, replayPeerAuditBundle, savePeerAuditBundle } from './peer-bundle.ts'

function parsePeerOptions(raw:string):{input?:string;verify?:string} {
  if(raw.length>1500)throw new Error('RESEARCH_COMMAND_INVALID')
  const match=/^--(input|verify)=(?:"([^"\n]+)"|'([^'\n]+)'|([^\s]+))$/u.exec(raw.trim())
  if(!match)throw new Error('RESEARCH_COMMAND_INVALID')
  return {[match[1]]:match[2]??match[3]??match[4]}
}
/** Resolves only explicitly named source files. There is no shell, crawler, model call or name-based geocoder. */
export async function loadPeerWorkspaceInput(root:string,relative:string,context:{projectId:string;revision:number},signal?:AbortSignal) {
  signal?.throwIfAborted()
  const raw:unknown=JSON.parse((await readResearchFile(root,relative,4*1024*1024)).replace(/^\uFEFF/u,''))
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('PEER_REQUEST_INVALID')
  const request=raw as Record<string,unknown>
  if(request.projectId!==undefined&&request.projectId!==context.projectId)throw new Error('RESEARCH_PROJECT_MISMATCH')
  const input:Record<string,unknown>={...request,projectId:context.projectId,snapshotId:request.snapshotId??`revision-${context.revision}`}
  if(request.documents!==undefined){
    if(request.captures!==undefined||!Array.isArray(request.documents)||request.documents.length<1||request.documents.length>32)throw new Error('SOURCE_DOCUMENTS_INVALID')
    const descriptors=request.documents.map(d=>workspaceSourceDescriptorSchema.parse(d))
    if(new Set(descriptors.map(d=>d.sourceId)).size!==descriptors.length)throw new Error('SOURCE_ID_DUPLICATE')
    const captures=[]
    for(const descriptor of descriptors){signal?.throwIfAborted();captures.push(await captureWorkspaceSource(root,descriptor))}
    input.captures=captures
    delete input.documents
  }
  signal?.throwIfAborted()
  return input
}
export function createPeerResearchCommand(dependencies:RegionalCommandDependencies):CommandDefinition {
  return {name:'preplan-research-peers',description:'从工作区明确指定的原始资料生成竞品/业态/客群证据对照和离线审计包；不联网、不自动认定经营成功',
    input:{hint:'--input=工作区内请求.json 或 --verify=RUN-…'},handler:async invocation=>{
      try{
        const options=parsePeerOptions(invocation.rawInput??''),signal=(invocation as unknown as {signal?:AbortSignal}).signal
        signal?.throwIfAborted()
        const context=await boundResearchContext(invocation,dependencies)
        const unchanged=async()=>{signal?.throwIfAborted();if(JSON.stringify(await boundResearchContext(invocation,dependencies))!==JSON.stringify(context))throw new Error('RESEARCH_CONTEXT_CHANGED')}
        if(options.verify){
          const bundle=await readPeerAuditBundle(context.root,options.verify)
          if(bundle.manifest.projectId!==context.projectId)throw new Error('RESEARCH_PROJECT_MISMATCH')
          const verified=replayPeerAuditBundle(bundle);await unchanged()
          return {kind:'success',text:`竞品研究审计包复算通过：${options.verify}\n${JSON.stringify(verified)}\n仅验证归档数据、分析与图表一致；不是来源真实性或正式发布认证。`}
        }
        const input=await loadPeerWorkspaceInput(context.root,options.input!,context,signal),result=analyzePeers(input)
        const bundle=buildPeerAuditBundle(result),saved=await savePeerAuditBundle(context.root,bundle,{signal,beforeCommit:async()=>{
          await unchanged()
          const latest=await loadPeerWorkspaceInput(context.root,options.input!,context,signal)
          if(sha256CanonicalJson(latest)!==sha256CanonicalJson(input))throw new Error('RESEARCH_SOURCE_CHANGED')
        }})
        return {kind:'success',text:[`同类项目证据对照已保存：${saved.relativePath}/report.html`,
          `对象${result.summary.total}；来源记载营业供给${result.summary.operatingSupply}；单列参考${result.summary.references}。未证明市场缺口。`,
          bundle.files['regional-od.request.json']?`距离研究输入：${saved.relativePath}/regional-od.request.json（需另行调用地域命令；不自动联网）。`:'空间输入尚不完整；具体缺口已写入analysis-trace.json。',
          `复算：/preplan-research-peers --verify=${saved.runId}`,
          '未改变旧57项执行状态、项目修订或工作区身份；没有授予正式发布资格。'].join('\n')}
      }catch(error){
        const message=error instanceof RepositoryError&&error.code==='session-not-bound'?'RESEARCH_PROJECT_REQUIRED':error instanceof Error?error.message:''
        const safe=/^[A-Z][A-Z0-9_]+$/u.test(message)?message:'PEER_RESEARCH_FAILED'
        return {kind:'error',text:`${safe}：竞品研究未完成或未发布；请核查资料绑定、字段口径和项目状态。`}
      }
    }}
}
