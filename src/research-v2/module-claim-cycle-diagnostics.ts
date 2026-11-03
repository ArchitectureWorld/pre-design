import {sha256CanonicalJson as hash} from '../presentation/canonical-json.ts'
import {readJsonPointer} from './regional-schema.ts'

const object=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value)
type Address={port:string;recordId:string;field:string;at:string}
const address=(value:unknown):Address|undefined=>object(value)&&['port','recordId','field','at'].every(key=>typeof value[key]==='string')
 ? {port:value.port as string,recordId:value.recordId as string,field:value.field as string,at:value.at as string}:undefined
const key=(value:Address)=>JSON.stringify([value.port,value.recordId,value.field,value.at])
interface Node {target:Address;groupId?:string;originalSubmissionHash:string;evidenceIndex:number;evidenceHash:string;valueHash?:string;edges:Edge[]}
interface Edge {owner:Node;referencedTarget:Address;refPath:string}
function valueHash(raw:Record<string,unknown>,target:Address){
 try{
  const outputs=object(raw.outputs)?raw.outputs:typeof raw.outputsJson==='string'?JSON.parse(raw.outputsJson):undefined
  const record=outputs?.[target.port]?.records?.find((row:any)=>row?.recordId===target.recordId)
  const value=readJsonPointer({value:record?.[target.field]?.value},'/value'+target.at)
  return value===undefined?undefined:hash(value)
 }catch{return undefined}
}

/** Read-only address mapping for a central cycle rejection. It never edits a
 * reference or treats an inference inside the cycle as independent evidence.
 * Unknown future and duplicate addresses remain for unchanged validators. */
export function moduleClaimCycleConflicts(projections:readonly unknown[],groupId?:string){
 const nodes=new Map<string,Node>(),duplicates=new Set<string>()
 for(const raw of projections){
  if(!object(raw)||!Array.isArray(raw.evidence))continue
  const originalSubmissionHash=hash(raw)
  for(const [evidenceIndex,entry] of raw.evidence.entries()){
   if(!object(entry))continue
   const target=address(entry.target);if(!target)continue
   const id=key(target)
   if(nodes.has(id)||duplicates.has(id)){nodes.delete(id);duplicates.add(id);continue}
   const selectedValueHash=valueHash(raw,target)
   const node:Node={target,...(typeof raw.groupId==='string'?{groupId:raw.groupId}:{}),originalSubmissionHash,
    evidenceIndex,evidenceHash:hash(entry),...(selectedValueHash?{valueHash:selectedValueHash}:{}),edges:[]}
   const calculation=object(entry.calculation)?entry.calculation:undefined
   for(const [path,refs] of [['inputRefs',entry.inputRefs],['calculation/operands',calculation?.operands],['calculation/weights',calculation?.weights]] as const){
    if(!Array.isArray(refs))continue
    for(const [index,ref] of refs.entries()){
     const referencedTarget=object(ref)?address(ref.local):undefined
     if(referencedTarget)node.edges.push({owner:node,referencedTarget,refPath:path+'/'+index})
    }
   }
   nodes.set(id,node)
  }
 }
 const state=new Map<string,number>(),active=new Map<string,number>(),cycles=[]
 const readback=(edge:Edge)=>{const {edges:_edges,...owner}=edge.owner;return {...owner,refPath:edge.refPath,referencedTarget:edge.referencedTarget}}
 for(const root of nodes.keys()){
  if(state.has(root))continue
  const stack:{id:string;next:number;incoming?:Edge}[]=[{id:root,next:0}]
  state.set(root,1);active.set(root,0)
  while(stack.length){
   const frame=stack[stack.length-1],node=nodes.get(frame.id)!
   if(frame.next>=node.edges.length){state.set(frame.id,2);active.delete(frame.id);stack.pop();continue}
   const edge=node.edges[frame.next++],next=key(edge.referencedTarget)
   if(!nodes.has(next))continue
   if(state.get(next)===1){
    const path=[...stack.slice(active.get(next)!+1).map(row=>row.incoming!),edge]
    if(groupId!==undefined&&!path.some(row=>row.owner.groupId===groupId))continue
    cycles.push({edges:path.slice(0,16).map(readback),omittedEdges:Math.max(0,path.length-16),completeCycle:path.length<=16})
    if(cycles.length===8)return cycles
   }else if(!state.has(next)){
    active.set(next,stack.length);state.set(next,1);stack.push({id:next,next:0,incoming:edge})
   }
  }
 }
 return cycles
}

export const moduleClaimCycleReadbackProtocol='循环引用字段对照协议 module-claim-cycle-readback.v1：fieldClaimCycles仅把原中央拒稿中的局部引用环映射回原作者groupId、原稿哈希、target、原值哈希、evidence索引/哈希及refPath；不是完整稿、来源或替代证据。循环内的判断不能相互充当独立依据；按每个原字段的业务含义回查真实独立原件或已验证上游，再由你原生重做相应判断和完整证据。不得机械删引用、改标类别、填假设或复制诊断以过检；确无可用依据须如实保留missing/null与具体限制。omittedEdges表示有界显示省略，未列部分不表示通过。原稿及回执不改写，中央完整声明校验与新的独立审查保持。'
