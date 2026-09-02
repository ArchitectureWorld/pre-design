import type { ClientAnalyticalVisual } from './client-types.ts'

type EscapeHtml = (value: string) => string
type SitePlanVisual = Extract<ClientAnalyticalVisual,
  { readonly kind: 'spatial-sequence' } | { readonly kind: 'spatial-system' }>

function disclosure(value: string, escapeHtml: EscapeHtml): string {
  return `<p class="analysis-disclosure">${escapeHtml(value)}</p>`
}

function directedEdge(
  from: string,
  to: string,
  label: string,
  markerId: string,
  escapeHtml: EscapeHtml,
): string {
  const accessible = `${from} → ${to}：${label}`
  return `<div class="analysis-edge" data-from="${escapeHtml(from)}" data-to="${escapeHtml(to)}" data-relation-label="${escapeHtml(label)}" role="group" aria-label="${escapeHtml(accessible)}"><span>${escapeHtml(label)}</span><svg role="img" aria-label="${escapeHtml(`有向连接：${accessible}`)}" viewBox="0 0 24 120" preserveAspectRatio="none"><defs><marker id="${markerId}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z"/></marker></defs><line x1="12" y1="4" x2="12" y2="112" marker-end="url(#${markerId})"/></svg></div>`
}

function analysisNode(
  id: string,
  label: string,
  eyebrow: string,
  escapeHtml: EscapeHtml,
  detail?: string,
): string {
  const detailHtml = detail === undefined ? '' : `<small>${escapeHtml(detail)}</small>`
  return `<article class="analysis-node" data-analysis-node="${escapeHtml(id)}"><span>${escapeHtml(eyebrow)}</span><strong>${escapeHtml(label)}</strong>${detailHtml}</article>`
}

export function renderSitePlanHtml(
  visual: SitePlanVisual | undefined,
  escapeHtml: EscapeHtml,
): string {
  const nodes = visual?.kind === 'spatial-sequence'
    ? visual.nodes.slice(0, 4)
    : ['门户服务', '文化活动', '社区共享', '生态休闲']
  const anchors = nodes.map((node, index) => {
    const x = [150, 330, 520, 705][index] ?? 705
    const y = [205, 155, 230, 165][index] ?? 165
    return `<g data-map-anchor="anchor-${index + 1}" transform="translate(${x} ${y})"><circle r="12"/><text y="-20" text-anchor="middle">${escapeHtml(node)}</text></g>`
  }).join('')
  const sequence = visual?.kind === 'spatial-sequence'
    ? '<g data-map-layer="movement"><path d="M150 205 C220 170 255 165 330 155 S445 205 520 230 S630 185 705 165" marker-end="url(#site-plan-arrow)"/><text x="420" y="132" text-anchor="middle">公共主轴串联</text></g>'
    : '<g data-map-layer="spatial-system"><path d="M128 250 H730" marker-end="url(#site-plan-arrow)"/><path d="M570 98 V288"/><text x="410" y="276" text-anchor="middle">文化活力带</text><text x="590" y="118">生态水岸带</text></g>'
  const ecologyLabelY = visual?.kind === 'spatial-system' ? 238 : 257
  const analyticalKind = visual?.kind ?? 'spatial-context'
  return `<div class="analysis-visual analysis-site-plan" data-analysis-kind="${analyticalKind}" data-publishable="false"><svg role="img" aria-label="建筑策划示例总平场地研究图：展示城市道路、建筑肌理、水岸、功能分区、研究范围和策划节点" viewBox="0 0 860 360" preserveAspectRatio="xMidYMid meet"><title>建筑策划示例总平场地研究图</title><desc>自定义研究预览，用于表达场地、道路、建筑肌理、水岸、功能分区与节点关系，不代表真实项目红线或测绘成果。</desc><defs><pattern id="site-plan-buildings" width="42" height="34" patternUnits="userSpaceOnUse"><rect x="3" y="4" width="26" height="18" rx="2"/></pattern><marker id="site-plan-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z"/></marker></defs><g data-map-layer="context"><rect class="site-plan-ground" x="8" y="8" width="844" height="330" rx="12"/><path class="site-plan-water" d="M744 8 H852 V338 H690 C730 285 713 228 748 180 C785 130 727 70 744 8Z"/><text x="785" y="184" text-anchor="middle">城市水岸</text><path class="site-plan-road" d="M20 300 C180 265 300 325 450 294 S690 265 836 290"/><path class="site-plan-road" d="M74 28 V328"/><text x="108" y="318">城市道路</text><rect class="site-plan-buildings" x="96" y="48" width="620" height="238" fill="url(#site-plan-buildings)"/><text x="112" y="58">周边建筑肌理</text></g><g data-map-layer="functional-zones"><rect x="122" y="105" width="150" height="95"/><rect x="292" y="90" width="170" height="116"/><rect x="485" y="124" width="145" height="104"/><rect x="270" y="224" width="360" height="52"/><text x="197" y="126" text-anchor="middle">门户服务区</text><text x="377" y="111" text-anchor="middle">文化活动区</text><text x="557" y="145" text-anchor="middle">社区共享区</text><text x="450" y="${ecologyLabelY}" text-anchor="middle">生态休闲区</text></g><g data-map-layer="concept-boundary"><path d="M105 75 L700 75 L718 278 L108 286 Z"/><text x="120" y="304">研究范围（待核）</text></g>${sequence}<g data-map-layer="anchors">${anchors}</g><g data-map-layer="orientation"><path d="M810 76 V32" marker-end="url(#site-plan-arrow)"/><text x="810" y="94" text-anchor="middle">N</text><text x="810" y="316" text-anchor="middle">NTS</text></g></svg><p class="site-plan-status">研究范围（待核） · 非法定红线 · 非测绘成果</p><p class="analysis-disclosure">本图为自定义示例总平研究预览；正式项目需提供总平图、红线图、带 CRS 的闭合坐标或兼容 GeoJSON，并经复核确认后替换。</p></div>`
}

