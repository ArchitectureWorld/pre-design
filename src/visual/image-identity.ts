import { createHash } from 'node:crypto'
import { setImmediate as yieldImmediate } from 'node:timers/promises'
import { decode } from 'jpeg-js'
import { PNG } from 'pngjs'
import { verifiedRasterImageDimensions } from '../governance/site-boundary-asset-store.ts'
import type { ImageBounds, OriginalImageIdentity } from './image-policy.ts'

export interface ImageIdentityInput {
  readonly bytes: Uint8Array
  readonly mimeType: 'image/png' | 'image/jpeg' | 'image/webp'
  /** Claimed provenance is corroborated against decoded pixels before it can join a family. */
  readonly derivedFromSha256?: string
}

export interface ImageIdentityCandidate {
  readonly originalId: string
  readonly sourceSha256: string
  readonly kind: 'resized-or-recompressed' | 'crop' | 'annotation' | 'declared-derivative'
  readonly confirmed: boolean
  readonly similarity: number
  readonly matchedPixelFraction: number
  readonly meanPixelError: number
  /** Normalized bounds in the existing source, when the input is a crop. */
  readonly sourceBounds?: ImageBounds
  /** Present instead when the existing source is a crop of the input. */
  readonly inputBounds?: ImageBounds
}

export interface ImageIdentityResult {
  readonly status: 'identified' | 'ambiguous' | 'rejected'
  readonly identity?: OriginalImageIdentity
  readonly candidates: readonly ImageIdentityCandidate[]
  readonly reason?: 'invalid-image' | 'image-too-large' | 'decoder-required' | 'insufficient-detail' | 'unverified-derivation' | 'similarity-requires-review' | 'conflicting-families' | 'index-capacity'
  readonly width?: number
  readonly height?: number
}

const MAX_BYTES = 32 * 1024 * 1024
const MAX_PIXELS = 32 * 1024 * 1024
const MAX_REFERENCES = 256
const RASTER_EDGE = 128
const FINE_GRID = 32
const COARSE_GRID = 8

interface Raster { readonly width: number; readonly height: number; readonly integral: Float32Array }
interface Pixels { readonly width: number; readonly height: number; readonly data: Uint8Array }
interface Entry {
  readonly identity: OriginalImageIdentity
  readonly width: number
  readonly height: number
  readonly decodedSha256: string
  readonly raster: Raster
  readonly samples: Float32Array
  readonly coarse: Float32Array
}
interface Measurement {
  readonly mean: number
  readonly fraction: number
  readonly score: number
  readonly confirmed: boolean
  readonly candidate: boolean
  readonly annotation: boolean
}
interface CropMatch { readonly bounds: ImageBounds; readonly measurement: Measurement }
interface SampleBuffer { readonly values: Float32Array; readonly corners: Float64Array }
const fullBounds: ImageBounds = { x: 0, y: 0, width: 1, height: 1 }
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

function decodePixels(input: ImageIdentityInput): Pixels {
  // Container validation is useful, but unlike a header check it is followed by real pixel decoding.
  let bytes = Buffer.from(input.bytes.buffer, input.bytes.byteOffset, input.bytes.byteLength)
  if (input.mimeType === 'image/jpeg') {
    let end = bytes.length
    while (end > 2 && bytes[end - 1] === 0) end--
    bytes = bytes.subarray(0, end)
  }
  if (input.mimeType === 'image/png' && bytes.length >= 24
    && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    && bytes.readUInt32BE(16) * bytes.readUInt32BE(20) > MAX_PIXELS) throw new Error('image-too-large')
  const dimensions = verifiedRasterImageDimensions(input.mimeType, bytes)
  if (dimensions.width * dimensions.height > MAX_PIXELS) throw new Error('image-too-large')
  const decoded = input.mimeType === 'image/png'
    ? PNG.sync.read(bytes, { checkCRC: true })
    : decode(bytes, { tolerantDecoding: false, useTArray: true, maxResolutionInMP: 32, maxMemoryUsageInMB: 256 })
  if (decoded.width !== dimensions.width || decoded.height !== dimensions.height
    || decoded.data.length !== dimensions.width * dimensions.height * 4) throw new Error('invalid-image')
  return decoded
}

