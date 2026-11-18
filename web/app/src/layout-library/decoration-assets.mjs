import {crc32,inflateSync} from 'node:zlib'
import {createHash} from 'node:crypto'
import {z} from 'zod'
const id=z.string().regex(/^[a-z][a-z0-9-]{0,47}$/),hash=z.string().regex(/^[a-f0-9]{64}$/)
export const decorativeAssetSchema=z.object({id,derivation:z.object({method:z.literal('pdf-soft-mask-unmatte-v1'),inputHashes:z.tuple([hash,hash]),maskObjectNumber:z.number().int().positive(),matte:z.tuple([z.number().min(0).max(1),z.number().min(0).max(1),z.number().min(0).max(1)])}).strict().optional(),dataUrl:z.string().max(720000).regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/),sha256:hash,source:z.object({sha256:hash,page:z.number().int().positive(),objectNumber:z.number().int().positive()}).strict(),rights:z.object({basis:z.enum(['original','licensed','permission','unknown']),shareAllowed:z.boolean(),scope:z.literal('complete-image-object').optional()}).strict()}).strict()
export const decorationSchema=z.object({assetId:id,maskAssetId:id.optional(),rect:z.object({x:z.number().min(0).max(1),y:z.number().min(0).max(1),w:z.number().positive().max(1),h:z.number().positive().max(1)}).strict().refine(r=>r.x+r.w<=1.000001&&r.y+r.h<=1.000001),crop:z.object({x:z.number().min(0).max(1),y:z.number().min(0).max(1),w:z.number().positive().max(1),h:z.number().positive().max(1)}).strict().refine(r=>r.x+r.w<=1.000001&&r.y+r.h<=1.000001).optional(),placement:z.enum(['background','foreground'])}).strict()
const bad=()=>{throw Object.assign(new Error('装饰资产的字节、来源、图层或共享授权不一致。'),{code:'LAYOUT_DECORATION_INVALID',statusCode:409})}
function pngInfo(a){
 const b=Buffer.from(a.dataUrl.slice(22),'base64');if(b.length>512*1024||b.length<45||b.toString('base64')!==a.dataUrl.slice(22)||createHash('sha256').update(b).digest('hex')!==a.sha256||b.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||b.readUInt32BE(8)!==13||b.toString('ascii',12,16)!=='IHDR')bad()
 const w=b.readUInt32BE(16),h=b.readUInt32BE(20);if(!w||!h||w>4096||h>4096||w*h>16_000_000)bad()
 const channels={0:1,2:3,4:2,6:4}[b[25]]
 if(b[24]!==8||!channels||b[26]!==0||b[27]!==0||b[28]!==0)bad()
 let pos=8,end=false,seenData=false,dataEnded=false;const compressed=[];const seen=new Set()
 while(pos+12<=b.length){
  const n=b.readUInt32BE(pos),kind=b.toString('ascii',pos+4,pos+8)
  if(n>b.length-pos-12||!['IHDR','pHYs','IDAT','IEND'].includes(kind)||crc32(b.subarray(pos+4,pos+8+n))!==b.readUInt32BE(pos+8+n))bad()
  if(kind==='IHDR'&&(pos!==8||seen.has(kind)))bad()
  if(kind==='pHYs'&&(seen.has(kind)||seenData||n!==9||b[pos+16]>1))bad()
  if(kind==='IDAT'){if(dataEnded)bad();seenData=true;compressed.push(b.subarray(pos+8,pos+8+n))}else if(seenData)dataEnded=true
  seen.add(kind);pos+=n+12
  if(kind==='IEND'){if(n!==0||pos!==b.length||!seenData)bad();end=true;break}
 }
 if(!end)bad()
 const packed=Buffer.concat(compressed),stride=1+w*channels,expected=stride*h
 try{const result=inflateSync(packed,{maxOutputLength:expected+1,info:true});if(result.buffer.length!==expected||result.engine.bytesWritten!==packed.length)bad();for(let y=0;y<h;y++)if(result.buffer[y*stride]>4)bad()}catch{bad()}
 return {w,h,pixels:w*h,bytes:b.length}

}
export function validateDecorativeAssets(pkg){
 const assets=pkg.decorativeAssets??[],map=new Map(),used=new Set();let total=0,totalPixels=0
 for(const a of assets){if(map.has(a.id))bad();const info=pngInfo(a);total+=info.bytes;totalPixels+=info.pixels;if(total>512*1024||totalPixels>16_000_000)bad();if(pkg.rights?.shareAllowed&&(!a.rights.shareAllowed||a.rights.basis==='unknown'||a.rights.scope!=='complete-image-object'))bad();map.set(a.id,{a,...info})}
 const evidence=new Map((pkg.designProfile?.evidence??[]).map(e=>[e.id,e]))
 for(const layout of pkg.layouts){
  const pages=new Set(),seen=new Set();function visit(id){if(seen.has(id))return;seen.add(id);const e=evidence.get(id);if(!e)return;if(e.fileSha256&&e.pageNumber)pages.add(e.fileSha256+':'+e.pageNumber);for(const x of e.dependsOn??[])visit(x)}
  for(const id of pkg.designProfile?.archetypes.find(a=>a.id===layout.archetypeId)?.evidenceIds??[])visit(id)
  if(!pages.size)for(const id of pkg.designProfile?.designSystem.evidenceIds??[])visit(id)
  for(const layer of layout.decorations??[]){
   const asset=map.get(layer.assetId),mask=layer.maskAssetId?map.get(layer.maskAssetId):null
   for(const entry of [asset,...(layer.maskAssetId?[mask]:[])]){if(!entry||!pages.has(entry.a.source.sha256+':'+entry.a.source.page))bad();used.add(entry.a.id)}
   if(mask&&(mask.w!==asset.w||mask.h!==asset.h||mask.a.source.sha256!==asset.a.source.sha256||mask.a.source.page!==asset.a.source.page))bad()
  }
 }
 if(used.size!==assets.length)bad()
 return pkg
}
export function inspectDecorativePng(data){if(!Buffer.isBuffer(data)||data.length>512*1024)bad();return pngInfo({dataUrl:'data:image/png;base64,'+data.toString('base64'),sha256:createHash('sha256').update(data).digest('hex')})}
