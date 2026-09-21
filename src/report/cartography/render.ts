import type { AnalysisBasemap, AnalysisGap, AnalysisLocation, AnalysisNode, AnalysisRoute, MapViewport, PlanningAnalysisInput, Wgs84Point } from './types.ts'
import { mapPixel, scaleBar } from './geometry.ts'

export interface RenderMapInput {
  request: PlanningAnalysisInput
  viewport: MapViewport
  basemap: AnalysisBasemap
  locations: readonly ((AnalysisLocation | AnalysisNode) & { wgs84: Wgs84Point })[]
  routes: readonly AnalysisRoute[]
  rings: readonly { kilometers: number; coordinates: readonly Wgs84Point[] }[]
  boundary?: { status: 'research' | 'confirmed'; coordinates: readonly Wgs84Point[] }
  straightDistances: readonly { fromId: string; toId: string; distanceMeters: number }[]
  disclosures: readonly string[]
  gaps: readonly AnalysisGap[]
}

const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!)
const clientPlaceName = (value: string) => value.replace(/（公开地图代表点）$/u, '')
function textLines(text: string, maxLength: number): string[] {
  const characters = Array.from(text), lines: string[] = []
  let current = '', width = 0
  for (const character of characters) {
    const size = /[\x00-\x7f]/.test(character) ? 0.6 : 1
    if (width + size > maxLength) { lines.push(current); current = ''; width = 0 }
    current += character; width += size
  }
  if (current) lines.push(current)
  return lines
}
function multiline(text: string, x: number, y: number, maxLength: number, fontSize = 21, lineHeight = 30, color = '#253d43'): string {
  return `<text x="${x}" y="${y}" font-size="${fontSize}" fill="${color}">${textLines(text, maxLength).map((line, index) => `<tspan x="${x}" dy="${index ? lineHeight : 0}">${escape(line)}</tspan>`).join('')}</text>`
}

