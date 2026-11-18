import {validateTextBlocks} from './text-blocks.mjs'
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
export function mappingForSelections(slots,source,selections,spansByKey={}){
 if(!/^[a-f0-9]{64}$/.test(source?.sourceFingerprint??''))throw Error('缺少当前原稿指纹，请刷新。')
 const used=new Set(),entries=slots.filter(s=>s.role==='text').map(slot=>{
  const value=selections[slot.binding],index=Number(value),option=source.sources?.[index]
  if(value===undefined||value===''||!Number.isSafeInteger(index)||index<0||!option)throw Error('请为每个局部文字位置选择完整原文；没有合适内容时请换版式或先修改脚本。')
  if(used.has(index))throw Error('同一段原文不能重复移入多个组件。')
  used.add(index);const spans=spansByKey[slot.binding]??[];validateTextBlocks([{key:slot.binding,text:option.quote,spans}]);return {source:structuredClone(option.source),quote:option.quote,targetKey:slot.binding,...(spans.length?{spans:structuredClone(spans)}:{})}
 })
 return {sourceFingerprint:source.sourceFingerprint,entries}
}
export function spanForSelection(text,start,end,style){
 const boundary=n=>n===0||n===text.length||!(text.charCodeAt(n-1)>=0xd800&&text.charCodeAt(n-1)<=0xdbff&&text.charCodeAt(n)>=0xdc00&&text.charCodeAt(n)<=0xdfff)
 if(typeof text!=='string'||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<=start||end>text.length||!boundary(start)||!boundary(end))throw Error('请在原文中完整选择需要强调的文字，不能选择半个字符。')
 const span={start:Array.from(text.slice(0,start)).length,end:Array.from(text.slice(0,end)).length,quote:text.slice(start,end),style};validateTextBlocks([{key:'selection',text,spans:[span]}]);return span
}
// Textarea normalizes CRLF and lone CR to LF. Map DOM UTF-16 boundaries
// back to the unchanged source before converting to contract code-point offsets.
export function spanForTextareaSelection(original,start,end,style){
 if(typeof original!=='string')throw Error('缺少原文。')
 const boundaries=[0];for(let i=0;i<original.length;){if(original[i]==='\r'&&original[i+1]==='\n')i+=2;else i++;boundaries.push(i)}
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<=start||end>=boundaries.length)throw Error('请选择完整原文片段。')
 return spanForSelection(original,boundaries[start],boundaries[end],style)
}
export function mountContentMapping(node,{layouts,source,features=[],initialMapping,onSave,onCancel}){
 const purposes={label:'标签',heading:'标题',subheading:'副标题',body:'正文',conclusion:'结论'}
 node.innerHTML=`<section data-content-mapping><strong>逐项选择原文位置</strong><p>不改写、不调用模型。完整原文移入组件；强调须由你在原文中选择，不根据参考图猜文字位置。未分配内容继续保留，容量不足会阻止保存。</p><label>目标版式<select data-mapping-layout>${layouts.map(l=>`<option value="${esc(l.id)}">${esc(l.label??l.id)}</option>`).join('')}</select></label><div data-mapping-fields></div><p data-mapping-error role="alert"></p><button type="button" data-mapping-save>确认原文映射并保存</button><button type="button" data-mapping-cancel>取消</button></section>`
 const select=node.querySelector('[data-mapping-layout]'),fields=node.querySelector('[data-mapping-fields]'),error=node.querySelector('[data-mapping-error]'),save=node.querySelector('[data-mapping-save]');let disposed=false,spansByKey={}
 const render=()=>{
  spansByKey={};const layout=layouts.find(l=>l.id===select.value)
  fields.innerHTML=layout.slots.filter(s=>s.role==='text').map(s=>{
   const candidates=features.filter(f=>f.layoutId===layout.id&&f.emphasisCandidate&&f.slotIds?.includes(s.id))
   return `<fieldset data-mapping-field="${esc(s.binding)}"><legend>${esc(purposes[s.purpose]??'文字')} · ${esc(s.binding)}</legend>${candidates.map(f=>`<p data-emphasis-candidate>参考强调候选 · 来源 ${esc(f.source.sha256)} · 第 ${f.source.page} 页 · 组件 ${esc(f.emphasisCandidate.componentId)} · ${f.emphasisCandidate.regions.length} 个区域，待文字绑定。不是已提取的强调词。</p>`).join('')}<label>完整原文<select data-mapping-key="${esc(s.binding)}" style="max-width:100%"><option value="">选择完整原文</option>${source.sources.map((o,i)=>`<option value="${i}">${esc((o.source.field==='points'?'要点':'段落')+' '+(o.source.index+1)+'：'+o.quote)}</option>`).join('')}</select></label><details><summary>显式选择强调文字（可选）</summary><p>在下方只读原文中选择片段，再添加。样式是你的派生选择，不代表原稿字体或颜色已还原。</p><textarea readonly data-emphasis-text aria-label="选择需要强调的原文" rows="4" style="width:100%"></textarea><label>强调样式<select data-emphasis-style><option value="strong">加粗</option><option value="accent">主题强调色</option><option value="accent-strong">加粗与主题强调色</option></select></label><button type="button" data-emphasis-add>添加所选片段</button><div data-emphasis-list></div></details></fieldset>`
  }).join('');error.textContent=''
  for(const field of fields.querySelectorAll('[data-mapping-field]')){
   const key=field.dataset.mappingField,choice=field.querySelector('[data-mapping-key]'),text=field.querySelector('[data-emphasis-text]'),list=field.querySelector('[data-emphasis-list]')
   const listRender=()=>{list.innerHTML=(spansByKey[key]??[]).map((s,i)=>`<p>${esc(s.quote)} · ${esc({strong:'加粗',accent:'主题强调色','accent-strong':'加粗与主题强调色'}[s.style])}<button type="button" data-emphasis-remove="${i}">移除此片段</button></p>`).join('');for(const b of list.querySelectorAll('[data-emphasis-remove]'))b.onclick=()=>{spansByKey[key].splice(Number(b.dataset.emphasisRemove),1);listRender()}}
   choice.onchange=()=>{text.value=choice.value===''?'':source.sources[Number(choice.value)]?.quote??'';spansByKey[key]=[];listRender()}
   if(initialMapping?.sourceFingerprint===source.sourceFingerprint){const entry=initialMapping.entries?.find(e=>e.targetKey===key),index=entry?source.sources.findIndex(o=>o.source.field===entry.source.field&&o.source.index===entry.source.index&&o.quote===entry.quote):-1;if(index>=0){choice.value=String(index);choice.onchange();spansByKey[key]=structuredClone(entry.spans??[]);listRender()}}

   field.querySelector('[data-emphasis-add]').onclick=()=>{try{const original=choice.value===''?undefined:source.sources[Number(choice.value)]?.quote;if(typeof original!=='string'||text.value!==original.replace(/\r\n?/g,'\n'))throw Error('原文已变化，请重新选择。');const next=[...(spansByKey[key]??[]),spanForTextareaSelection(original,text.selectionStart,text.selectionEnd,field.querySelector('[data-emphasis-style]').value)].sort((a,b)=>a.start-b.start);validateTextBlocks([{key,text:original,spans:next}]);spansByKey[key]=next;listRender();error.textContent=''}catch(e){error.textContent=e.message}}
  }
 }
 select.onchange=()=>{initialMapping=undefined;render()};render()
 save.onclick=async()=>{try{const layout=layouts.find(l=>l.id===select.value),selections=Object.fromEntries([...fields.querySelectorAll('[data-mapping-key]')].map(n=>[n.dataset.mappingKey,n.value]));const contentMapping=mappingForSelections(layout.slots,source,selections,spansByKey);save.disabled=true;select.disabled=true;for(const n of fields.querySelectorAll('select,button,textarea'))n.disabled=true;await onSave({layoutId:layout.id,contentMapping});if(!disposed)node.replaceChildren()}catch(e){if(!disposed)error.textContent=e.message}finally{if(!disposed){save.disabled=false;select.disabled=false;for(const n of fields.querySelectorAll('select,button,textarea'))n.disabled=false}}}
 node.querySelector('[data-mapping-cancel]').onclick=()=>{disposed=true;node.replaceChildren();onCancel?.()};return {dispose(){disposed=true;node.replaceChildren()}}
}
