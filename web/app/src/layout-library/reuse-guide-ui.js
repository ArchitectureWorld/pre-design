const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
const roles={title:'标题',claim:'引导文字',body:'正文要点',image:'图片',table:'表格',chart:'数据图表',timeline:'时间轴',diagram:'关系图',source:'来源与页码'}
const types={cover:'封面',section:'章节分隔',text:'文字分析',figure:'图文说明',map:'地图分析',data:'数据分析',comparison:'比较分析',timeline:'时间安排',relationship:'关系分析',mixed:'综合分析'}
/** Only derived, already-authorized package metadata. Never fetch source artifacts. */
export function reuseGuideHtml(pkg){
 if(!pkg.designSpec)return ''
 const spec=pkg.designSpec,graph=spec.masterLayoutGraph
 return `<details class="ll-profile" data-reuse-guide open><summary>复用说明 · 结构、内容与容量</summary><p>这是可复用版式资产，示例页面仅用于检查。选用后替换为自己的内容；不会复制参考原件的文字、照片或业务数据。</p><p>结构声明：${graph.filter(n=>n.kind==='master').length} 个母版层、${graph.filter(n=>n.kind==='layout').length} 个版式层、${graph.filter(n=>n.kind==='slide').length} 个来源页映射；${spec.components.length} 个组件。PDF / 图片的层级可能是证据支持的推导，不等于源文件原生母版。</p>${pkg.layouts.map(layout=>{
  const a=spec.profile.archetypes.find(a=>a.id===layout.archetypeId),fit=layout.contentFitRules
  return `<section><h4>${esc(layout.label)}</h4><p>适用页面：${esc(types[a?.pageType]??a?.pageType)}；依据 ${a?.evidenceIds.length??0} 项设计证据。</p><p>可编辑内容：${[...new Set(layout.slots.map(s=>s.role))].map(r=>esc(roles[r]??r)).join('、')}。装饰 SVG 不承载业务文字。</p><p>声明容量：标题 ${fit.maxTitleCharacters} 字符，引导文字 ${fit.maxClaimCharacters} 字符，正文 ${fit.maxBodyPoints} 条 / 合计 ${fit.maxBodyCharacters} 字符，图片 ${fit.maxImages} 张，表格 ${fit.maxTableRows} 行 × ${fit.maxTableColumns} 列。</p><ul>${layout.slots.map(s=>`<li>${esc(roles[s.role]??s.role)}：位置 ${Math.round(s.rect.x*100)}%, ${Math.round(s.rect.y*100)}%；宽高 ${Math.round(s.rect.w*100)}% × ${Math.round(s.rect.h*100)}%</li>`).join('')}</ul></section>`
 }).join('')}<p>容量是声明上限，不是所有内容都能通过的保证。实际文字换行、图片比例和图表复杂度仍须试排；超量拒绝，不自动裁剪。共享另需现有授权与审核，不包含原件访问权限。</p></details>`
}
