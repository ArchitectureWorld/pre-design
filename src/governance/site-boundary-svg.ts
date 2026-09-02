import { createHash } from 'node:crypto'
import type { NormalizedSiteBoundaryGeometry } from './site-boundary-geometry.ts'

export interface RenderedBoundarySvg {
  readonly svg: string
  readonly sha256: string
  readonly width: 1600
  readonly height: 1000
}

const WIDTH = 1600 as const
const HEIGHT = 1000 as const
const PLOT = { x: 120, y: 170, width: 1140, height: 650, padding: 42 }

function fail(code: string): never {
  throw new Error(code)
}

function escapeXml(value: string): string {
  return value.replace(/[&<>'"]/gu, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&apos;', '"': '&quot;' })[character]!)
}

function displayNumber(value: number): string {
  if (!Number.isFinite(value)) fail('SITE_BOUNDARY_SVG_NUMERIC')
  return value.toFixed(3)
}

function pathData(coordinates: NormalizedSiteBoundaryGeometry['coordinates']): string {
  const open = coordinates.slice(0, -1)
  if (open.length < 3 || open.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y))) fail('SITE_BOUNDARY_SVG_NUMERIC')
  const xs = open.map(([x]) => x)
  const ys = open.map(([, y]) => y)
  const minimumX = Math.min(...xs)
  const maximumX = Math.max(...xs)
  const minimumY = Math.min(...ys)
  const maximumY = Math.max(...ys)
  const spanX = maximumX - minimumX
  const spanY = maximumY - minimumY
  if (!Number.isFinite(spanX) || !Number.isFinite(spanY) || spanX <= 0 || spanY <= 0) fail('SITE_BOUNDARY_SVG_NUMERIC')
  const largestSpan = Math.max(spanX, spanY)
  const relativeX = spanX / largestSpan
  const relativeY = spanY / largestSpan
  if (!Number.isFinite(relativeX) || !Number.isFinite(relativeY) || relativeX <= 0 || relativeY <= 0) fail('SITE_BOUNDARY_SVG_NUMERIC')
  const availableWidth = PLOT.width - PLOT.padding * 2
  const availableHeight = PLOT.height - PLOT.padding * 2
  const fit = Math.min(availableWidth / relativeX, availableHeight / relativeY)
  const contentWidth = relativeX * fit
  const contentHeight = relativeY * fit
  if (!Number.isFinite(fit) || !Number.isFinite(contentWidth) || !Number.isFinite(contentHeight)) fail('SITE_BOUNDARY_SVG_NUMERIC')
  const offsetX = PLOT.x + (PLOT.width - contentWidth) / 2
  const offsetY = PLOT.y + (PLOT.height - contentHeight) / 2
  if (!Number.isFinite(offsetX) || !Number.isFinite(offsetY)) fail('SITE_BOUNDARY_SVG_NUMERIC')
  return open.map(([x, y], index) => {
    const normalizedX = (x - minimumX) / spanX
    const normalizedY = (y - minimumY) / spanY
    const displayX = offsetX + normalizedX * contentWidth
    const displayY = offsetY + contentHeight - normalizedY * contentHeight
    if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY) || !Number.isFinite(displayX) || !Number.isFinite(displayY)) fail('SITE_BOUNDARY_SVG_NUMERIC')
    return `${index === 0 ? 'M' : 'L'} ${displayNumber(displayX)} ${displayNumber(displayY)}`
  }).join(' ') + ' Z'
}

export function renderSiteBoundarySvg(input: {
  readonly projectName: string
  readonly sourceDate: string
  readonly geometry: NormalizedSiteBoundaryGeometry
}): RenderedBoundarySvg {
  const projectName = escapeXml(input.projectName)
  const sourceDate = escapeXml(input.sourceDate)
  const crs = escapeXml(input.geometry.crs)
  const boundaryPath = pathData(input.geometry.coordinates)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000" viewBox="0 0 1600 1000" role="img" aria-labelledby="title description">
  <title id="title">${projectName} 项目边界分析图</title>
  <desc id="description">基于提供闭合坐标的离线边界示意，不含外部地图或推断要素。</desc>
  <rect width="1600" height="1000" fill="#f6f3ec"/>
  <rect x="60" y="50" width="1480" height="900" fill="#fffdf8" stroke="#17212b" stroke-width="3"/>
  <text x="120" y="110" fill="#17212b" font-family="Arial, sans-serif" font-size="36" font-weight="700">${projectName}</text>
  <text x="120" y="145" fill="#46515c" font-family="Arial, sans-serif" font-size="18" letter-spacing="3">项目边界 · 闭合坐标分析图</text>
  <line x1="120" y1="170" x2="1480" y2="170" stroke="#17212b" stroke-width="2"/>
  <rect x="120" y="170" width="1140" height="650" fill="#e9ece8" stroke="#a8b2b8" stroke-width="2"/>
  <path d="${boundaryPath}" fill="#e8a23a" fill-opacity="0.34" stroke="#b54c2f" stroke-width="7" stroke-linejoin="round"/>
  <text x="1340" y="260" fill="#17212b" font-family="Arial, sans-serif" font-size="20" font-weight="700">图例</text>
  <line x1="1340" y1="292" x2="1410" y2="292" stroke="#b54c2f" stroke-width="7"/>
  <text x="1430" y="299" fill="#17212b" font-family="Arial, sans-serif" font-size="18">项目边界</text>
  <text x="1340" y="360" fill="#46515c" font-family="Arial, sans-serif" font-size="17">坐标参考：${crs}</text>
  <text x="1340" y="392" fill="#46515c" font-family="Arial, sans-serif" font-size="17">来源日期：${sourceDate}</text>
  <text x="1340" y="424" fill="#46515c" font-family="Arial, sans-serif" font-size="17">比例：NTS</text>
  <g transform="translate(1420 620)" fill="none" stroke="#17212b" stroke-width="3">
    <path d="M 0 -74 L 18 18 L 0 6 L -18 18 Z" fill="#17212b"/>
    <line x1="0" y1="-74" x2="0" y2="84"/>
    <circle cx="0" cy="0" r="30" fill="#fffdf8"/>
  </g>
  <text x="1420" y="530" text-anchor="middle" fill="#17212b" font-family="Arial, sans-serif" font-size="24" font-weight="700">N</text>
  <text x="1420" y="740" text-anchor="middle" fill="#46515c" font-family="Arial, sans-serif" font-size="17">指北针</text>
  <line x1="120" y1="870" x2="1480" y2="870" stroke="#17212b" stroke-width="2"/>
  <text x="120" y="910" fill="#46515c" font-family="Arial, sans-serif" font-size="17">坐标输入规范化后绘制 · 不作为测绘成果 · NTS</text>
  <text x="1480" y="910" text-anchor="end" fill="#46515c" font-family="Arial, sans-serif" font-size="17">${crs} · ${sourceDate}</text>
</svg>`
  return { svg, sha256: createHash('sha256').update(svg).digest('hex'), width: WIDTH, height: HEIGHT }
}
