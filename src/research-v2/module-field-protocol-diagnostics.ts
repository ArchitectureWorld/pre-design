import {sha256CanonicalJson} from '../presentation/canonical-json.ts'
import {getModuleAuthorFieldGroups,moduleEvidenceKindConflicts,moduleMissingFieldEvidenceTargets,type ModuleAuthorGroupSubmission} from './module-author-groups.ts'
import {moduleCalculationResultConflicts,moduleProjectionEvidenceKindDiagnostic,type ProjectionEvidence} from './module-author-projection.ts'
import {moduleGroupPointerDiagnostics} from './module-group-pointer-diagnostics.ts'
import {moduleLocalReferenceConflicts} from './module-local-reference-diagnostics.ts'
import {getModuleFieldContracts,getModuleOutputSchema} from './module-contracts.ts'
import type {MaterialCorpus} from '../materials/research-evidence.ts'
import {moduleSourceTextConflicts} from './module-source-text-diagnostics.ts'
import {moduleGroupStepEvidenceConflicts} from './module-group-step-diagnostics.ts'
import {boundedSourceDiagnostic} from './source-diagnostic-view.ts'
import {assertModuleFieldClaimCoverage,moduleInferenceBasisDiagnostic,type ClaimUpstream} from './module-claims.ts'
import {readJsonPointer} from './regional-schema.ts'
import {moduleUpstreamReferenceDiagnostics} from './module-upstream-reference-diagnostics.ts'
import {moduleClaimCycleConflicts} from './module-claim-cycle-diagnostics.ts'

export const moduleFieldClaimBasisProtocol='字段类别与推断依据协议 field-claim-basis.v1：fieldClaimClassConflicts与fieldInferenceBasisConflicts只报告同一原稿的字段类别、证据kind、原值哈希及现有校验错误，不选择业务类别或替代依据。同一字段的claimClass适用于全部数组叶，不能在source_conclusion数组中混入inference/proposal；来源摘录必须由同一连续原文支持，分析判断不能冒充source原文。推断必须由作者回查已有且实际具备证据的local或upstream，逐叶提交真实inputRefs及rationale；地址存在不等于业务依据，missing字段、自引或循环不能补出证据，单靠说明文字或source成员不能代替inputRefs。不能只换类别、删除依赖或照抄诊断来过检；回查实际依据后由原生作者完整修订，确无支持仍保留missing/null及具体限制。宿主不改稿、不生成claimRefs或替换输入，严格校验、有限修订额度与独立审查保持。'

/** Use the unchanged central rules to explain the original draft, never accept or compile it. */
function readFieldClaimBasisConflicts(raw:unknown){
 const fieldClaimClassConflicts:Record<string,unknown>[]=[],fieldInferenceBasisConflicts:Record<string,unknown>[]=[]
 try{
  const projection=raw as {outputs?:Record<string,{records?:any[]}>;outputsJson?:string;evidence?:ProjectionEvidence[]}
  const outputs=projection?.outputs??(typeof projection?.outputsJson==='string'?JSON.parse(projection.outputsJson):undefined)
  if(!outputs||!Array.isArray(projection.evidence))return {fieldClaimClassConflicts,fieldInferenceBasisConflicts}
  projection.evidence.forEach((entry,evidenceIndex)=>{
   try{
    const address=entry.target,records=outputs[address.port]?.records,index=records?.findIndex((row:{recordId?:unknown})=>row.recordId===address.recordId)??-1
    if(index<0)return
    const field=records![index][address.field]
    if(!field||typeof field.claimClass!=='string'||field.claimClass==='missing'||typeof address.at!=='string'||moduleProjectionEvidenceKindDiagnostic(entry))return
    const value=readJsonPointer({value:field.value},'/value'+address.at)
    const binding={evidenceIndex,target:structuredClone(address),fieldClaimClass:field.claimClass,evidenceKind:entry.kind,
     rawValueHash:sha256CanonicalJson(value),fieldValueHash:sha256CanonicalJson(field.value)}
    if(entry.kind==='inference'){
     const diagnostic=moduleInferenceBasisDiagnostic(value,entry.inputRefs)
     if(diagnostic)fieldInferenceBasisConflicts.push({...binding,inputRefCount:entry.inputRefs?.length??0,diagnostic})
    }
    // This isolated address check intentionally never declares field coverage:
    // the unchanged guard may reject the other array leaves afterwards.
    const escape=(value:string)=>value.replaceAll('~','~0').replaceAll('/','~1')
    const prefix=`/outputs/${escape(address.port)}/records/${index}/${escape(address.field)}`
    const id='diagnostic-address-'+sha256CanonicalJson(address)
    try{assertModuleFieldClaimCoverage({value:field.value,claimClass:field.claimClass,claimRefs:[id]},prefix,
     [{claimId:id,selector:prefix+'/value'+address.at,kind:entry.kind,value,...(entry.calculation?{calculation:{basis:entry.calculation.basis}}:{})}],[id])}
    catch(error){if(error instanceof Error&&error.message.startsWith('MODULE_CLAIM_CLASS_MISMATCH:'))fieldClaimClassConflicts.push(binding)}
   }catch{return}
  })
 }catch{}
 return {fieldClaimClassConflicts,fieldInferenceBasisConflicts}
}

