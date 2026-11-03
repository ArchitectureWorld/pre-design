import {expect,it} from 'vitest'
import * as corrections from '../src/report/chapter-copy-correction.ts'
import {sha256CanonicalJson as hash} from '../src/presentation/canonical-json.ts'
import {assertSupportedJsonSchema} from '@deepseek-ai/dsh-tools'

const draft:any={planHash:'plan',chapter:{id:'products',title:'产品',pages:[
 {id:'products-choice',title:'比较',body:['正文保持'],notes:['出处保持'],sourceRefs:['R-1'],table:{columns:['方向','原比较口径','取舍'],rows:[['内容服务','课程与讲解','主导'],['茶事','体验延展','支撑'],['住宿','配套停留','配套']]},quantities:[{id:'value',value:100}]},
 {id:'products-other',body:['其他页保持']}
]}}
const request:any={kind:'table-column-correction',planHash:'plan',baseManuscriptHash:hash(draft.chapter),pageId:'products-choice',columnIndex:1,reason:'统一已审三项比较口径'}
const output={heading:'同口径比较',values:['直达服务；轻投入；主线契合','延伸服务；轻投入；主题支撑','停留配套；较高投入；配套协作'],reason:'按同一顺序表达服务链、投入与定位'}
const apply=(d:any=draft,r:any=request,o:any=output)=>(corrections as any).applyChapterTableColumnCorrection(d,r,o)
it('changes only the selected table column and heading while preserving the rest of the chapter',()=>{
 const before=JSON.stringify(draft),next=apply()
 expect(next.pages[0].table.columns).toEqual(['方向','同口径比较','取舍'])
 expect(next.pages[0].table.rows).toEqual(draft.chapter.pages[0].table.rows.map((row:any,i:number)=>[row[0],output.values[i],row[2]]))
 const restored=structuredClone(next);restored.pages[0].table=draft.chapter.pages[0].table
 expect(restored).toEqual(draft.chapter)
 expect(JSON.stringify(draft)).toBe(before)
 expect(()=>assertSupportedJsonSchema((corrections as any).chapterTableColumnCorrectionSchema)).not.toThrow()
})
it.each([{baseManuscriptHash:'changed'},{planHash:'changed'},{pageId:'products-other'},{columnIndex:-1},{columnIndex:3},{columnIndex:1.5},{reason:''}])('rejects stale or invalid correction scope %s',patch=>{
 expect(()=>apply(draft,{...request,...patch})).toThrow('CHAPTER_TABLE_CORRECTION_BASE')
})
it.each([
 {...output,values:['only one row']},
 {...output,values:[...output.values,'extra row']},
 {...output,values:[null,...output.values.slice(1)]},
 {...output,heading:''},
 {...output,reason:''},
 {...output,table:{}},
 {...output,values:['x'.repeat(181),...output.values.slice(1)]}
])('rejects missing/extra rows, invalid copy, and fields that could replace other content',value=>{
 expect(()=>apply(draft,request,value)).toThrow('CHAPTER_TABLE_CORRECTION_OUTPUT')
})