/** Area sampling preserves spatial colour information across different resize filters. */
function comparisonRaster(pixels: Pixels): Raster {
  const scale = Math.min(1, RASTER_EDGE / Math.max(pixels.width, pixels.height))
  const width = Math.max(1, Math.round(pixels.width * scale)), height = Math.max(1, Math.round(pixels.height * scale))
  const integral = new Float32Array((width + 1) * (height + 1) * 3)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const left = x * pixels.width / width, right = (x + 1) * pixels.width / width
    const top = y * pixels.height / height, bottom = (y + 1) * pixels.height / height
    const sums = [0, 0, 0]
    for (let yy = Math.floor(top); yy < Math.ceil(bottom); yy++) for (let xx = Math.floor(left); xx < Math.ceil(right); xx++) {
      const weight = (Math.min(right, xx + 1) - Math.max(left, xx)) * (Math.min(bottom, yy + 1) - Math.max(top, yy))
      const p = (yy * pixels.width + xx) * 4, alpha = pixels.data[p + 3]! / 255
      for (let c = 0; c < 3; c++) sums[c] = sums[c]! + (pixels.data[p + c]! * alpha + 255 * (1 - alpha)) * weight
    }
    const area = (right - left) * (bottom - top), stride = (width + 1) * 3, p = ((y + 1) * (width + 1) + x + 1) * 3
    for (let c = 0; c < 3; c++) integral[p + c] = sums[c]! / area + integral[p + c - 3]! + integral[p + c - stride]! - integral[p + c - stride - 3]!
  }
  return { width, height, integral }
}

function sampleBuffer(grid: number): SampleBuffer {
  return { values: new Float32Array(grid * grid * 3), corners: new Float64Array((grid + 1) * (grid + 1) * 3) }
}

function samples(raster: Raster, bounds: ImageBounds, grid: number, buffer = sampleBuffer(grid)): Float32Array {
  const { values, corners } = buffer, stride = (grid + 1) * 3
  // Adjacent cells use the same integral corners. Float64 preserves the original
  // interpolation arithmetic before the final Float32 sample assignment.
  for (let y = 0; y <= grid; y++) for (let x = 0; x <= grid; x++) {
    const xx = (bounds.x + bounds.width * x / grid) * raster.width, yy = (bounds.y + bounds.height * y / grid) * raster.height
    const left = Math.min(raster.width, Math.max(0, Math.floor(xx))), top = Math.min(raster.height, Math.max(0, Math.floor(yy)))
    const right = Math.min(raster.width, left + 1), bottom = Math.min(raster.height, top + 1)
    const dx = Math.max(0, Math.min(1, xx - left)), dy = Math.max(0, Math.min(1, yy - top))
    const a = (top * (raster.width + 1) + left) * 3, b = (top * (raster.width + 1) + right) * 3
    const c = (bottom * (raster.width + 1) + left) * 3, d = (bottom * (raster.width + 1) + right) * 3
    const p = (y * (grid + 1) + x) * 3
    for (let channel = 0; channel < 3; channel++) corners[p + channel] =
      raster.integral[a + channel]! * (1 - dx) * (1 - dy) + raster.integral[b + channel]! * dx * (1 - dy)
      + raster.integral[c + channel]! * (1 - dx) * dy + raster.integral[d + channel]! * dx * dy
  }
  for (let y = 0; y < grid; y++) for (let x = 0; x < grid; x++) {
    const left = (bounds.x + bounds.width * x / grid) * raster.width, right = (bounds.x + bounds.width * (x + 1) / grid) * raster.width
    const top = (bounds.y + bounds.height * y / grid) * raster.height, bottom = (bounds.y + bounds.height * (y + 1) / grid) * raster.height
    const p = (y * (grid + 1) + x) * 3
    for (let c = 0; c < 3; c++) values[(y * grid + x) * 3 + c] = (corners[p + stride + 3 + c]!
      - corners[p + stride + c]! - corners[p + 3 + c]! + corners[p + c]!) / ((right - left) * (bottom - top))
  }
  return values
}