export function renderAnalysisSvg(input: RenderMapInput): string {
  const { viewport, request } = input, left = 40, top = 150, panelLeft = 1358
  const pixel = (point: Wgs84Point) => { const value = mapPixel(point, viewport); return { x: value.x + left, y: value.y + top } }
  const path = (points: readonly Wgs84Point[]) => points.map((point, index) => { const value = pixel(point); return `${index ? 'L' : 'M'}${value.x.toFixed(2)},${value.y.toFixed(2)}` }).join(' ')
  const scale = scaleBar(viewport), pieces: string[] = []
  pieces.push(`<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="1120" viewBox="0 0 1800 1120"><defs><clipPath id="map-clip"><rect x="${left}" y="${top}" width="${viewport.width}" height="${viewport.height}" rx="8"/></clipPath></defs><rect width="1800" height="1120" fill="#f8f7f2"/><g font-family="Microsoft YaHei, Noto Sans CJK SC, sans-serif">`)
  pieces.push(multiline(request.title, 40, 60, 44, 37, 45), multiline(request.question ?? '以真实地图与可追溯位置资料说明空间关系', 40, 114, 76, 21, 27, '#587078'))
  pieces.push(`<image x="${left}" y="${top}" width="${viewport.width}" height="${viewport.height}" href="data:image/png;base64,${Buffer.from(input.basemap.png).toString('base64')}"/>`)
  pieces.push('<g clip-path="url(#map-clip)">')
  for (const ring of input.rings) {
    pieces.push(`<path d="${path(ring.coordinates)} Z" fill="none" stroke="#54758c" stroke-width="2.3" stroke-dasharray="10 8"/>`)
    const labelPoint = pixel(ring.coordinates[18])
    pieces.push(`<text x="${labelPoint.x - 10}" y="${labelPoint.y - 10}" text-anchor="end" font-size="21" font-weight="600" stroke="#ffffff" stroke-width="5" paint-order="stroke" fill="#33526b">直线 ${ring.kilometers} 公里</text>`)
  }
  if (input.boundary) pieces.push(`<path d="${path(input.boundary.coordinates)} Z" fill="#df863511" stroke="#c66b22" stroke-width="3" stroke-dasharray="${input.boundary.status === 'research' ? '9 6' : 'none'}"/>`)
  input.routes.forEach((route, index) => pieces.push(`<path d="${path(route.geometry)}" fill="none" stroke="${['#ce5e40', '#7954a1', '#238075'][index % 3]}" stroke-width="6" stroke-linejoin="round" stroke-linecap="round"/>`))
  const labelBoxes: { left: number; right: number; top: number; bottom: number }[] = []
  input.locations.forEach((location, index) => {
    const point = pixel(location.wgs84), isSite = index === 0
    pieces.push(`<circle cx="${point.x}" cy="${point.y}" r="${isSite ? 13 : 10}" fill="${isSite ? '#c34e31' : '#1d6175'}" stroke="white" stroke-width="3"/>`)
    const label = `${index === 0 ? '' : `${index}. `}${clientPlaceName(location.label)}`
    const anchor = point.x > left + viewport.width * 0.72 ? 'end' : 'start', x = point.x + (anchor === 'end' ? -18 : 18)
    const labelWidth = Array.from(label).reduce((width, character) => width + (/[\x00-\x7f]/.test(character) ? 15 : 24), 0)
    const labelLeft = anchor === 'end' ? x - labelWidth : x
    const candidates = [-17, 37, -54, 74].map(offset => ({ left: labelLeft, right: labelLeft + labelWidth,
      top: point.y + offset - 26, bottom: point.y + offset + 6 }))
    const box = candidates.find(candidate => candidate.top >= top && candidate.bottom <= top + viewport.height
      && labelBoxes.every(placed => candidate.right + 8 < placed.left || candidate.left - 8 > placed.right
        || candidate.bottom + 8 < placed.top || candidate.top - 8 > placed.bottom)) ?? candidates[0]
    labelBoxes.push(box)
    pieces.push(`<text x="${x}" y="${box.bottom - 6}" text-anchor="${anchor}" font-size="23" font-weight="600" stroke="white" stroke-width="5" paint-order="stroke" fill="#183943">${escape(label)}</text>`)
  })
  pieces.push('</g>')
  pieces.push(`<rect x="${left + 18}" y="${top + viewport.height - 90}" width="245" height="68" rx="5" fill="#ffffffed"/><path d="M${left + 37},${top + viewport.height - 45}h${scale.pixels}" fill="none" stroke="#173e46" stroke-width="5"/><path d="M${left + 37},${top + viewport.height - 51}v12 M${left + 37 + scale.pixels},${top + viewport.height - 51}v12" stroke="#173e46" stroke-width="2"/><text x="${left + 37}" y="${top + viewport.height - 61}" font-size="19">比例尺 ${scale.label}</text>`)
  pieces.push(`<rect x="${left + viewport.width - 73}" y="${top + 18}" width="55" height="98" rx="5" fill="#ffffffed"/><text x="${left + viewport.width - 46}" y="${top + 47}" text-anchor="middle" font-size="22">北</text><path d="M${left + viewport.width - 46},${top + 60}l-13,35 13,-8 13,8 Z" fill="#173e46"/>`)
  pieces.push(`<rect x="${panelLeft - 14}" y="${top}" width="416" height="800" rx="8" fill="#eef2ef"/>`)
  pieces.push(multiline('图例与测量', panelLeft + 8, top + 39, 17, 27))
  let y = top + 81
  for (const { label, color } of [{ label: '项目位置', color: '#c34e31' }, ...(input.locations.length > 1 ? [{ label: '周边城镇', color: '#1d6175' }] : [])]) {
    pieces.push(`<circle cx="${panelLeft + 17}" cy="${y - 7}" r="7" fill="${color}"/>`, multiline(label, panelLeft + 36, y, 16, 19, 26)); y += 36
  }
  for (const label of [...(input.routes.length ? ['━ 驾车路线'] : []), ...(input.rings.length ? ['┄ 直线距离圈'] : []), ...(input.boundary ? [input.boundary.status === 'research' ? '┄ 研究范围' : '━ 项目边界'] : [])]) {
    pieces.push(multiline(label, panelLeft + 8, y, 17, 19, 26)); y += 36
  }
  for (const route of input.routes.slice(0, 5)) {
    const from = clientPlaceName(input.locations.find(location => location.id === route.fromId)?.label ?? route.fromId)
    const to = clientPlaceName(input.locations.find(location => location.id === route.toId)?.label ?? route.toId)
    const label = `${from} → ${to}附近路网：驾车 ${(route.distanceMeters / 1000).toFixed(1)} 公里，约 ${Math.round(route.durationSeconds / 60)} 分钟`
    pieces.push(multiline(label, panelLeft + 8, y + 9, 17, 21, 29)); y += textLines(label, 17).length * 29 + 25
  }
  if (!input.routes.length) for (const distance of input.straightDistances.slice(0, 4)) {
    const to = clientPlaceName(input.locations.find(location => location.id === distance.toId)?.label ?? distance.toId)
    const label = `至${to}：地表直线 ${(distance.distanceMeters / 1000).toFixed(1)} 公里`
    pieces.push(multiline(label, panelLeft + 8, y + 8, 17, 21, 29)); y += textLines(label, 17).length * 29 + 17
  }
  const credit = input.basemap.attribution.replace(/OpenStreetMap contributors/gi, '开放街图贡献者').replace(/\s*[·|]\s*ODbL\b/gi, '')
  pieces.push(multiline(`${credit}${input.basemap.source.observedAt ? ` · ${input.basemap.source.observedAt.slice(0, 10)}` : ''}`, 40, 985, 92, 18, 24, '#52676d'))
  pieces.push('</g></svg>')
  return pieces.join('')
}

