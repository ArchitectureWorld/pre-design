import {expect,it} from 'vitest'
import {normalizeApprovedChapterMetadata,buildApprovedChapterPrompt} from '../src/report/chapter-plan.ts'
import {validatePlanningChapter} from '../src/report/manuscript/validation.ts'
const sources=[{id:'s1',objectId:'source',fieldPath:'evidence',text:'客厅和茶园形成服务组合',basis:'native',evidenceIds:[]}]
function fixture(id:string){
 const page={id:id+'-package',kind:'product',title:'客厅与茶园构成服务组合',claim:'接待与茶事形成完整体验。',body:['客厅接待衔接茶园学习，茶叙收束游程。'],sourceRefs:['s1'],notes:['实施条件由相关方确认。'],visual:{kind:'source',subject:'茶园场景',purpose:'说明体验',caption:'茶田学习场景'}}
 return {raw:{id,title:'章节',thesis:'形成服务与经营安排。',pages:[page]},brief:{plan:{chapterId:id,title:'章节',summary:'服务组合',pages:[{id:page.id,title:page.title,content:{}}],sources},approval:{origin:'user-message',message:'一次完成后面章节',approvedAt:'2026-10-22T00:00:00Z'}} as any}
}
it.each([['launch','delivery'],['operation','financial']])('normalizes an unused product label in %s while preserving all native content', (id,target)=>{
 const {raw,brief}=fixture(id),before=structuredClone(raw),fixed=normalizeApprovedChapterMetadata(raw,brief)
 expect(fixed.changes).toEqual([{pageId:raw.pages[0]!.id,field:'kind',from:'product',to:target}])
 const expected=structuredClone(raw);expected.pages[0]!.kind=target
 expect(fixed.value).toEqual(expected);expect(raw).toEqual(before)
 expect(validatePlanningChapter(fixed.value,id as any,sources).pages[0]!.kind).toBe(target)
})
it.each(['launch','operation','products'])('keeps real or incomplete product specification requirements in %s',id=>{
 const {raw,brief}=fixture(id);Object.assign(raw.pages[0]!,{product:{name:'服务包'}})
 const fixed=normalizeApprovedChapterMetadata(raw,brief)
 expect(fixed.changes).toEqual([])
 expect(()=>validatePlanningChapter(fixed.value,id as any,sources)).toThrow('MANUSCRIPT_PRODUCT')
})
it('does not normalize a different chapter or an unknown page identity',()=>{
 const {raw,brief}=fixture('launch');raw.id='products'
 expect(normalizeApprovedChapterMetadata(raw,brief).changes).toEqual([])
 raw.id='launch';raw.pages[0]!.id='launch-unknown'
 expect(normalizeApprovedChapterMetadata(raw,brief).changes).toEqual([])
})
