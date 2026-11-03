import {assertObjectJsonSchema,type JsonSchemaNode,type ObjectJsonSchema} from '@deepseek-ai/dsh-tools'
import {sha256CanonicalJson as hash} from '../presentation/canonical-json.ts'
import {shareNativeSchemaDescription,nativeSchemaReferenceInstruction} from './native-schema-reference.ts'

/** A transport superset for a gateway that selects one union branch. This is
 * not the acceptance schema. The original contract must validate the untouched
 * submission after the native call, before any candidate can be accepted. */
export function nativeGatewaySchema(schema: ObjectJsonSchema, provider: string): { schema: ObjectJsonSchema; instruction: string } | undefined {
  if(provider!=='antigravity')return undefined
  assertObjectJsonSchema(schema)
  let changed=false
  const unique=<T>(values:T[]):T[]=>[...new Map(values.map(value=>[hash(value),value])).values()]
  const describe=(nodes:JsonSchemaNode[])=>[...new Set(nodes.map(node=>node.description).filter((text):text is string=>Boolean(text)))].join('\n')
  function merge(nodes:JsonSchemaNode[]):JsonSchemaNode{
    const values=unique(nodes.flatMap(node=>node.oneOf??[node]))
    if(values.length===1)return values[0]
    const groups=new Map<string,JsonSchemaNode[]>()
    const numeric=values.some(value=>value.type==='number')
    for(const value of values){
      if(!value.type)return {}
      const key=numeric&&value.type==='integer'?'number':value.type
      groups.set(key,[...(groups.get(key)??[]),value])
    }
    if(groups.size>1){
      const result:JsonSchemaNode={oneOf:[...groups.values()].map(merge)}
      if(groups.has('null'))result.description='允许JSON null (nullable)；是否缺失、字段分类与依据必须符合完整原契约。'
      return result
    }
    const type=groups.keys().next().value as NonNullable<JsonSchemaNode['type']>
    let result:JsonSchemaNode
    if(type==='object'){
      const keys=[...new Set(values.flatMap(value=>Object.keys(value.properties??{})))]
      const properties=Object.fromEntries(keys.map(key=>[key,merge(values.flatMap(value=>value.properties?.[key]?[value.properties[key]]:value.additionalProperties===false?[]:[{}]))]))
      result={type,properties,required:keys.filter(key=>values.every(value=>value.required?.includes(key))),
        additionalProperties:!values.every(value=>value.additionalProperties===false)}
    }else if(type==='array'){
      result={type,...(values.every(value=>value.items)?{items:merge(values.map(value=>value.items!))}:{})}
    }else{
      result={type}
      if(values.every(value=>Object.hasOwn(value,'const')||value.enum))
        result.enum=unique(values.flatMap(value=>Object.hasOwn(value,'const')?[value.const!]:value.enum!))
    }
    const description=describe(values);if(description)result.description=description
    return result
  }
  function visit(node:JsonSchemaNode):JsonSchemaNode{
    const result=structuredClone(node)
    if(['integer','number','boolean'].includes(result.type??'')&&(result.enum||Object.hasOwn(result,'const'))){
      // This gateway normalizes every enum member to a string and then forces
      // type:string. Keep the native primitive type; enforce literal choices
      // with the original schema after the call.
      const choices=Object.hasOwn(result,'const')?[result.const]:result.enum
      delete result.const;delete result.enum;changed=true
      result.description=[result.description,'原契约允许值：'+JSON.stringify(choices)+'；保持原数字/布尔类型，宿主严格复核。'].filter(Boolean).join('\n')
    }
    if(result.properties)result.properties=Object.fromEntries(Object.entries(result.properties).map(([key,value])=>[key,visit(value)]))
    if(result.items)result.items=visit(result.items)
    if(result.oneOf){
      const branches=result.oneOf.map(visit)
      if(branches.some(branch=>branch.type==='object'||branch.type==='array')){
        // All native union nodes are pure unions plus annotations. Reject an
        // unsupported composition rather than dropping a sibling constraint.
        if(Object.keys(result).some(key=>!['oneOf','description','title','default','examples'].includes(key)))
          throw new Error('MODULE_GATEWAY_SCHEMA_COMPOSITION_UNSUPPORTED')
        const {oneOf:_oneOf,...annotations}=result
        changed=true
        const joined=merge(branches)
        return {...joined,...annotations,...((joined.description||annotations.description)?{description:[annotations.description,joined.description].filter(Boolean).join('\n')}:{})}
      }
      result.oneOf=branches
      if(branches.some(branch=>branch.type==='null'))result.description=[result.description,'允许JSON null (nullable)，不得改成字符串"null"或虚构值。'].filter(Boolean).join('\n')
    }
    return result
  }
  const transport=visit(schema)
  if(!changed)return undefined
  assertObjectJsonSchema(transport)
  const instruction='网关兼容工具视图仅合并展示所有合法字段和证据类别，避免网关只保留oneOf首分支。提交仍须完全符合下列原契约；宿主先按原契约逐项校验，再执行来源、计算、综合和独审。missing必须为JSON null；source/calculation各自必须有对应成员，proposal/assumption/inference不得夹带source或calculation。兼容视图允许出现不代表业务或依据已获认可。\n'
    +JSON.stringify({nativeGatewayOriginalSchema:shareNativeSchemaDescription(schema)})+'\n'+nativeSchemaReferenceInstruction
  return {schema:transport,instruction}
}
