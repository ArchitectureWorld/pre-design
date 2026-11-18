import sharp from 'sharp'
import {createHash} from 'node:crypto'
const hash=x=>createHash('sha256').update(x).digest('hex')
/** Offline preparation only. Does not upload or mutate source; never downscales. */
export async function prepareReferenceImageTransport(bytes,{maxWireBytes=800000,reservedBytes=65536}={}){
 if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>8*1024*1024||!Number.isSafeInteger(maxWireBytes)||!Number.isSafeInteger(reservedBytes)||reservedBytes<0||maxWireBytes<=reservedBytes)throw Error('IMAGE_TRANSPORT_INPUT_INVALID')
 const meta=await sharp(bytes,{limitInputPixels:32*1024*1024,failOn:'error'}).metadata()
 if(!['png','jpeg'].includes(meta.format)||meta.pages>1||meta.orientation&&meta.orientation!==1)throw Error('IMAGE_TRANSPORT_FORMAT_UNSUPPORTED')
 const estimate=b=>4*Math.ceil(b.length/3)+reservedBytes,sourceSha256=hash(bytes),source={sha256:sourceSha256,bytes:bytes.length,width:meta.width,height:meta.height,mimeType:meta.format==='png'?'image/png':'image/jpeg'}
 let output=bytes,method='original',pixelPreserving=true
 if(estimate(bytes)>maxWireBytes){
  if(meta.hasAlpha)throw Error('IMAGE_TRANSPORT_ALPHA_REVIEW_REQUIRED')
  output=await sharp(bytes,{limitInputPixels:32*1024*1024,failOn:'error'}).jpeg({quality:90,chromaSubsampling:'4:4:4'}).toBuffer();method='jpeg-quality90-444';pixelPreserving=false
 }
 if(estimate(output)>maxWireBytes)throw Error('IMAGE_TRANSPORT_BUDGET_UNMET_NO_DOWNSCALE')
 const checked=await sharp(output).metadata();if(checked.width!==meta.width||checked.height!==meta.height)throw Error('IMAGE_TRANSPORT_COORDINATES_CHANGED')
 return {bytes:output,source,derived:{sha256:hash(output),bytes:output.length,width:checked.width,height:checked.height,mimeType:checked.format==='png'?'image/png':'image/jpeg'},method,pixelPreserving,coordinatesPreserved:true,needsVisualReview:!pixelPreserving,wireEstimate:{bytes:estimate(output),reservedBytes,maxWireBytes,measuredProviderRequest:false}}
}