export const moduleUpstreamReferenceProtocol='fieldUpstreamReferenceConflicts逐项保留同一原拒稿的/evidence引用路径和upstream原地址，只读诊断不提供替代claim。moduleId必须来自冻结upstream模块，分组编号不是moduleId，recordId不是claimId；claim须实际存在且非missing。由你回查业务依据、原模块和原claim，自行修订所属字段及引用，不能机械替换类别或编造地址以过检；无合法且业务相关的依据仍保留missing/null及具体限制。宿主不改原稿、不绑定替代引用，完整汇合及新的独立审查保持。'

export const moduleEvidenceOwnerProtocol='fieldEvidenceOwnerConflicts逐项绑定原稿/evidence中的target、evidenceIndex及entryHash，fieldEvidenceOwnerScope列出本组分配的port、fields和原稿实际submittedRecordIds；这些是只读身份诊断，不是替代地址。原生作者须回查同一对象及冻结记录身份，核对证据target、inputRefs与步骤fieldRefs属于本组实际字段和记录，不得将相近名称当作同一对象。宿主不选择替代recordId、不自动改写target、不改已验记录身份，不得靠删除事实、机械重标类别或编造证据过检。修订后仍须完整来源校验、汇合及新独立审查。'

/** Mirror the rejected group's existing ownership rules; never fix an address. */
function readEvidenceOwnerConflicts(raw:unknown,itemId?:string,preceding:readonly unknown[]=[]){
 if(!itemId)return
 try{
  const submission=raw as ModuleAuthorGroupSubmission
  const group=getModuleAuthorFieldGroups(itemId,submission.projectionVersion,preceding as readonly ModuleAuthorGroupSubmission[])
   .find(row=>row.groupId===submission.groupId)
  if(!group)return
  const outputs=submission.outputs??JSON.parse(submission.outputsJson!)
  const records=outputs?.[group.port]?.records
  if(!Array.isArray(records)||!Array.isArray(submission.evidence))return
  const submittedRecordIds=records.map(row=>row.recordId).filter((id:unknown):id is string=>typeof id==='string')
  const conflicts=submission.evidence.flatMap((entry,evidenceIndex)=>{
   const target=entry?.target
   if(!target||!['port','recordId','field','at'].every(key=>typeof target[key as keyof typeof target]==='string'))return []
   const reasons=[...(target.port!==group.port?['port-not-assigned-to-group']:[]),
    ...(!group.fields.includes(target.field)?['field-not-assigned-to-group']:[]),
    ...(!submittedRecordIds.includes(target.recordId)?['record-not-in-submission']:[])]
   return reasons.length?[{evidenceIndex,evidencePath:`/evidence/${evidenceIndex}/target`,target:structuredClone(target),entryHash:sha256CanonicalJson(entry),reasons}]:[]
  })
  return {scope:{groupId:group.groupId,port:group.port,fields:[...group.fields],submittedRecordIds},conflicts}
 }catch{return}
}

export const moduleEvidenceTargetUniquenessProtocol='fieldEvidenceDuplicateConflicts绑定原稿中重复的精确target、evidenceIndexes和entryHashes，repeatCount是原条目数；只读诊断最多展示8个地址及每地址8条，须核对完整原稿。同一个精确target只能有一条evidence，地址由port、recordId、field、at共同决定。多个来源引用不能各建一条相同target的source证据；由原生作者核对来源及字段语义后，自行提交一条能够支持原值的合法证据。若本来就是有依据的inference，其多个依据使用同一条inference证据既有的inputRefs数组；不能为消除重复而把source机械改成inference或proposal、拼接quote、改target或删事实。不同真实数组叶的at各自独立，不得虚造叶地址。不能由宿主代删、合并或选择证据；原稿、严格来源校验、完整汇合及独立审查保持。'

