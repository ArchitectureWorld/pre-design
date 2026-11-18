import {z} from 'zod'
import {packageDigest,assertInstanceContent,fail} from './contract.mjs'
import {validateTextBlocks} from './text-blocks.mjs'
const key=z.string().regex(/^[a-z][a-z0-9-]{0,47}$/)
export const contentMappingSchema=z.object({
 sourceFingerprint:z.string().regex(/^[a-f0-9]{64}$/),
 entries:z.array(z.object({source:z.object({field:z.enum(['paragraphs','points']),index:z.number().int().nonnegative().max(63)}).strict(),quote:z.string().min(1).max(4000),targetKey:key,spans:z.array(z.unknown()).max(32).optional()}).strict()).min(1).max(32),
}).strict()
export function contentSourceOptions(item){
 assertInstanceContent({item},{requireId:false})
 return {sourceFingerprint:packageDigest(item),sources:['paragraphs','points'].flatMap(field=>item[field].map((quote,index)=>({source:{field,index},quote})))}
}
/** A render-only projection. Never write it back to the source draft. */
export function projectContentMapping(item,input){
 const mapping=contentMappingSchema.parse(input),options=contentSourceOptions(item)
 if(options.sourceFingerprint!==mapping.sourceFingerprint)throw fail('原稿内容已变化，请重新核对文字映射。',409)
 const projected=structuredClone(item),used=new Set(),keys=new Set((item.textBlocks??[]).map(b=>b.key)),blocks=[]
 for(const entry of mapping.entries){
  const {field,index}=entry.source,identity=field+':'+index
  if(used.has(identity)||keys.has(entry.targetKey)||item[field][index]!==entry.quote)throw fail('映射原文或目标已变化，不能重复映射或覆盖文字。',409)
  used.add(identity);keys.add(entry.targetKey)
  blocks.push({key:entry.targetKey,text:entry.quote,...(entry.spans?{spans:structuredClone(entry.spans)}:{})})
 }
 projected.textBlocks=[...(projected.textBlocks??[]),...blocks];validateTextBlocks(projected.textBlocks)
 for(const field of ['paragraphs','points'])projected[field]=projected[field].filter((_v,i)=>!used.has(field+':'+i))
 return projected
}
