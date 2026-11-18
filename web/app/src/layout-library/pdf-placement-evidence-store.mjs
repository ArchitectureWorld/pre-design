/** Read-only, private operator evidence. Never reads model output or source pixels. */
const limitations=()=>['这是图像绘制操作的观察，不是完整可见像素或视觉还原验收。','裁剪、遮挡、透明合成以及源表格单元格内容仍需另行核对。','不据此认定图像属于照片、装饰或表格，不授予可编辑性或共享许可。']
const decode=value=>typeof value==='string'?JSON.parse(value):value
const summary=(sha,page,status,extra={})=>({status,sourceSha256:sha,page,coverage:'operator-list-only',shareAllowed:false,visualAcceptance:'unknown',limitations:limitations(),...extra})
function validOccurrence(o){return o&&typeof o.id==='string'&&o.id.length>0&&o.id.length<=80&&['unknown','page-boundary-only'].includes(o.clipStatus)&&o.visiblePixels==='unknown'&&Array.isArray(o.uncertainties)&&o.uncertainties.length<=3&&o.uncertainties.every(v=>['clipping','graphics-state-compositing','marked-content-visibility'].includes(v))}
export async function readPdfPlacementEvidence(db,{ownerId,fileId,sourceSha256,page}){
 // Deliberately read only local evidence and selection metadata, never full payload/model result.
 const {rows}=await db.query(`SELECT payload->'referenceImagePlacementEvidence' AS evidence,payload->'referenceComponentSelection' AS selection FROM jobs
 WHERE owner_id=$1 AND kind='layout-reference'
 AND CAST(payload->>'referenceImagePlacementVersion' AS text)='1'
 AND CAST(payload->>'referenceComponentVersion' AS text)='3' AND payload->>'referencePipeline'='native-v3'
 AND payload->'referenceComponentSelection'->>'fileId'=$2
 AND payload->'referenceFiles'->0->>'id'=$2
 AND payload->'referenceFiles'->0->>'sha256'=$3
 AND replace(replace(replace(CAST(payload->'referenceComponentSelection'->'pages' AS text),' ',''),'[',','),']',',') LIKE $4
 ORDER BY created_at DESC,id DESC LIMIT 1`,[ownerId,fileId,sourceSha256,'%,'+page+',%'])
 for(const row of rows){
  let selection,e
  try{selection=decode(row.selection);e=decode(row.evidence)}catch{return summary(sourceSha256,page,'unavailable',{reason:'invalid-evidence'})}
  if(!Array.isArray(selection?.pages)||selection.pages.length<1||selection.pages.length>6||selection.pages.some(p=>!Number.isSafeInteger(p)||p<1)||new Set(selection.pages).size!==selection.pages.length||!selection.pages.includes(page))return summary(sourceSha256,page,'unavailable',{reason:'invalid-evidence'})
  if(!e)return summary(sourceSha256,page,'not-collected')
  const invalid=()=>summary(sourceSha256,page,'unavailable',{reason:'invalid-evidence'})
  if(e.version!==1||e.visibility!=='private'||e.shareAllowed!==false)return invalid()
  if(e.status==='unavailable')return summary(sourceSha256,page,'unavailable',{reason:['busy','timeout','not-pdf','unsupported-or-unreadable','copy-restricted'].includes(e.reason)?e.reason:'unknown'})
  const native=e.evidence
  if(e.status!=='available'||native?.version!=='pre-design.pdf-image-placements.v1'||native.copyPermission!=='verified'||native.sourceSha256!==sourceSha256||native.shareAllowed!==false||native.evidenceKind!=='native-image-placement'||native.coverage!=='operator-list-only'||!Array.isArray(native.pages)||native.pages.length>6)return invalid()
  const matching=native.pages.filter(p=>p.page===page)
  if(matching.length!==1)return invalid()
  const occurrences=matching[0].occurrences
  if(!Array.isArray(occurrences)||occurrences.length>1024||!occurrences.every(validOccurrence)||new Set(occurrences.map(o=>o.id)).size!==occurrences.length)return invalid()
  return summary(sourceSha256,page,'available',{occurrenceCount:occurrences.length,clippedOrUncertainCount:occurrences.filter(o=>o.clipStatus==='unknown'||o.uncertainties.length>0).length})
 }
 return summary(sourceSha256,page,'not-collected')
}
