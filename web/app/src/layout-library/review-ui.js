import {mountNativePreview} from './preview-ui.js'
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
const types={cover:'封面',section:'章节',text:'文字分析',figure:'图文',map:'地图分析',data:'数据分析',comparison:'比较',timeline:'时间安排',relationship:'关系分析',mixed:'综合分析'}
const structures={'single-column':'单栏','equal-columns':'等宽分栏','asymmetric-columns':'非对称分栏',grid:'网格',hero:'主图突出','full-bleed':'满幅',stacked:'纵向组合'}
const density={low:'疏朗',medium:'适中',high:'密集'}
const limitations={'partial-coverage':'参考仅读取部分页面','text-only':'只有文字依据','unrendered-pages':'部分页面没有图像','approximate-measurement':'部分尺寸为视觉估计','unsupported-editable-mirror':'未提供可编辑原稿镜像','font-substitution':'字体采用可用替代','unsupported-decoration':'部分装饰无法迁移','readability-adjusted':'为可读性调整了样式','conflicting-sources':'不同参考存在冲突','content-capacity-limited':'页面存在内容容量限制'}

export function referenceProfileHtml(profile){
 if(!profile)return ''
 const system=profile.designSystem
 const sourcePages=new Set(profile.evidence.filter(e=>e.fileSha256&&e.pageNumber).map(e=>e.fileSha256+':'+e.pageNumber))
 return `<div class="ll-profile-summary"><p>已提炼 <b>${profile.archetypes.length}</b> 种页面类型，${profile.rules.length} 条设计规则；${sourcePages.size} 个来源页提供证据。</p><div class="ll-profile-colors">${Object.entries(system.colors).map(([key,value])=>`<span><i style="background:${esc(value)}"></i>${esc({background:'背景',ink:'正文',accent:'强调',muted:'注释'}[key])} ${esc(value)}</span>`).join('')}</div><p>画布 ${system.canvas.width} × ${system.canvas.height} · ${system.typography.fontFamily==='serif'?'宋体':'黑体'} · 标题 ${system.typography.titleSize} / 正文 ${system.typography.bodySize} / 注释 ${system.typography.captionSize}</p><ul>${profile.archetypes.map(a=>`<li><b>${esc(types[a.pageType]??a.pageType)}</b> · ${esc(structures[a.structure]??a.structure)} · ${esc(density[a.density])}；图片容量 ${a.capacity.images}，要点 ${a.capacity.bodyPoints}，表格行 ${a.capacity.tableRows}</li>`).join('')}</ul>${profile.limitations.length?`<p class="ll-review-limitations">${profile.limitations.map(l=>esc(limitations[l.code]??l.code)).join('；')}</p>`:''}</div>`
}

/** Comparison receipts are issued by the server for the exact saved version. */
export function openReferenceReview({document=globalThis.document,request,resource,notify=()=>{},onConfirmed=()=>{}}){
 const dialog=document.createElement('dialog'),base='/layout-library/'+resource.id+'/'+resource.version
 dialog.className='ll-dialog ll-review-dialog';dialog.setAttribute('aria-label','参考设计对照审阅')
 dialog.innerHTML=`<header class="ll-head"><h2>参考设计对照</h2><span data-review-status role="status">正在准备页面检查…</span><button data-review-close aria-label="关闭对照">×</button></header><div class="ll-review-main"><div class="ll-review-toolbar"><label>页面类型<select data-review-layout>${resource.package.layouts.map(l=>`<option value="${esc(l.id)}">${esc(l.label)}</option>`).join('')}</select></label><span data-review-count>0 / ${resource.package.layouts.length} 已查看</span></div><div class="ll-review-pair"><section><h3 data-source-title>参考原页</h3><div class="ll-reference-image" data-review-source></div></section><section><h3>迁移试排 · 合成内容</h3><div class="ll-preview" data-review-prototype></div><p class="ll-hint">本页用于核对设计迁移。选用后会用项目实际内容再次检查容量与素材。</p></section></div><details open><summary>提炼的设计规律与限制</summary>${referenceProfileHtml(resource.package.designProfile)}</details><footer class="ll-review-footer"><label><input type="checkbox" data-review-accepted>我已逐页核对风格、图文关系和限制，接受此版本</label><button data-review-confirm class="ll-primary" disabled>确认全部页面类型</button></footer></div>`
 document.body.append(dialog);dialog.showModal()
 let disposed=false,generation=0,preview,busy=false,validation=resource.validation
 const seen=new Map(),find=selector=>dialog.querySelector(selector),controller=new AbortController()
 const status=message=>{if(!disposed)find('[data-review-status]').textContent=message}
 function dispose(){if(disposed)return;disposed=true;generation++;controller.abort();preview?.dispose();dialog.close();dialog.remove()}
 function controls(){if(disposed)return;find('[data-review-confirm]').disabled=busy||validation?.status!=='passed'||seen.size!==resource.package.layouts.length||!find('[data-review-accepted]').checked;find('[data-review-count]').textContent=seen.size+' / '+resource.package.layouts.length+' 已查看'}
 async function load(){
  const token=++generation,layoutId=find('[data-review-layout]').value;busy=true;controls();status('正在读取原页与试排…')
  try{
   const value=await request(base+'/compare',{method:'POST',body:{layoutId},signal:controller.signal})
   if(disposed||token!==generation)return
   const source=find('[data-review-source]');source.replaceChildren()
   if(value.source){const image=document.createElement('img');image.src=value.source.dataUrl;image.alt='原参考第 '+value.source.page+' 页';source.append(image);find('[data-source-title]').textContent=value.source.name+' · 第 '+value.source.page+' 页'}
   else{source.textContent='此页面类型来自文字设计要求，没有可对照的原页图像。';find('[data-source-title]').textContent='文字要求与设计规则'}
   preview?.dispose();preview=mountNativePreview(find('[data-review-prototype]'),value.html)
   seen.set(layoutId,value.receipt.id);status(validation?.status==='passed'?'页面检查通过，请逐类核对参考。':'页面检查未通过，请调整版式后重新审阅。')
  }catch(error){if(!disposed&&token===generation){status(error.message);notify(error.message)}}
  finally{if(!disposed&&token===generation){busy=false;controls()}}
 }
 find('[data-review-close]').onclick=dispose;dialog.oncancel=event=>{event.preventDefault();dispose()}
 find('[data-review-layout]').onchange=()=>void load()
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
