import { expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { reviewChapterExport,nativeVisualReviewSchema } from '../src/report/chapter-visual-review.ts'
import { CHAPTER_QUALITY_POLICY } from '../src/report/chapter-quality-policy.ts'

const sha = (b:Uint8Array|string) => createHash('sha256').update(b).digest('hex')
it('uses a direct object for one-page native review rather than an unsupported single oneOf',()=>{
  const schema:any=nativeVisualReviewSchema([{pageId:'p1',screenshotSha256:'abc'}])
  expect(schema.properties.pages.items.oneOf).toBeUndefined()
  expect(schema.properties.pages.items.properties.pageId.const).toBe('p1')
})
it('sends real final pixels in serial three-page batches and refuses artifact changes during review', async () => {
  const root=await mkdtemp(join(tmpdir(),'chapter-visual-review-test-'))
  try {
    const qa=join(root,'逐页检查');await mkdir(qa)
    const png=await sharp({create:{width:160,height:90,channels:3,background:'#537869'}}).png().toBuffer()
    const pages=[]
    for(let i=0;i<4;i++){const screenshot=join(qa,`page-${i}.png`);await writeFile(screenshot,png);pages.push({pageId:`p${i}`,screenshot})}
    await writeFile(join(qa,'全章缩略图.png'),png)
    const browserQa=join(qa,'显示核验.json');await writeFile(browserQa,JSON.stringify({pass:true,pages}))
    const htmlPath=join(root,'report.html'),pdfPath=join(root,'report.pdf')
    await writeFile(htmlPath,'html');await writeFile(pdfPath,'pdf')
    const result={htmlPath,pdfPath,htmlSha256:sha('html'),pdfSha256:sha('pdf'),browserQa}
    const draft:any={chapter:{pages:pages.map(p=>({id:p.pageId,title:'标题',body:['正文'],sourceRefs:['W-1']}))}}
    const brief:any={plan:{pages:pages.map(p=>({id:p.pageId,content:{question:'本页问题',oldGap:'旧研究尚未补齐案例原文'}})),sources:[{id:'W-1',text:'本轮官方案例原文',basis:'https://example.gov.cn/case 当次检索的路线组织说明',evidenceIds:['W-1']} ]}}
    const layouts:any=pages.map(p=>({pageId:p.pageId,elements:[]}))
    const calls:any[]=[]
    const run:any=async(phase:string,prompt:string,schema:any,validate:any,images:any[])=>{
      calls.push({phase,prompt,images});expect(images.every(i=>Buffer.isBuffer(i.bytes)&&sha(i.bytes)===i.sha256)).toBe(true)
      const review={chapterObservation:'各页结构有差异。',pages:(schema.properties.pages.items.oneOf??[schema.properties.pages.items]).map((p:any)=>({pageId:p.properties.pageId.const,screenshotSha256:p.properties.screenshotSha256.const,imageReadable:true,
        checks:CHAPTER_QUALITY_POLICY.rules.map(r=>({ruleId:r.id,observation:'标题和配图区域明确。'})),findings:[]}))}
      validate(review);return review
    }
    const review=await reviewChapterExport(result,draft,brief,layouts,[],AbortSignal.timeout(10000),run)
    expect(calls).toHaveLength(2);expect(calls.map(c=>c.images.length)).toEqual([4,2]);expect(review.status).toBe('ready')
    expect(calls.every(c=>c.prompt.includes('本轮官方案例原文')&&c.prompt.includes('https://example.gov.cn/case'))).toBe(true)
    expect(calls.every(c=>c.prompt.includes('current-native-manuscript')&&!c.prompt.includes('旧研究尚未补齐案例原文'))).toBe(true)
    expect(JSON.parse(await readFile(review.path,'utf8')).reviewBasis).toBe('accepted-native-copy-20261022')
    expect(JSON.parse(await readFile(review.path,'utf8')).reviewContractVersion).toBe(5)
    expect(calls.every(c=>c.prompt.includes('typographyMetrics')&&c.prompt.includes('颜色差异本身不属于字体不匹配'))).toBe(true)
    expect(JSON.parse(await readFile(review.path,'utf8')).userReview).toBe('pending')
    await writeFile(join(root,'版面与图件.json'),JSON.stringify({layouts,assets:[]}))
    const baseline=JSON.parse(await readFile(review.path,'utf8'))
    baseline.reviews[1].pages[0].findings=[{ruleId:'purpose',severity:'blocking',evidence:'旧页欠缺示意',action:'后续补图',repairTarget:'layout'}]
    const baselinePath=join(root,'baseline.json');await writeFile(baselinePath,JSON.stringify(baseline))
    const continuity={path:baselinePath,sha256:sha(await readFile(baselinePath)),pageIds:['p1']}
    const changed=await sharp({create:{width:160,height:90,channels:3,background:'#ffddee'}}).png().toBuffer()
    await writeFile(pages[1]!.screenshot,changed)
    const before=calls.length
    const continued=await reviewChapterExport(result,draft,brief,layouts,[],AbortSignal.timeout(10000),run,{continuity})
    expect(calls.length-before).toBe(1)
    expect(continued.pageCount).toBe(4)
    expect(continued.status).toBe('needs_revision')
    expect(continued.scopedStatus).toBe('ready')
    expect(continued.deferredPageIds).toEqual(['p3'])
    expect(JSON.parse(await readFile(continued.path,'utf8')).reusedPageIds).toEqual(['p0','p2','p3'])
    // A new aesthetics policy must examine every page afresh while keeping the repair scope.
    const oldPolicy={...baseline,policyVersion:'previous-aesthetic-policy'}
    const oldPolicyPath=join(root,'old-policy.json');await writeFile(oldPolicyPath,JSON.stringify(oldPolicy))
    const beforePolicy=calls.length
    const rechecked=await reviewChapterExport(result,draft,brief,layouts,[],AbortSignal.timeout(10000),run,{continuity:{...continuity,path:oldPolicyPath,sha256:sha(await readFile(oldPolicyPath))}})
    expect(calls.length-beforePolicy).toBe(2)
    expect(rechecked.reusedPageIds).toEqual([])
    expect(rechecked.reviewedPageIds).toEqual(['p0','p1','p2','p3'])
    expect(rechecked.scopePageIds).toEqual(['p1'])
    // A prior review with obsolete task authority cannot be reused even if pixels match.
    const oldBasis={...baseline,reviewBasis:undefined}
    const oldBasisPath=join(root,'old-basis.json');await writeFile(oldBasisPath,JSON.stringify(oldBasis))
    const beforeBasis=calls.length
    const basisReview=await reviewChapterExport(result,draft,brief,layouts,[],AbortSignal.timeout(10000),run,{continuity:{...continuity,path:oldBasisPath,sha256:sha(await readFile(oldBasisPath))}})
    expect(calls.length-beforeBasis).toBe(2)
    expect(basisReview.reusedPageIds).toEqual([])
    // Neighbours changed in the overview: unchanged individual pages need a fresh rhythm review too.
    await writeFile(join(qa,'全章缩略图.png'),changed)
    const beforeOverview=calls.length
    const overviewReview=await reviewChapterExport(result,draft,brief,layouts,[],AbortSignal.timeout(10000),run,{continuity})
    expect(calls.length-beforeOverview).toBe(2)
    expect(overviewReview.reusedPageIds).toEqual([])
    await writeFile(join(qa,'全章缩略图.png'),png)
    await writeFile(pages[0]!.screenshot,changed)
    await expect(reviewChapterExport(result,draft,brief,layouts,[],AbortSignal.timeout(10000),run,{continuity})).rejects.toThrow('CHAPTER_QUALITY_OUTSIDE_SCOPE_CHANGED')
    await writeFile(pages[0]!.screenshot,png)
    const subset=await reviewChapterExport(result,draft,brief,layouts,[],AbortSignal.timeout(10000),run,{pageIds:['p1']})
    expect(subset.pageCount).toBe(1)
    expect(JSON.parse(await readFile(subset.path,'utf8')).scope).toBe('selected-pages')
    await expect(reviewChapterExport(result,draft,brief,layouts,[],AbortSignal.timeout(10000),run,{pageIds:['missing']})).rejects.toThrow('CHAPTER_QUALITY_REVIEW_SCOPE')
    await expect(reviewChapterExport(result,draft,brief,layouts,[],AbortSignal.timeout(10000),async(...args)=>{
      const value=await run(...args);await writeFile(htmlPath,'changed');return value
    })).rejects.toThrow('CHAPTER_QUALITY_ARTIFACT_CHANGED')
  } finally { await rm(root,{recursive:true,force:true}) }
})
