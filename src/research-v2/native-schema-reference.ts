import { assertObjectJsonSchema, type ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import { sha256CanonicalJson as hash } from '../presentation/canonical-json.ts'

const encoding='native-schema-reference.v1',maxBytes=64*1024*1024
const object=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value)
const invalid=():never=>{throw new Error('MODULE_NATIVE_SCHEMA_REFERENCE_INVALID')}

/** Read-only description, never SDK parameters. Only whole identical JSON
 * subtrees share storage; literals and correlated identities stay exact. */
export function shareNativeSchemaDescription(schema:ObjectJsonSchema):unknown{
 assertObjectJsonSchema(schema)
 const original=JSON.parse(JSON.stringify(schema)),originalBytes=Buffer.byteLength(JSON.stringify(original),'utf8')
 if(originalBytes>maxBytes)return original
 const counts=new Map<string,number>(),keys=new Set<string>()
 function scan(value:unknown,depth=0):void{
  if(depth>128)throw new RangeError('Schema description depth')
  if(value===null||typeof value!=='object')return
  const text=JSON.stringify(value)
  if(Buffer.byteLength(text,'utf8')>=80)counts.set(text,(counts.get(text)??0)+1)
  if(Array.isArray(value))value.forEach(child=>scan(child,depth+1))
  else for(const [key,child]of Object.entries(value)){keys.add(key);scan(child,depth+1)}
 }
 try{scan(original)}catch(error){if(error instanceof RangeError)return original;throw error}
 let refKey='@D';while(keys.has(refKey))refKey+='_'
 const definitions:unknown[]=[],indices=new Map<string,number>()
 function pack(value:unknown):unknown{
  if(value===null||typeof value!=='object')return value
  const text=JSON.stringify(value),repeated=(counts.get(text)??0)>1
  if(repeated&&indices.has(text))return {[refKey]:indices.get(text)}
  const packed=Array.isArray(value)?value.map(pack):Object.fromEntries(Object.entries(value).map(([key,child])=>[key,pack(child)]))
  if(!repeated)return packed
  const index=definitions.length;definitions.push(packed);indices.set(text,index)
  return {[refKey]:index}
 }
 const view={encoding,refKey,definitions,schema:pack(original),originalHash:hash(original),originalBytes}
 if(!definitions.length||Buffer.byteLength(JSON.stringify(view),'utf8')>=originalBytes)return original
 const restored=expandNativeSchemaDescription(view)
 if(JSON.stringify(restored)!==JSON.stringify(original))return invalid()
 return view
}

/** Rebuild only the explicit committed descriptor. Every SDK/central
 * validation still uses the original supported schema. */
export function expandNativeSchemaDescription(value:unknown):ObjectJsonSchema{
 if(!object(value)||value.encoding!==encoding){assertObjectJsonSchema(value);return value}
 const expected=['encoding','refKey','definitions','schema','originalHash','originalBytes']
 if(Object.keys(value).length!==expected.length||expected.some(key=>!Object.hasOwn(value,key))
  ||typeof value.refKey!=='string'||!/^@D_*$/u.test(value.refKey)||!Array.isArray(value.definitions)||value.definitions.length>100000
  ||typeof value.originalHash!=='string'||! /^[a-f0-9]{64}$/u.test(value.originalHash)
  ||!Number.isSafeInteger(value.originalBytes)||(value.originalBytes as number)<2||(value.originalBytes as number)>maxBytes)return invalid()
 const refKey=value.refKey,limit=value.originalBytes as number,definitions=value.definitions
 type Decoded={value:unknown;bytes:number;depth:number}
 const restored:Decoded[]=[]
 function expand(node:unknown,before:number,depth=0):Decoded{
  if(depth>128)return invalid()
  if(object(node)&&Object.hasOwn(node,refKey)){
   const index=node[refKey]
   if(Object.keys(node).length!==1||!Number.isSafeInteger(index)||(index as number)<0||(index as number)>=before)return invalid()
   const result=restored[index as number];if(!result)return invalid();return result
  }
  let result:unknown,bytes=2,nodeDepth=0
  if(Array.isArray(node)){
   const children=node.map(child=>expand(child,before,depth+1));result=children.map(child=>child.value)
   bytes+=children.reduce((total,child)=>total+child.bytes,Math.max(0,children.length-1));nodeDepth=1+children.reduce((max,child)=>Math.max(max,child.depth),0)
  }else if(object(node)){
   const entries=Object.entries(node).map(([key,child])=>[key,expand(child,before,depth+1)] as const)
   result=Object.fromEntries(entries.map(([key,child])=>[key,child.value]))
   bytes+=entries.reduce((total,[key,child])=>total+Buffer.byteLength(JSON.stringify(key),'utf8')+1+child.bytes,Math.max(0,entries.length-1))
   nodeDepth=1+entries.reduce((max,[,child])=>Math.max(max,child.depth),0)
  }else{
   if(!['string','number','boolean'].includes(typeof node)&&node!==null)return invalid()
   result=node;bytes=Buffer.byteLength(JSON.stringify(node),'utf8')
  }
  if(!Number.isSafeInteger(bytes)||bytes>limit||nodeDepth>128)return invalid()
  return {value:result,bytes,depth:nodeDepth}
 }
 definitions.forEach((definition,index)=>restored.push(expand(definition,index)))
 const result=expand(value.schema,definitions.length)
 if(result.bytes!==limit||hash(result.value)!==value.originalHash)return invalid()
 assertObjectJsonSchema(result.value)
 return result.value
}

export const nativeSchemaReferenceInstruction='只读native-schema-reference.v1完整描述原工具Schema：schema为根，只有一个refKey字段的对象以其整数值引用definitions；索引从0开始，定义只引用更早定义，逐个替换恢复完整原结构。普通数字、字符串、数组顺序、字段约束及oneOf身份关系均为原值。此描述不是提交结果或SDK参数；输出仍遵守恢复后的完整原Schema。originalHash及originalBytes由宿主验证，禁止修改、补猜或将引用标记提交为业务字段。'
