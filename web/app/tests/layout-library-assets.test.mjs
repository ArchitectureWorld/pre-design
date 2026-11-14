import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import sharp from 'sharp'
import {createLayoutAssetResolver} from '../src/layout-library/assets.mjs'

test('实际核验原件之后仍能从文件起点读取图像，绑定项目与哈希且不接受越权图片',async t=>{
 const workspace=await mkdtemp(join(tmpdir(),'layout-asset-'));t.after(()=>rm(workspace,{recursive:true,force:true}))
 await mkdir(join(workspace,'原始资料'));const id=randomUUID(),path=join(workspace,'原始资料','test.png')
 const image=await sharp({create:{width:96,height:64,channels:3,background:'#446688'}}).png().toBuffer();await writeFile(path,image)
 const file={id,path,bytes:image.length,sha256:createHash('sha256').update(image).digest('hex'),image:{width:96,height:64}}
 const resolver=createLayoutAssetResolver({query:async(_q,args)=>({rows:args[0]==='own'&&args[1]===id?[file]:[]})})
 const page={id:'one',item:{figure:{materialId:id,caption:'样例原件'}}}
 const [rendered]=await resolver([page],{id:'own',workspace});assert.match(rendered.nativeAssets.image.dataUrl,/^data:image\/webp;base64,/);assert.equal(rendered.nativeAssets.image.sourceHash,file.sha256)
 assert.equal((await sharp(Buffer.from(rendered.nativeAssets.image.dataUrl.split(',')[1],'base64')).metadata()).width,96)
 await assert.rejects(resolver([page],{id:'other',workspace}),/不存在/)
 await writeFile(path,Buffer.from('changed'));await assert.rejects(resolver([page],{id:'own',workspace}),/校验失败/)
})
