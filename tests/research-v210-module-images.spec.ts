import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { captureMaterialCorpus } from '../src/materials/research-evidence.ts'
import { prepareModuleSourceImages } from '../src/research-v2/module-image-context.ts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'module-images-')); roots.push(root)
  for (const [i, name] of ['A/1.jpg', 'A/2.jpg', 'B/1.jpg'].entries()) {
    await mkdir(join(root, '原始资料', name, '..'), { recursive: true })
    await writeFile(join(root, '原始资料', name), await sharp({ create: { width: 20 + i, height: 10, channels: 3, background: '#abc' } }).jpeg().toBuffer())
  }
  return { root, corpus: await captureMaterialCorpus(root), signal: new AbortController().signal }
}
it('keeps source pixels for spatial authors and review while metadata-only photo groups use frozen tags', async () => {
  const imageApi = await import('../src/research-v2/module-image-context.ts') as any
  const { getModuleAuthorFieldGroups } = await import('../src/research-v2/module-author-groups.ts')
  expect(typeof imageApi.moduleGroupUsesSourceImages).toBe('function')
  const groups = getModuleAuthorFieldGroups('1.07')
  expect(groups.map(group => [group.groupId, imageApi.moduleGroupUsesSourceImages('1.07', group.fields)])).toEqual([
    ['site_use:1.1', true], ['site_use:1.2', true], ['site_use:2', true], ['site_use:3', true], ['site_use:4.1', false], ['site_use:4.2', false], ['site_use:4.3', true],
  ])
  expect(imageApi.moduleUsesSourceImages('1.07')).toBe(true)
  for (const group of getModuleAuthorFieldGroups('1.02')) expect(imageApi.moduleGroupUsesSourceImages('1.02', group.fields)).toBe(true)
})
it('attaches real, hash-checked source pixels with bounded point coverage and explicit omissions', async () => {
  const f = await fixture(), saved = new Map<string, Uint8Array>()
  const images = await prepareModuleSourceImages(f.root, f.corpus, {
    saveImage: async ({ data }: { data: Uint8Array }) => { const id = createHash('sha256').update(data).digest('hex'); saved.set(id, data); return { id } },
  } as never, f.signal, 2)
  expect(images.sources.map(row => row.path)).toEqual(['原始资料/A/1.jpg', '原始资料/B/1.jpg'])
  expect(images.omitted.map(row => row.path)).toEqual(['原始资料/A/2.jpg'])
  expect(images.blocks.filter(block => block.type === 'image')).toHaveLength(2)
  for (const source of images.sources) {
    expect(source.contentHash).toBe(f.corpus.documents.find(doc => doc.path === source.path)!.contentHash)
    expect(saved.has(source.previewHash)).toBe(true)
  }
})
it('rejects changed source pixels before attaching them to a native child', async () => {
  const f = await fixture()
  await writeFile(join(f.root, f.corpus.documents[0].path), 'changed source')
  await expect(prepareModuleSourceImages(f.root, f.corpus, { saveImage: async () => { throw Error('must not attach') } } as never, f.signal)).rejects.toThrow('MODULE_IMAGE_SOURCE_CHANGED')
})
it('narrows prepared native pictures by point coverage while retaining original attachments, hashes and explicit omissions', async () => {
  const api = await import('../src/research-v2/module-image-context.ts') as any
  const f = await fixture()
  const images = await prepareModuleSourceImages(f.root, f.corpus, {
    saveImage: async ({ data }: { data: Uint8Array }) => ({ id: createHash('sha256').update(data).digest('hex') }),
  } as never, f.signal)
  const before = structuredClone(images), selected = api.narrowModuleSourceImages(f.corpus, images, 2)
  expect(selected.sources.map((row: any) => row.path)).toEqual(['原始资料/A/1.jpg', '原始资料/B/1.jpg'])
  expect(selected.omitted.map((row: any) => row.path)).toEqual(['原始资料/A/2.jpg'])
  expect(selected.sources).toEqual(images.sources.slice(0, 2))
  expect(selected.blocks).toEqual(images.blocks.slice(0, 4))
  expect(images).toEqual(before)
  expect(api.narrowModuleSourceImages(f.corpus, images, 16)).toEqual(before)
  expect(() => api.narrowModuleSourceImages(f.corpus, images, 0)).toThrow('MODULE_IMAGE_LIMIT_INVALID')
})
it('cannot silently perform text-only research when original source images require a native attachment service', async () => {
  const f = await fixture()
  await expect(prepareModuleSourceImages(f.root, f.corpus, undefined, f.signal)).rejects.toThrow('MODULE_IMAGE_INPUT_UNAVAILABLE')
})
