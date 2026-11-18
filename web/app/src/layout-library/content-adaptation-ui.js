import {mountNativePreview} from './preview-ui.js'
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
const expiry=v=>typeof v==='number'?v:Date.parse(v)
export function contentAdaptationBoundaryText(policy){
 const gap=policy?.minGap
 return (Number.isFinite(gap)&&gap>=.001&&gap<=.05?'最小留白约画布宽高的'+Number((gap*100).toFixed(4))+'%，':'未提供最小留白数值；')+'调整范围以已保存父组边界为限。'
}
export function contentAdaptationPayload(layout,draft){
 const policy=layout?.contentAdaptationPolicy
 if(policy?.version!==1||policy.activation!=='explicit-preview-only'||!policy.entries?.length)throw Error('此版式未提供可核对的内容适配边界。')
 if(typeof draft?.title!=='string'||!draft.title.trim())throw Error('请填写试排标题。')
 if(draft.title.length>100)throw Error('试排标题最多 100 个字符，请自行调整，系统不会截断。')
 const textBlocks=layout.slots.filter(s=>s.role==='text').map(s=>{const text=draft.texts?.[s.binding];if(typeof text!=='string'||!text.trim())throw Error('请填写每个文字位置的完整试排内容。');if(text.length>5000)throw Error('每个文字位置最多 5000 个字符，请自行调整，系统不会截断。');return {key:s.binding,text}})
 const policies=[]
 for(const entry of policy.entries){const direction=draft.directions?.[entry.slotId];if(!direction)continue;if(!entry.directions.includes(direction))throw Error('所选调整方向不在此版式许可范围内。');policies.push({slotId:entry.slotId,direction})}
 if(!policies.length)throw Error('请至少选择一个文字位置及调整方向。')
 return {layoutId:layout.id,title:draft.title,textBlocks,policies}
}
export function createContentAdaptationController({resource,layout,request,now=Date.now,newId=()=>crypto.randomUUID?.()??Array.from(crypto.getRandomValues(new Uint8Array(16)),x=>x.toString(16).padStart(2,'0')).join('')}){
 const state={draft:{title:'',texts:{},directions:{}},receipt:null,busy:false,saved:null,error:''};let revision=0,disposed=false,confirmationId=null
 const check=()=>{if(disposed)throw Error('预览已关闭，请重新打开。')}
 const invalidate=()=>{revision++;state.receipt=null;confirmationId=null;state.error=''}
 return {state,update(draft){check();if(state.busy==='save')throw Error('正在保存，请等待结果。');invalidate();state.draft=structuredClone(draft)},
 async preview(){check();if(state.busy)throw Error('请等待当前操作完成。');invalidate();const token=revision,body=contentAdaptationPayload(layout,state.draft);state.busy='preview'
  try{const r=await request('/layout-library/'+resource.id+'/'+resource.version+'/content-fit-preview',{method:'POST',body});if(disposed||token!==revision)return null
   if(!r?.previewId||r.resourceId!==resource.id||r.sourceVersion!==resource.version||r.sourceHash!==resource.hash||!Number.isFinite(expiry(r.expiresAt))||expiry(r.expiresAt)<=now()||r.qa?.pages!==1||!Array.isArray(r.qa?.issues)||r.qa.issues.length||typeof r.beforeHtml!=='string'||typeof r.afterHtml!=='string')throw Error('试排检查未通过或来源已变化，请重新生成预览。')
   state.receipt=r;return r
  }catch(e){if(!disposed&&token===revision)state.error=e.message;throw e}finally{if(!disposed)state.busy=false}},
 async confirm(reviewed){check();const r=state.receipt;if(state.busy||!r||state.saved||reviewed!==true||expiry(r.expiresAt)<=now())throw Error('请重新生成预览并勾选已核对差异，再保存新版本。')
  confirmationId??=newId();state.busy='save';try{const result=await request('/layout-library/'+resource.id+'/content-fit-confirm',{method:'POST',body:{previewId:r.previewId,requestId:confirmationId,reviewed:true}});if(result?.id!==resource.id||!Number.isSafeInteger(result.version)||result.version<=resource.version)throw Error('保存结果尚未确认，请刷新版本记录核对。');state.saved=result;state.receipt=null;return result}
  catch(e){if(!disposed){state.error=e.message;if([400,403,404,409,410,422].includes(e.status??e.statusCode))invalidate()}throw e}finally{if(!disposed)state.busy=false}},
 dispose(){disposed=true;invalidate()}}
}
/** UI sends only trial text and allowed directions. Server owns measurement, geometry and revision checks. */
export function openContentAdaptation({document,resource,layout,request,initialDraft,onDraft=()=>{},onSaved=()=>{},onClose=()=>{}}){
 const dialog=document.createElement('dialog');dialog.className='ll-content-adaptation';dialog.setAttribute('aria-label','内容适配预览')
 const controller=createContentAdaptationController({resource,layout,request}),entries=layout.contentAdaptationPolicy?.entries??[],names={left:'向左加宽',up:'向上加高',down:'向下加高'},purposes={label:'标签',heading:'局部标题',subheading:'副标题',body:'正文',conclusion:'结论'}
 let disposed=false,previews=[],rendered=null,checkTimer
 dialog.innerHTML=`<header><h2>内容适配预览 · V${esc(resource.version)}</h2><button type="button" data-fit-close>关闭并保留试排草稿</button></header><p>先填真实文字并选择调整方向，再比较原版和适配提案。服务器重新测量，不调用模型、不缩小字号、不截断正文。</p><p>图片为合成试排占位，不代表已核验真实照片效果。保存只创建个人新版本，原版本保留，不发布、不改项目页面；试排正文不会存入可复用版式。</p><p data-fit-boundaries>${esc(contentAdaptationBoundaryText(layout.contentAdaptationPolicy))}</p><form data-fit-form><label>试排标题<input data-fit-title required maxlength="100"></label><div class="ll-fit-inputs">${layout.slots.filter(s=>s.role==='text').map(s=>`<label>${esc(purposes[s.purpose]??'文字')} · ${esc(s.binding)}<textarea data-fit-text="${esc(s.binding)}" required rows="3" maxlength="5000"></textarea></label>`).join('')}</div><fieldset><legend>只调整明确选中的文字框</legend>${entries.map(e=>`<label>${esc(e.slotId)}<select data-fit-direction="${esc(e.slotId)}"><option value="">不调整</option>${e.directions.map(d=>`<option value="${esc(d)}">${esc(names[d]??d)}</option>`).join('')}</select></label>`).join('')}</fieldset><button type="submit" data-fit-preview>生成适配预览</button></form><p data-fit-status role="status" aria-live="polite"></p><section data-fit-results hidden><div class="ll-fit-comparison"><section><h3>原版（相同试排内容）</h3><div data-fit-before class="ll-fit-canvas"></div></section><section><h3>适配提案（尚未保存）</h3><div data-fit-after class="ll-fit-canvas"></div></section></div><h3>文字框变化</h3><p>以下为画布百分比：左／上／宽／高。原稿位置与上次派生位置分别保留。</p><ul data-fit-changes></ul><p data-fit-qa></p></section><label class="ll-fit-confirm"><input type="checkbox" data-fit-reviewed disabled>我已对照预览，确认文字完整、调整位置合适；仅保存新版本，不发布。</label><button type="button" data-fit-save disabled>确认保存为新版本</button>`
 const find=s=>dialog.querySelector(s),status=t=>find('[data-fit-status]').textContent=t
 function read(){return {title:find('[data-fit-title]').value,texts:Object.fromEntries([...dialog.querySelectorAll('[data-fit-text]')].map(n=>[n.dataset.fitText,n.value])),directions:Object.fromEntries([...dialog.querySelectorAll('[data-fit-direction]')].map(n=>[n.dataset.fitDirection,n.value]))}}
 function controls(){if(disposed)return;const s=controller.state,valid=!!s.receipt&&!s.saved&&expiry(s.receipt.expiresAt)>Date.now();find('[data-fit-reviewed]').disabled=!!s.busy||!valid;find('[data-fit-save]').disabled=!!s.busy||!valid||!find('[data-fit-reviewed]').checked;find('[data-fit-preview]').disabled=!!s.busy;find('[data-fit-close]').disabled=s.busy==='save';for(const n of dialog.querySelectorAll('input[data-fit-title],textarea,select'))n.disabled=s.busy==='save'}
 function changed(){try{controller.update(read());onDraft(structuredClone(controller.state.draft));find('[data-fit-reviewed]').checked=false;status(rendered?'内容或方向已变化，旧预览仅供参考，请重新生成后确认。':'');controls()}catch(e){status(e.message)}}
 function showReceipt(r){previews.forEach(p=>p.dispose());previews=[];find('[data-fit-results]').hidden=false;previews.push(mountNativePreview(find('[data-fit-before]'),r.beforeHtml));previews.push(mountNativePreview(find('[data-fit-after]'),r.afterHtml));rendered=r
  const rect=r=>r?['x','y','w','h'].map(k=>(Number(r[k])*100).toFixed(1)+'%').join(' / '):'未提供';const list=find('[data-fit-changes]');list.replaceChildren();for(const c of r.changes??[]){const li=document.createElement('li');li.textContent=`${c.componentId} · ${names[c.direction]??c.direction}：原稿 ${rect(c.sourceRect)}；原版 ${rect(c.previousDerivedRect)} → 提案 ${rect(c.derivedRect)}`;list.append(li)}if(!list.childNodes.length)list.textContent='本次没有文字框位置变化。'
  find('[data-fit-qa]').textContent='本次试排浏览器检查：未发现溢出。仍须人工核对视觉效果，不代表原稿保真或发布审核通过。预览有效至 '+new Date(expiry(r.expiresAt)).toLocaleTimeString();status('请检查左右预览与变化明细，再确认保存新版本。')
 }
 find('[data-fit-form]').addEventListener('input',changed);find('[data-fit-form]').addEventListener('change',changed)
 find('[data-fit-form]').onsubmit=async e=>{e.preventDefault();if(controller.state.busy)return;try{changed();const pending=controller.preview();controls();status('正在服务器测量并重新试排…');const r=await pending;if(disposed)return;if(r)showReceipt(r);else status('试排期间内容已变化，请重新生成预览。')}catch(e){if(!disposed){controller.update(read());find('[data-fit-reviewed]').checked=false;status(e.message)}}finally{controls()}}
 find('[data-fit-reviewed]').onchange=controls
 find('[data-fit-save]').onclick=async()=>{if(controller.state.busy)return;try{const pending=controller.confirm(find('[data-fit-reviewed]').checked);controls();status('正在保存新版本，原版保持不变…');const result=await pending;if(disposed)return;status('已保存 V'+result.version+'，原版 V'+resource.version+' 保留。');find('[data-fit-reviewed]').checked=false;try{await onSaved(result)}catch{if(!disposed)status('新版本已保存，但列表刷新失败，请刷新版式库，不要重复保存。')}}catch(e){if(!disposed){find('[data-fit-reviewed]').checked=false;status(e.message+'；试排文字已保留。')}}finally{controls()}}
 const close=()=>{if(controller.state.busy==='save')return;dispose();onClose()}
 find('[data-fit-close]').onclick=close;dialog.addEventListener('cancel',e=>{e.preventDefault();close()})
 function dispose(){if(disposed)return;onDraft(read());disposed=true;controller.dispose();clearInterval(checkTimer);previews.forEach(p=>p.dispose());dialog.close();dialog.remove()}
 document.body.append(dialog);const draft=initialDraft??controller.state.draft;find('[data-fit-title]').value=draft.title??'';for(const n of dialog.querySelectorAll('[data-fit-text]'))n.value=draft.texts?.[n.dataset.fitText]??'';for(const n of dialog.querySelectorAll('[data-fit-direction]'))n.value=draft.directions?.[n.dataset.fitDirection]??'';controller.update(read());dialog.showModal();controls();checkTimer=setInterval(controls,1000)
 return {dispose,dialog,controller}
}
