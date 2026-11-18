// Explicit opt-in integration acceptance: real PDF bytes and real Poppler, no model.
// Run: node web/app/tests/reference-pdf-301.acceptance.mjs [output-directory]
import assert from 'node:assert/strict'
import {PDFDocument,StandardFonts,rgb} from 'pdf-lib'
import sharp from 'sharp'
import {createHash} from 'node:crypto'
import {mkdir,writeFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {extractReferenceDocument} from '../src/layout-library/reference-document.mjs'
import {MAX_REFERENCE_PDF_PAGES} from '../src/layout-library/reference-limits.mjs'
const output=resolve(process.argv[2]??'/tmp/pre-design-pdf-301-acceptance'),count=301,hash=b=>createHash('sha256').update(b).digest('hex')
await mkdir(output,{recursive:true})
assert.equal(MAX_REFERENCE_PDF_PAGES,30,'product batch limit must not be changed')
const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica)
for(let n=1;n<=count;n++){
 const page=pdf.addPage([400,225])
 page.drawRectangle({x:0,y:0,width:400,height:225,color:n===count?rgb(0,1,0):rgb(1,1,1)})
 page.drawText('SYNTHETIC ORIGINAL PAGE '+String(n).padStart(3,'0'),{x:24,y:100,size:16,font,color:rgb(0,0,0)})
}
const bytes=Buffer.from(await pdf.save()),sourceSha256=hash(bytes),started=Date.now(),seen=new Set(),batches=[]
await writeFile(join(output,'synthetic-301-pages.pdf'),bytes)
const signal=AbortSignal.timeout(10*60*1000)
for(let start=1;start<=count;start+=MAX_REFERENCE_PDF_PAGES){
 const result=await extractReferenceDocument({bytes,filename:'synthetic-301-pages.pdf',pdfStartPage:start,signal})
 const expected=Array.from({length:Math.min(30,count-start+1)},(_,i)=>start+i)
 assert.equal(result.pageCount,count);assert.deepEqual(result.readPages,expected)
 assert.deepEqual(result.pages.map(p=>p.page),expected);assert.deepEqual(result.images.map(p=>p.page),expected)
 const pages=[]
 for(const n of expected){
  assert(!seen.has(n),'duplicate original page '+n);seen.add(n)
  const record=result.pages.find(p=>p.page===n),image=result.images.find(p=>p.page===n)
  assert.match(record.text,new RegExp('SYNTHETIC ORIGINAL PAGE '+String(n).padStart(3,'0')))
  assert(image.data.length>100);const metadata=await sharp(image.data).metadata()
  assert(metadata.width>0&&metadata.height>0);assert.equal(metadata.width,image.width);assert.equal(metadata.height,image.height)
  pages.push({page:n,textSha256:hash(record.text),imageSha256:hash(image.data),width:image.width,height:image.height,bytes:image.data.length})
  if(n===count){
   const {data,info}=await sharp(image.data).removeAlpha().raw().toBuffer({resolveWithObject:true}),i=(10*info.width+10)*info.channels
   assert(data[i]<25&&data[i+1]>230&&data[i+2]<25,'last original page has its distinct green background')
   await writeFile(join(output,'page-301.png'),await sharp(image.data).png().toBuffer())
   await writeFile(join(output,'page-301.txt'),record.text)
  }
 }
 batches.push({start,end:expected.at(-1),pageCount:result.pageCount,readPages:result.readPages,pages})
 console.log(JSON.stringify({batch:batches.length,start,end:expected.at(-1),read:seen.size,total:count}))
}
assert.equal(batches.length,11);assert.equal(batches.at(-1).pages.length,1)
assert.deepEqual([...seen],Array.from({length:count},(_,i)=>i+1));assert.equal(hash(bytes),sourceSha256)
const receipt={schemaVersion:'synthetic-pdf-full-read.v1',pass:true,scope:'real-parser-synthetic-pdf-no-model-no-private-content',entryPoint:'extractReferenceDocument',sourceSha256,sourceBytes:bytes.length,totalPages:count,readPages:seen.size,batchLimit:30,batchCount:batches.length,elapsedMs:Date.now()-started,batches,limitations:['This verifies real parser continuation, not database upload persistence, model observation or visual-design quality.']}
await writeFile(join(output,'receipt.json'),JSON.stringify(receipt,null,2))
console.log(JSON.stringify({pass:true,totalPages:count,batchCount:batches.length,elapsedMs:receipt.elapsedMs,receipt:join(output,'receipt.json')}))
