import { describe, expect, it } from 'vitest'
import { normalizeSiteBoundaryGeometry } from '../src/governance/site-boundary-geometry.ts'

const square = [[114, 30], [114.01, 30], [114.01, 30.01], [114, 30.01], [114, 30]] as const

describe('normalizeSiteBoundaryGeometry', () => {
  it('gives cyclic and reversed equivalent rings one canonical geometry SHA', () => {
    const first = normalizeSiteBoundaryGeometry('EPSG:4490', square)
    const second = normalizeSiteBoundaryGeometry('EPSG:4490', [[114.01, 30.01], [114.01, 30], [114, 30], [114, 30.01], [114.01, 30.01]])

    expect(second.coordinates).toEqual(first.coordinates)
    expect(second.sha256).toBe(first.sha256)
    expect(first.coordinates).toEqual([[114, 30], [114.01, 30], [114.01, 30.01], [114, 30.01], [114, 30]])
  })

  it('accepts a geometry-only single outer-ring GeoJSON Polygon', () => {
    const geometry = normalizeSiteBoundaryGeometry('EPSG:4326', { type: 'Polygon', coordinates: [square] })

    expect(geometry.source).toBe('geojson')
    expect(geometry.crs).toBe('EPSG:4326')
    expect(geometry.coordinates).toEqual(square)
  })

  it('rejects an open ring', () => {
    expect(() => normalizeSiteBoundaryGeometry('EPSG:4490', [[114, 30], [114.01, 30], [114, 30.01]])).toThrow('SITE_BOUNDARY_GEOMETRY_UNCLOSED')
  })

  it('rejects non-finite coordinates', () => {
    expect(() => normalizeSiteBoundaryGeometry('EPSG:4490', [[114, 30], [Infinity, 30], [114, 30.01], [114, 30]])).toThrow('SITE_BOUNDARY_GEOMETRY_NON_FINITE')
    expect(() => normalizeSiteBoundaryGeometry('EPSG:4490', [[114, 30], [Number.NaN, 30], [114, 30.01], [114, 30]])).toThrow('SITE_BOUNDARY_GEOMETRY_NON_FINITE')
  })

  it('removes consecutive duplicates and normalizes negative zero before hashing', () => {
    const normalized = normalizeSiteBoundaryGeometry('EPSG:4490', [[-0, -0], [114, 30], [114, 30], [114.01, 30], [114, 30.01], [-0, -0]])

    expect(normalized.coordinates).toEqual([[0, 0], [114, 30], [114.01, 30], [114, 30.01], [0, 0]])
    expect(normalized.sha256).toMatch(/^[a-f0-9]{64}$/u)
  })

  it('rejects fewer than three distinct points after normalization', () => {
    expect(() => normalizeSiteBoundaryGeometry('EPSG:4490', [[114, 30], [114.01, 30], [114, 30], [114, 30]])).toThrow('SITE_BOUNDARY_GEOMETRY_TOO_FEW_DISTINCT_POINTS')
  })

  it('rejects a zero-area ring', () => {
    expect(() => normalizeSiteBoundaryGeometry('EPSG:4490', [[114, 30], [114.01, 30], [114.02, 30], [114, 30]])).toThrow('SITE_BOUNDARY_GEOMETRY_ZERO_AREA')
  })

  it('rejects a self-intersecting polygon including touch and collinear overlap', () => {
    expect(() => normalizeSiteBoundaryGeometry('EPSG:4490', [[114, 30], [114.02, 30.02], [114, 30.02], [114.02, 30], [114, 30]])).toThrow('SITE_BOUNDARY_GEOMETRY_SELF_INTERSECTION')
    expect(() => normalizeSiteBoundaryGeometry('EPSG:4490', [[0, 0], [3, 0], [3, 3], [0, 3], [3, 0], [0, 0]])).toThrow('SITE_BOUNDARY_GEOMETRY_SELF_INTERSECTION')
    expect(() => normalizeSiteBoundaryGeometry('EPSG:3857', [[0, 0], [6, 0], [6, 6], [0, 6], [0, 4], [4, 4], [4, 5], [1, 5], [1, 4], [5, 4], [0, 0]])).toThrow('SITE_BOUNDARY_GEOMETRY_SELF_INTERSECTION')
  })

  it('allows the adjacent first and last edges of a simple polygon', () => {
    expect(normalizeSiteBoundaryGeometry('EPSG:4490', square).coordinates).toHaveLength(5)
  })

  it('rejects more than 5000 effective open vertices before geometric analysis', () => {
    const ring = Array.from({ length: 5001 }, (_, index) => [index, index % 2] as const)
    const closed = [...ring, ring[0]!]

    expect(() => normalizeSiteBoundaryGeometry('EPSG:3857', closed)).toThrow('SITE_BOUNDARY_GEOMETRY_TOO_MANY_VERTICES')
  })

  it('counts effective vertices after removing raw consecutive duplicates and the closing point', () => {
    const repeated = Array.from({ length: 6000 }, () => [1, 0] as const)
    const normalized = normalizeSiteBoundaryGeometry('EPSG:3857', [[0, 0], ...repeated, [1, 1], [0, 0]])

    expect(normalized.coordinates).toEqual([[0, 0], [1, 0], [1, 1], [0, 0]])
  })

  it('enforces longitude and latitude ranges only for EPSG:4326 and EPSG:4490', () => {
    expect(() => normalizeSiteBoundaryGeometry('EPSG:4326', [[181, 0], [179, 1], [179, 0], [181, 0]])).toThrow('SITE_BOUNDARY_GEOMETRY_COORDINATE_RANGE')
    expect(() => normalizeSiteBoundaryGeometry('EPSG:4490', [[114, 91], [115, 89], [114, 89], [114, 91]])).toThrow('SITE_BOUNDARY_GEOMETRY_COORDINATE_RANGE')
    expect(normalizeSiteBoundaryGeometry('EPSG:3857', [[20000000, 0], [20000001, 0], [20000000, 1], [20000000, 0]])).toMatchObject({ crs: 'EPSG:3857' })
  })

  it('rejects an invalid or unknown CRS identifier', () => {
    expect(() => normalizeSiteBoundaryGeometry('EPSG:0', square)).toThrow('SITE_BOUNDARY_CRS_INVALID')
    expect(() => normalizeSiteBoundaryGeometry('WGS84', square)).toThrow('SITE_BOUNDARY_CRS_INVALID')
  })

  it('rejects FeatureCollection, MultiPolygon, and polygon holes', () => {
    expect(() => normalizeSiteBoundaryGeometry('EPSG:4490', { type: 'Feature', geometry: { type: 'Polygon', coordinates: [square] } })).toThrow('SITE_BOUNDARY_GEOMETRY_GEOJSON_UNSUPPORTED')
    expect(() => normalizeSiteBoundaryGeometry('EPSG:4490', { type: 'FeatureCollection', features: [] })).toThrow('SITE_BOUNDARY_GEOMETRY_GEOJSON_UNSUPPORTED')
    expect(() => normalizeSiteBoundaryGeometry('EPSG:4490', { type: 'MultiPolygon', coordinates: [[square]] })).toThrow('SITE_BOUNDARY_GEOMETRY_GEOJSON_UNSUPPORTED')
    expect(() => normalizeSiteBoundaryGeometry('EPSG:4490', { type: 'Polygon', coordinates: [square, square] })).toThrow('SITE_BOUNDARY_GEOMETRY_GEOJSON_UNSUPPORTED')
  })

  it('rejects malformed coordinate tuples', () => {
    expect(() => normalizeSiteBoundaryGeometry('EPSG:3857', [[0, 0], [1, 0, 9], [1, 1], [0, 0]])).toThrow('SITE_BOUNDARY_GEOMETRY_INVALID')
    expect(() => normalizeSiteBoundaryGeometry('EPSG:3857', [[0, 0], ['1', 0], [1, 1], [0, 0]])).toThrow('SITE_BOUNDARY_GEOMETRY_INVALID')
    expect(() => normalizeSiteBoundaryGeometry('EPSG:3857', [[0, 0], [{ x: 1 }, 0], [1, 1], [0, 0]])).toThrow('SITE_BOUNDARY_GEOMETRY_INVALID')
  })

  it('keeps extreme finite forward and reversed rings canonical without numeric drift', () => {
    const high = Number.MAX_VALUE
    const low = high / 2
    const forward = normalizeSiteBoundaryGeometry('EPSG:3857', [[low, low], [high, low], [high, high], [low, high], [low, low]])
    const reversed = normalizeSiteBoundaryGeometry('EPSG:3857', [[low, low], [low, high], [high, high], [high, low], [low, low]])
    const tiny = Number.MIN_VALUE
    const tinyForward = normalizeSiteBoundaryGeometry('EPSG:3857', [[tiny, tiny], [tiny * 2, tiny], [tiny * 2, tiny * 2], [tiny, tiny * 2], [tiny, tiny]])
    const tinyReversed = normalizeSiteBoundaryGeometry('EPSG:3857', [[tiny, tiny], [tiny, tiny * 2], [tiny * 2, tiny * 2], [tiny * 2, tiny], [tiny, tiny]])

    expect(reversed.coordinates).toEqual(forward.coordinates)
    expect(reversed.sha256).toBe(forward.sha256)
    expect(tinyReversed.coordinates).toEqual(tinyForward.coordinates)
    expect(tinyReversed.sha256).toBe(tinyForward.sha256)
  })
})