/** Coarse ranking uses only this score, never the confirmation/structure fields. */
function coarseScore(a: Float32Array, b: Float32Array, errors: Float64Array, ceiling: number): number {
  const count = errors.length, retained = Math.ceil(count * 0.86), discarded = count - retained
  let sum = 0, largest = 0, unmatched = 0
  for (let i = 0; i < count; i++) {
    const p = i * 3
    const error = (Math.abs(a[p]! - b[p]!) + Math.abs(a[p + 1]! - b[p + 1]!) + Math.abs(a[p + 2]! - b[p + 2]!)) / 3
    errors[i] = error; sum += error; largest = Math.max(largest, error)
    if (error > 8) unmatched++
    // Even discarding the largest possible errors seen so far cannot reduce
    // the final trimmed sum below this bound. Unseen errors are nonnegative.
    // The margin keeps floating-point rounding at the bound conservative.
    const lowerBound = Math.max(0, sum - discarded * largest) / retained + unmatched / count * 10
    if (lowerBound > ceiling + 1e-9) return Infinity
  }
  errors.sort()
  let trimmed = 0
  for (let i = 0; i < retained; i++) trimmed += errors[i]!
  return trimmed / retained + (1 - (count - unmatched) / count) * 10
}

/** Averaging unrelated fine textures can produce almost identical grey thumbnails.
 * Confirmation needs correlated spatial deviations from each channel's own mean,
 * with enough retained contrast to make that correlation informative. */
function hasMatchingStructure(a: Float32Array, b: Float32Array): boolean {
  const sumA = [0, 0, 0], sumB = [0, 0, 0], squareA = [0, 0, 0], squareB = [0, 0, 0], products = [0, 0, 0]
  let retained = 0
  for (let p = 0; p < a.length; p += 3) {
    const error = (Math.abs(a[p]! - b[p]!) + Math.abs(a[p + 1]! - b[p + 1]!) + Math.abs(a[p + 2]! - b[p + 2]!)) / 3
    if (error > 8) continue // The existing coverage/bounds checks separately constrain annotation outliers.
    retained++
    for (let c = 0; c < 3; c++) {
      const x = a[p + c]!, y = b[p + c]!
      sumA[c] = sumA[c]! + x; sumB[c] = sumB[c]! + y
      squareA[c] = squareA[c]! + x * x; squareB[c] = squareB[c]! + y * y
      products[c] = products[c]! + x * y
    }
  }
  if (retained === 0) return false
  let varianceA = 0, varianceB = 0, covariance = 0
  for (let c = 0; c < 3; c++) {
    varianceA += squareA[c]! - sumA[c]! * sumA[c]! / retained
    varianceB += squareB[c]! - sumB[c]! * sumB[c]! / retained
    covariance += products[c]! - sumA[c]! * sumB[c]! / retained
  }
  return Math.min(varianceA, varianceB) >= retained * 3 * 8 ** 2
    && covariance / Math.sqrt(varianceA * varianceB) >= 0.97
}

