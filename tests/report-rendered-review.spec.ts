import { expect,it } from 'vitest'
import { mkdtemp,mkdir,writeFile,rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ReportRenderedReviewService,validateRenderedReview } from '../src/report/rendered-review.ts'
import { completeReportFixture } from './support/complete-report.ts'
const probe=['blue','red','green','yellow']
const output=()=>({inputHash:'a'.repeat(64),pageId:'spatial-map',pass:true,rationale:'河畔课堂与游线图逐项对应。',findings:[],probe})
it('invalidates native page receipts when HTML changes while screenshots are retained',async()=>{
  const root=await mkdtemp(join(tmpdir(),'rendered-binding-'))
  try{
    await mkdir(join(root,'html'),{recursive:true});await mkdir(join(root,'html-review'))
    await writeFile(join(root,'html/index.html'),'original');await writeFile(join(root,'planning-sources.html'),'source')
    await writeFile(join(root,'html-review/page-0001.png'),'screenshot')
    const input=completeReportFixture(true),page={pageId:'cover',sourcePageId:'cover',assetIds:[],screenshot:'html-review/page-0001.png'}
    const service=new ReportRenderedReviewService({classes:{execution:()=>undefined}} as any)
    const original=await (service as any).packet(input,root,page)
    await writeFile(join(root,'html/index.html'),'changed CSS hiding parts of the proposal')
    const changed=await (service as any).packet(input,root,page)
    expect(changed.inputHash).not.toBe(original.inputHash)
  }finally{await rm(root,{recursive:true,force:true})}
})
it('rejects a fabricated pass when the reviewer did not decode the image challenge',()=>{
  expect(()=>validateRenderedReview({...output(),probe:['red','red','red','red']},'spatial-map','a'.repeat(64),probe)).toThrow('REPORT_RENDERED_REVIEW_INVALID')
})
it.each(['wrong-page','wrong-input','contradiction','missing-reason'])('rejects %s visual acceptance',kind=>{
  const value:any=output()
  if(kind==='wrong-page')value.pageId='other'
  if(kind==='wrong-input')value.inputHash='b'.repeat(64)
  if(kind==='contradiction')value.findings=['图片没有文中所述产品，只是重复风景']
  if(kind==='missing-reason')value.rationale=''
  expect(()=>validateRenderedReview(value,'spatial-map','a'.repeat(64),probe)).toThrow('REPORT_RENDERED_REVIEW_INVALID')
})
it('preserves a concrete negative visual verdict',()=>{
  const value={...output(),pass:false,findings:['图中游线穿越说明文字标注的生态保留区。']}
  expect(validateRenderedReview(value,'spatial-map','a'.repeat(64),probe).pass).toBe(false)
})
