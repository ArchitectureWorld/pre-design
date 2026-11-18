/** Private inventory only. Poppler's mask object ID identifies the owner, not the mask. */
const invalid=()=>{throw Object.assign(new Error('PDF 原生图像目录无法核验。'),{code:'PDF_IMAGE_INVENTORY_INVALID',statusCode:409})}
export function parsePdfImageInventory(output,{sourceSha256,readPages}){
 if(typeof output!=='string'||Buffer.byteLength(output)>1024*1024||!/^[a-f0-9]{64}$/.test(sourceSha256??'')||!Array.isArray(readPages)||!readPages.length||readPages.some(p=>!Number.isSafeInteger(p)||p<1))invalid()
 const lines=output.trim().split(/\r?\n/),objects=[],seen=new Set()
 if(!/^page\s+num\s+type\s+width\s+height/.test(lines.shift()??'')||!/^[-\s]+$/.test(lines.shift()??''))invalid()
 for(const line of lines){
  if(!line.trim())continue
  const c=line.trim().split(/\s+/)
  if(c.length!==16||!['image','mask','smask','stencil'].includes(c[2])||![0,1,3,4,6,7,10,11].every(i=>/^\d+$/.test(c[i])))invalid()
  const [page,index,width,height,objectNumber,generation]=[0,1,3,4,10,11].map(i=>Number(c[i]))
  if(!readPages.includes(page)||width<1||height<1||width>100000||height>100000||![page,index,width,height,objectNumber,generation].every(Number.isSafeInteger)||seen.has(page+':'+index)||objects.length>=1024)invalid()
  seen.add(page+':'+index)
  const mask=c[2]!=='image',occurrence=objects.filter(o=>o.page===page).length
  objects.push({id:`pdf-image-${page}-${occurrence}`,sourceSha256,page,index:occurrence,evidenceKind:'native-image-inventory',type:c[2],width,height,
   objectNumber:mask?null:objectNumber,ownerObjectNumber:mask?objectNumber:null,generation,
   selectionStatus:'requires-inspection',classification:'unknown',shareAllowed:false})
 }
 return {schemaVersion:'pre-design.pdf-image-inventory.v1',visibility:'private',sourceSha256,readPages:[...readPages],objects,
  limitations:['仅记录 PDF 图像清单，尚未提取对象像素、位置或遮罩真实对象号。','图像是否装饰、是否含业务数据及共享权利未知；不能自动收入共享模板。']}
}
/** This is a candidate list for inspection, not a selection or permission grant. */
export function prototypePdfImageCandidates(files,selectedPages){
 if(!Array.isArray(selectedPages)||selectedPages.length>6)invalid()
 return {method:'native-image-inventory-only',selectedAssets:[],pages:selectedPages.map(({fileSha256,pageNumber})=>{
  const page=files.find(f=>f.sha256===fileSha256)?.pages?.find(p=>(p.page??p.pageNumber)===pageNumber),inventory=page?.nativeImageInventory
  if(!inventory||inventory.status==='unavailable')return {sourceSha256:fileSha256,page:pageNumber,status:'unavailable',objects:[]}
  if(inventory.status!=='available'||inventory.sourceSha256!==fileSha256||!Array.isArray(inventory.objects)||inventory.objects.length>1024)invalid()
  const all=inventory.objects.map((o,index)=>{
   if(o.sourceSha256!==fileSha256||o.page!==pageNumber||o.index!==index||o.id!==`pdf-image-${pageNumber}-${index}`||!['image','mask','smask','stencil'].includes(o.type)||![o.width,o.height].every(n=>Number.isSafeInteger(n)&&n>0&&n<=100000)||!Number.isSafeInteger(o.generation)||o.generation<0)invalid()
   const identity=o.type==='image'?o.objectNumber:o.ownerObjectNumber
   if(!Number.isSafeInteger(identity)||identity<0||o.type!=='image'&&o.objectNumber!==null)invalid()
   return {id:o.id,sourceSha256:fileSha256,page:pageNumber,type:o.type,width:o.width,height:o.height,objectNumber:o.type==='image'?identity:null,ownerObjectNumber:o.type==='image'?null:identity,generation:o.generation,classification:'unknown',selectionStatus:'requires-inspection',shareAllowed:false}
  })
  return {sourceSha256:fileSha256,page:pageNumber,status:'available',objects:all.slice(0,32),omittedCount:Math.max(0,all.length-32)}
 }),limitations:['原生图像清单不包含像素、定位或完整遮罩身份；是否装饰和权利均未确认，禁止凭此自动生成或共享资产。']}
}
