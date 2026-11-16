const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char])

export function outlineNumber(parent,index,count){
  if(count===1)return parent
  return parent ? `${parent}.${index+1}` : String(index+1)
}
export function reportHierarchy(doc){
  return doc.flow.map((id,i)=>{
    const number=outlineNumber('',i,doc.flow.length)
    const blocks=doc.blocks.filter(block=>block.chapterId===id)
    return {id,title:doc.chapters?.find(c=>c.id===id)?.title??id,number,
      sections:blocks.map((block,j)=>({block,number:outlineNumber(number,j,blocks.length),numbered:blocks.length>1}))}
  })
}
export const presentationLayouts={points:'要点',columns:'分栏对照',focus:'重点陈述','image-left':'左图右文',table:'数据比较',composition:'原生组合版式'}
export function workflowBlockItems(block) {
  if (Array.isArray(block?.items)) return block.items
  if (!block?.body?.trim()) return []
  return [{
    id: `${block.id}-item-1`,
    title: block.title,
    paragraphs: block.body.split(/\n\s*\n/u),
    points: [],
    evidenceIndexes: block.evidenceIndexes ?? [],
    legacy: true,
  }]
}

const itemFigures=item=>item.figures??(item.figure?[item.figure]:[])
const markdownValue=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('|','\\|').replaceAll('\n',' ')
const markdownTable=rows=>rows.map(row=>'| '+row.map(markdownValue).join(' | ')+' |').join('\n')
const chartRows=chart=>[['分类',...chart.series.map(s=>s.name)],...chart.categories.map((category,i)=>[category,...chart.series.map(s=>s.values[i])])]
function structuredMarkdown(item){
 const diagram=item.diagram,nodes=new Map(diagram?.nodes.map(n=>[n.id,n.label])??[])
 return [
  item.table?markdownTable([item.table.columns,...item.table.rows]):'',
  ...itemFigures(item).map(figure=>`图像：${markdownValue(figure.caption)}（资料ID：${markdownValue(figure.materialId)}）`),
  item.chart?`图表：${markdownValue(item.chart.title??(item.chart.type==='line'?'折线图':'条形图'))}${item.chart.unit?'（单位：'+markdownValue(item.chart.unit)+'）':''}\n\n${markdownTable(chartRows(item.chart))}`:'',
  item.timeline?`时间轴${item.timeline.title?'：'+markdownValue(item.timeline.title):''}\n\n${item.timeline.events.map(e=>'- '+markdownValue(e.label)+(e.description?'：'+markdownValue(e.description):'')).join('\n')}`:'',
  diagram?`关系图${diagram.title?'：'+markdownValue(diagram.title):''}\n\n节点：${diagram.nodes.map(n=>markdownValue(n.label)).join('、')}\n\n${diagram.edges.map(e=>'- '+markdownValue(nodes.get(e.from))+' → '+markdownValue(nodes.get(e.to))+(e.label?'：'+markdownValue(e.label):'')).join('\n')}`:'',
 ].filter(Boolean)
}
export function workflowBodyMarkdown(items, {headings = true} = {}) {
  return items.map(item => [
    headings ? `#### ${item.title}` : '',
    ...item.paragraphs,
    item.points.map(point => `- ${point}`).join('\n'),
    ...structuredMarkdown(item),
  ].filter(Boolean).join('\n\n')).join('\n\n')
}

export function workflowItemText(item) {
  return [item.title, ...item.paragraphs, ...item.points.map(point => `• ${point}`),...structuredMarkdown(item)].join('\n\n')
}

