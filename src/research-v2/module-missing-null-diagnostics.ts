import {parseModuleProjectionOutputsJson} from './module-author-projection.ts'
const object=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)
/** Locate every authored missing/non-null violation without substituting values
 * or copying source prose. Addresses stay bound to the immutable rejected raw. */
export function moduleMissingNullFieldTargets(raw:unknown) {
  if(!object(raw))return []
  let outputs=raw.outputs
  if(outputs===undefined&&typeof raw.outputsJson==='string'){try{outputs=parseModuleProjectionOutputsJson(raw.outputsJson)}catch{return []}}
  if(!object(outputs))return []
  return Object.entries(outputs).flatMap(([port,data])=>{
    if(!object(data)||!Array.isArray(data.records))return []
    return data.records.flatMap((row,recordIndex)=>{
      if(!object(row)||typeof row.recordId!=='string')return []
      return Object.entries(row).flatMap(([field,value])=>object(value)&&value.claimClass==='missing'&&value.value!==null
        ?[{target:{port,recordId:row.recordId,field,at:''},recordIndex,claimClass:'missing',receivedType:Array.isArray(value.value)?'array':typeof value.value,
          stringNull:value.value==='null',rule:'missing requires JSON null; preserve missing classification and original limitations; no attached evidence'}]:[])
    })
  })
}
