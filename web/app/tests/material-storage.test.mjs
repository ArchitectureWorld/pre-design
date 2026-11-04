import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,readFile,readdir,symlink,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {Readable} from 'node:stream'
import {createHash} from 'node:crypto'
import {validateMaterialPath,writeMaterialStream,materialProcessing} from '../src/material-storage.mjs'
test('folder uploads preserve relative paths, arbitrary extensions and same-name originals',async()=>{
 const root=await mkdtemp(join(tmpdir(),'materials-'));await mkdir(join(root,'原始资料'))
 try{
  const bytes=Buffer.from('AC1032\0CAD sample')
  const a=await writeMaterialStream(root,'a','设计/建筑/平面.dwg',Readable.from([bytes]))
  const b=await writeMaterialStream(root,'b','设计/结构/平面.dwg',Readable.from([bytes]))
  assert.notEqual(a.path,b.path);assert.match(a.path,/设计\/建筑\/a\/平面\.dwg$/)
  assert.deepEqual(await readFile(a.path),bytes);assert.equal(a.sha256,createHash('sha256').update(bytes).digest('hex'))
  assert.equal(materialProcessing('平面.dwg',bytes.length,null).status,'conversion_required')
  const empty=await writeMaterialStream(root,'empty','README',Readable.from([]));assert.equal(empty.bytes,0)
  assert.equal(materialProcessing('任务书.txt',100,null).status,'readable')
  assert.equal(materialProcessing('扫描.png',100,null).status,'metadata_pending')
 }finally{await rm(root,{recursive:true,force:true})}
})
test('paths cannot escape the project or follow directory symlinks; oversized partial files are removed',async()=>{
 for(const path of ['../a.dwg','/a.dwg','C:/a.dwg','a/../b.dwg','a\\b.dwg','a//b.dwg','a/./b.dwg','a\0b'])assert.throws(()=>validateMaterialPath(path.split('/').at(-1),path))
 assert.equal(validateMaterialPath('.notes','.notes'),'.notes')
 const root=await mkdtemp(join(tmpdir(),'materials-')),outside=await mkdtemp(join(tmpdir(),'outside-'));await mkdir(join(root,'原始资料'));await symlink(outside,join(root,'原始资料','escape'))
 try{
  await assert.rejects(writeMaterialStream(root,'x','escape/a.dwg',Readable.from([Buffer.from('data')])));
  assert.deepEqual(await readdir(outside),[])
  await assert.rejects(writeMaterialStream(root,'big','safe/b.dwg',Readable.from([Buffer.alloc(5),Buffer.alloc(6)]),10),e=>e.statusCode===413)
  assert.deepEqual(await readdir(join(root,'原始资料','safe')),[])
 }finally{await rm(root,{recursive:true,force:true});await rm(outside,{recursive:true,force:true})}
})
test('real large CAD archives report missing parsers while large photos can attempt metadata reads',()=>{
 assert.match(materialProcessing('地形图.rar',188075048,null).label,/待转换或专用解析/)
 assert.match(materialProcessing('三区三线.DWG',68054284,null).label,/待转换或专用解析/)
 assert.equal(materialProcessing('影像.jpg',21053110,null).status,'metadata_pending')
 assert.match(materialProcessing('影像.jpg',21053110,null).label,/元数据/)
 assert.match(materialProcessing('长报告.pdf',70*1024*1024,null).label,/拆分/)
})
