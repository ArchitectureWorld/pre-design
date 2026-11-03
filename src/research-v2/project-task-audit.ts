import {sha256CanonicalJson as hash} from '../presentation/canonical-json.ts'
import type {SessionStatement} from '../runtime/material-research-intake.ts'
import type {CompiledModuleCandidate} from './module-author-projection.ts'
import {loadPlanningCatalog} from './catalog.ts'
import {projectResearchPlan} from './planning.ts'
import {getResearchModuleSpec} from './specification.ts'
import type {ResearchFlags} from './types.ts'

const taskFields=new Set(['originalStatement','commissionScope','initiationBasis','decisionsSupported','timeRequirements'])
const taskReferenceFields=new Set([...taskFields,'projectId','projectNature','sourceVersion','sourceLocation'])
const marker='task_statement_refs='
const object=(v:unknown):v is Record<string,any>=>v!==null&&typeof v==='object'&&!Array.isArray(v)
function fail(code:string):never{throw new Error(code)}
export function projectTaskStatements(brief?:string):SessionStatement[]{
  const rows:SessionStatement[]=[],seen=new Set<string>()
  for(const line of brief?.split('\n')??[]){
    try{
      const r=JSON.parse(line)
      if(!object(r)||typeof r.sessionId!=='string'||!r.sessionId.trim()||!Number.isSafeInteger(r.seq)||r.seq<0
        ||typeof r.time!=='string'||!Number.isFinite(Date.parse(r.time))||typeof r.text!=='string'||!r.text.trim())continue
      const key=r.sessionId+':'+r.seq
      if(seen.has(key))fail('MODULE_PROJECT_TASK_STATEMENT_DUPLICATE')
      seen.add(key);rows.push({sessionId:r.sessionId,seq:r.seq,time:r.time,text:r.text})
    }catch(error){if(error instanceof Error&&error.message==='MODULE_PROJECT_TASK_STATEMENT_DUPLICATE')throw error}
  }
  return rows
}

/** Read-only locations of the author's rejected literal quote; never rebind it. */
export function projectTaskQuoteDiagnostics(raw:unknown,brief?:string){
  if(!object(raw)||!Array.isArray(raw.evidence))return undefined
  const statements=projectTaskStatements(brief)
  if(!statements.length)return undefined
  const conflicts=raw.evidence.flatMap((entry:unknown,evidenceIndex:number)=>{
    if(!object(entry)||!object(entry.target)||typeof entry.rationale!=='string'||!entry.rationale.includes(marker))return []
    let refs:unknown
    try{refs=JSON.parse(entry.rationale.slice(entry.rationale.indexOf(marker)+marker.length).trim())}catch{return []}
    if(!Array.isArray(refs)||refs.length>8)return []
    return refs.flatMap((ref:unknown)=>{
      if(!object(ref)||typeof ref.sessionId!=='string'||!Number.isSafeInteger(ref.seq)||typeof ref.quote!=='string'||!ref.quote.trim())return []
      const claimed=statements.find(row=>row.sessionId===ref.sessionId&&row.seq===ref.seq)
      if(claimed?.text.includes(ref.quote))return []
      return [{evidenceIndex,target:{...entry.target},submittedReference:{sessionId:ref.sessionId,seq:ref.seq,quote:ref.quote},
        claimedMessageLocated:!!claimed,exactQuoteLocations:statements.filter(row=>row.text.includes(ref.quote)).map(row=>({
          sessionId:row.sessionId,seq:row.seq,time:row.time,statementHash:hash(row),
        }))}]
    })
  })
  return conflicts.length?{acceptanceGranted:false,originalSubmissionHash:hash(raw),taskBriefHash:hash(brief),conflicts}:undefined
}

export function projectTaskQuoteCorrectionFeedback(raw:unknown,brief?:string){
  const diagnostic=projectTaskQuoteDiagnostics(raw,brief)
  return diagnostic?'任务引文位置诊断仅逐字检索原拒稿quote在冻结消息中的实际位置，不接受、改写或自动重绑原稿。逐项核对target、submittedReference和exactQuoteLocations，并回查taskContext.projectTaskStatements的对应text；消息位置存在不证明该引文适用于字段。由你原生提交真实任务依据、连续原话与正确sessionId/seq，未知正式事实及严格校验保持。\n'
    +JSON.stringify({projectTaskQuoteDiagnostic:diagnostic})+'\n':''
}