export function renderDecisionConvergenceHtml(
  decisions: readonly string[],
  escapeHtml: EscapeHtml,
): string {
  const selected = decisions.slice(0, 3)
  const nodes = selected.map((decision, index) => analysisNode(`decision-${index + 1}`, decision, `决策 ${String(index + 1).padStart(2, '0')}`, escapeHtml)).join('')
  const edges = selected.map((decision, index) => directedEdge(`decision-${index + 1}`, 'shared-unlock', '共同确认后汇聚', `closing-arrow-${index + 1}`, escapeHtml)).join('')
  return `<div class="analysis-visual analysis-convergence" data-analysis-kind="decision-convergence"><div class="analysis-node-row">${nodes}</div><div class="analysis-edge-row">${edges}</div>${analysisNode('shared-unlock', '共同决策完成，解锁概念深化、专题测算与首期实施', '共同决策 / 下一阶段解锁', escapeHtml)}</div>`
}

export function renderAnalyticalHtml(
  visual: ClientAnalyticalVisual | undefined,
  escapeHtml: EscapeHtml,
): string {
  if (visual === undefined) return ''

  if (visual.kind === 'urgency-signals') {
    const count = /^([0-9]+)\s*(.*)$/u.exec(visual.countLabel)
    return `<div class="analysis-visual analysis-urgency" data-analysis-kind="${visual.kind}"><div class="analysis-big-number"><strong>${escapeHtml(count?.[1] ?? visual.countLabel)}</strong><span>${escapeHtml(count?.[2] ?? '')}</span></div><ol>${visual.signals.map((signal, index) => `<li><span>${String(index + 1).padStart(2, '0')}</span><strong>${escapeHtml(signal.label)}</strong><p>${escapeHtml(signal.state)}</p></li>`).join('')}</ol>${disclosure(visual.disclosure, escapeHtml)}</div>`
  }
  if (visual.kind === 'spatial-sequence') {
    return renderSitePlanHtml(visual, escapeHtml)
  }
  if (visual.kind === 'spatial-system') {
    return renderSitePlanHtml(visual, escapeHtml)
  }
  if (visual.kind === 'operating-model') {
    const layers = visual.layers.slice(0, 3)
    const teams = visual.teams.slice(0, 3)
    const layerNodes = layers.map((layer, index) => analysisNode(`operation-layer-${index + 1}`, layer, `内容层 ${String(index + 1).padStart(2, '0')}`, escapeHtml)).join('')
    const layerEdges = layers.map((_layer, index) => directedEdge(`operation-layer-${index + 1}`, 'operation-outcome', '协同供给', `operation-in-${index + 1}`, escapeHtml)).join('')
    const teamEdges = teams.map((_team, index) => directedEdge('operation-outcome', `operation-team-${index + 1}`, '形成执行分工', `operation-out-${index + 1}`, escapeHtml)).join('')
    const teamNodes = teams.map((team, index) => analysisNode(`operation-team-${index + 1}`, team, `责任节点 ${String(index + 1).padStart(2, '0')}`, escapeHtml)).join('')
    return `<div class="analysis-visual analysis-directed-map analysis-operating" data-analysis-kind="public-operation"><div class="analysis-node-row">${layerNodes}</div><div class="analysis-edge-row">${layerEdges}</div>${analysisNode('operation-outcome', visual.outcome, '共同结果', escapeHtml)}<div class="analysis-edge-row">${teamEdges}</div><div class="analysis-node-row">${teamNodes}</div></div>`
  }
  if (visual.kind === 'daypart-matrix') {
    const header = visual.columns.map(column => `<th>${escapeHtml(column)}</th>`).join('')
    const rows = visual.rows.map((row, rowIndex) => `<tr><th>${escapeHtml(row)}</th>${visual.columns.map((_column, columnIndex) => {
      const level = visual.values[rowIndex]?.[columnIndex] ?? '中'
      return `<td data-level="${level}"><span>${level}</span></td>`
    }).join('')}</tr>`).join('')
    return `<div class="analysis-visual analysis-matrix" data-analysis-kind="${visual.kind}"><table><thead><tr><th>客群 / 场景</th>${header}</tr></thead><tbody>${rows}</tbody></table>${disclosure(visual.disclosure, escapeHtml)}</div>`
  }
  if (visual.kind === 'investment-sequence') {
    const sharedBasis = visual.items.length > 1 && new Set(visual.items.map(item => item.basis)).size === 1
      ? visual.items[0]?.basis
      : undefined
    const basis = sharedBasis === undefined
      ? ''
      : `<p class="analysis-shared-basis">测算口径｜${escapeHtml(sharedBasis)}</p>`
    return `<div class="analysis-visual analysis-investment" data-analysis-kind="${visual.kind}"><ol>${visual.items.map(item => `<li><span>${escapeHtml(item.order)}</span><strong>${escapeHtml(item.label)}</strong><p>${escapeHtml(item.amount)}${item.unit === '' ? '' : ` ${escapeHtml(item.unit)}`}</p>${sharedBasis === undefined ? `<small>${escapeHtml(item.basis)}</small>` : ''}</li>`).join('')}</ol>${basis}${disclosure(visual.disclosure, escapeHtml)}</div>`
  }
  if (visual.kind === 'decision-triad') {
    const items = visual.items.slice(0, 3)
    const nodes = items.map(item => analysisNode(`triad-decision-${item.order}`, item.label, `决策 ${item.order}`, escapeHtml, item.output)).join('')
    const edges = items.map(item => directedEdge(`triad-decision-${item.order}`, 'triad-common-unlock', '共同确认后汇聚', `triad-arrow-${item.order}`, escapeHtml)).join('')
    return `<div class="analysis-visual analysis-directed-map analysis-decisions" data-analysis-kind="${visual.kind}"><div class="analysis-node-row">${nodes}</div><div class="analysis-edge-row">${edges}</div>${analysisNode('triad-common-unlock', '形成统一输入（定位结论·首期边界图·协同机制）', '统一输入', escapeHtml)}</div>`
  }
  return `<div class="analysis-visual analysis-decision-flow" data-analysis-kind="${visual.kind}"><div><span>共同确认</span>${visual.decisions.map(decision => `<strong>${escapeHtml(decision)}</strong>`).join('')}</div><b aria-hidden="true">→</b><div><span>确认后进入</span>${visual.outputs.map(output => `<strong>${escapeHtml(output)}</strong>`).join('')}</div></div>`
}
