import {parseModuleProjectionOutputsJson} from './module-author-projection.ts'
import {moduleSourceNumberDiagnostic} from './module-claims.ts'
import {readJsonPointer} from './regional-schema.ts'
import {decodePhotoDecimal,isPhotoDecimalTarget} from './photo-decimal-wire.ts'
const object=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)
/** Exact rejected scalar bindings only; no source prose, suggested values or repaired payload. */
export function moduleGroupNumberDiagnostics(raw:unknown) {
  if(!object(raw)||!Array.isArray(raw.evidence))return []
  let outputs=raw.outputs
  if(outputs===undefined&&typeof raw.outputsJson==='string'){try{outputs=parseModuleProjectionOutputsJson(raw.outputsJson)}catch{return []}}
  if(!object(outputs))return []
  return raw.evidence.flatMap((entry,evidenceIndex)=>{
    if(!object(entry)||entry.kind!=='source'||!object(entry.target)||!object(entry.source))return []
    const t=entry.target,s=entry.source
    if(!['port','recordId','field','at'].every(k=>typeof t[k]==='string')||typeof s.quote!=='string')return []
    const port=outputs[t.port as string]
    if(!object(port)||!Array.isArray(port.records))return []
    const record=port.records.find(r=>object(r)&&r.recordId===t.recordId)
    if(!object(record))return []
    try{
      const wireValue=readJsonPointer(record[t.field as string],'/value'+t.at)
      const rawValue=isPhotoDecimalTarget(raw,t)?decodePhotoDecimal(wireValue):wireValue
      if(typeof rawValue!=='number')return []
      const wireMismatch=isPhotoDecimalTarget(raw,t)&&s.valueQuote!==wireValue
      const diagnostic=wireMismatch?{rule:'v7 coordinate decimal text must exactly equal source valueQuote',
        ...(typeof s.valueQuote==='string'?{valueQuote:s.valueQuote}:{}),valueQuoteParsesToRawValue:false,valueQuoteIsWholeNumericToken:false,
        boundary:'Recheck the original decimal spelling. Never change the native draft automatically.'}
        :moduleSourceNumberDiagnostic({rawValue,quote:s.quote,...(typeof s.valueQuote==='string'?{valueQuote:s.valueQuote}:{})})
      return diagnostic?[{evidenceIndex,target:{port:t.port,recordId:t.recordId,field:t.field,at:t.at},rawValue,...diagnostic}]:[]
    }catch{return []}
  })
}
