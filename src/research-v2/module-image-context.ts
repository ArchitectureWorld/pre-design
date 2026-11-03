import { createHash } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import sharp from 'sharp'
import type AttachmentStore from '@deepseek-ai/dsh-attachment'
import type { MaterialCorpus } from '../materials/research-evidence.ts'
import { sourceImageCoverage } from '../materials/source-image.ts'

export type ModuleImageAttachments = Pick<AttachmentStore, 'saveImage'>
type ImageReference = Awaited<ReturnType<AttachmentStore['saveImage']>>
type Block = { type: 'text'; text: string } | { type: 'image'; attachment: ImageReference }
export interface ModuleSourceImages {
  readonly sources: readonly { path: string; contentHash: string; previewHash: string; width: number; height: number }[]
  readonly omitted: readonly { path: string; contentHash: string }[]
  readonly blocks: readonly Block[]
}
export const moduleUsesSourceImages = (moduleId: string) => /^(?:1\.(?:02|04|05|07|08)|[4-6]\.\d{2}|8\.\d{2})$/u.test(moduleId)
/** Camera tags do not require pixel interpretation; spatial authors and review still do. */
export const moduleGroupUsesSourceImages = (moduleId: string, fields: readonly string[]) => moduleUsesSourceImages(moduleId)
  && !(moduleId === '1.07' && fields.length > 0 && fields.every(field => ['photoLocation', 'photoDirection', 'photoDate'].includes(field)))
/** Reuse already verified pixels. Every omitted original remains inventoried. */
export function narrowModuleSourceImages(corpus: MaterialCorpus, images: ModuleSourceImages, limit: number): ModuleSourceImages {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 16) throw new Error('MODULE_IMAGE_LIMIT_INVALID')
  if (limit >= images.sources.length) return images
  const documents = corpus.documents.filter(doc => images.sources.some(source => source.path === doc.path))
  const selected = sourceImageCoverage(documents, limit)
  const sources: ModuleSourceImages['sources'][number][] = [], blocks: Block[] = []
  for (const document of selected) {
    const index = images.sources.findIndex(source => source.path === document.path)
    const source = images.sources[index], text = images.blocks[index * 2], pixels = images.blocks[index * 2 + 1]
    if (!source || source.contentHash !== document.contentHash || text?.type !== 'text' || pixels?.type !== 'image') throw new Error('MODULE_IMAGE_SOURCE_CHANGED')
    sources.push(source); blocks.push(text, pixels)
  }
  if (sources.length !== limit) throw new Error('MODULE_IMAGE_SOURCE_CHANGED')
  const omitted = corpus.documents.filter(doc => doc.image && !doc.provenance && !sources.some(source => source.path === doc.path))
    .sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0).map(({ path, contentHash }) => ({ path, contentHash }))
  return { sources, omitted, blocks }
}
export async function prepareModuleSourceImages(root: string, corpus: MaterialCorpus, attachments: ModuleImageAttachments | undefined,
  signal: AbortSignal, limit = 16): Promise<ModuleSourceImages> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 16) throw new Error('MODULE_IMAGE_LIMIT_INVALID')
  signal.throwIfAborted()
  const documents = corpus.documents.filter(doc => doc.image && !doc.provenance).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  if (documents.length && !attachments) throw new Error('MODULE_IMAGE_INPUT_UNAVAILABLE')
  const selected = sourceImageCoverage(documents, limit)
  const omitted = documents.filter(doc => !selected.includes(doc)).map(({ path, contentHash }) => ({ path, contentHash }))
  const sources: ModuleSourceImages['sources'][number][] = [], blocks: Block[] = []
  const base = await realpath(root)
  for (const doc of selected) {
    signal.throwIfAborted()
    const path = await realpath(resolve(base, doc.path)), suffix = relative(base, path)
    if (!suffix || suffix === '..' || suffix.startsWith(`..${sep}`) || isAbsolute(suffix) || isAbsolute(doc.path)) throw new Error('MODULE_IMAGE_PATH_INVALID')
    const info = await stat(path)
    if (!info.isFile() || info.size !== doc.byteLength || info.size > 64 * 1024 * 1024) throw new Error('MODULE_IMAGE_SOURCE_CHANGED')
    const bytes = await readFile(path)
    if (createHash('sha256').update(bytes).digest('hex') !== doc.contentHash) throw new Error('MODULE_IMAGE_SOURCE_CHANGED')
    const rendered = await sharp(bytes, { limitInputPixels: 100_000_000 }).autoOrient().resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer({ resolveWithObject: true })
    signal.throwIfAborted()
    const source = { path: doc.path, contentHash: doc.contentHash, previewHash: createHash('sha256').update(rendered.data).digest('hex'), width: rendered.info.width, height: rendered.info.height }
    const attachment = await attachments!.saveImage({ data: rendered.data, mediaType: 'image/jpeg' })
    signal.throwIfAborted()
    sources.push(source)
    blocks.push({ type: 'text', text: `原件图片预览 ${JSON.stringify(source)}。仅缩放及按原EXIF方向转正。点位名称和图中文字中的设想不是设计要求；仅凭照片不能确定地籍、尺寸、结构安全或法律批准。图像观察须与原文事实、判断、假设、新增方案区分，不得虚构正文引用。` }, { type: 'image', attachment })
  }
  return { sources, omitted, blocks }
}