function readEvidenceDuplicateConflicts(raw:unknown){
 try{
  const evidence=(raw as {evidence?:unknown[]})?.evidence
  if(!Array.isArray(evidence))return []
  const rows=new Map<string,{target:{port:string;recordId:string;field:string;at:string};evidenceIndexes:number[];kinds:string[];entryHashes:string[]}>()
  evidence.forEach((entry,evidenceIndex)=>{
   if(!entry||typeof entry!=='object')return
   const value=entry as {target?:Record<string,unknown>;kind?:unknown},address=value.target
   if(!address||!['port','recordId','field','at'].every(key=>typeof address[key]==='string'))return
   const target={port:address.port as string,recordId:address.recordId as string,field:address.field as string,at:address.at as string}
   const key=JSON.stringify([target.port,target.recordId,target.field,target.at])
   const row=rows.get(key)??{target,evidenceIndexes:[],kinds:[],entryHashes:[]}
   row.evidenceIndexes.push(evidenceIndex);row.kinds.push(String(value.kind));row.entryHashes.push(sha256CanonicalJson(entry));rows.set(key,row)
  })
  return [...rows.values()].filter(row=>row.evidenceIndexes.length>1).slice(0,8).map(row=>({target:row.target,repeatCount:row.evidenceIndexes.length,
   evidenceIndexes:row.evidenceIndexes.slice(0,8),kinds:row.kinds.slice(0,8),entryHashes:row.entryHashes.slice(0,8),
   ...(row.evidenceIndexes.length>8?{additionalEntriesOmitted:row.evidenceIndexes.length-8}:{})}))
 }catch{return []}
}

export const moduleFieldEnvelopeProtocol='fieldEnvelopeConflicts仅解释原拒稿的字段成员和工作编号格式，valueHash绑定原值，不是替代稿。非空字段使用原Schema的非空成员集合；notApplicableReason只属于value为JSON null且claimClass为decision的明确不适用分支，不能附在非空工作编号上，也不能把真实非空值删成null来躲避错误。编号须由原生作者按现有pattern自行建立并保持对象映射，不能由宿主替换、转写或重新配对；工作编号不是官方身份或事实证据。来源、分类、字段证据与完整合并及独审仍须分别通过。'

/** Read the unchanged field schema; report identities/members, never repair them. */
function readFieldEnvelopeConflicts(raw:unknown,itemId?:string){
 if(!itemId)return []
 const conflicts:{target:{port:string;recordId:string;field:string;at:string};reason:string;valueHash:string;unexpectedMembers?:string[];allowedMembers?:string[];pattern?:string}[]=[]
 try{
  const submission=raw as {outputs?:Record<string,{records?:Record<string,any>[]}>;outputsJson?:string}
  const outputs:Record<string,{records?:Record<string,any>[]}>|undefined=submission?.outputs??(typeof submission?.outputsJson==='string'?JSON.parse(submission.outputsJson):undefined)
  if(!outputs)return []
  const contract=getModuleFieldContracts(itemId),schema=getModuleOutputSchema(itemId) as any
  for(const [port,envelope] of Object.entries(outputs)){
   if(!contract.ports[port]||!Array.isArray(envelope?.records))continue
   const rowSchema=schema.properties[port].properties.records.items
   for(const record of envelope.records){
    if(typeof record?.recordId!=='string')continue
    const target=(field:string)=>({port,recordId:record.recordId,field,at:''})
    const pattern=rowSchema.properties.recordId.pattern as string
    if(!new RegExp(pattern,'u').test(record.recordId))conflicts.push({target:target('recordId'),reason:'invalid-id-pattern',valueHash:sha256CanonicalJson(record.recordId),pattern})
    for(const field of contract.ports[port].fields){
     const value=record[field.name]
     if(!value||typeof value!=='object'||Array.isArray(value)||value.value===null||!Object.hasOwn(value,'value'))continue
     const nonNull=rowSchema.properties[field.name].anyOf[2],allowedMembers=Object.keys(nonNull.properties)
     const unexpectedMembers=Object.keys(value).filter(key=>!allowedMembers.includes(key))
     if(unexpectedMembers.length)conflicts.push({target:target(field.name),reason:'non-null-envelope-extra-members',valueHash:sha256CanonicalJson(value.value),unexpectedMembers,allowedMembers})
     const idPattern=field.kind==='id'?nonNull.properties.value.pattern:undefined
     if(typeof idPattern==='string'&&typeof value.value==='string'&&!new RegExp(idPattern,'u').test(value.value))conflicts.push({target:target(field.name),reason:'invalid-id-pattern',valueHash:sha256CanonicalJson(value.value),pattern:idPattern})
     if(conflicts.length>=8)return conflicts.slice(0,8)
    }
   }
  }
 }catch{return []}
 return conflicts
}