/** Read-only missing members in this original draft; do not choose task quotes. */
export function projectTaskBindingDiagnostics(raw:unknown,brief?:string){
  if(!projectTaskStatements(brief).length||!object(raw))return undefined
  const outputs=raw.outputs??(typeof raw.outputsJson==='string'?JSON.parse(raw.outputsJson):undefined)
  if(!object(outputs)||!object(outputs.project_brief)||!Array.isArray(outputs.project_brief.records))return undefined
  const evidence=Array.isArray(raw.evidence)?raw.evidence:[]
  const conflicts=[]
  for(const [evidenceIndex,entry] of evidence.entries()){
    if(!object(entry)||!object(entry.target)||typeof entry.rationale!=='string'||!entry.rationale.includes(marker))continue
    const payload=entry.rationale.slice(entry.rationale.indexOf(marker)+marker.length).trim()
    let parseError:string|undefined
    try{
      const refs=JSON.parse(payload)
      if(!Array.isArray(refs)||!refs.length||refs.length>8
        ||refs.some(ref=>!object(ref)||Object.keys(ref).sort().join('|')!=='quote|seq|sessionId'
          ||typeof ref.sessionId!=='string'||!Number.isSafeInteger(ref.seq)||typeof ref.quote!=='string'||!ref.quote.trim()))
        parseError='Reference array must contain 1 to 8 objects with only sessionId, integer seq and nonempty quote.'
    }catch(error){parseError=error instanceof Error?error.message:'Invalid reference JSON'}
    if(parseError)conflicts.push({evidenceIndex,target:{...entry.target},invalidMember:'rationale.task_statement_refs',
      parseError,referencePayloadHash:hash(payload),referencePayloadTail:payload.slice(-256)})
  }
  for(const record of outputs.project_brief.records){
    if(!object(record))continue
    for(const field of taskFields){
      const value=record[field]
      if(!object(value)||value.value===null||value.claimClass!=='decision')continue
      const entries=evidence.flatMap((entry:unknown,evidenceIndex:number)=>object(entry)&&entry.target?.port==='project_brief'
        &&entry.target?.recordId===record.recordId&&entry.target?.field===field?[{entry,evidenceIndex}]:[])
      if(!entries.length)conflicts.push({evidenceIndex:null,target:{port:'project_brief',recordId:record.recordId,field},
        missingMember:'evidence',inputRefsPresent:false})
      for(const {entry,evidenceIndex} of entries){
        if(typeof entry.rationale==='string'&&entry.rationale.includes(marker))continue
        conflicts.push({evidenceIndex,target:{...entry.target},missingMember:'rationale.task_statement_refs',
          inputRefsPresent:Array.isArray(entry.inputRefs)&&entry.inputRefs.length>0})
      }
    }
  }
  return conflicts.length?{acceptanceGranted:false,originalSubmissionHash:hash(raw),taskBriefHash:hash(brief),
    conflicts:conflicts.slice(0,32),...(conflicts.length>32?{omittedConflicts:conflicts.length-32}:{})}:undefined
}

export function projectTaskCorrectionFeedback(error:string,raw:unknown,brief?:string):string{
  if(error.startsWith('MODULE_PROJECT_TASK_STATEMENT_QUOTE'))return projectTaskQuoteCorrectionFeedback(raw,brief)
  if(!/^MODULE_PROJECT_TASK_STATEMENT_(?:REQUIRED|INVALID)(?::|$)/u.test(error))return ''
  const diagnostic=projectTaskBindingDiagnostics(raw,brief)
  return diagnostic?'任务依据缺项及格式诊断 project-task-binding-readback.v1：下列地址来自本次未改动的拒稿，不接受或补写原稿。invalidMember逐项给出原evidenceIndex、字段target、真实JSON解析错误及原引用数据末尾referencePayloadTail；例如数组闭合后仍有多余字符会被严格拒绝。该末尾是未获接受的原稿片段，不能直接复制为新证据；由你在同一字段原生提交完整有效JSON，中央不删字符、不修括号、不重新绑定或接受原稿。rationale中仅写“依据seq某条”、引用另一字段的inputRefs或其他字段已有任务引用，都不能代替本条evidence的逐字任务绑定。对每个conflicts中的真实工作决定，由你核对taskContext.projectTaskStatements，在同一条proposal evidence的rationale末尾写task_statement_refs=后接JSON数组；每项仅含sessionId、seq、quote，quote由你选择对应text中的连续原文并逐字复制，不能转述、拼接或错绑消息。JSON数组之后不附其他文字。不添加第二条同址evidence，不自动选quote，不用缺失正式事实构造任务；事实未知与严格来源、完整汇合、新独审均保持。\n'
    +JSON.stringify({projectTaskBindingDiagnostic:diagnostic})+'\n':''
}
function statementRefs(rationale:unknown,kind:unknown,statements:readonly SessionStatement[]){
  if(typeof rationale!=='string'||!rationale.includes(marker))return []
  if(kind!=='proposal')fail('MODULE_PROJECT_TASK_STATEMENT_KIND')
  let refs:unknown
  try{refs=JSON.parse(rationale.slice(rationale.indexOf(marker)+marker.length).trim())}
  catch{fail('MODULE_PROJECT_TASK_STATEMENT_INVALID')}
  if(!Array.isArray(refs)||!refs.length||refs.length>8)fail('MODULE_PROJECT_TASK_STATEMENT_INVALID')
  return refs.map(ref=>{
    if(!object(ref)||Object.keys(ref).sort().join('|')!=='quote|seq|sessionId'||typeof ref.sessionId!=='string'
      ||!Number.isSafeInteger(ref.seq)||typeof ref.quote!=='string'||!ref.quote.trim())fail('MODULE_PROJECT_TASK_STATEMENT_INVALID')
    const row=statements.find(s=>s.sessionId===ref.sessionId&&s.seq===ref.seq)
    if(!row||!row.text.includes(ref.quote))fail('MODULE_PROJECT_TASK_STATEMENT_QUOTE: '+JSON.stringify({sessionId:ref.sessionId,seq:ref.seq,messageLocated:!!row})
      +'; reread that exact frozen user/message; quote continuous original text only; use separate refs for discontinuous passages, do not rewrite punctuation or combine statements')
    return {sessionId:row.sessionId,seq:row.seq,time:row.time,quote:ref.quote,statementHash:hash(row)}
  })
}