/** Portable companion preserves full provider attribution without crowding client map pixels. */
export function renderAnalysisHtml(input: RenderMapInput, png: Uint8Array): string {
  const sourceLink = (label: string, locator: string) => /^https?:\/\//i.test(locator)
    ? `<a href="${escape(locator)}" rel="noopener noreferrer">${escape(label)}</a>` : escape(`${label}：${locator}`)
  const osm = /OpenStreetMap/i.test(input.basemap.attribution)
  const credit = osm
    ? `${sourceLink(input.basemap.attribution, 'https://www.openstreetmap.org/copyright')} · <a href="https://opendatacommons.org/licenses/odbl/1-0/">ODbL</a>`
    : escape(input.basemap.attribution)
  const rows = input.locations.map(location => `<tr><th scope="row">${escape(location.label)}</th><td>${location.wgs84.longitude.toFixed(7)}, ${location.wgs84.latitude.toFixed(7)}</td><td>${sourceLink(location.source.label, location.source.locator)}</td></tr>`).join('')
  const routeDetails = input.routes.map(route => {
    const from = input.locations.find(location => location.id === route.fromId)?.label ?? route.fromId
    const to = input.locations.find(location => location.id === route.toId)?.label ?? route.toId
    return `<li>${escape(from)} → ${escape(to)}附近路网：${(route.distanceMeters / 1000).toFixed(2)} 公里，模型估计 ${(route.durationSeconds / 60).toFixed(1)} 分钟，无实时路况。路网吸附偏移：起点 ${route.waypoints[0].snapDistanceMeters.toFixed(2)} 米，终点 ${route.waypoints[1].snapDistanceMeters.toFixed(2)} 米。来源：${sourceLink(route.source.label, route.source.locator)}。</li>`
  }).join('')
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(input.request.title)} — 地图来源与说明</title><style>body{font:17px/1.65 "Microsoft YaHei",sans-serif;color:#253d43;background:#f8f7f2;max-width:1200px;margin:36px auto;padding:0 24px}h1{font-size:30px}img{display:block;width:100%;height:auto}a{color:#155f7a;overflow-wrap:anywhere}table{border-collapse:collapse;width:100%}th,td{border:1px solid #cbd4d0;padding:10px;text-align:left}figcaption{margin:12px 0}li{margin:10px 0}</style><h1>${escape(input.request.title)}</h1><figure><img src="data:image/png;base64,${Buffer.from(png).toString('base64')}" alt="${escape(input.request.title)}，真实公开地图与来源支持的测量"><figcaption>${credit}</figcaption></figure><h2>来源与坐标</h2><p>底图：${sourceLink(input.basemap.source.label, input.basemap.source.locator)}。获取日期：${escape(input.basemap.source.observedAt ?? '见证据记录')}。地理坐标 WGS84 / EPSG:4326；显示投影 EPSG:3857；缩放级别 ${input.viewport.zoom}。</p><table><thead><tr><th>地点</th><th>经度、纬度</th><th>位置来源</th></tr></thead><tbody>${rows}</tbody></table>${routeDetails ? `<h2>道路测量与吸附</h2><ul>${routeDetails}</ul>` : ''}<h2>测量边界</h2><ul>${input.disclosures.map(value => `<li>${escape(value)}</li>`).join('')}</ul><p>原始响应摘要、坐标、测量值和文件校验值见<a href="analysis.evidence.json">地图证据清单</a>。</p></html>`
}