export const moduleFieldEvidenceCoverageProtocol='fieldEvidenceCoverageGaps仅定位原拒稿中没有任何局部evidence绑定的非空字段，valueHash绑定原值，不是建议值或替代稿。claimRefs由编译器从原生作者evidence生成，禁止自行填写claimRefs。非空decision字段同样须有对应target的原生evidence；确由你作出的工作编号、版本或条件研究选择用decision+proposal及真实rationale，说明对象、选择规则、研究适用范围及非官方限制，不附source/calculation或虚构inputRefs。不能把未核事实改标为decision以过检，研究选择也不能补出几何、面积、批准或现状事实。必须回查每个原字段的业务含义与真实依据；有依据推断用inference并显式列出真实可用的inputRefs，不能把direct等分类枚举冒充原文source。没有可核依据则由你提交missing/null及具体限制，不得机械重标分类或造依据来过检。宿主不补值、不补证据；原来源、字段覆盖、完整汇合和独审门槛保持。'

export const peerCategoricalEvidenceProtocol='分类枚举引用协议 peer-categorical-evidence.v1：peer_supply.status、relationship、selection等字段须遵守原Schema，operating、direct等枚举是表示代码。中文原文不含英文枚举时，不能把英文标签当source原文、把翻译或业务分类当逐字摘录；source_conclusion+source仍须字段标量逐字获同一真实quote支持。只有原始依据支持该对象、年代及业务含义时，才可由你原生形成agent_inference+inference，说明分类理由与时点限制；inputRefs仅支持local或upstream，不能填写source、sourceId或虚构claimId。local必须引用此前已验或本组实际evidence.target的精确标量叶地址；数组容器at=""并不自动有claim，数组叶通常为"/0"等。previousAuthorGroups.priorGroupEvidenceTargets或registeredEvidenceTargets仅是原生地址清单，不是推荐替代依据；servedNeeds、规模或名称的存在本身不能证明营业状态。不要仅为让地址匹配而引用不相关字段或机械重标类别；引用错误不能靠切回已被TEXT拒绝的枚举source来规避。原文不足，或没有合法且业务相关的已验inputRefs时，由你提交该字段missing/null及具体对象/时点缺口，不改其他已验字段，不把历史宣传、规划条件或研究asOf升级成当前营业事实。缺失字段不附evidence和步骤fieldRefs；四步仍保留实际核对摘要、limited状态及限制。该协议不映射枚举、不补值、不补引用、不放宽校验；完整汇合和独立审查保持。'

export const peerProductCategoricalEvidenceProtocol=peerCategoricalEvidenceProtocol+'\n产品分类引用边界 peer-products-classification.v1：以上来源与推断规则同样适用于peer_products.status、productType和classificationBasis。classificationBasis若是你对报道主题的分类论证，不能作为source逐字原文；须回查实际对象、报道时点与业务适用性，按真实依据原生形成推断及精确inputRefs，或保留missing/null。unknown是Schema中的状态代码，不是“未载经营状态”等中文文字的连续摘录；不得用缺证说明证明当前经营事实，亦不得仅换claimClass而沿用未核事实。原始引文、原生地址及严格来源校验不改写，完整汇合和新的独审仍须执行。'

/** Guidance only: never translates a value, changes a class or manufactures a reference. */
export const peerSelectionEvidenceProtocol='筛选决策证据协议 peer-selection-evidence.v1：selection与selectionReason须先区分实际研究选择、来源事实和专业推断。由你形成的实际纳入/排除研究选择按原Schema用decision+proposal并给出真实rationale；include/exclude是研究表示代码，不是中文来源摘录，也不是营业状态、审批结论或挂牌认定。selectionReason中作者自己的筛选判断不因附有来源quote就变成连续原文。不能只把source改成proposal而沿用其中未核事实；须回查项目研究范围、已验同类字段及对象/年代限制，重新形成你实际作出的选择与理由，不附source/calculation到proposal。需要表达来源事实时仍须同一quote的连续原文支持；有依据的专业推断须按agent_inference+inference并引用实际业务相关的精确叶地址，不能虚构inputRefs或把数组容器、库存当证据。没有依据形成某项结论则missing/null与具体限制；纳入研究不能补出missing状态、当前经营表现、客流或未做的调查。该协议不选择include/exclude、不改标原稿、不映射枚举、不补值或放宽校验；完整汇合和独立审查保持。'

