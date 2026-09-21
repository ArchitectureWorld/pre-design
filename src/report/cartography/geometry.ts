import type { AnalysisCoordinate, MapViewport, Wgs84Point } from './types.ts'

const EARTH_RADIUS = 6371008.8
const MERCATOR_RADIUS = 6378137
const radians = (degrees: number) => degrees * Math.PI / 180
const degrees = (radians: number) => radians * 180 / Math.PI

export function toWgs84(coordinate: AnalysisCoordinate): Wgs84Point {
  if (!coordinate || !Number.isFinite(coordinate.longitude) || !Number.isFinite(coordinate.latitude)) throw new Error('COORDINATE_INVALID')
  let { longitude, latitude } = coordinate
  if (coordinate.crs === 'EPSG:3857') {
    if (Math.abs(longitude) > 20037508.343 || Math.abs(latitude) > 20037508.343) throw new Error('COORDINATE_INVALID')
    longitude = Number(degrees(longitude / MERCATOR_RADIUS).toFixed(12))
    latitude = Number(degrees(2 * Math.atan(Math.exp(latitude / MERCATOR_RADIUS)) - Math.PI / 2).toFixed(12))
  } else if (coordinate.crs !== 'EPSG:4326' && coordinate.crs !== 'WGS84') {
    // GCJ-02 / BD-09 are deliberately not silently approximated as WGS84.
    throw new Error('CRS_UNSUPPORTED')
  }
  if (Math.abs(longitude) > 180 || Math.abs(latitude) > 85.05112878) throw new Error('COORDINATE_INVALID')
  return { longitude, latitude }
}

export function geodesicDistanceMeters(a: Wgs84Point, b: Wgs84Point): number {
  const dLat = radians(b.latitude - a.latitude), dLon = radians(b.longitude - a.longitude)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))))
}

export function geodesicRing(center: Wgs84Point, distanceMeters: number): Wgs84Point[] {
  const angle = distanceMeters / EARTH_RADIUS, lat = radians(center.latitude), lon = radians(center.longitude)
  return Array.from({ length: 73 }, (_, index) => {
    const bearing = radians(index * 5)
    const y = Math.asin(Math.sin(lat) * Math.cos(angle) + Math.cos(lat) * Math.sin(angle) * Math.cos(bearing))
    const x = lon + Math.atan2(Math.sin(bearing) * Math.sin(angle) * Math.cos(lat), Math.cos(angle) - Math.sin(lat) * Math.sin(y))
    return { longitude: ((degrees(x) + 540) % 360) - 180, latitude: degrees(y) }
  })
}

export function worldPixel(point: Wgs84Point, zoom: number): { x: number; y: number } {
  const size = 256 * 2 ** zoom, sine = Math.sin(radians(point.latitude))
  return { x: (point.longitude + 180) / 360 * size, y: (0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI)) * size }
}

function worldCoordinate(x: number, y: number, zoom: number): Wgs84Point {
  const size = 256 * 2 ** zoom
  return { longitude: x / size * 360 - 180, latitude: degrees(Math.atan(Math.sinh(Math.PI * (1 - 2 * y / size)))) }
}

export function fitViewport(points: readonly Wgs84Point[], width = 1280, height = 800): MapViewport {
  if (!points.length) throw new Error('MAP_EXTENT_EMPTY')
  const minLon = Math.min(...points.map(point => point.longitude)), maxLon = Math.max(...points.map(point => point.longitude))
  if (maxLon - minLon > 180) throw new Error('ANTIMERIDIAN_EXTENT_UNSUPPORTED')
  const pixels = points.map(point => worldPixel(point, 0))
  const left = Math.min(...pixels.map(point => point.x)), right = Math.max(...pixels.map(point => point.x))
  const top = Math.min(...pixels.map(point => point.y)), bottom = Math.max(...pixels.map(point => point.y))
  const zoom = Math.max(1, Math.min(16, Math.floor(Math.log2(Math.min((width - 150) / Math.max(right - left, 0.00001), (height - 150) / Math.max(bottom - top, 0.00001))))))
  const size = 256 * 2 ** zoom
  const worldLeft = Math.round((left + right) / 2 * 2 ** zoom - width / 2)
  const worldTop = Math.round((top + bottom) / 2 * 2 ** zoom - height / 2)
  if (worldLeft < 0 || worldLeft + width > size || worldTop < 0 || worldTop + height > size) throw new Error('MAP_EXTENT_UNSUPPORTED')
  const northwest = worldCoordinate(worldLeft, worldTop, zoom), southeast = worldCoordinate(worldLeft + width, worldTop + height, zoom)
  return { width, height, zoom, west: northwest.longitude, north: northwest.latitude, east: southeast.longitude, south: southeast.latitude,
    worldLeft, worldTop, centerLatitude: worldCoordinate(worldLeft + width / 2, worldTop + height / 2, zoom).latitude }
}

export function mapPixel(point: Wgs84Point, viewport: MapViewport): { x: number; y: number } {
  const pixel = worldPixel(point, viewport.zoom)
  return { x: pixel.x - viewport.worldLeft, y: pixel.y - viewport.worldTop }
}

export function scaleBar(viewport: MapViewport): { meters: number; pixels: number; label: string; latitude: number } {
  const latitude = worldCoordinate(viewport.worldLeft + 40, viewport.worldTop + viewport.height - 40, viewport.zoom).latitude
  const metersPerPixel = Math.cos(radians(latitude)) * 2 * Math.PI * MERCATOR_RADIUS / (256 * 2 ** viewport.zoom)
  const target = metersPerPixel * 170
  const magnitude = 10 ** Math.floor(Math.log10(target))
  const meters = [5, 2, 1].map(value => value * magnitude).find(value => value <= target) ?? magnitude / 2
  return { meters, pixels: meters / metersPerPixel, label: meters >= 1000 ? `${meters / 1000} 公里` : `${meters} 米`, latitude }
}
