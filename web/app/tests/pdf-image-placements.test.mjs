import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {PDFDocument,degrees,pushGraphicsState,popGraphicsState,rectangle,clip,endPath} from 'pdf-lib'
const api=await import('../src/layout-library/pdf-image-placements.mjs').catch(()=>({}))
const near=(actual,expected)=>{for(const key of Object.keys(expected))assert(Math.abs(actual[key]-expected[key])<1e-10,`${key}: ${actual[key]} != ${expected[key]}`)}
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')
async function fixture({rotation=0,clipped=false}={}){const doc=await PDFDocument.create(),page=doc.addPage([400,300]),image=await doc.embedPng(png);if(clipped)page.pushOperators(pushGraphicsState(),rectangle(20,20,10,10),clip(),endPath());page.drawImage(image,{x:20,y:30,width:40,height:50});if(clipped)page.pushOperators(popGraphicsState());page.drawImage(image,{x:200,y:100,width:60,height:40,rotate:degrees(90)});page.setRotation(degrees(rotation));const bytes=Buffer.from(await doc.save());return{bytes,sourceSha256:createHash('sha256').update(bytes).digest('hex'),selectedPages:[1]}}
test('actual PDF reused image yields distinct placements without pixels or sharing grant',async()=>{assert.equal(typeof api.extractPdfImagePlacements,'function');const f=await fixture(),before=Buffer.from(f.bytes),r=await api.extractPdfImagePlacements(f);assert.deepEqual(f.bytes,before);assert.equal(r.pages[0].occurrences.length,2);const [a,b]=r.pages[0].occurrences;assert.notEqual(a.id,b.id);assert.equal(a.referenceKey,b.referenceKey);near(a.bounds,{x:.05,y:220/300,w:.1,h:50/300});assert.equal(r.copyPermission,'verified');assert.equal(r.shareAllowed,false);assert.equal(a.visiblePixels,'unknown');assert(!JSON.stringify(r).includes('base64'));assert(!JSON.stringify(r).includes('data:image'))})
test('actual rotated page uses display coordinates and clipping remains explicitly unknown',async()=>{const r=await api.extractPdfImagePlacements(await fixture({rotation:90,clipped:true}));assert.equal(r.pages[0].width,300);assert.equal(r.pages[0].height,400);const a=r.pages[0].occurrences[0];near(a.bounds,{x:.1,y:.05,w:50/300,h:.1});assert.equal(a.clipStatus,'unknown');assert(a.uncertainties.includes('clipping'));assert.equal(r.pages[0].occurrences[1].clipStatus,'page-boundary-only')})
test('identity, selection, cancellation, byte and operation/occurrence limits fail closed',async()=>{const f=await fixture();for(const x of [{...f,sourceSha256:'0'.repeat(64)},{...f,selectedPages:[]},{...f,selectedPages:[1,1]},{...f,selectedPages:[2]},{...f,maxBytes:8},{...f,maxOperators:1},{...f,maxOccurrences:1}])await assert.rejects(api.extractPdfImagePlacements(x));const c=new AbortController();c.abort(Error('STOP'));await assert.rejects(api.extractPdfImagePlacements({...f,signal:c.signal}),/STOP/);await assert.rejects(api.extractPdfImagePlacements({...f,timeoutMs:1}),e=>e.code==='PDF_PLACEMENTS_TIMEOUT')})