/** Validate an author's own task choices. User requests never become source facts or approvals. */
export function assertProjectTaskFieldBindings(raw:unknown,brief?:string):void{
  const statements=projectTaskStatements(brief)
  if(!statements.length||!object(raw))return
  const outputs=raw.outputs??(typeof raw.outputsJson==='string'?JSON.parse(raw.outputsJson):undefined)
  if(!object(outputs)||!object(outputs.project_brief)||!Array.isArray(outputs.project_brief.records))return
  const evidence=Array.isArray(raw.evidence)?raw.evidence:[]
  for(const e of evidence){
    if(object(e)&&typeof e.rationale==='string'&&e.rationale.includes(marker)){
      if(!object(e.target)||e.target.port!=='project_brief'||!taskReferenceFields.has(e.target.field))fail('MODULE_PROJECT_TASK_STATEMENT_TARGET: '
        +JSON.stringify({port:e.target?.port??null,field:e.target?.field??null,at:e.target?.at??null})
        +'; task quotes support working task choices/provenance only; allowed fields='+[...taskReferenceFields].join(',')+'; retain unknown formal facts and do not fabricate source evidence')
      statementRefs(e.rationale,e.kind,statements)
    }
  }
  for(const r of outputs.project_brief.records){
    if(!object(r))continue
    if('originalStatement' in r&&object(r.originalStatement)&&r.originalStatement.value===null)
      fail('MODULE_PROJECT_TASK_REQUEST_UNREAD: frozen user statements exist; preserve unknown formal commission, but read and locate the actual research request separately')
    for(const field of taskFields){
      const f=r[field]
      if(!object(f)||f.value===null||f.claimClass!=='decision')continue
      const entries=evidence.filter(e=>object(e)&&e.target?.port==='project_brief'&&e.target?.recordId===r.recordId&&e.target?.field===field)
      if(!entries.length||entries.some(e=>!statementRefs(e.rationale,e.kind,statements).length))
        fail('MODULE_PROJECT_TASK_STATEMENT_REQUIRED: '+field+'; locate the actual user request for each working decision; no automatic drafting, fabricated quote or approval')
      if(field==='originalStatement'&&entries.some(e=>statementRefs(e.rationale,e.kind,statements).every(ref=>
        typeof f.value!=='string'||!f.value.includes(ref.quote))))fail('MODULE_PROJECT_TASK_STATEMENT_VALUE')
    }
  }
}