export function peerSelectionEvidenceFeedback(error:string,raw:unknown):string {
 if(!/^MODULE_(?:SOURCE_VALUE_(?:TEXT|QUOTE)|PROJECTION_(?:REFERENCE|EVIDENCE_KIND))(?::|$)/u.test(error))return ''
 try{
  const draft=raw as {outputs?:{peer_supply?:{records?:Record<string,unknown>[]}};outputsJson?:string}
  const outputs=draft?.outputs??(typeof draft?.outputsJson==='string'?JSON.parse(draft.outputsJson):undefined)
  if(!Array.isArray(outputs?.peer_supply?.records))return ''
  return outputs.peer_supply.records.some((record:Record<string,unknown>)=>['selection','selectionReason'].some(name=>{
   const field=record?.[name] as {value?:unknown}|undefined
   return field&&typeof field==='object'&&typeof field.value==='string'
  }))?peerSelectionEvidenceProtocol:''
 }catch{return ''}
}

/** Guidance only: never translates a value, changes a class or manufactures a reference. */
export function peerCategoricalEvidenceFeedback(error:string,raw:unknown):string {
 if(!/^MODULE_(?:SOURCE_VALUE_(?:TEXT|QUOTE)|PROJECTION_REFERENCE)(?::|$)/u.test(error))return ''
 try{
  const draft=raw as {outputs?:Partial<Record<'peer_supply'|'peer_products',{records?:Record<string,unknown>[]}>>;outputsJson?:string}
  const outputs=draft?.outputs??(typeof draft?.outputsJson==='string'?JSON.parse(draft.outputsJson):undefined)
  const applies=(port:'peer_supply'|'peer_products',fields:readonly string[])=>Array.isArray(outputs?.[port]?.records)&&outputs[port].records.some((record:Record<string,unknown>)=>fields.some(name=>{
   const field=record?.[name] as {value?:unknown}|undefined
   return field&&typeof field==='object'&&typeof field.value==='string'
  }))
  return applies('peer_products',['status','productType','classificationBasis'])?peerProductCategoricalEvidenceProtocol:
    applies('peer_supply',['status','relationship','selection'])?peerCategoricalEvidenceProtocol:''
 }catch{return ''}
}

/** Addresses and hashes only; absence is diagnosed, never filled or accepted. */
export function moduleFieldEvidenceCoverageGaps(raw:unknown){
 const gaps:{target:{port:string;recordId:string;field:string;at:string};valueType:string;claimClass?:string;valueHash:string;evidenceCount:number}[]=[]
 try{
  const submission=raw as {outputs?:Record<string,{records?:Record<string,unknown>[]}>;outputsJson?:string;evidence?:{target?:{port?:string;recordId?:string;field?:string}}[]}
  const outputs=submission.outputs??(typeof submission.outputsJson==='string'?JSON.parse(submission.outputsJson):undefined)
  if(!outputs||!Array.isArray(submission.evidence))return gaps
  for(const [port,envelope] of Object.entries(outputs) as [string,{records?:Record<string,unknown>[]} ][]){
   if(!Array.isArray(envelope.records))continue
   for(const record of envelope.records){
    if(typeof record.recordId!=='string')continue
    for(const [field,rawField] of Object.entries(record)){
     if(!rawField||typeof rawField!=='object'||Array.isArray(rawField)||!Object.hasOwn(rawField,'value'))continue
     const value=rawField as {value:unknown;claimClass?:string}
     if(value.value===null||value.value===undefined)continue
     if(submission.evidence.some(entry=>entry.target?.port===port&&entry.target.recordId===record.recordId&&entry.target.field===field))continue
     gaps.push({target:{port,recordId:record.recordId,field,at:''},valueType:Array.isArray(value.value)?'array':typeof value.value,
      claimClass:value.claimClass,valueHash:sha256CanonicalJson(value.value),evidenceCount:0})
    }
   }
  }
 }catch{return []}
 return gaps
}