test('many reused draws, form transform and cancellation during parse use actual PDF operators',async()=>{
 const doc=await PDFDocument.create(),page=doc.addPage([400,300]),image=await doc.embedPng(png)
 for(let n=0;n<12;n++)page.drawImage(image,{x:n*20,y:30,width:10,height:15})
 const bytes=Buffer.from(await doc.save()),input={bytes,sourceSha256:createHash('sha256').update(bytes).digest('hex'),selectedPages:[1]}
 const result=await api.extractPdfImagePlacements(input)
 assert.equal(result.pages[0].occurrences.length,12)
 for(let n=0;n<12;n++)near(result.pages[0].occurrences[n].bounds,{x:n*.05,y:.85,w:.025,h:.05})
 const outer=await PDFDocument.create(),[embedded]=await outer.embedPdf(bytes),outerPage=outer.addPage([800,600])
 outerPage.drawPage(embedded,{x:100,y:50,width:400,height:300})
 const nested=Buffer.from(await outer.save()),r=await api.extractPdfImagePlacements({bytes:nested,sourceSha256:createHash('sha256').update(nested).digest('hex'),selectedPages:[1]})
 assert.equal(r.pages[0].occurrences.length,12)
 near(r.pages[0].occurrences[0].bounds,{x:.125,y:505/600,w:10/800,h:15/600})
 assert.equal(r.pages[0].occurrences[0].clipStatus,'unknown')
 const abort=new AbortController(),pending=api.extractPdfImagePlacements({...input,signal:abort.signal});abort.abort(Error('DURING_PARSE'))
 await assert.rejects(pending,/DURING_PARSE/)
})
test('compact repeated draws retain every occurrence; transparency groups fail closed',async()=>{
 const {drawObject,concatTransformationMatrix,PDFName}=await import('pdf-lib')
 const {getDocument,OPS}=await import('pdfjs-dist/legacy/build/pdf.mjs')
 const d=await PDFDocument.create(),p=d.addPage([400,300]),im=await d.embedPng(png),name=p.node.newXObject('Repeated',im.ref)
 for(let i=0;i<12;i++)p.pushOperators(pushGraphicsState(),concatTransformationMatrix(10,0,0,15,i*20,30),drawObject(name),popGraphicsState())
 const bytes=Buffer.from(await d.save()),input={bytes,sourceSha256:createHash('sha256').update(bytes).digest('hex'),selectedPages:[1]}
 const task=getDocument({data:Uint8Array.from(bytes),verbosity:0}),doc=await task.promise,list=await(await doc.getPage(1)).getOperatorList()
 // getOperatorList uses PDF.js NullOptimizer (OPLIST intent), not rendering optimizations.
 assert.equal(list.fnArray.filter(op=>op===OPS.paintImageXObject).length,12);await task.destroy()
 const r=await api.extractPdfImagePlacements(input);assert.equal(r.pages[0].occurrences.length,12)
 near(r.pages[0].occurrences[11].bounds,{x:.55,y:.85,w:.025,h:.05})
 const groupedDoc=await PDFDocument.create(),[groupForm]=await groupedDoc.embedPdf(bytes)
 await groupForm.embed()
 groupedDoc.context.lookup(groupForm.ref).dict.set(PDFName.of('Group'),groupedDoc.context.obj({S:'Transparency',I:true}))
 groupedDoc.addPage([400,300]).drawPage(groupForm)
 const grouped=Buffer.from(await groupedDoc.save())
 await assert.rejects(api.extractPdfImagePlacements({bytes:grouped,sourceSha256:createHash('sha256').update(grouped).digest('hex'),selectedPages:[1]}),e=>e.code==='PDF_PLACEMENTS_UNSUPPORTED_GROUP_OR_MASK')
})
test('degenerate image transform and malformed PDF are rejected without partial evidence',async()=>{
 const d=await PDFDocument.create(),p=d.addPage([400,300]),im=await d.embedPng(png)
 p.drawImage(im,{x:10,y:20,width:0,height:50})
 const bytes=Buffer.from(await d.save())
 await assert.rejects(api.extractPdfImagePlacements({bytes,sourceSha256:createHash('sha256').update(bytes).digest('hex'),selectedPages:[1]}),e=>e.code==='PDF_PLACEMENTS_GEOMETRY')
 const invalid=Buffer.from('%PDF-1.7\nnot a PDF')
 await assert.rejects(api.extractPdfImagePlacements({bytes:invalid,sourceSha256:createHash('sha256').update(invalid).digest('hex'),selectedPages:[1]}),e=>e.code==='PDF_PLACEMENTS_PARSE')
})
test('actual copy-restricted PDF stops before native inspection; permissive PDF remains supported',async()=>{
 const {readFile}=await import('node:fs/promises')
 for(const name of ['copy-denied','copy-allowed','copy-unknown']){const bytes=await readFile(new URL('./fixtures/pdf-permissions/'+name+'.pdf',import.meta.url)),input={bytes,sourceSha256:createHash('sha256').update(bytes).digest('hex'),selectedPages:[1]};if(name!=='copy-allowed')await assert.rejects(api.extractPdfImagePlacements(input),e=>e.code==='PDF_PLACEMENTS_COPY_RESTRICTED');else assert.equal((await api.extractPdfImagePlacements(input)).pages[0].occurrences.length,0)}
})
