import { describe, expect, it } from 'vitest'
import { normalizeSiteBoundaryGeometry } from '../src/governance/site-boundary-geometry.ts'
import { renderSiteBoundarySvg } from '../src/governance/site-boundary-svg.ts'

const geometry = normalizeSiteBoundaryGeometry('EPSG:4490', [[114, 30], [114.01, 30], [114.01, 30.01], [114, 30.01], [114, 30]])

describe('renderSiteBoundarySvg', () => {
  it('renders one deterministic 1600x1000 NTS boundary sheet', () => {
    const first = renderSiteBoundarySvg({ projectName: '自定义测试项目', sourceDate: '2026-08-30', geometry })
    const second = renderSiteBoundarySvg({ projectName: '自定义测试项目', sourceDate: '2026-08-30', geometry })

    expect(first).toEqual(second)
    expect(first.width).toBe(1600)
    expect(first.height).toBe(1000)
    expect(first.svg).toContain('viewBox="0 0 1600 1000"')
    expect(first.svg).toContain('NTS')
    expect(first.svg).toContain('EPSG:4490')
    expect(first.svg).toContain('项目边界')
    expect(first.svg).not.toMatch(/道路|建筑|地块|高德|百度|Mapbox/iu)
    expect(first.sha256).toMatch(/^[a-f0-9]{64}$/u)
  })

  it('escapes project metadata and rounds only SVG display coordinates to three decimals', () => {
    const rendered = renderSiteBoundarySvg({ projectName: '<甲&乙>"\'', sourceDate: '2026-08-30<&', geometry })

    expect(rendered.svg).toContain('&lt;甲&amp;乙&gt;&quot;&apos;')
    expect(rendered.svg).toContain('2026-08-30&lt;&amp;')
    expect(rendered.svg).toMatch(/\d+\.\d{3}\s+\d+\.\d{3}/u)
    expect(geometry.coordinates[1]).toEqual([114.01, 30])
  })

  it('contains only inline SVG elements and no external resource references', () => {
    const rendered = renderSiteBoundarySvg({ projectName: '项目', sourceDate: '2026-08-30', geometry })

    expect(rendered.svg).toContain('指北针')
    expect(rendered.svg).toContain('图例')
    expect(rendered.svg).not.toMatch(/<image\b|<script\b|\bhref\s*=/iu)
  })

  it('renders extreme finite normalized geometry without NaN or Infinity', () => {
    const high = Number.MAX_VALUE
    const low = high / 2
    const extreme = normalizeSiteBoundaryGeometry('EPSG:3857', [[low, low], [high, low], [high, high], [low, high], [low, low]])
    const rendered = renderSiteBoundarySvg({ projectName: '极值项目', sourceDate: '2026-08-30', geometry: extreme })

    expect(rendered.svg).not.toMatch(/NaN|Infinity/u)
  })

  it('fails closed when direct extreme coordinates overflow the SVG bounding-box span', () => {
    const high = Number.MAX_VALUE
    expect(() => renderSiteBoundarySvg({
      projectName: '极值项目', sourceDate: '2026-08-30',
      geometry: { source: 'closed_coordinates', crs: 'EPSG:3857', coordinates: [[-high, -high], [high, -high], [high, high], [-high, high], [-high, -high]], sha256: 'a'.repeat(64) },
    })).toThrow('SITE_BOUNDARY_SVG_NUMERIC')
  })
})
