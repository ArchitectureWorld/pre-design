import {expect,it} from 'vitest'
import {recoverNativeChapterLayouts,scopeChapterLayoutError} from '../src/report/chapter-layout-recovery.ts'

it('repairs only excess current image uses while preserving prior chapters and valid pages',()=>{
 const c=base(),error=new Error('CHAPTER_IMAGE_ORIGINAL_REUSE: '+JSON.stringify([{originalId:'x',count:3,pages:['previous','p2','p6']}]))
 expect(scopeChapterLayoutError(error,c).pageIds).toEqual(['p6'])
 expect(scopeChapterLayoutError(new Error('unknown'),c).pageIds).toEqual(c.pages.map((p:any)=>p.pageId))
})

const base=()=>({pages:Array.from({length:7},(_,i)=>({pageId:'p'+i,reason:i%2?'needs repair':'native valid'}))} as any)
it('repairs only diagnosed pages in bounded native submissions and preserves the other objects',async()=>{
 const original=base(),calls:string[][]=[]
 const result=await recoverNativeChapterLayouts(original,c=>c.pages.filter(p=>p.reason==='needs repair').map(p=>({pageIds:[p.pageId],feedback:'actual geometry error'})),async(c,ids)=>{
  calls.push(ids);return {pages:ids.map(pageId=>({...c.pages.find(p=>p.pageId===pageId)!,reason:'native corrected'}))}
 })
 expect(calls).toEqual([['p1','p3'],['p5']])
 expect(result.pages.map(p=>p.pageId)).toEqual(original.pages.map((p:any)=>p.pageId))
 for(const i of [0,2,4,6])expect(result.pages[i]).toBe(original.pages[i])
 expect(original.pages[1].reason).toBe('needs repair')
})
it('checks whole-chapter issues after page repairs instead of equating local success with delivery',async()=>{
 const original=base();let submitted=0
 const result=await recoverNativeChapterLayouts(original,c=>c.pages[6]!.reason!=='native rhythm change'?[{pageIds:['p6'],feedback:'three consecutive layouts'}]:[],async(c,ids)=>{
  submitted++;return {pages:ids.map(pageId=>({...c.pages.find(p=>p.pageId===pageId)!,reason:'native rhythm change'}))}
 })
 expect(submitted).toBe(1);expect(result.pages[0]).toBe(original.pages[0])
})
it('rejects incomplete partial responses and bounds ineffective recovery without altering the source',async()=>{
 const original=base(),diagnose=()=>[{pageIds:['p1','p3'],feedback:'collision'}]
 await expect(recoverNativeChapterLayouts(original,diagnose,async()=>({pages:[original.pages[1]]}))).rejects.toThrow('CHAPTER_LAYOUT_USER_REVIEW_PAGES')
 let calls=0
 await expect(recoverNativeChapterLayouts(original,diagnose,async(c,ids)=>{calls++;return {pages:ids.map(id=>c.pages.find(p=>p.pageId===id)!)}})).rejects.toThrow('CHAPTER_LAYOUT_RECOVERY_LIMIT')
 expect(calls).toBe(3);expect(original.pages[1].reason).toBe('needs repair')
})
