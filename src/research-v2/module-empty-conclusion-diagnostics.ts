import {sha256CanonicalJson as hash} from '../presentation/canonical-json.ts'
import {getModuleFieldContracts} from './module-contracts.ts'
import type {ModuleAnalysisContext} from './module-execution.ts'

const object=(value:unknown):value is Record<string,any>=>!!value&&typeof value==='object'&&!Array.isArray(value)

/** Original addresses only. This diagnoses an empty completed author set; it
 * does not accept it, choose document records, or manufacture field values. */
export function moduleEmptyConclusionDiagnostic(context:Pick<ModuleAnalysisContext,'resumeExecutionAudit'>&Partial<Pick<ModuleAnalysisContext,'module'|'resumeExecutionError'>>){
 if(context.module?.id!=='1.03'||!context.resumeExecutionError?.startsWith('MODULE_EMPTY_PROFESSIONAL_CONCLUSION:'))return
 const audit=context.resumeExecutionAudit
 if(!audit)return
 const completed=audit.attempts.filter((a):a is Record<string,any>=>object(a)&&a.classId==='text'&&a.status==='completed')
  .filter((a,index,all)=>!all.slice(index+1).some(later=>later.groupId===a.groupId))
 if(!completed.length||completed.some(a=>typeof a.executionId!=='string'||typeof a.childId!=='string'
  ||!object(a.structuredOutput)||a.groupId!==a.structuredOutput.groupId||a.structuredHash!==hash(a.structuredOutput)))return
 const ports=getModuleFieldContracts('1.03').ports,missingFields:{port:string;recordId:string;field:string;groupId:string;originalSubmissionHash:string}[]=[]
 for(const a of completed){
  if(!object(a.structuredOutput.outputs))return
  for(const [port,value] of Object.entries(a.structuredOutput.outputs)){
   if(!ports[port]||!object(value)||!Array.isArray(value.records))return
   for(const record of value.records){
    if(!object(record)||typeof record.recordId!=='string')return
    for(const field of ports[port].fields){
     if(['id','ids'].includes(field.kind)||['sourceVersion','sourceLocation'].includes(field.name)||!(field.name in record))continue
     const envelope=record[field.name]
     if(!object(envelope)||envelope.value!==null||envelope.claimClass!=='missing')return
     missingFields.push({port,recordId:record.recordId,field:field.name,groupId:a.groupId,originalSubmissionHash:a.structuredHash})
    }
   }
  }
 }
 if(!missingFields.length)return
 const first=completed[0],firstPorts=Object.values(first.structuredOutput.outputs) as {records:{recordId:string}[]}[],limit=48
 return {version:'module-empty-policy-conclusion-readback.v1',itemId:'1.03',diagnosticOnly:true,completeSubmission:false,
  originalAuditHash:hash(audit),allObservedProfessionalValuesNull:true,groupCount:completed.length,
  firstRecordSelection:{groupId:first.groupId,executionId:first.executionId,childId:first.childId,originalSubmissionHash:first.structuredHash,
   recordIds:firstPorts.flatMap(port=>port.records.map(record=>record.recordId)).slice(0,limit)},
  missingFieldCount:missingFields.length,missingFields:missingFields.slice(0,limit),omittedMissingFields:Math.max(0,missingFields.length-limit)}
}

export const moduleEmptyPolicyConclusionProtocol='emptyConclusionDiagnostic仅列同一中央全空拒绝所绑定的原作者记录、字段地址和哈希，不是事实来源、候选、推荐值或通过要求。先核对firstRecordSelection：planning_conditions是文件/条款研究记录，不应仅因本轮项目未有正式批复，就把已取得文件身份也统一改成一个空项目对象。首组须由你按原件重新识别实际文件记录并区分不同文件；有来源的文件身份可如实登记，是否现行、是否直接适用、是否批准本轮建设须另行核验并保留限制。历史文件的封面、编制单位或日期不能自动证明发布机关、生效日期、批准状态或本轮适用性；各字段按真实含义逐项取证，不能混用。后续组只对本次原生选定的完整记录按冻结身份履责。按task.fallback，在关键原文或控制线缺失时研究具体条件性路线比较，把项目影响与应对判断登记为实际字段及证据，并明确所需条件、适用限制和待补输入，阻断无条件建设/产业可行性表述；不能只在stepResults写结论却把相关字段全置空。尚无依据的事实、控制线、测算、核验人或回执仍missing/null；不以非空待核占位、机械重标assumption/proposal或伪造inputRefs来过检。完整原稿和原回执保持不变，重新原生提交后仍须严格汇合校验及新的独立审查。'
