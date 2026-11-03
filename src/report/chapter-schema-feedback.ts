import type { SessionEventLike } from '../visual/session-image-collector.ts'

/** Explain an actual tool rejection before another model request; never repair or accept data. */
export function chapterLiveSchemaFeedback(events:readonly SessionEventLike[],schema:Record<string,unknown>):string|undefined{
  const callIndex=events.findLastIndex(e=>e.type==='tool/call'&&(e.data as any)?.name==='structured_output')
  if(callIndex<0||events.findLastIndex(e=>e.type==='turn/start')>callIndex)return
  const call=events[callIndex]!.data as any
  const rejected=events.slice(callIndex+1).some(e=>{
    const data=e.data as any,id=data?.callId??data?.message?.source?.callId
    return e.type==='tool/result'&&data?.error?.code==='INVALID_ARGS'&&(!id||!call.callId||id===call.callId)
  })
  if(!rejected)return
  let output:any
  try{output=typeof call.arguments==='string'?JSON.parse(call.arguments):call.arguments}catch{return}
  const problems:string[]=[]
  const inspect=(value:any,node:any,path:string):void=>{
    if(!node||problems.length>=80)return
    if(node.oneOf){
      if(!value||typeof value!=='object'||Array.isArray(value)){problems.push(`${path} 必须是页面对象，不能用字符串或页ID代替`);return}
      const matches=node.oneOf.filter((branch:any)=>Object.entries(branch.properties??{}).some(([key,field]:[string,any])=>field.const!==undefined&&field.const===value[key]))
      if(matches.length===1)inspect(value,matches[0],path)
      else problems.push(`${path} 的标识不能匹配Schema分支；按本轮pageId清单填写完整对象`)
      return
    }
    const validType=!node.type||({object:value!==null&&typeof value==='object'&&!Array.isArray(value),array:Array.isArray(value),
      integer:Number.isSafeInteger(value),number:typeof value==='number'&&Number.isFinite(value),string:typeof value==='string',boolean:typeof value==='boolean',null:value===null} as Record<string,boolean>)[node.type]
    if(!validType){problems.push(`${path} 必须是 ${node.type} 类型`);return}
    if(node.enum&&!node.enum.includes(value))problems.push(`${path} 必须取本轮允许值 ${JSON.stringify(node.enum)}`)
    if(node.const!==undefined&&value!==node.const)problems.push(`${path} 必须为 ${JSON.stringify(node.const)}`)
    if(typeof value==='number'){
      if(Number.isFinite(node.minimum)&&value<node.minimum)problems.push(`${path} 至少 ${node.minimum}`)
      if(Number.isFinite(node.maximum)&&value>node.maximum)problems.push(`${path} 最多 ${node.maximum}`)
    }
    if(Array.isArray(value)){
      if(Number.isFinite(node.minItems)&&value.length<node.minItems)problems.push(`${path} 至少 ${node.minItems} 项，当前 ${value.length} 项`)
      if(Number.isFinite(node.maxItems)&&value.length>node.maxItems)problems.push(`${path} 最多 ${node.maxItems} 项，当前 ${value.length} 项`)
      value.forEach((v,i)=>inspect(v,node.items,`${path}[${i}]`));return
    }
    if(!value||typeof value!=='object')return
    for(const name of node.required??[])if(!(name in value))problems.push(`${path}.${name} 缺少必填字段；空列表也须显式提交 []`)
    if(node.additionalProperties===false)for(const name of Object.keys(value))if(!(name in (node.properties??{})))problems.push(`${path}.${name} 不在Schema中，请删除未定义字段`)
    for(const [name,field] of Object.entries(node.properties??{}))if(name in value)inspect(value[name],field,`${path}.${name}`)
  }
  inspect(output,schema,'value')
  if(!problems.length)return
  return '上一轮structured_output发生真实Schema拒绝，以下是本次提交的具体字段错误。仅修复这些字段并保留其余内容；提交完整页数组，不以普通文本或页ID字符串代替页面。以下诊断不是已接受结果，不改变原Schema、正文或验收规则。\n'+problems.join('\n')
}
