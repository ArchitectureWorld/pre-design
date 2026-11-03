import type {MaterialCorpus,MaterialCorpusDocument} from '../materials/research-evidence.ts'
export interface PhotoDateMapping {readonly kind:'photo-exif-calendar-date.v1';readonly dateTimeOriginalQuote:string}
const fail=():never=>{throw new Error('MODULE_SOURCE_DATE_MAPPING: explicit original-image EXIF calendar mapping, complete timestamp and matching photoDate required; no timezone inference')}
function originalCapture(document:MaterialCorpusDocument):{dateTimeOriginal?:unknown}|undefined {
 if(!document.image||document.pages||typeof document.text!=='string')return undefined
 try{const value=JSON.parse(document.text);return value?.kind==='source-image-metadata.v1'?value.capture:undefined}catch{return undefined}
}
/** A declared calendar representation of the camera's original timestamp. It
 * neither supplies a missing time nor converts or guesses a timezone. */
export function verifyPhotoDateMapping(source:{rawValue:unknown;quote:string;dateMapping:PhotoDateMapping},document:MaterialCorpusDocument):string {
 const timestamp=originalCapture(document)?.dateTimeOriginal,m=source.dateMapping
 if(m.kind!=='photo-exif-calendar-date.v1'||typeof timestamp!=='string'||m.dateTimeOriginalQuote!==timestamp
  ||!source.quote.includes('"dateTimeOriginal":'+JSON.stringify(timestamp)))return fail()
 const parts=/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/u.exec(timestamp)
 if(!parts||parts[1]==='0000'||Number(parts[4])>23||Number(parts[5])>59||Number(parts[6])>59)return fail()
 const date=parts[1]+'-'+parts[2]+'-'+parts[3],parsed=new Date(date+'T00:00:00Z')
 if(Number.isNaN(parsed.valueOf())||parsed.toISOString().slice(0,10)!==date||source.rawValue!==date)return fail()
 return date
}
export function assertPhotoDateMappingTarget(target:{port?:unknown;field?:unknown;at?:unknown}|undefined) {
 if(target?.port!=='site_use'||target.field!=='photoDate'||target.at!=='')return fail()
}
/** Exact original source/target identities guide an author repair, never a
 * synthesized date, accepted draft or source replacement. */
export function modulePhotoDateMappingDiagnostics(raw:unknown,corpus?:MaterialCorpus) {
 const value=raw as {groupId?:unknown;outputs?:Record<string,{records?:readonly Record<string,unknown>[]}>
  evidence?:readonly {kind?:unknown;target?:{port?:unknown;recordId?:unknown;field?:unknown;at?:unknown};source?:{path?:unknown;quote?:unknown;dateMapping?:unknown}}[]}
 if(!corpus||!Array.isArray(value?.evidence)||value.groupId!=='site_use:4.2')return []
 return value.evidence.flatMap(entry=>{
  const t=entry.target,s=entry.source
  if(entry.kind!=='source'||t?.port!=='site_use'||t.field!=='photoDate'||t.at!==''||s?.dateMapping||typeof s?.quote!=='string')return []
  const doc=corpus.documents.find(d=>d.path===s.path),timestamp=doc&&originalCapture(doc)?.dateTimeOriginal
  const field=value.outputs?.site_use?.records?.find(r=>r.recordId===t.recordId)?.photoDate as {value?:unknown}|undefined
  if(typeof timestamp!=='string'||typeof field?.value!=='string'||s.quote.includes(field.value))return []
  return [{target:{port:t.port,recordId:t.recordId,field:t.field,at:t.at},sourcePath:s.path,
   dateTimeOriginalQuote:timestamp,receivedDate:field.value,
   rule:'The ISO date is not literal EXIF text. Author must explicitly declare photo-exif-calendar-date.v1 with the complete original DateTimeOriginal timestamp and exact source tag quote. Retain original time/unknown timezone limitations; no automatic fill, fabricated quote, timezone conversion or relabeling.'}]
 })
}