type ProjectIdentity={name:string|null;location:string|null;principal:string|null}
export function projectIdentityMayAutoMerge(a:ProjectIdentity,b:ProjectIdentity):boolean{
  return (['name','location','principal'] as const).every(k=>typeof a[k]==='string'&&!!a[k]!.trim()
    &&typeof b[k]==='string'&&!!b[k]!.trim()&&a[k]!.normalize('NFKC').trim()===b[k]!.normalize('NFKC').trim())
}
type AuditCandidate=Pick<CompiledModuleCandidate,'outputs'|'claims'|'sourceValues'> & Partial<Pick<CompiledModuleCandidate,'steps'|'limitations'>>
export interface ProjectTaskConfigurationInput {
  readonly projectId:string;readonly snapshotId:string;readonly planHash:string;readonly flags:ResearchFlags
}
function receiveTaskConfiguration(candidate:AuditCandidate,input:ProjectTaskConfigurationInput){
  const plan=projectResearchPlan(loadPlanningCatalog(),input.flags)
  if(!input.projectId?.trim()||!input.snapshotId?.trim()||input.planHash!==plan.hash)fail('MODULE_PROJECT_TASK_CONFIGURATION: frozen execution plan does not match')
  // M01 is internal task configuration. Invoke the real planner with the frozen
  // execution options; do not infer those options from unknown site facts.
  return {receiver:'M01' as const,implementation:'projectResearchPlan' as const,projectId:input.projectId,snapshotId:input.snapshotId,
    taskFieldsHash:hash(candidate.outputs.project_brief),planHash:plan.hash,catalogHash:plan.catalogHash,flags:plan.flags,
    activeModuleIds:plan.activeModuleIds,inactiveModuleIds:plan.inactiveModuleIds,pendingModuleIds:plan.pendingModuleIds,
    blockedModuleIds:plan.blockedModuleIds,dependencyEdgesHash:hash(plan.edges),
    configurationAuthority:'frozen-execution-options; exploratory task configuration, not site facts or construction approval',
    qualificationGranted:false as const}
}
export function buildProjectTaskAudit(candidate:AuditCandidate,brief?:string,configuration?:ProjectTaskConfigurationInput){
  const statements=projectTaskStatements(brief)
  const taskBindings=candidate.claims.flatMap(claim=>{
    const m=/^\/outputs\/project_brief\/records\/(\d+)\/([^/]+)\/value/.exec(claim.selector)
    if(!m||!taskReferenceFields.has(m[2]))return []
    return statementRefs(claim.rationale,claim.kind,statements).map(ref=>({claimId:claim.claimId,field:m[2],...ref}))
  })
  const control={name:'Synthetic identity control',location:'Synthetic location A',principal:'Synthetic principal'}
  const records=(candidate.outputs.project_brief as {records?:Record<string,any>[]}|undefined)?.records??[]
  const currentRecordChecks=records.map(r=>{
    const read=(key:string)=>object(r[key])&&r[key].claimClass==='source_conclusion'&&typeof r[key].value==='string'?r[key].value:null
    const identity={name:read('formalName'),location:read('administrativeCode'),principal:read('principal')}
    return {recordId:typeof r.recordId==='string'?r.recordId:null,identityHash:hash(identity),availableIdentityFieldsMatch:projectIdentityMayAutoMerge(identity,identity),
      locationBasis:'administrativeCode only; not a verified project location',formalIdentityVerified:false,
      sameNameDifferentLocationRejected:!projectIdentityMayAutoMerge(identity,{...identity,location:'Synthetic foreign location'})}
  })
  const requestClaims=candidate.claims.filter(c=>/\/originalStatement\/value$/.test(c.selector))
  const taskRequestLocated=requestClaims.length>0&&requestClaims.every(c=>c.kind==='source'
    ?candidate.sourceValues.some(s=>s.sourceId===c.sourceId):taskBindings.some(b=>b.claimId===c.claimId&&typeof c.value==='string'&&c.value.includes(b.quote)))
  return {version:'project-task-audit.v1' as const,candidateHash:hash(candidate),taskBriefHash:hash(brief??null),statementSetHash:hash(statements),
    identityProbe:{syntheticInputs:true,sameNameDifferentLocationRejected:!projectIdentityMayAutoMerge(control,{...control,location:'Synthetic location B'}),
      incompleteIdentityRejected:!projectIdentityMayAutoMerge({...control,principal:null},control),matchingControlAllowed:projectIdentityMayAutoMerge(control,{...control}),currentRecordChecks},
    taskBindings,taskRequestLocated,originalUserStatementCount:statements.length,
    ...(configuration?{taskConfiguration:receiveTaskConfiguration(candidate,configuration)}:{}),
    boundary:'Task quotes support the research request only; software probes are synthetic and do not verify formal identity, land, ownership or construction approval.'}
}
export type ProjectTaskAudit=ReturnType<typeof buildProjectTaskAudit>
export function verifyProjectTaskAudit(candidate:AuditCandidate,brief:string|undefined,audit:ProjectTaskAudit,configuration?:ProjectTaskConfigurationInput):void{
  try{if(hash(buildProjectTaskAudit(candidate,brief,audit.taskConfiguration?configuration:undefined))===hash(audit))return}catch{}
  fail('MODULE_PROJECT_TASK_AUDIT_MISMATCH')
}

