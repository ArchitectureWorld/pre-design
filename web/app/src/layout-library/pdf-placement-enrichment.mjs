import {createHash} from 'node:crypto'
import {prepareComponentSelection} from './component-reference-selection.mjs'
const failure=code=>Object.assign(Error(code),{code,statusCode:409})
let active=false
const unavailable=(payload,reason)=>({...payload,referenceImagePlacementEvidence:{version:1,status:'unavailable',reason,visibility:'private',shareAllowed:false}})
/** Job-owned optional evidence. Never changes model inputs or upgrades historical jobs. */
export async function enrichPdfPlacementEvidence({payload,actor,uploads,signal,extract}={}){
 signal?.throwIfAborted()
 if(payload.referenceImagePlacementVersion===undefined)return payload
 if(payload.referenceImagePlacementVersion!==1||payload.referenceComponentVersion!==3||payload.referencePipeline!=='native-v3')throw failure('REFERENCE_IMAGE_PLACEMENT_VERSION_INVALID')
 const files=payload.referenceFiles??[],selection=prepareComponentSelection(files,payload.referenceComponentSelection?.pages),file=files[0]
 if(selection.fileId!==payload.referenceComponentSelection?.fileId)throw failure('REFERENCE_IMAGE_PLACEMENT_SOURCE_INVALID')
 if(file.kind!=='pdf')return unavailable(payload,'not-pdf')
 if(selection.pages.some(p=>!file.readPages?.includes(p)||!file.pages?.some(row=>(row.page??row.pageNumber)===p)))throw failure('REFERENCE_IMAGE_PLACEMENT_SOURCE_INVALID')
 // No queue: an optional local observation must not accumulate PDF byte buffers.
 if(active)return unavailable(payload,'busy')
 active=true
 try{
  const source=await uploads.download(actor,file.id)
  signal?.throwIfAborted()
  if(!(source.data instanceof Uint8Array)||createHash('sha256').update(source.data).digest('hex')!==file.sha256)throw failure('REFERENCE_IMAGE_PLACEMENT_SOURCE_INVALID')
  const parse=extract??(await import('./pdf-image-placements.mjs')).extractPdfImagePlacements
  try{
   const evidence=await parse({bytes:source.data,sourceSha256:file.sha256,selectedPages:selection.pages,signal})
   signal?.throwIfAborted()
   return {...payload,referenceImagePlacementEvidence:{version:1,status:'available',visibility:'private',shareAllowed:false,evidence}}
  }catch(error){
   signal?.throwIfAborted()
   if(error?.name==='AbortError')throw error
   return unavailable(payload,error?.code==='PDF_PLACEMENTS_COPY_RESTRICTED'?'copy-restricted':error?.code==='PDF_PLACEMENTS_TIMEOUT'?'timeout':'unsupported-or-unreadable')
  }
 }finally{active=false}
}
