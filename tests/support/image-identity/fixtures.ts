import { encode } from 'jpeg-js'
import { PNG } from 'pngjs'

export interface FixtureRaster { width: number; height: number; data: Buffer }

/** Preserves the original pipeline regression fixture: independent pixel noise with the same average palette. */
export function noise(index = 0, width = 1024, height = 768): FixtureRaster {
  const data = Buffer.alloc(width * height * 4)
  let seed = 17 + index * 137
  for (let offset = 0; offset < data.length; offset += 4) {
    seed = Math.imul(seed, 1664525) + 1013904223
    data[offset] = seed >>> 24; data[offset + 1] = (seed >>> 12) & 255
    data[offset + 2] = (seed >>> 3) & 255; data[offset + 3] = 255
  }
  return { width, height, data }
}

/** Two seeds share a palette and subject vocabulary, but move every physical feature. */
export function scene(seed = 7, width = 256, height = 192): FixtureRaster {
  const data = Buffer.alloc(width * height * 4)
  let state = seed
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 0x100000000 }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const p = (y * width + x) * 4
    const variation = 16 * Math.sin(x / 13 + seed) * Math.cos(y / 9 + seed / 2) + (random() - 0.5) * 12
    const sky = y < height * 0.36
    data[p] = (sky ? 110 : 72) + variation + x / width * 24
    data[p + 1] = (sky ? 170 : 116) + variation + y / height * 34
    data[p + 2] = (sky ? 199 : 67) + variation
    data[p + 3] = 255
  }
  const rectangle = (x: number, y: number, w: number, h: number, rgb: readonly number[]) => {
    for (let yy = Math.max(0, y); yy < Math.min(height, y + h); yy++) for (let xx = Math.max(0, x); xx < Math.min(width, x + w); xx++) {
      const p = (yy * width + xx) * 4
      data[p] = rgb[0]!; data[p + 1] = rgb[1]!; data[p + 2] = rgb[2]!
    }
  }
  for (let i = 0; i < 38; i++) {
    const x = Math.floor(random() * (width - 20)), y = Math.floor(random() * (height - 28))
    const w = 8 + Math.floor(random() * 20), h = 10 + Math.floor(random() * 26)
    rectangle(x, y, w, h, [40 + random() * 150, 65 + random() * 110, 35 + random() * 130])
    rectangle(x + 2, y + 3, Math.max(2, w - 5), 3, [215, 201, 153])
  }
  return { width, height, data }
}

export function png(raster: FixtureRaster, deflateLevel = 9): Buffer {
  const image = new PNG({ width: raster.width, height: raster.height })
  image.data = raster.data
  return PNG.sync.write(image, { deflateLevel })
}

export function jpeg(raster: FixtureRaster, quality = 76): Buffer {
  return Buffer.from(encode(raster, quality).data)
}

export function crop(raster: FixtureRaster, x: number, y: number, width: number, height: number): FixtureRaster {
  const data = Buffer.alloc(width * height * 4)
  for (let row = 0; row < height; row++) {
    raster.data.copy(data, row * width * 4, ((y + row) * raster.width + x) * 4, ((y + row) * raster.width + x + width) * 4)
  }
  return { width, height, data }
}

/** Independent nearest-neighbour transform, deliberately unlike the production area sampler. */
export function resize(raster: FixtureRaster, width: number, height: number): FixtureRaster {
  const data = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const source = (Math.min(raster.height - 1, Math.floor((y + 0.5) * raster.height / height)) * raster.width
      + Math.min(raster.width - 1, Math.floor((x + 0.5) * raster.width / width))) * 4
    raster.data.copy(data, (y * width + x) * 4, source, source + 4)
  }
  return { width, height, data }
}

export function annotated(raster: FixtureRaster): FixtureRaster {
  const data = Buffer.from(raster.data)
  // Opaque caption bar and isolated white annotation strokes occupy under 10% of the image.
  for (let y = raster.height - 15; y < raster.height - 3; y++) for (let x = 20; x < raster.width - 20; x++) {
    const p = (y * raster.width + x) * 4
    data[p] = 20; data[p + 1] = 20; data[p + 2] = 20
  }
  for (let x = 31; x < raster.width - 31; x += 9) for (let y = raster.height - 12; y < raster.height - 6; y++) {
    const p = (y * raster.width + x) * 4
    data[p] = 245; data[p + 1] = 245; data[p + 2] = 245
  }
  return { width: raster.width, height: raster.height, data }
}

export function solid(level: number): FixtureRaster {
  const data = Buffer.alloc(96 * 72 * 4, level)
  for (let p = 3; p < data.length; p += 4) data[p] = 255
  return { width: 96, height: 72, data }
}