/** One migration repair only. This does not grant acceptance or discard the
 * old review; the original candidate and all native receipts must still replay. */
export function projectTaskHandoffReplayAllowed(audit:ProjectTaskAudit|undefined,reviews:readonly unknown[]):boolean{
  const review=reviews.at(-1)
  if(!audit||audit.taskConfiguration||!audit.taskRequestLocated||!object(review)||review.verdict!=='limited'
    ||review.stopReason!=='completed'||!Array.isArray(review.checks))return false
  const qa=getResearchModuleSpec('1.01').qa
  return review.checks.length===qa.length&&qa.every((criterion,index)=>{
    const checks=review.checks.filter((c:unknown)=>object(c)&&c.criterion===criterion)
    return checks.length===1&&checks[0].status===(index===1?'limited':'pass')
      &&(index!==1||typeof checks[0].rationale==='string'&&/\bM01\b/u.test(checks[0].rationale))
  })
}

export const projectTaskStatementProtocol='研究任务原文协议 project-task-statement.v1：taskContext内按sessionId/seq/time保留的user/message是真实本轮任务输入，可用于研究任务选择与原话定位，不是现场事实或建设批准。正式委托缺失不等于用户没有提出研究要求。逐条回查实际消息，原始表述必须保留真正逐字引文；工作任务选择用decision+proposal及真实rationale，末尾另起一行写task_statement_refs=JSON数组，每项且仅含sessionId、seq、quote，quote必须是对应原消息连续原文，最多8项。该数组声明你的真实任务依据，中央逐字验证，不生成引用、正文或claimRefs。initiationBasis、decisionsSupported、commissionScope、timeRequirements的非空工作决定逐叶绑定实际任务依据；不能把正式委托、法定主体、边界、期限或批准缺失改成虚构任务。sourceVersion、sourceLocation可记录实际消息的版本与定位作为明确工作决定，不伪装正式文件。formalName/principal及未经确认的事实仍未知；允许按spec.fallback建立临时研究任务。程序在完整汇合后执行并存档同名异地身份拒合并测试，独审核对绑定当前候选的projectTaskAudit，不要求字段作者伪称已跑全模块测试。未执行状态和无法确定的关系写具体limitations，不能混在原文conflicts数组中充当事实或无依据推断；整个字段及全部叶的claimClass/kind仍须一致。所有source原文、数值、完整汇合与新独审标准保持。'
export const projectTaskReviewProtocol='projectTaskAudit是程序对本候选实际执行的身份拒合并测试及用户任务引文回放，与候选和冻结taskBrief哈希绑定，结果读取时独立复算。syntheticInputs仅为软件反事实测试，不能证明正式项目身份；身份不全应拒绝自动合并，按spec.fallback允许明确临时研究任务。taskBindings逐字核对真实消息，只证明原用户提出的研究要求或作者据此选择的任务，不证明现场、委托文件或建设批准。formalName、principal、法定边界等未知须保留；核对作者是否实际形成任务对应和下游交接，不把程序回执、工作标识或有限数据本身当作整项通过。M01是内部任务配置，不是旧57项或另一轮研究。taskConfiguration若存在，是完整候选汇合后真实调用projectResearchPlan的交接回执：绑定完整任务字段、冻结执行开关、快照及适用模块/依赖；不证明各模块已经研究或事实成立。字段作者的四步原稿只描述各自执行时的范围，未执行全模块交接应如实保留；跨字段步骤4应同时核对本次程序交接，不能仅因旧分组未执行中央动作而判定当前交接不存在。仍须核对任务对应、配置是否适合明确研究边界及全部QA；交付期限未知保持missing，按实际任务和原fallback判断其对研究的限制，不补造期限，不自动判pass。'
export const projectTaskLiteralContextProtocol='任务逐字定位输入：taskContext.projectTaskStatements按真实sessionId/seq/time单列每条冻结user/message的完整text，来自原任务输入的只读解析，不生成研究结论或引用。task_statement_refs.quote只能从指定那条记录的text连续原文中由你选择并逐字复制。taskBrief中其他叙述、当前执行意图、程序规则及历史拒稿转述都不是该条消息原文，不能把其中“仍为”等改述标成原消息“仍是”，也不能把别条消息的话借用同一seq。非连续句子分开引用；工作判断value可按真实依据表述，原话quote禁止转述或拼接。工作性质/标识/来源定位可使用proposal及真实任务引用；正式身份、权属和批准仍须原件事实证明。'
