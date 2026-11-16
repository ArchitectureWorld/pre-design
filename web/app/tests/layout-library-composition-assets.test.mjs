import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import sharp from 'sharp'
import {createLayoutAssetResolver} from '../src/layout-library/assets.mjs'

test('多图原件逐一按项目核验并保持顺序；任一越权图片使整页拒绝',async t=>{
 const workspace=await mkdtemp(join(tmpdir(),'composition-assets-'));t.after(()=>rm(workspace,{recursive:true,force:true}))
 await mkdir(join(workspace,'原始资料'))
 const files=[]
 for(const [index,background]of ['#334466','#886644'].entries()){
  const id=randomUUID(),path=join(workspace,'原始资料',`image-${index}.png`),bytes=await sharp({create:{width:80+index*20,height:60,channels:3,background}}).png().toBuffer()
  await writeFile(path,bytes);files.push({id,path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),image:{width:80+index*20,height:60}})
 }
 const resolver=createLayoutAssetResolver({query:async(_query,[project,id])=>({rows:project==='owner'?files.filter(f=>f.id===id):[]})})
 const page={id:'mix',item:{figures:files.map((f,i)=>({materialId:f.id,caption:`合成图${i+1}`})),table:{columns:['对象','数量'],rows:[['设施','2']]}}}
 const [rendered]=await resolver([page],{id:'owner',workspace})
 assert(Array.isArray(rendered.nativeAssets?.images),'每张图片均须取得独立核验结果')
 assert.deepEqual(rendered.nativeAssets.images.map(i=>i.materialId),files.map(f=>f.id))
 assert.deepEqual(rendered.nativeAssets.images.map(i=>i.sourceHash),files.map(f=>f.sha256))
 assert.deepEqual(rendered.item,page.item)
 const invalid=structuredClone(page);invalid.item.figures[1].materialId=randomUUID()
 await assert.rejects(resolver([invalid],{id:'owner',workspace}),/不存在/)
 await assert.rejects(resolver([page],{id:'other',workspace}),/不存在/)
})