export const moduleFieldEvidenceLeafCoverageProtocol='逐叶证据覆盖协议 field-evidence-leaf-coverage.v1：fieldEvidenceLeafCoverageGaps仅列同一原拒稿的未覆盖叶地址、分类及原值哈希，不提供替代任务、事实或证据。一个数组项的at="/0"只绑定该项，不自动覆盖其余项；每个保留的非空叶必须获得符合真实业务含义的精确证据覆盖。source只能绑定实际标量叶且由原件连续原文支持；确由你形成的工作选择仍按decision+proposal提交真实rationale及范围限制，可以按原Schema为各项登记证据，不能把未知事实改标为工作选择或复制无关理由过检。stepResults.fieldRefs只能指向实际登记的evidence.target；claimRefs由编译器生成。检查完整列表和完整原稿，诊断最多列16个叶，未列不表示通过；不能删掉任务、把非空值置null、补造inputRefs或自行生成claimRefs来躲避错误。由原生作者重新核对并提交，中央来源校验、完整汇合及独立审查继续执行。'

/** Locate missing leaves across the submitted records of the field named by the unchanged central error.
 * Address coverage is not source validation or acceptance of the original values. */
function readFieldEvidenceLeafCoverageGaps(error:string,raw:unknown){
 const match=/^MODULE_CLAIM_VALUE_UNCOVERED: \/outputs\/([^/]+)\/records\/(\d+)\/([^/]+)\/value(.*)$/u.exec(error)
 if(!match)return
 try{
  const decode=(key:string)=>key.replaceAll('~1','/').replaceAll('~0','~')
  const submission=raw as {outputs?:Record<string,{records?:Record<string,any>[]} >;outputsJson?:string;evidence?:{target?:Record<string,unknown>}[]}
  const outputs=submission?.outputs??(typeof submission?.outputsJson==='string'?JSON.parse(submission.outputsJson):undefined)
  const port=decode(match[1]),field=decode(match[3]),record=outputs?.[port]?.records?.[Number(match[2])],value=record?.[field]
  if(typeof record?.recordId!=='string'||!value||typeof value!=='object'||!Object.hasOwn(value,'value')
    ||value.value===null&&value.claimClass==='missing'||!Array.isArray(submission.evidence))return
  const gaps:{target:{port:string;recordId:string;field:string;at:string};valueType:string;claimClass:string;valueHash:string}[]=[]
  let total=0,rejectedLeafFound=false
  const records:Record<string,any>[]=outputs![port].records!,rejectedIndex=Number(match[2])
  // Prioritize the actual rejected record, then diagnose its same-field peers.
  // Return nothing if the unchanged central address is already covered.
  for(const index of [rejectedIndex,...records.map((_,i)=>i).filter(i=>i!==rejectedIndex)]){
   const currentRecord=records[index],currentValue=currentRecord?.[field]
   if(typeof currentRecord?.recordId!=='string'||!currentValue||typeof currentValue!=='object'||!Object.hasOwn(currentValue,'value')
     ||currentValue.value===null&&currentValue.claimClass==='missing')continue
   const registered=new Set(submission.evidence.flatMap(entry=>{
    const target=entry?.target
    return target?.port===port&&target.recordId===currentRecord.recordId&&target.field===field&&typeof target.at==='string'?[target.at]:[]
   }))
   const visit=(leaf:unknown,at:string):void=>{
    if(registered.has(at))return
    if(Array.isArray(leaf)&&leaf.length){leaf.forEach((entry,index)=>visit(entry,at+'/'+index));return}
    if(leaf!==null&&typeof leaf==='object'&&Object.keys(leaf).length){
     for(const [key,entry] of Object.entries(leaf))if(!['unit','currency','basis'].includes(key))visit(entry,at+'/'+key.replaceAll('~','~0').replaceAll('/','~1'))
     return
    }
    total++;if(index===rejectedIndex&&at===match[4])rejectedLeafFound=true
    if(gaps.length<16)gaps.push({target:{port,recordId:currentRecord.recordId,field,at},valueType:Array.isArray(leaf)?'array':leaf===null?'null':typeof leaf,
     claimClass:currentValue.claimClass,valueHash:sha256CanonicalJson(leaf)})
   }
   visit(currentValue.value,'')
  }
  return rejectedLeafFound?{gaps,total}:undefined
 }catch{return}
}