function measure(a: Float32Array, b: Float32Array, grid: number): Measurement {
  const errors: number[] = []
  let matched = 0, informative = 0, informativeMatched = 0, variation = 0
  let minX = grid, minY = grid, maxX = -1, maxY = -1
  for (let y = 0; y < grid; y++) for (let x = 0; x < grid; x++) {
    const p = (y * grid + x) * 3
    const error = (Math.abs(a[p]! - b[p]!) + Math.abs(a[p + 1]! - b[p + 1]!) + Math.abs(a[p + 2]! - b[p + 2]!)) / 3
    const adjacent = x + 1 < grid ? p + 3 : p - 3
    const detail = (Math.abs(a[p]! - a[adjacent]!) + Math.abs(a[p + 1]! - a[adjacent + 1]!) + Math.abs(a[p + 2]! - a[adjacent + 2]!)) / 3
    variation += detail
    if (detail >= 3) { informative++; if (error <= 8) informativeMatched++ }
    if (error <= 8) matched++
    else { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y) }
    errors.push(error)
  }
  errors.sort((x, y) => x - y)
  const count = errors.length, retained = Math.ceil(count * 0.86)
  const mean = errors.reduce((sum, error) => sum + error, 0) / count
  const trimmed = errors.slice(0, retained).reduce((sum, error) => sum + error, 0) / retained
  const fraction = matched / count, detailedFraction = informativeMatched / Math.max(1, informative)
  const distinctive = informative >= count * 0.12 && variation / count >= 1.7
  const outlierBoundsArea = maxX < 0 ? 0 : (maxX - minX + 1) * (maxY - minY + 1) / count
  const annotation = fraction < 0.965 && fraction >= 0.85 && outlierBoundsArea <= 0.24 && detailedFraction >= 0.80
  const confirmed = distinctive && trimmed <= 2.7
    && ((fraction >= 0.965 && detailedFraction >= 0.91 && mean <= 3.4) || annotation)
    && hasMatchingStructure(a, b)
  return {
    mean, fraction, confirmed, annotation,
    score: trimmed + (1 - fraction) * 10,
    candidate: confirmed || (trimmed <= 7 && fraction >= 0.68 && (!distinctive || detailedFraction >= 0.50)),
  }
}

/** Bounded coarse-to-fine search. Similar average colours only rank candidates; they never confirm one. */
function findCrop(source: Entry, target: Entry): CropMatch | undefined {
  const widthRatio = target.width / target.height * source.height / source.width
  const maximumWidth = Math.min(1, widthRatio), minimumWidth = Math.max(0.12, 12 / source.raster.width)
  if (maximumWidth < minimumWidth) return undefined
  const widths = new Set<number>([maximumWidth, Math.min(maximumWidth, target.width / source.width)])
  for (let width = maximumWidth; width >= minimumWidth; width -= maximumWidth / 16) widths.add(width)
  let ranked: { bounds: ImageBounds; score: number }[] = []
  const buffer = sampleBuffer(COARSE_GRID), errors = new Float64Array(COARSE_GRID * COARSE_GRID)
  const keep = (bounds: ImageBounds) => {
    if (bounds.width < minimumWidth || bounds.height < 12 / source.raster.height || bounds.x < 0 || bounds.y < 0
      || bounds.x + bounds.width > 1.000001 || bounds.y + bounds.height > 1.000001) return
    const score = coarseScore(samples(source.raster, bounds, COARSE_GRID, buffer), target.coarse, errors,
      ranked.length < 4 ? Infinity : ranked.at(-1)!.score)
    if (ranked.length < 4 || score < ranked.at(-1)!.score) {
      ranked.push({ bounds, score }); ranked.sort((a, b) => a.score - b.score); ranked = ranked.slice(0, 4)
    }
  }
  const step = 1 / 20
  for (const width of widths) {
    const height = width / widthRatio
    if (height > 1 || width < minimumWidth) continue
    const nx = Math.max(1, Math.ceil((1 - width) / step)), ny = Math.max(1, Math.ceil((1 - height) / step))
    for (let iy = 0; iy <= ny; iy++) for (let ix = 0; ix <= nx; ix++) keep({ x: ix * (1 - width) / nx, y: iy * (1 - height) / ny, width, height })
  }
  for (let pass = 0; pass < 4; pass++) {
    const previous = ranked, delta = step / 2 ** (pass + 1), widthDelta = maximumWidth / 32 / 2 ** pass
    ranked = []
    for (const candidate of previous) for (const dw of [-widthDelta, 0, widthDelta]) {
      const width = candidate.bounds.width + dw, height = width / widthRatio
      for (const dx of [-delta, 0, delta]) for (const dy of [-delta, 0, delta]) keep({ x: candidate.bounds.x + dx, y: candidate.bounds.y + dy, width, height })
    }
  }
  let best: CropMatch | undefined
  for (const candidate of ranked) {
    // Do not compare an upsampled crop against detail the retained source raster cannot resolve.
    const grid = Math.min(FINE_GRID, Math.max(8, Math.floor(Math.min(
      candidate.bounds.width * source.raster.width, candidate.bounds.height * source.raster.height) / 3)))
    const measurement = measure(samples(source.raster, candidate.bounds, grid),
      grid === FINE_GRID ? target.samples : samples(target.raster, fullBounds, grid), grid)
    if (!measurement.candidate) continue
    // Very small or low-resolution excerpts require human/pixel review even when the template agrees.
    const confirmed = measurement.confirmed && candidate.bounds.width * candidate.bounds.height >= 0.12
      && Math.min(target.width, target.height, source.width * candidate.bounds.width, source.height * candidate.bounds.height) >= 32
    const match = { bounds: candidate.bounds, measurement: { ...measurement, confirmed } }
    if (best === undefined || (confirmed !== best.measurement.confirmed
      ? confirmed : measurement.score < best.measurement.score)) best = match
  }
  return best
}

