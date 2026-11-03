import { fitViewport, mapPixel, scaleBar, toWgs84 } from '../report/cartography/geometry.ts'
import type { RegionalOdResult, RegionalOdRow } from './regional-od.ts'

export const escapeHtml=(value:string)=>value.replace(/[&<>"']/gu,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!))
const colors=['#166b76','#975e20','#695591','#43754b','#a54848','#5c6878']
const family='Microsoft YaHei, Noto Sans CJK SC, sans-serif'
const valueText=(n:number|null,divisor=1)=>n===null?'未取得':(n/divisor).toFixed(1)
function svgStart(width:number,height:number,title:string):string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img"><title>${escapeHtml(title)}</title><rect width="100%" height="100%" fill="#ffffff"/><g font-family="${family}" fill="#173c43">`
}

/** This is explicitly a coordinate-backed geometry diagram, not a licensed basemap. */
export function renderRegionalRouteSvg(result:RegionalOdResult):string|null {
  const rows=result.rows.filter(r=>r.routeGeometry!==null)
  if (!rows.length) return null
  const points=result.input.nodes.map(n=>toWgs84(n.coordinate))
  const viewport=fitViewport([...points,...rows.flatMap(r=>r.routeGeometry!)],1000,620)
  const px=(p:typeof points[number])=>{const q=mapPixel(p,viewport);return {x:q.x+30,y:q.y+125}}
  const parts=[svgStart(1280,860,'路网几何示意 · 无地理底图'),
    '<text x="32" y="46" font-size="30" font-weight="700">重要区域到达路线：路网几何示意</text>',
    '<text x="32" y="84" font-size="20" fill="#8b541e">无地理底图 · 仅展示路网返回曲线，不替代正式带底图的路线图</text>',
    '<rect x="30" y="125" width="1000" height="620" rx="8" fill="#f4f7f5" stroke="#cad8d3"/>']
  // A projection grid carries no fabricated road, parcel or watercourse information.
  for(let x=230;x<1030;x+=200)parts.push(`<path d="M${x},125V745" stroke="#dce5e1" stroke-width="1"/>`)
  for(let y=249;y<745;y+=124)parts.push(`<path d="M30,${y}H1030" stroke="#dce5e1" stroke-width="1"/>`)
  rows.forEach((row,index)=>{
    const d=row.routeGeometry!.map((p,i)=>{const q=px(p);return `${i?'L':'M'}${q.x.toFixed(2)},${q.y.toFixed(2)}`}).join(' ')
    parts.push(`<path data-od-id="${escapeHtml(row.id)}" d="${d}" fill="none" stroke="${colors[index]}" stroke-width="4"/>`)
    const y=160+index*85
    parts.push(`<path d="M1050,${y-8}h22" stroke="${colors[index]}" stroke-width="4"/><text x="1080" y="${y}" font-size="18">OD ${result.rows.indexOf(row)+1}</text>`,
      `<text x="1050" y="${y+27}" font-size="18">${valueText(row.roadMeters,1000)} km</text><text x="1050" y="${y+52}" font-size="18">模型 ${valueText(row.durationSeconds,60)} min</text>`)
  })
  result.input.nodes.forEach((node,index)=>{
    const p=px(points[index])
    parts.push(`<circle cx="${p.x}" cy="${p.y}" r="10" stroke="#fff" stroke-width="3" fill="#173c43"/><text x="${p.x+14}" y="${p.y-12}" font-size="20" font-weight="700">入口 ${index+1}</text>`)
  })
  const scale=scaleBar(viewport)
  parts.push(`<rect x="45" y="666" width="230" height="60" fill="white"/><text x="58" y="691" font-size="18">${scale.label}（局部比例）</text><path d="M58,710h${scale.pixels}" stroke="#173c43" stroke-width="4"/>`,
    '<text x="995" y="162" font-size="22" text-anchor="middle">北 ↑</text>',
    '<text x="32" y="786" font-size="18">坐标 WGS84；显示 EPSG:3857。入口编号与节点台账对应；道路通行及入口尚需复核。</text>',
    `<text x="32" y="817" font-size="18">${result.transportMode==='injected'?'注入的OSRM格式响应 · 非本次在线取数；来源与测试用途见审计包。':'路线来源：OSRM / OpenStreetMap；无实时路况。© OpenStreetMap contributors · ODbL'}</text>`,
    '</g></svg>')
  return parts.join('')
}

export function renderRegionalChartSvg(result:RegionalOdResult):string {
  const h=200+result.rows.length*105, max=Math.max(1,...result.rows.flatMap(r=>[r.straightMeters,r.roadMeters??0]))
  const parts=[svgStart(1280,h,'距离与路网模型时间对照'),
    '<text x="32" y="46" font-size="30" font-weight="700">距离与时间分开比较，不把未知写成零</text>',
    '<text x="32" y="85" font-size="19">浅色：球面直线距离　深色：路网模型里程；右侧时间不使用距离轴。</text>',
    '<text x="1030" y="118" font-size="19">模型时间（分钟）</text>']
  for(const [index,row] of result.rows.entries()) {
    const y=150+index*105
    const bar=(v:number|null,yy:number,color:string)=>v===null?`<text x="270" y="${yy+18}" font-size="18" fill="#8b541e">未取得</text>`:
      `<rect x="260" y="${yy}" width="${v/max*610}" height="22" fill="${color}"/><text x="${275+v/max*610}" y="${yy+18}" font-size="18">${valueText(v,1000)} km</text>`
    parts.push(`<g data-od-id="${escapeHtml(row.id)}"><text x="32" y="${y+17}" font-size="21">OD ${index+1} · ${row.mode==='driving'?'驾车':escapeHtml(row.mode)}</text>`,
      `<text x="32" y="${y+48}" font-size="17">入口 ${result.input.nodes.findIndex(n=>n.id===row.fromId)+1} → 入口 ${result.input.nodes.findIndex(n=>n.id===row.toId)+1}</text>`,
      bar(row.straightMeters,y,'#bdcfc9'),bar(row.roadMeters,y+34,'#166b76'),
      `<text x="1050" y="${y+38}" font-size="26">${valueText(row.durationSeconds,60)}</text></g>`)
  }
  parts.push(`<text x="32" y="${h-20}" font-size="18">同一快照、原始底数计算；仅展示提供坐标和已取得路网结果，不推断客源或承诺实际到达时间。</text></g></svg>`)
  return parts.join('')
}

export function regionalCsv(result:RegionalOdResult):string {
  const escape=(value:unknown)=>{
    let s=value===null?'':String(value)
    // Preserve originals in JSON. Prefix risky text cells for spreadsheet viewers.
    if(typeof value==='string'&&/^[\s]*[=+@-]|^[\t\r]/u.test(s))s="'"+s
    return '"'+s.replaceAll('"','""')+'"'
  }
  const rows:unknown[][]=[['OD_ID','origin_ID','destination_ID','origin_label','destination_label','mode','straight_m','road_m','duration_s','time_basis','snapshot_ID','issues','claim_refs']]
  for(const row of result.rows)rows.push([row.id,row.fromId,row.toId,result.input.nodes.find(n=>n.id===row.fromId)!.label,
    result.input.nodes.find(n=>n.id===row.toId)!.label,row.mode,row.straightMeters,row.roadMeters,row.durationSeconds,row.timeBasis,
    result.snapshotId,row.issues.join(';'),row.claimRefs.join(';')])
  return rows.map(row=>row.map(escape).join(',')).join('\r\n')+'\r\n'
}

export function renderRegionalReport(result:RegionalOdResult,routeSvg:string|null,chartSvg:string):string {
  const cell=(row:RegionalOdRow,metric:'straightMeters'|'roadMeters'|'durationSeconds',divisor:number)=>
    `<td class="number"${row[metric]===null?'':` data-claim-id="claim-${escapeHtml(row.id)}-${metric}"`}>${valueText(row[metric],divisor)}</td>`
  const rows=result.rows.map((r,i)=>`<tr data-row-id="${escapeHtml(r.id)}"><th scope="row">OD ${i+1}</th><td>${escapeHtml(result.input.nodes.find(n=>n.id===r.fromId)!.label)} → ${escapeHtml(result.input.nodes.find(n=>n.id===r.toId)!.label)}</td><td>${escapeHtml(r.mode)}</td>${cell(r,'straightMeters',1000)}${cell(r,'roadMeters',1000)}${cell(r,'durationSeconds',60)}<td>${r.issues.length?'有缺口':'模型结果'}${r.limitations.some(l=>l.includes('暂定入口'))?' / 暂定入口':''}</td></tr>`).join('')
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:;"><title>重要区域距离与到达条件</title><style>
  *{box-sizing:border-box}body{margin:0;background:#f4f6f4;color:#173c43;font:17px/1.75 ${family}}main{max-width:1320px;padding:40px 28px;margin:auto}header{padding:28px 32px;background:#143c43;color:white;border-radius:18px}h1{font-size:32px;line-height:1.35}h2{font-size:24px;margin-top:34px}.tag{font-size:14px;color:#c3dad2}.notice{border-left:4px solid #b88135;background:#fff8e9;padding:18px 22px;margin:22px 0}figure{background:#fff;border:1px solid #d7e2dc;margin:22px 0;padding:10px;border-radius:12px}svg{display:block;width:100%;height:auto}figcaption{font-size:14px;padding:8px 14px}.table{overflow:auto;background:#fff}table{border-collapse:collapse;width:100%;min-width:880px;font-size:15px}td,th{padding:12px;border-bottom:1px solid #d8e3dd;text-align:left}thead{background:#e4eee8}.number{text-align:right;font-variant-numeric:tabular-nums}small{font-size:14px}li{margin:8px 0}a{color:#166b76}footer{margin-top:35px;font-size:14px}@media(max-width:700px){main{padding:20px 12px}header{padding:22px}h1{font-size:26px}}@media print{@page{size:A3 landscape;margin:16mm}body{background:white;font-size:11pt}main{padding:0;max-width:none}header{background:white;color:#173c43;border:1px solid #ccd9d3;padding:8mm}svg{max-height:205mm}figure{break-inside:avoid}h2{break-after:avoid}.table{overflow:visible}table{min-width:0;font-size:9pt}tr{break-inside:avoid}thead{display:table-header-group}.tag{color:#47665d}}
  </style></head><body><main><header><div class="tag">地域研究 · 2.02 / 2.03 · 有条件分析成果</div><h1>重要区域距离与到达条件</h1><p>${escapeHtml(result.input.scope)}</p></header>
  <div class="notice">${result.transportMode==='injected'?'本页使用调用方注入的响应，未自行进行公开网络取数。':''}本页是提供坐标与可用路网响应的计算结果，不是已通过专业审核的可实施结论。路网数据缺失时仅给出直线距离。</div>
  <h2>入口与研究对象</h2><ol>${result.input.nodes.map(n=>`<li><b>${escapeHtml(n.label)}</b> · ${escapeHtml(n.selectionReason)}<br><small>${n.entranceStatus==='provisional'?'暂定入口':'来源记载点（未独立核实）'}；${n.relation==='potential'?'潜在联系，不代表已合作':'输入记录的现有联系'}</small></li>`).join('')}</ol>
  ${routeSvg?`<figure>${routeSvg}<figcaption>路线几何仅来自路网响应；底图缺口未被虚构内容填补。</figcaption></figure>`:'<div class="notice">未取得有效路线，路线图未生成。没有以直线连接冒充驾车路径。</div>'}
  <figure>${chartSvg}<figcaption>直线距离、道路里程和时间分别表达；完整精度保留在数据表中。</figcaption></figure>
  <h2>起终点对照表</h2><div class="table"><table><thead><tr><th>序号</th><th>起点 → 终点</th><th>方式</th><th>直线 km</th><th>道路 km</th><th>模型分钟</th><th>限制</th></tr></thead><tbody>${rows}</tbody></table></div>
  <h2>判断边界与人工复核</h2><ul>${result.limitations.map(l=>`<li>${escapeHtml(l)}</li>`).join('')}</ul><p>人工至少复核：入口选择依据、原坐标及坐标系、路网吸附、禁行或封闭条件、去回程差异，以及原始响应与表中数字是否一致。</p>
  <footer>数据日期 ${escapeHtml(result.input.asOf)}。内部抽查包包含原始来源、路网响应、未取数原因和逐数字追溯记录。若有路网模型结果，来源为OSRM / OpenStreetMap，© OpenStreetMap contributors（ODbL）。</footer></main></body></html>`
}
