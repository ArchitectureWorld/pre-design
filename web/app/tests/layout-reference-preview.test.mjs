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
test('PDF continuation retains one original, serializes same-source additions and loads only six verified pages',async t=>{
 const env=await createTestDb(),root=await mkdtemp(join(tmpdir(),'reference-continue-'))
 t.after(async()=>{await env.close();await rm(root,{recursive:true,force:true})})
 let calls=0
 const uploads=await createReferenceUploads(env.db,{root,extractor:async({pdfStartPage=1})=>{
  calls++;const readPages=Array.from({length:Math.min(30,87-pdfStartPage+1)},(_,i)=>pdfStartPage+i)
  return {kind:'pdf',mimeType:'application/pdf',pageCount:87,readPages,pages:readPages.map(page=>({page,text:'page '+page})),images:readPages.map(page=>({page,mimeType:'image/jpeg',width:1600,height:900,data:Buffer.from('image '+page)})),text:'batch text',limitations:[]}
 }})
 const actor={id:'owner'},source=Buffer.from('unchanged original'),file=await uploads.create(actor,{requestId:'one',filename:'reference.pdf',bytes:source})
 await assert.rejects(uploads.ensurePdfPages({id:'other'},file.id,31),e=>e.statusCode===404)
 await Promise.all([uploads.ensurePdfPages(actor,file.id,31),uploads.ensurePdfPages(actor,file.id,31)])
 const result=await uploads.ensurePdfPages(actor,file.id,61)
 assert.equal(calls,3);assert.equal(result.readPages.length,87);assert.equal(result.readPages.at(-1),87)
 assert.deepEqual((await uploads.download(actor,file.id)).data,source)
 const manifest=await uploads.imageManifest(actor,[file]);assert.equal(manifest.length,87)
 const batch=await uploads.loadImageBatch(actor,manifest.slice(60,66));assert.equal(batch.length,6);assert.equal(batch[0].page,61)
 await assert.rejects(uploads.loadImageBatch({id:'other'},manifest.slice(0,1)),e=>e.statusCode===404)
 await assert.rejects(uploads.loadImageBatch(actor,[{...manifest[0],sha256:'0'.repeat(64)}]),e=>e.statusCode===409)
 await assert.rejects(uploads.modelImages(actor,[file]),e=>e.statusCode===413)
})
test('PDF continuation safely resumes after failed or uncertain COMMIT without overwriting page bytes',async t=>{
 for(const outcome of ['before','after']){
  const env=await createTestDb(),root=await mkdtemp(join(tmpdir(),'reference-commit-'))
  t.after(async()=>{await env.close();await rm(root,{recursive:true,force:true})})
  let failCommit=false
  const db={query:(...args)=>env.db.query(...args),connect:async()=>{const c=await env.db.connect();return {release:()=>c.release(),query:async(sql,...args)=>{
   if(sql==='COMMIT'&&failCommit){failCommit=false;if(outcome==='after')await c.query(sql,...args);throw Error('TEST_COMMIT_ACK_LOST')}
   return c.query(sql,...args)
  }}}}
  const uploads=await createReferenceUploads(db,{root,extractor:async({pdfStartPage=1})=>{const readPages=Array.from({length:Math.min(30,31-pdfStartPage+1)},(_,i)=>pdfStartPage+i);return {kind:'pdf',mimeType:'application/pdf',pageCount:31,readPages,pages:readPages.map(page=>({page})),images:readPages.map(page=>({page,mimeType:'image/jpeg',width:100,height:100,data:Buffer.from('stable '+page)}))}}})
  const actor={id:'owner'},file=await uploads.create(actor,{requestId:'one',filename:'reference.pdf',bytes:Buffer.from('source')})
  failCommit=true;await assert.rejects(uploads.ensurePdfPages(actor,file.id,31),/TEST_COMMIT_ACK_LOST/)
  const result=await uploads.ensurePdfPages(actor,file.id,31);assert.equal(result.readPages.length,31)
  assert.equal((await uploads.preview(actor,file.id,31)).data.toString(),'stable 31')
 }
})
test('PPTX continuation fills sampled gaps without replacing original graph or SVG artifacts',async t=>{
 const {createHash}=await import('node:crypto'),env=await createTestDb(),root=await mkdtemp(join(tmpdir(),'reference-pptx-continue-'))
 t.after(async()=>{await env.close();await rm(root,{recursive:true,force:true})})
 const source=Buffer.from('original pptx'),sourceSha256=createHash('sha256').update(source).digest('hex'),svg=Buffer.from('<svg/>'),svgSha=createHash('sha256').update(svg).digest('hex'),structure={slides:Array.from({length:87},(_,i)=>({page:i+1,layoutId:'layout-1',masterId:'master-1'})),pptMaster:{receiptHash:'same-original-receipt'}}
 const uploads=await createReferenceUploads(env.db,{root,extractor:async({pptxStartPage})=>{
  const readPages=pptxStartPage===undefined?Array.from({length:30},(_,i)=>Math.round(i*86/29)+1):Array.from({length:Math.min(30,88-pptxStartPage)},(_,i)=>pptxStartPage+i)
  const pages=(pptxStartPage===undefined?structure.slides:structure.slides.filter(p=>readPages.includes(p.page))).map(p=>({...p,preview:readPages.includes(p.page)}))
  return {kind:'pptx',mimeType:'application/vnd.openxmlformats-officedocument.presentationml.presentation',pageCount:87,readPages,pages,images:readPages.map(page=>({page,mimeType:'image/jpeg',width:1600,height:900,data:Buffer.from('slide '+page)})),...(pptxStartPage===undefined?{structure,privateArtifacts:[{path:'svg-flat/slide_31.svg',sha256:svgSha,bytes:svg.length,data:svg}]}:{previewOnly:true,sourceSha256})}
 }})
 const actor={id:'owner'},file=await uploads.create(actor,{requestId:'pptx',filename:'reference.pptx',bytes:source}),before=await uploads.get(actor,file.id)
 for(const start of [1,31,61])await uploads.ensureDocumentPages(actor,file.id,start)
 const after=await uploads.get(actor,file.id);assert.equal(after.readPages.length,87);assert.equal(after.pages.length,87);assert.deepEqual(after.structure,before.structure);assert.deepEqual(after.privateArtifacts,before.privateArtifacts)
 assert.equal((await uploads.preview(actor,file.id,2)).data.toString(),'slide 2');assert.equal((await uploads.preview(actor,file.id,87)).data.toString(),'slide 87');assert.deepEqual((await uploads.artifact(actor,file.id,'svg-flat/slide_31.svg')).data,svg)
 assert.deepEqual((await uploads.download(actor,file.id)).data,source)
})