export function renderWorkflowItem(item, headingLevel = 3) {
  const heading = headingLevel === null ? null : headingLevel === 2 ? 'h2' : headingLevel === 4 ? 'h4' : 'h3'
  const lines = text => escape(text).replaceAll('\n', '<br>')
  const paragraphs = item.paragraphs.map(paragraph => `<p>${lines(paragraph)}</p>`).join('')
  const points = item.points.length ? `<ul>${item.points.map(point => `<li>${lines(point)}</li>`).join('')}</ul>` : ''
  const table=item.table?`<table class="workflow-script-table"><thead><tr>${item.table.columns.map(v=>`<th>${escape(v)}</th>`).join('')}</tr></thead><tbody>${item.table.rows.map(row=>`<tr>${row.map(v=>`<td>${escape(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>`:''
  const figure=itemFigures(item).map(f=>`<p class="workflow-script-figure">图像：${escape(f.caption)}（资料ID：${escape(f.materialId)}；输出前核验原件）</p>`).join('')
  const chart=item.chart?`<section class="workflow-script-chart"><strong>图表：${escape(item.chart.title??(item.chart.type==='line'?'折线图':'条形图'))}${item.chart.unit?' · 单位：'+escape(item.chart.unit):''}</strong><table class="workflow-script-table">${chartRows(item.chart).map((row,i)=>`<tr>${row.map(value=>i?`<td>${escape(value)}</td>`:`<th>${escape(value)}</th>`).join('')}</tr>`).join('')}</table></section>`:''
  const timeline=item.timeline?`<section class="workflow-script-timeline"><strong>时间轴${item.timeline.title?'：'+escape(item.timeline.title):''}</strong><ol>${item.timeline.events.map(e=>`<li>${escape(e.label)}${e.description?'：'+escape(e.description):''}</li>`).join('')}</ol></section>`:''
  const diagram=item.diagram,nodes=new Map(diagram?.nodes.map(n=>[n.id,n.label])??[])
  const relationships=diagram?`<section class="workflow-script-diagram"><strong>关系图${diagram.title?'：'+escape(diagram.title):''}</strong><p>节点：${diagram.nodes.map(n=>escape(n.label)).join('、')}</p><ul>${diagram.edges.map(e=>`<li>${escape(nodes.get(e.from))} → ${escape(nodes.get(e.to))}${e.label?'：'+escape(e.label):''}</li>`).join('')}</ul></section>`:''
  return `${heading ? `<${heading}>${escape(item.title)}</${heading}>` : ''}${paragraphs}${points}${table}${figure}${chart}${timeline}${relationships}`
}

export function workflowItemPresentation(block, index, sectionNumber) {
  const items = workflowBlockItems(block), subdivided = items.length > 1
  return {subdivided, number:outlineNumber(sectionNumber,index,items.length), title:subdivided||items[index]?.presentation?items[index]?.title:block.title}
}

const noteTopics = [
  {kind: 'boundary', title: '项目边界与规划管控', action: '待核实', terms: [
    ['项目红线', /项目红线/u],
    ['实施边界', /实施边界/u],
    ['项目边界', /项目边界|项目界址/u],
    ['用地性质', /用地(?:性质|类型|分类)|地类/u],
    ['规划管控', /规划管控|控规|规划条件|管控线/u],
  ]},
  {kind: 'scope', title: '研究范围与目标', action: '待明确', terms: [
    ['研究范围', /(?:研究|策划|服务|比较|本次)范围|半径|范围(?:待|未)/u],
    ['策划目标', /目标|(?:本次|策划|研究|项目)目的|决策/u],
    ['启动原因', /启动原因|启动背景/u],
    ['成果用途', /成果用途/u],
    ['成果要求', /成果深度|成果要求|成果[^，。；？]{0,15}深度/u],
    ['管理职责', /管理职责/u],
  ]},
  {kind: 'source', title: '资料时点与适用范围', action: '需核对', terms: [
    ['资料来源', /资料来源|说明来源|来源[、，]/u],
    ['资料时点', /时点|历史|年份|现势|版本|时间/u],
    ['适用范围', /适用/u],
    ['资料核验', /原件|原始资料|测绘|图纸|附件|证据|依据|CAD|DWG/iu],
  ]},
  {kind: 'conclusion', title: '专业判断限制', action: '需核对判断前提', terms: [
    ['专业判断', /专业结论|可行性|实施条件|开发强度|建设规模|可开发/u],
  ]},
]

export function compactWorkflowNotes(record) {
  const notes = [...new Set([...(record?.internalNotes ?? []), ...(record?.limitations ?? [])])]
    .filter(note => typeof note === 'string' && note.trim())
  const groups = new Map()
  for (const note of notes) {
    if (note.startsWith('待用户决定：')) {
      if (!groups.has('decision')) groups.set('decision',{kind:'decision',title:'待用户决定',details:[]})
      groups.get('decision').details.push(note.slice('待用户决定：'.length))
      continue
    }
    const matches = noteTopics.flatMap(topic => {
      const terms = topic.terms.filter(([, pattern]) => pattern.test(note)).map(([label]) => label)
      return terms.length ? [{...topic, terms}] : []
    })
    const source = matches.find(match => match.kind === 'source')
    // Requests for the date and origin of a source stay with the source checks.
    const asksForSource = /说明来源[、，]|注明来源[、，]/u.test(note)
    const topic = (asksForSource ? source : undefined)
      ?? matches.find(match => match.kind === 'boundary')
      ?? (source?.terms.some(term => term !== '资料核验') ? source : undefined)
      ?? matches[0] ?? {kind: 'other', title: '其他待核事项', terms: []}
    if (!groups.has(topic.kind)) {
      groups.set(topic.kind, {kind: topic.kind, title: topic.title, action: topic.action, terms: new Set(), details: []})
    }
    const group = groups.get(topic.kind)
    for (const term of topic.terms) group.terms.add(term)
    group.details.push(note)
  }
  return [...groups.values()].map(({kind, title, action, terms, details}) => {
    if (kind==='decision') return {kind,title,summary:details.length===1?details[0]:`${details.length} 个待决问题`,details}
    const shortNote = details.length === 1 && details[0].length <= 60 && !/本轮暂缺|处理方式|[？?\n]/u.test(details[0])
    const summary = shortNote ? details[0] : action ? `${action}：${[...terms].join('、')}。` : '展开查看具体限制与待补事项。'
    return {kind, title, summary, details}
  })
}
