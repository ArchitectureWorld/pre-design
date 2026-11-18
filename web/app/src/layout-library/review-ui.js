import {emphasisCandidateReviewHtml} from './fidelity-assessment.mjs'
import {mountNativePreview} from './preview-ui.js'
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
const types={cover:'封面',section:'章节',text:'文字分析',figure:'图文',map:'地图分析',data:'数据分析',comparison:'比较',timeline:'时间安排',relationship:'关系分析',mixed:'综合分析'}
const structures={'single-column':'单栏','equal-columns':'等宽分栏','asymmetric-columns':'非对称分栏',grid:'网格',hero:'主图突出','full-bleed':'满幅',stacked:'纵向组合'}
const density={low:'疏朗',medium:'适中',high:'密集'}
const limitations={'partial-coverage':'参考仅读取部分页面','text-only':'只有文字依据','unrendered-pages':'部分页面没有图像','approximate-measurement':'部分尺寸为视觉估计','unsupported-editable-mirror':'未提供可编辑原稿镜像','font-substitution':'字体采用可用替代','unsupported-decoration':'部分装饰无法迁移','readability-adjusted':'为可读性调整了样式','conflicting-sources':'不同参考存在冲突','content-capacity-limited':'页面存在内容容量限制'}

/** Fixed copy only: source geometry is not a semantic or editing guarantee. */
export function placementEvidenceText(value,page){
 if(!value||value.status==='not-collected')return '原生图像摆放证据：未采集。不能据此认定原稿没有图像，或已提取可编辑表格。'
 if(value.status!=='available'||!Number.isSafeInteger(page)||page<1||value.page!==page||!/^[a-f0-9]{64}$/.test(value.sourceSha256??'')||![value.occurrenceCount,value.clippedOrUncertainCount].every(n=>Number.isSafeInteger(n)&&n>=0&&n<=1024)||value.clippedOrUncertainCount>value.occurrenceCount)return '原生图像摆放证据：不可用或来源未知。请直接对照原页；未据此判定可编辑性。'
 return `原件 ${value.sourceSha256.slice(0,12)}… · 第 ${page} 页：记录 ${value.occurrenceCount} 次图像绘制，其中 ${value.clippedOrUncertainCount} 次含裁剪或合成不确定性。仅为绘制操作观察，不代表完整可见图像、表格数据已提取、可编辑性或素材共享授权。`
}

export function referenceProfileHtml(profile){
 if(!profile)return ''
 const system=profile.designSystem
 const sourcePages=new Set(profile.evidence.filter(e=>e.fileSha256&&e.pageNumber).map(e=>e.fileSha256+':'+e.pageNumber))
 return `<div class="ll-profile-summary"><p>已提炼 <b>${profile.archetypes.length}</b> 种页面类型，${profile.rules.length} 条设计规则；${sourcePages.size} 个来源页提供证据。</p><div class="ll-profile-colors">${Object.entries(system.colors).map(([key,value])=>`<span><i style="background:${esc(value)}"></i>${esc({background:'背景',ink:'正文',accent:'强调',muted:'注释'}[key])} ${esc(value)}</span>`).join('')}</div><p>画布 ${system.canvas.width} × ${system.canvas.height} · ${system.typography.fontFamily==='serif'?'宋体':'黑体'} · 标题 ${system.typography.titleSize} / 正文 ${system.typography.bodySize} / 注释 ${system.typography.captionSize}</p><ul>${profile.archetypes.map(a=>`<li><b>${esc(types[a.pageType]??a.pageType)}</b> · ${esc(structures[a.structure]??a.structure)} · ${esc(density[a.density])}；图片容量 ${a.capacity.images}，要点 ${a.capacity.bodyPoints}，模板表格行容量 ${a.capacity.tableRows}</li>`).join('')}</ul>${profile.limitations.length?`<p class="ll-review-limitations">${profile.limitations.map(l=>esc(limitations[l.code]??l.code)).join('；')}</p>`:''}</div>`
}

