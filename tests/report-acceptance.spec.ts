import { afterEach, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ReportAcceptanceService } from '../src/report/acceptance.ts'
import { completeReportFixture } from './support/complete-report.ts'
const roots:string[]=[]
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})))})
async function fixture(){
  const root=await mkdtemp(join(tmpdir(),'report-acceptance-'));roots.push(root)
  await mkdir(join(root,'html/assets'),{recursive:true});await writeFile(join(root,'html/index.html'),'<html>report</html>');await writeFile(join(root,'html/assets/one.png'),'image');await writeFile(join(root,'planning-sources.html'),'sources')
  const input=completeReportFixture(true)
  let contentStatus='passed',issues:any[]=[]
  const service=new ReportAcceptanceService({workspaceRoot:()=>root,content:{load:async()=>({status:contentStatus,receipts:[],findings:[]})},
    inspect:async()=>({version:'report-browser.v1',viewport:{width:1440,height:900},navigation:true,pages:input.manuscript!.chapters.flatMap(c=>c.pages.map(p=>({pageId:p.id,sourcePageId:p.id,screenshot:'unused',assetIds:[]}))),findings:issues}),
    rendered:{prepare:async()=>[],verify:async()=>{}},
  } as any)
  return{root,input,service,failContent:()=>{contentStatus='failed'},failHtml:()=>{issues=[{code:'HTML_TEXT_OVERFLOW',pageId:'spatial-plan',message:'空间文字溢出'}]}}
}
it('binds final HTML and resources and refuses changed image bytes on cache reuse',async()=>{
  const h=await fixture(),result=await h.service.accept(h.input,h.root)
  expect(result.status).toBe('passed');expect(result.resources.map(r=>r.path)).toContain('html/assets/one.png')
  await h.service.verify(h.input,h.root)
  await writeFile(join(h.root,'html/assets/one.png'),'changed')
  await expect(h.service.verify(h.input,h.root)).rejects.toThrow('REPORT_ACCEPTANCE_RESOURCE_CHANGED')
})
it('does not promote a historical HTML package without current acceptance',async()=>{
  const h=await fixture();await expect(h.service.verify(h.input,h.root)).rejects.toThrow('REPORT_ACCEPTANCE_REQUIRED')
})
it('retains specific HTML rejection outside staging and never grants acceptance',async()=>{
  const h=await fixture();h.failHtml()
  await expect(h.service.accept(h.input,h.root)).rejects.toThrow('REPORT_HTML_REJECTED')
  const result=JSON.parse(await readFile(join(h.root,'report-acceptance.json'),'utf8'))
  expect(result.status).toBe('failed');expect(result.findings[0].pageId).toBe('spatial-plan')
})
it('cannot export when independent content acceptance failed',async()=>{
  const h=await fixture();h.failContent()
  await expect(h.service.accept(h.input,h.root)).rejects.toThrow('REPORT_CONTENT_ACCEPTANCE_REQUIRED')
})