/** Diagnose one original rejected draft. No pointer, value, evidence or kind is repaired. */
export function moduleFieldProtocolDiagnostic(error:string,submitted:unknown,preceding:readonly unknown[]=[],itemId?:string,corpus?:MaterialCorpus,upstream?:readonly ClaimUpstream[]){
 const claimReferenceGap=/^MODULE_PROJECTION_OUTPUT_INVALID:.*\.claimRefs: Too small:/u.test(error)
 // New native identity constraints can reject a group before semantic guards.
 // Explain that untouched draft with the existing read-only readers as well.
 const earlyGroupRejection=/^MODULE_GROUP_(?:STEPS|MISSING_EVIDENCE|EVIDENCE_OWNER)(?::|$)/u.test(error)
  ||/^(?:MODULE_NATIVE_SCHEMA_INVALID|MODULE_NATIVE_JSON_WIRE_INVALID):/u.test(error)&&Boolean(submitted&&typeof submitted==='object'
    &&typeof (submitted as {groupId?:unknown}).groupId==='string'&&Array.isArray((submitted as {evidence?:unknown}).evidence))
 if(!claimReferenceGap&&!earlyGroupRejection&&!/^(?:MODULE_SOURCE_VALUE_(?:TEXT|QUOTE|LOCATION)|MODULE_PROJECTION_SOURCE_LOCATION|MODULE_SOURCE_QUERY_MAPPING|MODULE_PROJECT_TASK_STATEMENT_(?:TARGET|REQUIRED|QUOTE)|MODULE_CLAIM_CLASS_MISMATCH|MODULE_CLAIM_INFERENCE_BASIS|MODULE_CLAIM_UPSTREAM_MISSING|MODULE_GROUP_POINTER|MODULE_GROUP_EVIDENCE_DUPLICATE|MODULE_PROJECTION_OUTPUT_INVALID|MODULE_PROJECTION_EVIDENCE_KIND|MODULE_CALCULATION_REQUIRED|MODULE_PROJECTION_REFERENCE|MODULE_CLAIM_VALUE_UNCOVERED)(?::|$)/u.test(error))return
 const fieldPointerConflicts=moduleGroupPointerDiagnostics(submitted)
 const owner=error.startsWith('MODULE_GROUP_EVIDENCE_OWNER')?readEvidenceOwnerConflicts(submitted,itemId,preceding):undefined
 const fieldEvidenceOwnerConflicts=owner?.conflicts??[]
 const fieldEvidenceKindConflicts=moduleEvidenceKindConflicts(submitted)
 const {fieldClaimClassConflicts,fieldInferenceBasisConflicts}=readFieldClaimBasisConflicts(submitted)
 // Source-only failures keep their established specialized readers, including
 // original-image date representation. This extension combines actual
 // semantic conflicts; it must not replace those existing source protocols.
 if(/^(?:MODULE_SOURCE_VALUE_(?:TEXT|QUOTE|LOCATION)|MODULE_PROJECTION_SOURCE_LOCATION)(?::|$)/u.test(error)
  &&!fieldClaimClassConflicts.length&&!fieldInferenceBasisConflicts.length)return
 const fieldCalculationConflicts=moduleCalculationResultConflicts(submitted)
 const fieldLocalReferenceConflicts=moduleLocalReferenceConflicts(submitted,preceding)
 const fieldUpstreamReferenceConflicts=upstream===undefined?[]:moduleUpstreamReferenceDiagnostics([submitted],upstream)
 const fieldEvidenceCoverageGaps=claimReferenceGap||earlyGroupRejection?moduleFieldEvidenceCoverageGaps(submitted):[]
 const fieldEvidenceConflicts=earlyGroupRejection?moduleMissingFieldEvidenceTargets(submitted):[]
 const stepEvidenceConflicts=moduleGroupStepEvidenceConflicts(submitted)
 // Central validation may stop before checking source bindings. Diagnose the
 // same untouched submission rather than making each hidden problem consume
 // another native correction. These readers never accept or rewrite evidence.
 const fieldTextConflicts=corpus?moduleSourceTextConflicts(submitted,corpus):[]
 const leafCoverage=readFieldEvidenceLeafCoverageGaps(error,submitted),fieldEvidenceLeafCoverageGaps=leafCoverage?.gaps??[]
 const fieldEnvelopeConflicts=error.startsWith('MODULE_PROJECTION_OUTPUT_INVALID:')?readFieldEnvelopeConflicts(submitted,itemId):[]
 const fieldEvidenceDuplicateConflicts=/^(?:MODULE_GROUP_EVIDENCE_DUPLICATE|MODULE_PROJECT_TASK_STATEMENT_TARGET)(?::|$)/u.test(error)?readEvidenceDuplicateConflicts(submitted):[]
 // Earlier field guards can mask an actual local cycle. Bind the readback to
 // this draft's owning group, never an unrelated historical group or new value.
 const groupId=submitted&&typeof submitted==='object'?(submitted as {groupId?:unknown}).groupId:undefined
 const fieldClaimCycles=typeof groupId==='string'&&groupId.length?moduleClaimCycleConflicts([...preceding,submitted],groupId):[]
 const kinds=[fieldEvidenceOwnerConflicts,fieldPointerConflicts,fieldEvidenceKindConflicts,fieldClaimClassConflicts,fieldInferenceBasisConflicts,fieldCalculationConflicts,fieldLocalReferenceConflicts,fieldUpstreamReferenceConflicts,fieldEvidenceCoverageGaps,fieldEvidenceLeafCoverageGaps,fieldEnvelopeConflicts,fieldEvidenceDuplicateConflicts,fieldEvidenceConflicts,stepEvidenceConflicts,fieldTextConflicts,fieldClaimCycles].filter(rows=>rows.length).length
 if(!kinds)return
 const diagnostic={scope:kinds>1||fieldClaimClassConflicts.length||fieldInferenceBasisConflicts.length?'field-protocol-conflicts-only':fieldEvidenceOwnerConflicts.length?'evidence-owner-conflicts-only':fieldPointerConflicts.length?'field-pointer-address-conflicts-only':fieldEvidenceKindConflicts.length?'evidence-kind-member-conflicts-only':fieldCalculationConflicts.length?'calculation-result-types-only':fieldLocalReferenceConflicts.length?'local-reference-address-conflicts-only':fieldUpstreamReferenceConflicts.length?'upstream-reference-address-conflicts-only':fieldEnvelopeConflicts.length?'field-envelope-member-conflicts-only':fieldEvidenceDuplicateConflicts.length?'field-evidence-target-duplicates-only':fieldEvidenceLeafCoverageGaps.length?'field-evidence-leaf-coverage-only':fieldEvidenceConflicts.length?'missing-field-evidence-conflicts-only':stepEvidenceConflicts.length?'step-evidence-address-conflicts-only':fieldTextConflicts.length?'source-text-bindings-only':'non-null-field-evidence-coverage-only',
  completeSubmission:false,originalSubmissionHash:sha256CanonicalJson(submitted),
  ...(fieldEvidenceOwnerConflicts.length?{fieldEvidenceOwnerScope:owner!.scope,fieldEvidenceOwnerConflicts}:{}),
  ...(fieldPointerConflicts.length?{fieldPointerConflicts}:{}),
  ...(fieldEvidenceKindConflicts.length?{fieldEvidenceKindConflicts}:{}),
  ...(fieldClaimClassConflicts.length?{fieldClaimClassConflicts}:{}),
  ...(fieldInferenceBasisConflicts.length?{fieldInferenceBasisConflicts}:{}),
  ...(fieldCalculationConflicts.length?{fieldCalculationConflicts}:{}),
  ...(fieldLocalReferenceConflicts.length?{fieldLocalReferenceConflicts}:{}),
  ...(fieldUpstreamReferenceConflicts.length?{fieldUpstreamReferenceConflicts}:{}),
  ...(fieldEvidenceCoverageGaps.length?{fieldEvidenceCoverageGaps}:{}),
  ...(fieldEvidenceConflicts.length?{fieldEvidenceConflicts}:{}),
  ...(stepEvidenceConflicts.length?{stepEvidenceConflicts}:{}),
  ...(fieldTextConflicts.length?{fieldTextConflicts}:{}),
  ...(fieldEvidenceLeafCoverageGaps.length?{fieldEvidenceLeafCoverageGaps,fieldEvidenceLeafCoverageGapCount:leafCoverage!.total,
    ...(leafCoverage!.total>fieldEvidenceLeafCoverageGaps.length?{omittedFieldEvidenceLeafCoverageGaps:leafCoverage!.total-fieldEvidenceLeafCoverageGaps.length}:{})}:{}),
  ...(fieldEnvelopeConflicts.length?{fieldEnvelopeConflicts}:{}),
  ...(fieldEvidenceDuplicateConflicts.length?{fieldEvidenceDuplicateConflicts}:{}),
  ...(fieldClaimCycles.length?{fieldClaimCycles}:{})}
 return boundedSourceDiagnostic(diagnostic)
}
