import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import sharp from 'sharp'
import { localizeImageLegend, prepareLocalizedLegendMaterial, verifyLocalizedLegendMaterial, type ImageLegendLocalization } from '../src/visual/image-legend-localization.ts'
import type { PresentationAdoptedAssetInput } from '../src/presentation/standard-project-types.ts'
import { VERIFIED_CASE_STUDIES } from '../src/report/case-studies/catalog.ts'
import { BUNDLED_CASE_STUDY_IMAGES } from '../src/report/case-studies/catalog-images.ts'
import { ImageIdentityIndex } from '../src/visual/image-identity.ts'

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
async function source() {
  const pixels = Buffer.alloc(800 * 600 * 3, 255)
  for (let y = 100; y < 400; y++) for (let x = 100; x < 700; x++) {
    const at = (y * 800 + x) * 3; pixels[at] = 20; pixels[at + 1] = 60; pixels[at + 2] = 30
  }
  return sharp(pixels, { raw: { width: 800, height: 600, channels: 3 } }).png().toBuffer()
}
const spec = (bytes: Uint8Array): ImageLegendLocalization => ({ version: 'source-legend-zh-v1', sourceSha256: sha(bytes),
  width: 800, height: 600, regions: [{ x: 0, y: 500, width: 500, height: 90, lines: [
    { sourceText: '1 休息区 Rest Area', chineseText: '1 休息区' },
    { sourceText: '2 步道 Walkway', chineseText: '2 步道' },
  ] }] })

it('replaces only the recorded legend, retains every pixel outside it, and is deterministic', async () => {
  const bytes = await source(), definition = spec(bytes), output = await localizeImageLegend(bytes, definition)
  const before = await sharp(bytes).ensureAlpha().raw().toBuffer(), after = await sharp(output.bytes).ensureAlpha().raw().toBuffer()
  expect(output.sha256).not.toBe(sha(bytes))
  expect(output.sha256).toBe((await localizeImageLegend(bytes, definition)).sha256)
  expect(after.length).toBe(before.length)
  let changed = 0, outsideChanged = 0
  for (let y = 0; y < 600; y++) for (let x = 0; x < 800; x++) {
    const i = (y * 800 + x) * 4, same = before.subarray(i, i + 4).equals(after.subarray(i, i + 4))
    if (x < 500 && y >= 500 && y < 590) { if (!same) changed++ }
    else if (!same) outsideChanged++
  }
  expect(changed).toBeGreaterThan(50)
  expect(outsideChanged).toBe(0)
  expect(output.sourceSha256).toBe(sha(bytes))
})

it('keeps localized publisher drawings in their original family without inheriting inspection approval', async () => {
  const root = await mkdtemp(join(tmpdir(), 'case-legend-'))
  try {
    for (const original of VERIFIED_CASE_STUDIES.flatMap(row => row.gallery ?? []).filter(image => image.legendLocalization)) {
      const bytes = Buffer.from(BUNDLED_CASE_STUDY_IMAGES[original.sha256]!, 'base64'), sourcePath = join(root, `${original.sha256}.jpg`)
      await writeFile(sourcePath, bytes)
      const sourceMaterial = { sourceKey: 'source', sourcePath, aliases: ['case-photo'], mimeType: 'image/jpeg',
        origin: { type: 'human_added', method: JSON.stringify({ kind: 'case-reference', sourcePageUrl: original.sourcePageUrl }), parentAssetKeys: [] },
        imageQuality: { inspection: { decision: 'approved' } } } as unknown as PresentationAdoptedAssetInput
      const derived = await prepareLocalizedLegendMaterial(sourceMaterial, original.legendLocalization!, root)
      expect(derived.imageQuality?.inspection).toBeUndefined()
      expect(derived.origin.parentAssetKeys).toEqual(['source'])
      expect(derived.aliases).toContain('case-photo')
      expect(await verifyLocalizedLegendMaterial(derived)).toBe(true)
      expect(sha(await readFile(sourcePath))).toBe(original.sha256)
      const index = new ImageIdentityIndex(), parent = index.identify({ bytes, mimeType: 'image/jpeg' })
      const child = index.identify({ bytes: await readFile(derived.sourcePath), mimeType: 'image/png', derivedFromSha256: original.sha256 })
      expect(child.status).toBe('identified')
      expect(child.identity?.originalId).toBe(parent.identity?.originalId)
      await writeFile(derived.sourcePath, Buffer.from('altered-output'))
      expect(await verifyLocalizedLegendMaterial(derived)).toBe(false)
      const restored = await prepareLocalizedLegendMaterial(sourceMaterial, original.legendLocalization!, root)
      await writeFile(sourcePath, Buffer.from('altered-source'))
      expect(await verifyLocalizedLegendMaterial(restored)).toBe(false)
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('rejects changed originals, broad image masks and untranslated or unsupported replacement labels', async () => {
  const bytes = await source(), definition = spec(bytes)
  await expect(localizeImageLegend(Buffer.from('changed'), definition)).rejects.toThrow('LEGEND_SOURCE_CHANGED')
  await expect(localizeImageLegend(bytes, { ...definition, regions: [{ ...definition.regions[0]!, height: 120 }] })).rejects.toThrow('LEGEND_REGION_INVALID')
  await expect(localizeImageLegend(bytes, { ...definition, regions: [{ ...definition.regions[0]!, x: 0, y: 0, width: 800, height: 400 }] })).rejects.toThrow('LEGEND_AREA_EXCEEDED')
  for (const chineseText of ['Rest Area', '3 新增茶室']) {
    await expect(localizeImageLegend(bytes, { ...definition, regions: [{ ...definition.regions[0]!, lines: [{ sourceText: '1 休息区 Rest Area', chineseText }] }] })).rejects.toThrow('LEGEND_TRANSCRIPTION_INVALID')
  }
})
