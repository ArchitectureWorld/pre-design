/** Source observations are claims to inspect, never a visual pass receipt. Browser-safe. */
export const fidelityFeatures=['texture','typography','decoration','hierarchy','color','image-group','rich-text','table-structure','spacing']
const bad=()=>{throw Object.assign(new Error('视觉特征记录的来源、版式、组件或派生理由不完整。'),{statusCode:409,code:'LAYOUT_FIDELITY_INVALID'})}
const nonempty=(s,n)=>typeof s==='string'&&s.trim().length>0&&s.length<=n
export function validateFidelityFeatures(pkg){
 if(pkg.fidelityFeatures===undefined)return pkg
 if(!Array.isArray(pkg.fidelityFeatures)||!pkg.fidelityFeatures.length||pkg.fidelityFeatures.length>256)bad()
 for(const f of pkg.fidelityFeatures){
  if(!f||typeof f!=='object'||Object.keys(f).some(k=>!['layoutId','source','feature','observed','representation','reason','slotIds','editability','evidenceKind','emphasisCandidate'].includes(k)))bad()
  const layout=pkg.layouts.find(l=>l.id===f.layoutId),a=pkg.designProfile?.archetypes.find(a=>a.id===layout?.archetypeId)
  const evidence=new Map((pkg.designProfile?.evidence??[]).map(e=>[e.id,e])),seen=new Set(),pages=new Set()
  function visit(id){if(seen.has(id))return;seen.add(id);const e=evidence.get(id);if(!e)return;if(e.fileSha256&&e.pageNumber)pages.add(`${e.fileSha256}:${e.pageNumber}`);for(const p of e.dependsOn??[])visit(p)}
  for(const id of a?.evidenceIds??[])visit(id)
  if(!pages.size)for(const id of pkg.designProfile?.designSystem?.evidenceIds??[])visit(id)
  if(!layout||!f.source||Object.keys(f.source).some(k=>!['sha256','page'].includes(k))||!/^[a-f0-9]{64}$/.test(f.source.sha256??'')||!Number.isSafeInteger(f.source.page)||f.source.page<1||!pages.has(`${f.source.sha256}:${f.source.page}`))bad()
  if(!fidelityFeatures.includes(f.feature)||!nonempty(f.observed,2000)||!['missing','approximate','derived','represented','unverified'].includes(f.representation)||!['none','unknown','text','vector','replaceable-image','structured-data'].includes(f.editability))bad()
  if(f.evidenceKind!==undefined&&!['native-text','vector','image','ocr','inferred'].includes(f.evidenceKind))bad()
  if(f.reason!==undefined&&!nonempty(f.reason,2000)||f.representation!=='represented'&&!nonempty(f.reason,2000))bad()
  if(!Array.isArray(f.slotIds)||f.slotIds.length>32||new Set(f.slotIds).size!==f.slotIds.length||f.slotIds.some(id=>!layout.slots.some(s=>s.id===id)))bad()
  const roles={text:['title','claim','body','source','text'],'replaceable-image':['image'],'structured-data':['table','chart','timeline','diagram'],vector:[]}
  if(roles[f.editability]&&(!f.slotIds.length||f.slotIds.some(id=>!roles[f.editability].includes(layout.slots.find(s=>s.id===id)?.role))))bad()
  if(f.representation==='missing'&&f.editability!=='none')bad()
  if(f.emphasisCandidate!==undefined){
   const c=f.emphasisCandidate
   if(!c||typeof c!=='object'||Object.keys(c).some(k=>!['version','componentId','status','regions'].includes(k))||c.version!==1||c.status!=='pending-text-binding'||f.feature!=='rich-text'||f.evidenceKind!=='image'||f.representation!=='unverified'||f.editability!=='unknown'||f.slotIds.length!==1||c.componentId!==f.slotIds[0]||!['text','title'].includes(layout.slots.find(s=>s.id===c.componentId)?.role))bad()
   if(!Array.isArray(c.regions)||!c.regions.length||c.regions.length>16)bad()
   for(const r of c.regions)if(!r||Object.keys(r).some(k=>!['x','y','w','h'].includes(k))||!['x','y','w','h'].every(k=>Number.isFinite(r[k]))||r.x<0||r.y<0||r.w<=0||r.h<=0||r.x+r.w>1.000001||r.y+r.h>1.000001)bad()
  }
 }
 return pkg
}
export function assessFidelity(pkg){
 validateFidelityFeatures(pkg)
 const features=pkg.fidelityFeatures??[]
 return {visualStatus:features.length?'needs-review':'unassessed',reuseStatus:features.length?'needs-review':'unassessed',features,
  scope:'source-observation-and-capability-inventory; no-automatic-fidelity-score'}
}
export function fidelityAssessmentHtml(pkg){
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
 const a=assessFidelity(pkg),names={texture:'纸纹/材质',typography:'字体',decoration:'装饰',hierarchy:'层次',color:'色彩','image-group':'图组','rich-text':'局部强调','table-structure':'表格结构',spacing:'留白'},states={unverified:'未逐项核对',missing:'缺失',approximate:'近似',derived:'派生',represented:'已有表现，待对照'},edits={unknown:'编辑能力待核对',none:'不可编辑',text:'文字可编辑',vector:'矢量可编辑','replaceable-image':'图像可替换','structured-data':'结构化数据可编辑'}
 const evidenceKinds={'native-text':'原生文字',vector:'矢量',image:'图像',ocr:'OCR（不证明原字体）',inferred:'推断'}
 return `<section data-fidelity-assessment><h4>${a.features.length?'视觉特征与复用待核对':'视觉还原未评估'}</h4><p>页面无溢出不代表视觉还原合格；组件可编辑也不代表与原页一致。未记录的特征视为未知，不计算自动还原分数。</p>${a.features.map(f=>`<p>${esc(pkg.layouts.find(l=>l.id===f.layoutId)?.label)} · 来源 SHA-256 ${esc(f.source.sha256)} · 原页 ${f.source.page} · ${esc(evidenceKinds[f.evidenceKind]??'证据类型未知')} · ${esc(names[f.feature])}：${esc(f.observed)}；${esc(states[f.representation])}；${esc(edits[f.editability])}${f.reason?'。原因：'+esc(f.reason):''}。</p>`).join('')}</section>`
}
/** Coordinates remain source-page observations, never text offsets or acceptance. */
export function emphasisCandidateReviewHtml(pkg,layoutId){
 validateFidelityFeatures(pkg)
 const features=(pkg.fidelityFeatures??[]).filter(f=>f.layoutId===layoutId&&f.emphasisCandidate),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),pct=v=>(v*100).toFixed(1)+'%'
 if(!features.length)return ''
 return `<section data-emphasis-review><h4>强调候选 · 待绑定项目原文</h4><p>图像区域不是文字位置。请对照对应原页；选用后在原文映射中自行选中片段。标题槽暂只供对照，不自动拆分标题强调。原稿字体、颜色及视觉质量仍待审阅。</p>${features.map(f=>`<details><summary>组件 ${esc(f.emphasisCandidate.componentId)} · ${f.emphasisCandidate.regions.length} 个区域</summary><p>来源 SHA-256 ${esc(f.source.sha256)} · 第 ${f.source.page} 页</p><button type="button" data-emphasis-source-sha="${esc(f.source.sha256)}" data-emphasis-source-page="${f.source.page}">查看此候选原页</button><ul>${f.emphasisCandidate.regions.map(r=>`<li>左 ${pct(r.x)}，上 ${pct(r.y)}，宽 ${pct(r.w)}，高 ${pct(r.h)}（原页比例）</li>`).join('')}</ul></details>`).join('')}</section>`
}
