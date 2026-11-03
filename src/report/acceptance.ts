import { createHash, randomUUID } from 'node:crypto'
import { cp, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'
import type { FrozenProjectInput } from './types.ts'
import { DEFAULT_REPORT_DELIVERY_CONTRACT, assertReportDeliveryContract, inspectReportCoverage, type ReportAcceptanceFinding } from './delivery-contract.ts'
import { reportManuscriptHash, type ReportContentAcceptance, type ReportContentReviewService } from './content-review.ts'
import { manuscriptSourceFingerprint } from './manuscript/source.ts'
import { sha256CanonicalJson as hash } from '../presentation/canonical-json.ts'
import { inspectReportHtml, type ReportBrowserResult } from './html-browser.ts'
import { ReportPageRejected } from './page-rejection.ts'
import { writeReportWebSourceAppendix } from './web-source-appendix.ts'

export interface RenderedReviewReceipt {
  readonly pageId:string;readonly inputHash:string;readonly executionId:string;readonly childId:string
  readonly output:{readonly inputHash:string;readonly pageId:string;readonly pass:boolean;readonly rationale:string;readonly findings:readonly string[];readonly probe:readonly string[]}
}
export interface ReportAcceptanceResult {
  readonly version:'report-acceptance.v1';readonly contractVersion:string;readonly sourceFingerprint:string;readonly manuscriptHash:string
  readonly status:'passed'|'failed';readonly createdAt:string;readonly findings:readonly ReportAcceptanceFinding[]
  readonly content:ReportContentAcceptance;readonly browser?:ReportBrowserResult;readonly rendered:readonly RenderedReviewReceipt[]
  readonly resources:readonly {path:string;sha256:string;bytes:number}[]
  readonly integrityHash:string
}
export interface ReportAcceptancePort {
  assertContent(input:FrozenProjectInput):Promise<ReportContentAcceptance>
  accept(input:FrozenProjectInput,root:string,signal?:AbortSignal):Promise<ReportAcceptanceResult>
  verify(input:FrozenProjectInput,root:string):Promise<ReportAcceptanceResult>
}
interface Dependencies {
  readonly content:Pick<ReportContentReviewService,'load'>
  readonly workspaceRoot:(projectId:string)=>string
  readonly browserExecutable?:string
  readonly inspect?:typeof inspectReportHtml
  readonly rendered:{
    prepare(input:FrozenProjectInput,root:string,browser:ReportBrowserResult,signal:AbortSignal):Promise<readonly RenderedReviewReceipt[]>
    verify(input:FrozenProjectInput,root:string,browser:ReportBrowserResult,receipts:readonly RenderedReviewReceipt[]):Promise<void>
  }
}
export async function reportAcceptanceResources(root:string){
  const base=await realpath(root),files:string[]=[]
  async function walk(folder:string){
    for(const entry of await readdir(join(base,folder),{withFileTypes:true})){
      const path=folder+'/'+entry.name
      if(entry.isSymbolicLink())throw new Error('REPORT_ACCEPTANCE_RESOURCE_LINK')
      if(entry.isDirectory())await walk(path);else if(entry.isFile())files.push(path)
    }
  }
  await walk('html');files.push('planning-sources.html')
  try{await walk('html-review')}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
  try{await walk('sources')}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
  return Promise.all(files.sort().map(async path=>{
    const resolved=await realpath(join(base,path)),rel=relative(base,resolved)
    if(isAbsolute(rel)||rel.startsWith('..'))throw new Error('REPORT_ACCEPTANCE_RESOURCE_LINK')
    const bytes=await readFile(resolved);return{path,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length}
  }))
}
export class ReportAcceptanceService implements ReportAcceptancePort {
  constructor(private dependencies:Dependencies){}
  async assertContent(input:FrozenProjectInput){
    assertReportDeliveryContract(input.deliveryContract)
    const result=await this.dependencies.content.load(input,this.dependencies.workspaceRoot(input.projectId))
    if(!result||result.status!=='passed'||inspectReportCoverage(input).length)throw new Error('REPORT_CONTENT_ACCEPTANCE_REQUIRED: 独立内容验收尚未通过。')
    return result
  }
  async accept(input:FrozenProjectInput,root:string,signal=new AbortController().signal):Promise<ReportAcceptanceResult>{
    signal.throwIfAborted()
    const content=await this.assertContent(input),findings:ReportAcceptanceFinding[]=[]
    let browser:ReportBrowserResult|undefined,rendered:readonly RenderedReviewReceipt[]=[],failure:unknown
    try{
      await writeReportWebSourceAppendix(input,this.dependencies.workspaceRoot(input.projectId),root)
      browser=await (this.dependencies.inspect??inspectReportHtml)(root,{signal,browserExecutable:this.dependencies.browserExecutable})
      findings.push(...browser.findings)
      const wanted=input.manuscript!.chapters.flatMap(c=>c.pages.map(p=>p.id))
      for(const id of wanted)if(!browser.pages.some(p=>p.sourcePageId===id))findings.push({code:'HTML_PAGE_MISSING',pageId:id,message:'文稿页面未进入实际HTML。'})
      if(!browser.navigation)findings.push({code:'HTML_NAVIGATION',message:'HTML导航未通过。'})
      if(!findings.length){
        rendered=await this.dependencies.rendered.prepare(input,root,browser,signal)
        await this.dependencies.rendered.verify(input,root,browser,rendered)
        for(const r of rendered)if(!r.output.pass)findings.push(...r.output.findings.map(message=>({code:'HTML_VISUAL_CONTRADICTION',pageId:browser!.pages.find(p=>p.pageId===r.pageId)?.sourcePageId??r.pageId,message})))
      }
      signal.throwIfAborted()
    }catch(error){failure=error;findings.push({code:'HTML_REVIEW_UNAVAILABLE',message:'实际HTML或独立页面审查未完成，不能授予验收。'})}
    const body={version:'report-acceptance.v1' as const,contractVersion:DEFAULT_REPORT_DELIVERY_CONTRACT.version,sourceFingerprint:manuscriptSourceFingerprint(input),manuscriptHash:reportManuscriptHash(input),
      status:findings.length?'failed' as const:'passed' as const,createdAt:new Date().toISOString(),findings,content,...(browser?{browser}:{}),rendered,resources:await reportAcceptanceResources(root)}
    const result:ReportAcceptanceResult={...body,integrityHash:hash(body)}
    await writeFile(join(root,'report-acceptance.json'),JSON.stringify(result,null,2))
    // Rejected diagnostics survive the package service's staging cleanup.
    const audit=join(this.dependencies.workspaceRoot(input.projectId),'.pre-design/report-acceptance/html',result.integrityHash)
    await mkdir(audit,{recursive:true});await writeFile(join(audit,'report-acceptance.json'),JSON.stringify(result,null,2))
    await cp(join(root,'html-review'),join(audit,'html-review'),{recursive:true}).catch(error=>{if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error})
    if(failure)throw failure
    if(findings.length)throw new ReportPageRejected(findings)
    return result
  }
  async verify(input:FrozenProjectInput,root:string):Promise<ReportAcceptanceResult>{
    const content=await this.assertContent(input)
    let result:ReportAcceptanceResult
    try{result=JSON.parse(await readFile(join(root,'report-acceptance.json'),'utf8'))}catch{throw new Error('REPORT_ACCEPTANCE_REQUIRED: 旧成果没有当前标准的验收记录。')}
    const{integrityHash,...body}=result
    if(result.version!=='report-acceptance.v1'||result.contractVersion!==DEFAULT_REPORT_DELIVERY_CONTRACT.version||result.status!=='passed'||result.findings.length||!result.browser?.navigation
      ||result.sourceFingerprint!==manuscriptSourceFingerprint(input)||result.manuscriptHash!==reportManuscriptHash(input)||hash(body)!==integrityHash||hash(result.content)!==hash(content))throw new Error('REPORT_ACCEPTANCE_INVALID')
    if(hash(await reportAcceptanceResources(root))!==hash(result.resources))throw new Error('REPORT_ACCEPTANCE_RESOURCE_CHANGED')
    if(result.browser.findings.length||input.manuscript!.chapters.flatMap(c=>c.pages).some(p=>!result.browser!.pages.some(r=>r.sourcePageId===p.id)))throw new Error('REPORT_ACCEPTANCE_INVALID')
    await this.dependencies.rendered.verify(input,root,result.browser,result.rendered)
    if(result.rendered.some(r=>!r.output.pass))throw new Error('REPORT_ACCEPTANCE_INVALID')
    return result
  }
}
