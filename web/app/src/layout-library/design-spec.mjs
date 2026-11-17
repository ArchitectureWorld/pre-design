import {z} from 'zod'
import {referenceProfileSchema,validateReferenceProfile,referenceRoles} from './reference-profile.mjs'
import {compositionStyleSchema} from './composition-contract.mjs'
export const DESIGN_SPEC_SCHEMA='pre-design.design-spec.v1'
const id=z.string().regex(/^[a-z][a-z0-9-]{0,63}$/)
const graphId=z.string().regex(/^(master|layout|slide)-[1-9][0-9]{0,5}$/)
const evidenceIds=z.array(id).min(1).max(128)
export const designSpecSchema=z.object({
 schemaVersion:z.literal(DESIGN_SPEC_SCHEMA),scope:z.enum(['brand','style','layout','deck']),fidelity:z.enum(['standard','fidelity']),profile:referenceProfileSchema,
 masterLayoutGraph:z.array(z.object({id:graphId,kind:z.enum(['master','layout','slide']),parentId:graphId.nullable(),archetypeId:id.optional(),evidenceIds}).strict()).min(1).max(256),
 components:z.array(z.object({id:z.string().regex(/^component-[1-9][0-9]{0,5}$/),kind:z.enum(['decoration','content-slot']),role:z.enum(referenceRoles).optional(),style:compositionStyleSchema.optional(),evidenceIds}).strict()).max(128),
}).strict()
const invalid=message=>Object.assign(new Error(message),{statusCode:409,code:'DESIGN_SPEC_INVALID'})
export function validateDesignSpec(value,context={}){
 const parsed=designSpecSchema.safeParse(value)
 if(!parsed.success)throw invalid('Design Spec 格式无效；不能包含原文、路径或素材。')
 const spec=parsed.data;spec.profile=validateReferenceProfile(spec.profile,context)
 const evidence=new Set(spec.profile.evidence.map(e=>e.id)),archetypes=new Set(spec.profile.archetypes.map(a=>a.id)),nodes=new Map(spec.masterLayoutGraph.map(n=>[n.id,n]))
 if(nodes.size!==spec.masterLayoutGraph.length||new Set(spec.components.map(c=>c.id)).size!==spec.components.length)throw invalid('设计声明 ID 重复。')
 const refs=ids=>{if(new Set(ids).size!==ids.length||ids.some(id=>!evidence.has(id)))throw invalid('设计声明证据不存在或重复。')}
 for(const node of spec.masterLayoutGraph){
  refs(node.evidenceIds)
  if(!node.id.startsWith(node.kind+'-'))throw invalid('原生结构匿名 ID 与节点类型不一致。')
  if(node.kind==='master'?node.parentId!==null:!nodes.has(node.parentId)||nodes.get(node.parentId).kind!==(node.kind==='layout'?'master':'layout'))throw invalid('Master/Layout/Slide 继承关系无效。')
  if(node.archetypeId&&!archetypes.has(node.archetypeId))throw invalid('原生结构引用未知页面原型。')
  if(node.kind==='layout'&&!node.archetypeId)throw invalid('Layout 缺少页面原型映射。')
 }
 for(const archetype of archetypes)if(!spec.masterLayoutGraph.some(n=>n.kind==='layout'&&n.archetypeId===archetype))throw invalid('页面原型缺少 Layout 结构映射。')
 for(const component of spec.components){refs(component.evidenceIds);if((component.kind==='content-slot')!==!!component.role)throw invalid('组件类型与内容角色不一致。')}
 return spec
}