/** Comparison receipts are issued by the server for the exact saved version. */
export function openReferenceReview({document=globalThis.document,request,resource,notify=()=>{},onConfirmed=()=>{}}){
 const dialog=document.createElement('dialog'),base='/layout-library/'+resource.id+'/'+resource.version
 dialog.className='ll-dialog ll-review-dialog';dialog.setAttribute('aria-label','参考设计对照审阅')
 dialog.innerHTML=`<header class="ll-head"><h2>参考设计对照</h2><span data-review-status role="status">正在准备页面检查…</span><button data-review-close aria-label="关闭对照">×</button></header><div class="ll-review-main"><div class="ll-review-toolbar"><label>页面类型<select data-review-layout>${resource.package.layouts.map(l=>`<option value="${esc(l.id)}">${esc(l.label)}</option>`).join('')}</select></label><span data-review-count>0 / ${resource.package.layouts.length} 已查看</span></div><div class="ll-review-pair"><section><h3 data-source-title>参考原页</h3><div class="ll-reference-image" data-review-source></div><p class="ll-hint" data-review-native-evidence hidden></p></section><section><h3 data-review-prototype-title>迁移试排 · 合成内容</h3><div class="ll-preview" data-review-prototype></div><p class="ll-hint" data-review-purpose>本页用于核对设计迁移。选用后会用项目实际内容再次检查容量与素材。</p><p class="ll-hint" data-review-table-status hidden>表格状态：可编辑模板表格 / 重建结构。当前试排使用合成数据；这不表示已从源参考稿提取单元格文本、数值或合并关系。请对照原页核对结构，实际数据仍需提供或另行提取。</p></section></div><div data-review-emphasis></div><details open><summary>提炼的设计规律与限制</summary>${referenceProfileHtml(resource.package.designProfile)}</details><footer class="ll-review-footer"><label><input type="checkbox" data-review-accepted>我已逐页核对风格、图文关系和限制，接受此版本</label><button data-review-confirm class="ll-primary" disabled>确认全部页面类型</button></footer></div>`
 document.body.append(dialog);dialog.showModal()
 let disposed=false,generation=0,preview,sourcePreview,busy=false,selectedSource=null,validation=resource.validation
 const seen=new Map(),find=selector=>dialog.querySelector(selector),controller=new AbortController()
 const status=message=>{if(!disposed)find('[data-review-status]').textContent=message}
 function dispose(){if(disposed)return;disposed=true;generation++;controller.abort();preview?.dispose();sourcePreview?.dispose();dialog.close();dialog.remove()}
 function controls(){if(disposed)return;find('[data-review-confirm]').disabled=busy||validation?.status!=='passed'||seen.size!==resource.package.layouts.length||!find('[data-review-accepted]').checked;find('[data-review-count]').textContent=seen.size+' / '+resource.package.layouts.length+' 已查看'}
 async function load(){
  const token=++generation,layoutId=find('[data-review-layout]').value;find('[data-review-table-status]').hidden=!resource.package.layouts.find(l=>l.id===layoutId)?.slots?.some(s=>s.role==='table');find('[data-review-native-evidence]').hidden=true;sourcePreview?.dispose();sourcePreview=null;find('[data-review-source]').replaceChildren();find('[data-review-emphasis]').replaceChildren();preview?.dispose();preview=null;busy=true;controls();status('正在读取原页与试排…')
  try{
   const value=await request(base+'/compare',{method:'POST',body:{layoutId,...(selectedSource?{source:selectedSource}:{})},signal:controller.signal})
   if(disposed||token!==generation)return
   const source=find('[data-review-source]');source.replaceChildren()
   const style=!!value.sourcePreviewHtml&&value.sourceIdentity
   find('[data-review-prototype-title]').textContent=style?'平台重新设计 · 合成内容':'迁移试排 · 合成内容'
   find('[data-review-purpose]').textContent=style?'左侧为冻结源资源的合成内容样例，右侧为平台重新设计；不是原 PDF 分析恢复或保真复刻。选用后仍以项目实际内容检查容量与素材。':'本页用于核对设计迁移。选用后会用项目实际内容再次检查容量与素材。'
   if(style){sourcePreview=mountNativePreview(source,value.sourcePreviewHtml);find('[data-source-title]').textContent=value.sourceIdentity.name+' · 源资源 V'+value.sourceIdentity.version+' · 合成内容样例'}
   else if(value.source){const image=document.createElement('img');image.src=value.source.dataUrl;image.alt='原参考第 '+value.source.page+' 页';source.append(image);find('[data-review-native-evidence]').textContent=placementEvidenceText(value.source.nativeImagePlacements,value.source.page);find('[data-review-native-evidence]').hidden=false;find('[data-source-title]').textContent=value.source.name+' · 第 '+value.source.page+' 页'}
   else{source.textContent='此页面类型来自文字设计要求，没有可对照的原页图像。';find('[data-source-title]').textContent='文字要求与设计规则'}
   const candidates=find('[data-review-emphasis]');candidates.innerHTML=style?'':emphasisCandidateReviewHtml(resource.package,layoutId);for(const button of candidates.querySelectorAll('[data-emphasis-source-page]'))button.onclick=()=>{selectedSource={fileSha256:button.dataset.emphasisSourceSha,pageNumber:Number(button.dataset.emphasisSourcePage)};void load()}
   preview?.dispose();preview=mountNativePreview(find('[data-review-prototype]'),value.html)
   seen.set(layoutId,value.receipt.id);status(validation?.status==='passed'?'页面检查通过，请逐类核对参考。':'页面检查未通过，请调整版式后重新审阅。')
  }catch(error){if(!disposed&&token===generation){status(error.message);notify(error.message)}}
  finally{if(!disposed&&token===generation){busy=false;controls()}}
 }
 find('[data-review-close]').onclick=dispose;dialog.oncancel=event=>{event.preventDefault();dispose()}
 find('[data-review-layout]').onchange=()=>{selectedSource=null;void load()}
 find('[data-review-accepted]').onchange=controls
 find('[data-review-confirm]').onclick=async()=>{
  if(busy||disposed)return
  busy=true;controls()
  try{
   await request(base+'/reference-review',{method:'POST',body:{requestId:crypto.randomUUID(),packageHash:resource.hash,comparisonIds:[...seen.values()],reviewed:true},signal:controller.signal})
   if(disposed)return
   await onConfirmed();dispose()
  }catch(error){if(!disposed){status(error.message);notify(error.message)}}finally{busy=false;controls()}
 }
 const ready=(async()=>{
  try{
   if(validation?.status!=='passed')validation=await request(base+'/validate',{method:'POST',body:{},signal:controller.signal})
   if(!disposed)await load()
  }catch(error){if(!disposed){status(error.message);notify(error.message);controls()}}
 })()
 return {dialog,dispose,ready}
}
