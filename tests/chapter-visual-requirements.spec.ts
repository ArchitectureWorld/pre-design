import {expect,it} from 'vitest'
import {assertChapterRequiredVisuals,mergeChapterVisualRequirements} from '../src/report/chapter-layout-revision.ts'

it('rejects a claimed diagram when the compiled page contains only a photo and text',()=>{
 const layouts:any=[{pageId:'roles',elements:[{type:'figure'},{type:'body'}]}]
 expect(()=>assertChapterRequiredVisuals(layouts,[{pageId:'roles',kind:'graphic'}])).toThrow(/CHAPTER_REQUIRED_VISUAL_MISSING.*roles.*graphic/)
})
it('checks actual compiled visual roles and does not mistake a plain map for annotations',()=>{
 const layouts:any=[{pageId:'route',elements:[{type:'figure'},{type:'sequence'}]}]
 expect(()=>assertChapterRequiredVisuals(layouts,[{pageId:'route',kind:'annotated-map'}])).toThrow('CHAPTER_REQUIRED_VISUAL_MISSING')
 layouts[0].elements[0].annotations={markers:[{label:'1'}]}
 expect(()=>assertChapterRequiredVisuals(layouts,[{pageId:'route',kind:'annotated-map'},{pageId:'route',kind:'sequence'}])).not.toThrow()
 expect(()=>assertChapterRequiredVisuals([{pageId:'roles',elements:[{type:'graphic'}]}] as any,[{pageId:'roles',kind:'graphic'}])).not.toThrow()
})
it('keeps previously declared obligations across unrelated caption repairs and deduplicates',()=>{
 const before:any=[{pageId:'roles',kind:'graphic'}]
 expect(mergeChapterVisualRequirements(before,[],['roles','route'])).toEqual(before)
 expect(mergeChapterVisualRequirements(before,[...before,{pageId:'route',kind:'sequence'}],['roles','route'])).toEqual([...before,{pageId:'route',kind:'sequence'}])
 expect(before).toEqual([{pageId:'roles',kind:'graphic'}])
})
it('rejects invalid or foreign requirements instead of silently skipping them',()=>{
 expect(()=>mergeChapterVisualRequirements([],[{pageId:'other',kind:'graphic'}],['roles'])).toThrow('CHAPTER_REQUIRED_VISUAL_SCOPE')
 expect(()=>mergeChapterVisualRequirements([],[{pageId:'roles',kind:'reason'}] as any,['roles'])).toThrow('CHAPTER_REQUIRED_VISUAL_SCOPE')
 expect(()=>assertChapterRequiredVisuals([],[{pageId:'roles',kind:'graphic'}])).toThrow('CHAPTER_REQUIRED_VISUAL_MISSING')
})