function comparison(source: Entry, target: Entry): ImageIdentityCandidate | undefined {
  const direct = measure(source.samples, target.samples, FINE_GRID)
  const make = (measurement: Measurement, kind: ImageIdentityCandidate['kind'], bounds?: ImageBounds, reverse = false): ImageIdentityCandidate => ({
    originalId: source.identity.originalId, sourceSha256: source.identity.fileSha256, kind,
    confirmed: measurement.confirmed && Math.min(source.width, source.height, target.width, target.height) >= 32,
    similarity: Math.max(0, 1 - measurement.mean / 255), matchedPixelFraction: measurement.fraction, meanPixelError: measurement.mean,
    ...(bounds === undefined ? {} : reverse ? { inputBounds: bounds } : { sourceBounds: bounds }),
  })
  if (direct.confirmed) return make(direct, direct.annotation ? 'annotation' : 'resized-or-recompressed')
  const forward = findCrop(source, target)
  if (forward?.measurement.confirmed) return make(forward.measurement, 'crop', forward.bounds)
  const reverse = findCrop(target, source)
  if (reverse?.measurement.confirmed) return make(reverse.measurement, 'crop', reverse.bounds, true)
  if (direct.candidate) return make(direct, direct.annotation ? 'annotation' : 'resized-or-recompressed')
  if (forward) return make(forward.measurement, 'crop', forward.bounds)
  if (reverse) return make(reverse.measurement, 'crop', reverse.bounds, true)
  return undefined
}

/**
 * Register original/high-resolution sources before their derivatives where possible.
 * Ambiguous inputs have no allocatable identity and are not retained as trusted references.
 * The index retains only bounded comparison rasters (under 64 MB for 256 references), never source bytes.
 */
export class ImageIdentityIndex {
  private readonly entries: Entry[] = []
  private readonly files = new Map<string, Entry>()
  private readonly decoded = new Map<string, Entry>()

  identify(input: ImageIdentityInput): ImageIdentityResult {
    const steps = this.identifySteps(input)
    for (;;) {
      const step = steps.next()
      if (step.done) return step.value
    }
  }

  /** The same complete search, with a cancellation boundary after each reference comparison. */
  async identifyAsync(input: ImageIdentityInput, signal?: AbortSignal): Promise<ImageIdentityResult> {
    const steps = this.identifySteps(input)
    for (;;) {
      signal?.throwIfAborted()
      const step = steps.next()
      if (step.done) return step.value
      await yieldImmediate(undefined, { signal })
    }
  }

