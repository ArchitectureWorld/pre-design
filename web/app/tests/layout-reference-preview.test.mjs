import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createTestDb} from './support/dossier-db.mjs'
import {createReferenceUploads} from '../src/layout-library/reference-uploads.mjs'

test('结构事实保留在私有上传记录，原页预览按拥有者和真实页码核验',async t=>{
 const env=await createTestDb(),root=await mkdtemp(join(tmpdir(),'reference-preview-'))
 t.after(async()=>{await env.close();await rm(root,{recursive:true,force:true})})
 const bytes=Buffer.from('private original'),image=Buffer.from('private image'),structure={schema:'pre-design.pptx-structure.v1',canvas:{width:1000,height:700},slides:[{number:7}]}
 const uploads=await createReferenceUploads(env.db,{root,extractor:async()=>({kind:'pptx',mimeType:'application/vnd.openxmlformats-officedocument.presentationml.presentation',text:'仅用于分析的正文',images:[{data:image,mimeType:'image/png',width:1000,height:700,page:7}],pageCount:12,readPages:[7],structure,pages:[{pageNumber:7}],limitations:[],summary:'选取第7页'})})
 const file=await uploads.create({id:'owner'},{requestId:'one',filename:'参考.pptx',bytes})
 assert.equal(file.structure,undefined,'上传摘要不能携带完整私有结构')
 assert.deepEqual((await uploads.get({id:'owner'},file.id)).structure,structure)
 assert.equal(typeof uploads.previewBySource,'function')
 const preview=await uploads.previewBySource({id:'owner'},file.sha256,7)
 assert.deepEqual(preview.data,image);assert.equal(preview.page,7);assert.equal(preview.fileId,file.id)
 const modelImages=await uploads.modelImages({id:'owner'},[{id:file.id,sha256:file.sha256}])
 assert.equal(modelImages[0].width,1000);assert.equal(modelImages[0].height,700)
 await assert.rejects(uploads.previewBySource({id:'other'},file.sha256,7),e=>e.statusCode===404)
 await assert.rejects(uploads.previewBySource({id:'owner'},file.sha256,1),e=>e.statusCode===404)
})
test('private derived artifacts survive upload storage and are owner/hash gated, not returned in summaries',async t=>{
 const {createHash}=await import('node:crypto'),{writeFile}=await import('node:fs/promises')
 const env=await createTestDb(),root=await mkdtemp(join(tmpdir(),'reference-artifacts-upload-'))
 t.after(async()=>{await env.close();await rm(root,{recursive:true,force:true})})
 const data=Buffer.from('<svg/>'),sha256=createHash('sha256').update(data).digest('hex')
 const uploads=await createReferenceUploads(env.db,{root,extractor:async()=>({kind:'pptx',mimeType:'application/vnd.openxmlformats-officedocument.presentationml.presentation',images:[],privateArtifacts:[{path:'svg/slide_01.svg',bytes:data.length,sha256,data}]})})
 const file=await uploads.create({id:'owner'},{requestId:'artifacts',filename:'reference.pptx',bytes:Buffer.from('source')})
 assert.equal(file.privateArtifacts,undefined)
 const privateFile=await uploads.get({id:'owner'},file.id)
 assert.equal(privateFile.privateArtifacts[0].path,'svg/slide_01.svg')
 assert.equal(privateFile.privateArtifacts[0].data,undefined)
 assert.deepEqual((await uploads.artifact({id:'owner'},file.id,'svg/slide_01.svg')).data,data)
 await assert.rejects(uploads.artifact({id:'other'},file.id,'svg/slide_01.svg'),e=>e.statusCode===404)
 await assert.rejects(uploads.artifact({id:'owner'},file.id,'../source'),e=>e.statusCode===404)
 await writeFile(join(root,file.id,'artifact-1'),Buffer.from('changed'))
 await assert.rejects(uploads.artifact({id:'owner'},file.id,'svg/slide_01.svg'),e=>e.statusCode===409)
})
