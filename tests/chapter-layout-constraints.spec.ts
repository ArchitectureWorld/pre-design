import {expect,it} from 'vitest'
import {assertChapterLayoutConstraints,mergeChapterLayoutConstraints} from '../src/report/chapter-layout-revision.ts'
const page=(assetId='outdoor',right=false):any=>({pageId:'p',name:'composed',elements:[
 {type:'figure',assetId,rect:{x:right?850:56,y:210,width:690,height:400}},
 {type:'body',index:0,rect:{x:right?56:850,y:210,width:690,height:300}},
]})
it('checks selected imagery and actual reading direction, not the native explanation',()=>{
 const constraints:any=[{pageId:'p',allowedAssetIds:['indoor'],allowedFlows:['copy-left-image-right']}]
 expect(()=>assertChapterLayoutConstraints([page()],constraints)).toThrow('CHAPTER_LAYOUT_CONSTRAINT')
 expect(()=>assertChapterLayoutConstraints([page('indoor')],constraints)).toThrow('CHAPTER_LAYOUT_CONSTRAINT')
 expect(()=>assertChapterLayoutConstraints([page('indoor',true)],constraints)).not.toThrow()
})
it('retains established constraints during later automatic repairs and validates their scope',()=>{
 const previous:any=[{pageId:'p',allowedAssetIds:['indoor']}]
 expect(mergeChapterLayoutConstraints(previous,[],['p'],[])).toEqual(previous)
 expect(mergeChapterLayoutConstraints(previous,[{pageId:'p',allowedFlows:['copy-left-image-right']}],['p'],['p'])).toEqual([{...previous[0],allowedFlows:['copy-left-image-right']}])
 expect(()=>mergeChapterLayoutConstraints([],previous,['p'],['other'])).toThrow('CHAPTER_LAYOUT_CONSTRAINT_SCOPE')
 expect(()=>mergeChapterLayoutConstraints([],[{pageId:'p',allowedAssetIds:[]}],['p'],['p'])).toThrow('CHAPTER_LAYOUT_CONSTRAINT_SCOPE')
})
