import {expect,it} from 'vitest'
import {applyChapterCopyCorrection,chapterCopyCorrectionSchema} from '../src/report/chapter-copy-correction.ts'
import {sha256CanonicalJson as hash} from '../src/presentation/canonical-json.ts'
import {assertSupportedJsonSchema} from '@deepseek-ai/dsh-tools'

const draft:any={planHash:'plan',chapter:{id:'products',title:'产品',pages:[{id:'products-one',body:['摘要旧值','第二条不动'],notes:['来源不动'],quantities:[{id:'total',value:100}]},{id:'products-two',body:['其他页面不动']}]}}
const request:any={kind:'single-body-correction',planHash:'plan',baseManuscriptHash:hash(draft.chapter),pageId:'products-one',bodyIndex:0,reason:'修正摘要与计算口径的矛盾'}
it('changes only the authorized body item and preserves the native chapter and source data',()=>{
 const original=JSON.stringify(draft),chapter=applyChapterCopyCorrection(draft,request,{text:'原生作者修正的摘要',reason:'与已有计算一致'})
 expect(chapter.pages[0]!.body).toEqual(['原生作者修正的摘要','第二条不动'])
 expect(chapter.pages[1]).toEqual(draft.chapter.pages[1])
 expect(chapter.pages[0]!.notes).toEqual(draft.chapter.pages[0].notes)
 expect(chapter.pages[0]!.quantities).toEqual(draft.chapter.pages[0].quantities)
 expect(JSON.stringify(draft)).toBe(original)
 expect(()=>assertSupportedJsonSchema(chapterCopyCorrectionSchema)).not.toThrow()
})
it.each([{baseManuscriptHash:'changed'},{planHash:'changed'},{pageId:'outside'},{bodyIndex:2},{bodyIndex:-1}])('rejects a changed base or out-of-scope target %s',patch=>{
 expect(()=>applyChapterCopyCorrection(draft,{...request,...patch},{text:'修改',reason:'理由'})).toThrow('CHAPTER_COPY_CORRECTION_BASE')
})
it('rejects extra fields so a correction cannot replace other page content',()=>{
 expect(()=>applyChapterCopyCorrection(draft,request,{text:'修改',reason:'理由',pages:[]} as any)).toThrow('CHAPTER_COPY_CORRECTION_OUTPUT')
})