  private *identifySteps(input: ImageIdentityInput): Generator<void, ImageIdentityResult, void> {
    if (input.bytes.byteLength > MAX_BYTES) return { status: 'rejected', reason: 'image-too-large', candidates: [] }
    if (input.mimeType === 'image/webp') return { status: 'rejected', reason: 'decoder-required', candidates: [] }
    let pixels: Pixels
    try { pixels = decodePixels(input) }
    catch (error) { return { status: 'rejected', reason: error instanceof Error && error.message === 'image-too-large' ? 'image-too-large' : 'invalid-image', candidates: [] } }
    const fileSha256 = digest(input.bytes), dimensions = { width: pixels.width, height: pixels.height }
    if (Math.min(pixels.width, pixels.height) < 32) return { status: 'ambiguous', reason: 'insufficient-detail', candidates: [], ...dimensions }
    const fileMatch = this.files.get(fileSha256)
    if (fileMatch) return { status: 'identified', identity: { ...fileMatch.identity, verification: 'file-hash' }, candidates: [], ...dimensions }
    const decodedSha256 = createHash('sha256').update(`${pixels.width}x${pixels.height}:`).update(pixels.data).digest('hex')
    const raster = comparisonRaster(pixels), fine = samples(raster, fullBounds, FINE_GRID), coarse = samples(raster, fullBounds, COARSE_GRID)
    const fingerprint = digest(Uint8Array.from(samples(raster, fullBounds, 16), value => Math.round(value)))
    const identity: OriginalImageIdentity = { originalId: `image:${decodedSha256}`, fileSha256, pixelFingerprint: fingerprint, verification: 'decoded-pixels' }
    const entry: Entry = { ...dimensions, identity, decodedSha256, raster, samples: fine, coarse }
    // No index state changes before the driver has an opportunity to observe cancellation.
    yield
    const exact = this.decoded.get(decodedSha256)
    if (exact) return this.retain({ ...entry, identity: { ...identity, originalId: exact.identity.originalId, derivedFromSha256: exact.identity.fileSha256 } }, [])
    const candidates: ImageIdentityCandidate[] = []
    for (const source of this.entries) {
      const candidate = comparison(source, entry)
      if (candidate !== undefined) candidates.push(candidate)
      yield
    }
    const confirmed = candidates.filter(candidate => candidate.confirmed)
    const families = new Set(confirmed.map(candidate => candidate.originalId))
    if (families.size > 1) return { status: 'ambiguous', reason: 'conflicting-families', candidates, ...dimensions }
    if (input.derivedFromSha256 !== undefined && !confirmed.some(candidate => candidate.sourceSha256 === input.derivedFromSha256)) {
      const claimed = this.files.get(input.derivedFromSha256)
      if (claimed && !candidates.some(candidate => candidate.sourceSha256 === input.derivedFromSha256)) candidates.push({
        originalId: claimed.identity.originalId, sourceSha256: input.derivedFromSha256, kind: 'declared-derivative',
        confirmed: false, similarity: 0, matchedPixelFraction: 0, meanPixelError: 255,
      })
      return { status: 'ambiguous', reason: 'unverified-derivation', candidates, ...dimensions }
    }
    const match = confirmed[0]
    if (match) return this.retain({ ...entry, identity: {
      ...identity, originalId: match.originalId, verification: 'verified-derivative',
      ...(match.inputBounds === undefined ? { derivedFromSha256: match.sourceSha256 } : {}),
    } }, candidates)
    if (candidates.length > 0) return { status: 'ambiguous', reason: 'similarity-requires-review', candidates, ...dimensions }
    return this.retain(entry, [])
  }

  private retain(entry: Entry, candidates: readonly ImageIdentityCandidate[]): ImageIdentityResult {
    if (this.entries.length >= MAX_REFERENCES) return { status: 'rejected', reason: 'index-capacity', candidates, width: entry.width, height: entry.height }
    this.entries.push(entry); this.files.set(entry.identity.fileSha256, entry); this.decoded.set(entry.decodedSha256, entry)
    return { status: 'identified', identity: entry.identity, candidates, width: entry.width, height: entry.height }
  }
}
