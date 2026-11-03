import {readFile,readdir} from 'node:fs/promises'
import {join} from 'node:path'
import {sha256CanonicalJson as hash} from '../../presentation/canonical-json.ts'
import type {PlanningManuscript} from './types.ts'
export type ReportRevisionStage='program'|'content'
export interface ReportRevisionRecovery {id:string;reason:string;sourceFingerprint:string;draftHash:string;baselineKeys:readonly string[]}
interface Entry {key:string;stage:ReportRevisionStage;legacy?:boolean;proof?:{draftHash:string;acceptancePath:string};recovery?:ReportRevisionRecovery}
interface Budget {version:'report-revision-budget.v2';entries:Entry[]}
async function read(path:string):Promise<any|undefined>{try{return JSON.parse(await readFile(path,'utf8'))}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error}}
async function files(path:string):Promise<string[]>{try{return(await readdir(path,{recursive:true})).map(String)}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return[];throw error}}
const programCodes=new Set(['RESEARCH_REQUIRED','RESEARCH_INCOMPLETE','CONTENT_REQUIRED','PROPOSAL_REQUIRED','SOURCE_UNBOUND','GENERIC_PROPOSAL','PRODUCT_REFERENCE_INVALID','PRODUCT_UNBOUND','TERRAIN_PLAN_REQUIRED','SPATIAL_EVIDENCE_REQUIRED','NUMBER_UNBOUND','CALCULATION_INVALID','RESEARCH_NOT_USED'])
/** Preserve the append-only legacy index. Reclassify only an exact draft/findings
 * key with a durable zero-receipt program rejection; unknown attempts keep their
 * original content-budget cost. Each stage remains bounded across restarts. */
export async function reserveReportRevision(root:string,folder:string,draft:PlanningManuscript,key:string,stage:ReportRevisionStage,save:(path:string,value:unknown)=>Promise<void>,recovery?:ReportRevisionRecovery):Promise<void>{
  const indexPath=join(folder,'index.json'),budgetPath=join(folder,'budget-v2.json')
  const index:string[]=await read(indexPath)??[],budget:Budget=await read(budgetPath)??{version:'report-revision-budget.v2',entries:[]}
  const keyValid=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{64}$/u.test(value)
  if(!Array.isArray(index)||index.some(k=>!keyValid(k))||new Set(index).size!==index.length||budget.version!=='report-revision-budget.v2'||!Array.isArray(budget.entries)
    ||budget.entries.some(e=>!keyValid(e.key)||!['program','content'].includes(e.stage))||new Set(budget.entries.map(e=>e.key)).size!==budget.entries.length)throw new Error('MANUSCRIPT_REVISION_BUDGET_INVALID')
  const missing=index.filter(k=>!budget.entries.some(e=>e.key===k))
  if(missing.length){
    const history=join(root,'.pre-design/report-manuscript-history'),acceptance=join(root,'.pre-design/report-acceptance',draft.sourceFingerprint)
    const drafts=[draft,...await Promise.all((await files(history)).filter(p=>p.endsWith('.json')).map(p=>read(join(history,p))))]
      .filter(d=>d&&d.projectId===draft.projectId&&d.sourceRevision===draft.sourceRevision&&d.sourceFingerprint===draft.sourceFingerprint)
    const records=await Promise.all((await files(acceptance)).filter(p=>p.endsWith('content.json')).map(async p=>({path:join(acceptance,p),record:await read(join(acceptance,p))})))
    for(const legacyKey of missing){
      let proof:Entry['proof']
      for(const {path,record:r} of records){
        if(r?.sourceFingerprint!==draft.sourceFingerprint||r.status!=='failed'||r.failureKind!=='content'||!Array.isArray(r.receipts)||r.receipts.length||r.active||r.attempts?.length
          ||!Array.isArray(r.findings)||!r.findings.length||r.findings.some((f:{code:string})=>!programCodes.has(f.code)))continue
        const prior=drafts.find(d=>hash({draft:d,findings:r.findings})===legacyKey)
        if(prior){proof={draftHash:hash(prior),acceptancePath:path};break}
      }
      budget.entries.push({key:legacyKey,stage:proof?'program':'content',legacy:true,...proof?{proof}:{}})
    }
  }
  const existing=budget.entries.find(e=>e.key===key)
  if(existing&&existing.stage!==stage)throw new Error('MANUSCRIPT_REVISION_STAGE_CHANGED')
  if(!existing){
    const prior=budget.entries.filter(e=>e.stage===stage)
    const scoped=stage==='content'&&prior.length===2&&!budget.entries.some(e=>e.recovery)
      &&recovery?.id?.trim()&&recovery.reason?.trim()&&recovery.sourceFingerprint===draft.sourceFingerprint&&recovery.draftHash===hash(draft)
      &&hash([...recovery.baselineKeys].sort())===hash(prior.map(e=>e.key).sort())
    if(prior.length>=2&&!scoped)throw new Error(`MANUSCRIPT_REVISION_LIMIT: ${stage==='program'?'程序检查修复':'独立内容审查返修'}额度已用完，历史与具体问题已保留。`)
    budget.entries.push({key,stage,...scoped?{recovery}: {}})
  }
  await save(budgetPath,budget)
  // If interrupted between these writes, the durable budget remains authoritative.
  await save(indexPath,[...new Set([...index,...budget.entries.map(e=>e.key)])])
}
