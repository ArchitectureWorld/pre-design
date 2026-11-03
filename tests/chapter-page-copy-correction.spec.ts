import {expect,it} from 'vitest'
import * as corrections from '../src/report/chapter-copy-correction.ts'
import {sha256CanonicalJson as hash} from '../src/presentation/canonical-json.ts'
import {assertSupportedJsonSchema} from '@deepseek-ai/dsh-tools'
const draft:any={planHash:'plan',chapter:{id:'spatial',title:'空间',pages:[{id:'spatial-one',title:'旧标题',claim:'旧结论',body:['旧段一','旧段二','旧段三'],visual:{kind:'source',subject:'旧图意',purpose:'旧目的',caption:'旧图注'},notes:['核验细目保留'],sourceRefs:['R-1'],spatialEvidence:{node:'位置依据保持'},table:{columns:['表头'],rows:[['不动']]}},{id:'spatial-other',body:['其他页不动']}]}}
const request:any={kind:'page-copy-correction',planHash:'plan',baseManuscriptHash:hash(draft.chapter),pageId:'spatial-one',reason:'公开正文应形成方案判断'}
const output={title:'空间组织形成完整体验',claim:'空间与服务共同组织体验。',body:['第一条拟议方案。','第二条空间组织。','第三条衔接策略。'],visual:{kind:'source',subject:'空间组织与现场',purpose:'呈现总体方案',caption:'现场环境'},reason:'保留原方案与核验备注'}
const apply=(d:any=draft,r:any=request,o:any=output)=>(corrections as any).applyChapterPageCopyCorrection(d,r,o)
it('changes only selected public page copy while keeping evidence, tables, notes and other pages fixed',()=>{
 const before=JSON.stringify(draft),next=apply(),p=next.pages[0]
 expect(p.title).toBe(output.title);expect(p.body).toEqual(output.body);expect(p.visual).toEqual(output.visual)
 for(const field of ['title','claim','body','visual'])p[field]=draft.chapter.pages[0][field]
 expect(next).toEqual(draft.chapter);expect(JSON.stringify(draft)).toBe(before)
 expect(()=>assertSupportedJsonSchema((corrections as any).chapterPageCopyCorrectionSchema)).not.toThrow()
})
it.each([{pageId:'outside'},{baseManuscriptHash:'old'},{planHash:'old'},{reason:''}])('rejects an unbound or absent target %s',patch=>{
 expect(()=>apply(draft,{...request,...patch})).toThrow('CHAPTER_PAGE_CORRECTION_BASE')
})
it.each([{...output,body:['one']},{...output,notes:[]},{...output,visual:{...output.visual,coordinates:[1,2]}},{...output,claim:''},{...output,body:['x'.repeat(181),'b','c']}])('rejects scope expansion and unusable public copy',value=>{
 expect(()=>apply(draft,request,value)).toThrow('CHAPTER_PAGE_CORRECTION_OUTPUT')
})
