import sharp from 'sharp'
import {openVerifiedMaterial} from '../material-storage.mjs'
import {fail,nativeFigures,nativeFigureSchema,nativeFiguresSchema} from './contract.mjs'
export function createLayoutAssetResolver(db){return async(pages,project)=>{
 const cache=new Map(),out=[]
 for(const page of pages){
  const figures=nativeFigures(page.item)
  if(page.item.figure!==undefined)nativeFigureSchema.parse(page.item.figure)
  if(page.item.figures!==undefined)nativeFiguresSchema.parse(page.item.figures)
  if(!figures.length){out.push(page);continue}
  const images=[]
  for(const figure of figures){
   let image=cache.get(figure.materialId)
   if(!image){
   const {rows:[f]}=await db.query('SELECT * FROM materials WHERE project_id=$1 AND id=$2',[project.id,figure.materialId])
   if(!f||!f.image||f.bytes>16*1024*1024)throw fail('页脚本图片不存在、未核验或超过16 MiB，未生成页面。',409)
   const handle=await openVerifiedMaterial(project.workspace,f)
   let input;try{const chunks=[];let count=0;for await(const chunk of handle.createReadStream({start:0,autoClose:false})){count+=chunk.length;if(count>16*1024*1024)throw fail('图片读取超过本版限制。',413);chunks.push(chunk)}input=Buffer.concat(chunks);const {createHash}=await import('node:crypto');if(createHash('sha256').update(input).digest('hex')!==f.sha256)throw fail('图片读取期间原件发生变化。',409)}finally{await handle.close()}
   const data=await sharp(input,{limitInputPixels:40_000_000}).resize({width:1800,height:1200,fit:'inside',withoutEnlargement:true}).webp({quality:88}).toBuffer()
   image={dataUrl:'data:image/webp;base64,'+data.toString('base64'),sourceHash:f.sha256,materialId:f.id,transform:'webp-88-inside-1800x1200-no-enlargement'};cache.set(f.id,image)
   }
   images.push(image)
  }
  out.push({...page,nativeAssets:{images,...(images.length===1?{image:images[0]}:{})}})
 }
 return out
}}
