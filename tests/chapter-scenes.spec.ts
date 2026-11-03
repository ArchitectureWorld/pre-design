import {expect,it} from 'vitest'
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {assertSupportedJsonSchema} from '@deepseek-ai/dsh-tools'
import {chapterSceneSchema,validateChapterSceneBriefs,chapterGeneratedScene,validateChapterSceneRequest,mergeChapterSceneAssets} from '../src/report/chapter-scenes.ts'

const scene={key:'tea-learning',title:'茶事体验',pageIds:['p1'],prompt:'本场景表现乡村茶园中的户外教学活动，教师带领家庭观察采茶手法，背景是连绵低山与茶垄，横幅摄影构图，无文字。',reason:'表现本页茶事体验产品。'}
it('exposes the two-page scene budget to native tools and reports the exact violating field',()=>{
  const scenes=(chapterSceneSchema as any).properties.scenes
  expect(scenes.description).toContain('1至6')
  expect(scenes.items.properties.pageIds.description).toContain('1至2')
  expect(()=>validateChapterSceneBriefs({scenes:[{...scene,pageIds:['p1','p2','p3']}]},['p1','p2','p3'])).toThrow(/pageIds.*3.*2/)
})
it('binds supplementary scene requests to the reviewed manuscript and real page scope',()=>{
  const request={origin:'user-message',message:'执行',baseManuscriptHash:'a'.repeat(64),pageIds:['p1'],feedback:'补充相关产品体验场景'}
  expect(()=>validateChapterSceneRequest(request,'a'.repeat(64),['p1','p2'])).not.toThrow()
  expect(()=>validateChapterSceneRequest(request,'b'.repeat(64),['p1'])).toThrow('CHAPTER_SCENE_REQUEST')
  expect(()=>validateChapterSceneRequest({...request,pageIds:['invented']},'a'.repeat(64),['p1'])).toThrow('CHAPTER_SCENE_REQUEST')
})
it('keeps previously generated native scenes when a supplementary batch is added or resumed',()=>{
  const old:any={id:'old',sha256:'old-hash'},fresh:any={id:'fresh',sha256:'fresh-hash'}
  expect(mergeChapterSceneAssets([old],[fresh])).toEqual([old,fresh])
  expect(mergeChapterSceneAssets([old,fresh],[fresh])).toEqual([old,fresh])
  expect(()=>mergeChapterSceneAssets([old],[{...old,sha256:'changed'}])).toThrow('CHAPTER_SCENE_ASSET_CHANGED')
})
it('accepts native schema and rejects invented pages, duplicate keys and missing image prompts',()=>{
  expect(()=>assertSupportedJsonSchema(chapterSceneSchema)).not.toThrow()
  expect(()=>validateChapterSceneBriefs({scenes:[scene]},['p1'])).not.toThrow()
  for(const value of [{scenes:[{...scene,pageIds:['missing']}]},{scenes:[scene,scene]},{scenes:[{...scene,prompt:undefined}]}])
    expect(()=>validateChapterSceneBriefs(value as any,['p1'])).toThrow('CHAPTER_SCENE')
})
it('admits only quality-accepted native concept assets and detects changed bytes',async()=>{
  const root=await mkdtemp(join(tmpdir(),'chapter-scene-'))
  try{
    await mkdir(join(root,'assets/images'),{recursive:true})
    const bytes=Buffer.from('native-image-bytes'),path=join(root,'assets/images/scene.png')
    await writeFile(path,bytes)
    const asset:any={assetId:'native-one',taskId:'native-task',fileName:'scene.png',kind:'concept',status:'candidate',quality:{accepted:true},provider:'configured',model:'selected',width:1600,height:896,sha256:createHash('sha256').update(bytes).digest('hex')}
    const result=await chapterGeneratedScene(root,scene,asset)
    expect(result.visualKind).toBe('product');expect(result.sourceNote).toContain('非现状实拍');expect(result.sourceNote).toContain('native-task')
    await expect(chapterGeneratedScene(root,scene,{...asset,quality:{accepted:false}})).rejects.toThrow('UNVERIFIED')
    await writeFile(path,'changed')
    await expect(chapterGeneratedScene(root,scene,asset)).rejects.toThrow('CHANGED')
  }finally{await rm(root,{recursive:true,force:true})}
})
