import type {ObjectJsonSchema} from '@deepseek-ai/dsh-tools'
import {sha256CanonicalJson as hash} from '../presentation/canonical-json.ts'

type Node=Record<string,unknown>
const object=(value:unknown):value is Node=>value!==null&&typeof value==='object'&&!Array.isArray(value)
const primitive=(value:unknown)=>value===null||['string','number','boolean'].includes(typeof value)
function choices(node:unknown):unknown[]|undefined{
 if(!object(node)||Object.hasOwn(node,'const')===Object.hasOwn(node,'enum'))return
 if(Object.hasOwn(node,'const'))return primitive(node.const)?[node.const]:undefined
 return Array.isArray(node.enum)&&node.enum.length&&node.enum.every(primitive)?node.enum:undefined
}
function children(node:Node):{path:string[];value:unknown}[]{
 const result:{path:string[];value:unknown}[]=[]
 for(const key of ['properties','patternProperties','$defs','definitions'])if(object(node[key]))
  for(const [name,value] of Object.entries(node[key]))result.push({path:[key,name],value})
 for(const key of ['items','additionalProperties','not','if','then','else','contains','propertyNames'])if(object(node[key]))result.push({path:[key],value:node[key]})
 for(const key of ['oneOf','anyOf','allOf','prefixItems'])if(Array.isArray(node[key]))
  node[key].forEach((value,index)=>result.push({path:[key,String(index)],value}))
 return result
}
function at(node:unknown,path:readonly string[]):Node|undefined{
 let value=node
 for(const key of path){if(value===null||typeof value!=='object')return;value=Reflect.get(value,key)}
 return object(value)?value:undefined
}
function paths(node:unknown,path:string[]=[]):string[][]{
 if(!object(node))return []
 // A different optional, array or conditional leaf does not make branches
 // disjoint: an absent property or empty array may match every alternative.
 // Walk only object properties that must be present on the entire path.
 const required=node.type==='object'&&Array.isArray(node.required)&&object(node.properties)
  ?Object.entries(node.properties).filter(([key])=>(node.required as unknown[]).includes(key))
   .flatMap(([key,value])=>paths(value,[...path,'properties',key])):[]
 return [...(choices(node)?[path]:[]),...required]
}
function compact(node:unknown):unknown{
 if(!object(node))return node
 const result={...node}
 for(const child of children(node)){
  let parent:any=result
  for(const key of child.path.slice(0,-1)){
   parent[key]=Array.isArray(parent[key])?[...parent[key]]:{...parent[key]};parent=parent[key]
  }
  parent[child.path.at(-1)!]=compact(child.value)
 }
 if(!Array.isArray(result.oneOf)||result.oneOf.length<2)return result
 let branches=result.oneOf
 for(let pass=0;pass<8;pass++){
  let changed=false
  const candidates=[...new Map(branches.flatMap(branch=>paths(branch)).map(path=>[JSON.stringify(path),path])).values()]
  for(const path of candidates){
   const groups=new Map<string,{index:number;branch:unknown;values:unknown[]}[]>()
   for(const [index,branch] of branches.entries()){
    const values=choices(at(branch,path));if(!values)continue
    const template=structuredClone(branch),slot=at(template,path)!
    delete slot.const;delete slot.enum
    const key=hash({path,template}),group=groups.get(key)??[]
    group.push({index,branch,values});groups.set(key,group)
   }
   const replacement=new Map<number,unknown>(),removed=new Set<number>()
   for(const group of groups.values()){
    if(group.length<2)continue
    const values=group.flatMap(row=>row.values)
    if(new Set(values.map(value=>JSON.stringify(value))).size!==values.length)continue
    // The native SDK requires at least two oneOf alternatives. Retain the
    // last disjoint choice rather than changing the surrounding schema form.
    const selected=group.length===branches.length?group.slice(0,-1):group
    if(selected.length<2)continue
    const merged=structuredClone(selected[0].branch),slot=at(merged,path)!
    delete slot.const;slot.enum=selected.flatMap(row=>row.values)
    replacement.set(selected[0].index,merged);selected.slice(1).forEach(row=>removed.add(row.index))
   }
   if(!removed.size)continue
   branches=branches.flatMap((branch,index)=>removed.has(index)?[]:[replacement.get(index)??branch]);changed=true
  }
  if(!changed)break
 }
 result.oneOf=branches;return result
}

/** Merge only disjoint primitive choices at one schema leaf in otherwise
 * identical oneOf branches. Every other constraint stays in place, preserving
 * exact oneOf match counts, correlated addresses and literal business payloads. */
export function compactNativeModuleSchema(schema:ObjectJsonSchema):ObjectJsonSchema{
 return compact(structuredClone(schema)) as ObjectJsonSchema
}
