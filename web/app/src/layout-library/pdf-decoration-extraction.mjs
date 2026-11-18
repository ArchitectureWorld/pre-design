import sharp from 'sharp'
import {createHash} from 'node:crypto'
import {inspectDecorativePng} from './decoration-assets.mjs'
const hash=b=>createHash('sha256').update(b).digest('hex')
const bad=()=>{throw Object.assign(new Error('PDF软遮罩尺寸或Matte声明无效。'),{code:'PDF_DECORATION_INVALID',statusCode:409})}
/** PDF Matte components are preblended in the source color space. Reconstruct
 * straight RGB before applying the soft mask; do not simply apply alpha twice. */
export async function reconstructPdfSoftMask({rgb,mask,matte}){
 if(!Array.isArray(matte)||matte.length!==3||matte.some(v=>!Number.isFinite(v)||v<0||v>1))bad()
 const a=inspectDecorativePng(rgb),b=inspectDecorativePng(mask);if(a.w!==b.w||a.h!==b.h)bad()
 const colors=await sharp(rgb,{limitInputPixels:16_000_000}).removeAlpha().toColourspace('srgb').raw().toBuffer({resolveWithObject:true})
 const alpha=await sharp(mask,{limitInputPixels:16_000_000}).removeAlpha().greyscale().raw().toBuffer({resolveWithObject:true})
 if(colors.info.channels!==3||alpha.info.channels!==1)bad()
 const output=Buffer.alloc(a.w*a.h*4)
 for(let i=0;i<a.w*a.h;i++){const opacity=alpha.data[i]/255;for(let c=0;c<3;c++)output[i*4+c]=opacity?Math.round(Math.max(0,Math.min(255,(colors.data[i*3+c]-matte[c]*255*(1-opacity))/opacity))):0;output[i*4+3]=alpha.data[i]}
 const data=await sharp(output,{raw:{width:a.w,height:a.h,channels:4}}).png({compressionLevel:9}).toBuffer();inspectDecorativePng(data)
 return {data,sha256:hash(data),method:'pdf-soft-mask-unmatte-v1',inputHashes:[hash(rgb),hash(mask)],matte:[...matte]}
}
