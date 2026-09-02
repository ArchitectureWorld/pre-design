import { assertPortableRelativePath } from './path-policy.ts'

export type MaterialDomain = 'source-materials' | 'assets'

export type SourceMaterialCategory =
  | 'documents'
  | 'drawings'
  | 'images'
  | 'videos'
  | 'data'
  | 'models'
  | 'other'

export type FormalAssetCategory =
  | 'images'
  | 'videos'
  | 'charts'
  | 'diagrams'
  | 'audio'
  | 'other'

export interface ExistingMaterialEntry {
  readonly objectId: string
  readonly originalFileName: string
  readonly relativePath: string
  readonly sha256: string
}

export interface PlanMaterialImportInput {
  readonly domain: MaterialDomain
  readonly category: SourceMaterialCategory | FormalAssetCategory
  readonly originalFileName: string
  readonly sha256: string
  readonly existingEntries: readonly ExistingMaterialEntry[]
}

interface MaterialImportPlanBase {
  readonly domain: MaterialDomain
  readonly category: SourceMaterialCategory | FormalAssetCategory
  readonly originalFileName: string
  readonly relativePath: string
  readonly sha256: string
}

export interface CopyMaterialImportPlan extends MaterialImportPlanBase {
  readonly action: 'copy'
}

export interface DeduplicateMaterialImportPlan extends MaterialImportPlanBase {
  readonly action: 'deduplicate'
  readonly existingObjectId: string
}

export type MaterialImportPlan =
  | CopyMaterialImportPlan
  | DeduplicateMaterialImportPlan

const SHA256_PATTERN = /^[a-f0-9]{64}$/u
const MIME_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/u
const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/u

const SOURCE_CATEGORIES = new Set<SourceMaterialCategory>([
  'documents',
  'drawings',
  'images',
  'videos',
  'data',
  'models',
  'other',
])

const ASSET_CATEGORIES = new Set<FormalAssetCategory>([
  'images',
  'videos',
  'charts',
  'diagrams',
  'audio',
  'other',
])

interface ExtensionRule {
  readonly sourceCategory: SourceMaterialCategory
  readonly allowedMimeTypes?: readonly string[]
  readonly allowedMimePrefixes?: readonly string[]
}

const EXTENSION_RULES: Readonly<Record<string, ExtensionRule>> = {
  pdf: { sourceCategory: 'documents', allowedMimeTypes: ['application/pdf'] },
  doc: {
    sourceCategory: 'documents',
    allowedMimeTypes: ['application/msword', 'application/octet-stream'],
  },
  docx: {
    sourceCategory: 'documents',
    allowedMimeTypes: [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/zip',
      'application/octet-stream',
    ],
  },
  xls: {
    sourceCategory: 'documents',
    allowedMimeTypes: ['application/vnd.ms-excel', 'application/octet-stream'],
  },
  xlsx: {
    sourceCategory: 'documents',
    allowedMimeTypes: [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/zip',
      'application/octet-stream',
    ],
  },
  ppt: {
    sourceCategory: 'documents',
    allowedMimeTypes: ['application/vnd.ms-powerpoint', 'application/octet-stream'],
  },
  pptx: {
    sourceCategory: 'documents',
    allowedMimeTypes: [
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/zip',
      'application/octet-stream',
    ],
  },
  txt: { sourceCategory: 'documents', allowedMimePrefixes: ['text/'] },
  md: { sourceCategory: 'documents', allowedMimePrefixes: ['text/'] },
  rtf: {
    sourceCategory: 'documents',
    allowedMimeTypes: ['application/rtf', 'text/rtf', 'application/octet-stream'],
  },
  dwg: {
    sourceCategory: 'drawings',
    allowedMimeTypes: [
      'image/vnd.dwg',
      'application/acad',
      'application/x-acad',
      'application/autocad_dwg',
      'application/dwg',
      'application/octet-stream',
    ],
  },
  dxf: {
    sourceCategory: 'drawings',
    allowedMimeTypes: [
      'image/vnd.dxf',
      'application/dxf',
      'application/x-dxf',
      'application/octet-stream',
    ],
  },
  png: { sourceCategory: 'images', allowedMimeTypes: ['image/png'] },
  jpg: { sourceCategory: 'images', allowedMimeTypes: ['image/jpeg'] },
  jpeg: { sourceCategory: 'images', allowedMimeTypes: ['image/jpeg'] },
  webp: { sourceCategory: 'images', allowedMimeTypes: ['image/webp'] },
  gif: { sourceCategory: 'images', allowedMimeTypes: ['image/gif'] },
  svg: { sourceCategory: 'images', allowedMimeTypes: ['image/svg+xml'] },
  tif: { sourceCategory: 'images', allowedMimeTypes: ['image/tiff'] },
  tiff: { sourceCategory: 'images', allowedMimeTypes: ['image/tiff'] },
  mp4: { sourceCategory: 'videos', allowedMimeTypes: ['video/mp4'] },
  mov: { sourceCategory: 'videos', allowedMimeTypes: ['video/quicktime'] },
  webm: { sourceCategory: 'videos', allowedMimeTypes: ['video/webm'] },
  avi: {
    sourceCategory: 'videos',
    allowedMimeTypes: ['video/x-msvideo', 'video/avi', 'application/octet-stream'],
  },
  mkv: {
    sourceCategory: 'videos',
    allowedMimeTypes: ['video/x-matroska', 'application/octet-stream'],
  },
  csv: {
    sourceCategory: 'data',
    allowedMimeTypes: ['text/csv', 'application/csv', 'application/vnd.ms-excel'],
  },
  json: {
    sourceCategory: 'data',
    allowedMimeTypes: ['application/json', 'text/json', 'application/octet-stream'],
  },
  geojson: {
    sourceCategory: 'data',
    allowedMimeTypes: ['application/geo+json', 'application/json', 'application/octet-stream'],
  },
  xml: {
    sourceCategory: 'data',
    allowedMimeTypes: ['application/xml', 'text/xml', 'application/octet-stream'],
  },
  yaml: {
    sourceCategory: 'data',
    allowedMimeTypes: ['application/yaml', 'text/yaml', 'text/x-yaml', 'application/octet-stream'],
  },
  yml: {
    sourceCategory: 'data',
    allowedMimeTypes: ['application/yaml', 'text/yaml', 'text/x-yaml', 'application/octet-stream'],
  },
  ifc: {
    sourceCategory: 'models',
    allowedMimeTypes: [
      'application/x-step',
      'model/step',
      'application/step',
      'application/octet-stream',
    ],
  },
  obj: {
    sourceCategory: 'models',
    allowedMimeTypes: ['model/obj', 'text/plain', 'application/octet-stream'],
  },
  glb: {
    sourceCategory: 'models',
    allowedMimeTypes: ['model/gltf-binary', 'application/octet-stream'],
  },
  gltf: {
    sourceCategory: 'models',
    allowedMimeTypes: ['model/gltf+json', 'application/json', 'application/octet-stream'],
  },
  fbx: { sourceCategory: 'models', allowedMimeTypes: ['application/octet-stream'] },
  '3dm': { sourceCategory: 'models', allowedMimeTypes: ['application/octet-stream'] },
  rvt: { sourceCategory: 'models', allowedMimeTypes: ['application/octet-stream'] },
  mp3: { sourceCategory: 'other', allowedMimeTypes: ['audio/mpeg'] },
  wav: {
    sourceCategory: 'other',
    allowedMimeTypes: ['audio/wav', 'audio/x-wav', 'audio/wave'],
  },
}

function fail(code: string, detail: string): never {
  throw new Error(`${code}: ${detail}`)
}

function normalizeMimeType(value: string): string {
  const normalized = value.trim().toLowerCase()
  if (!MIME_PATTERN.test(normalized)) {
    fail('PRESENTATION_MATERIAL_MIME_INVALID', `invalid MIME type '${value}'`)
  }
  return normalized
}

function normalizeFileName(value: string): string {
  const normalized = value.normalize('NFC').trim()
  if (normalized === ''
    || normalized === '.'
    || normalized === '..'
    || normalized.startsWith('.')
    || normalized.endsWith('.')
    || normalized.endsWith(' ')
    || normalized.includes('/')
    || normalized.includes('\\')
    || CONTROL_PATTERN.test(normalized)
    || normalized.length > 255) {
    fail('PRESENTATION_MATERIAL_FILENAME_INVALID', `unsafe file name '${value}'`)
  }
  return normalized
}

function extensionOf(fileName: string): string {
  const lastDot = fileName.lastIndexOf('.')
  if (lastDot <= 0 || lastDot === fileName.length - 1) return ''
  return fileName.slice(lastDot + 1).toLowerCase()
}

function assertExtensionMatchesMime(fileName: string, mimeType: string): ExtensionRule | undefined {
  const rule = EXTENSION_RULES[extensionOf(fileName)]
  if (rule === undefined) return undefined
  const matchesExact = rule.allowedMimeTypes?.includes(mimeType) ?? false
  const matchesPrefix = rule.allowedMimePrefixes?.some(prefix => mimeType.startsWith(prefix)) ?? false
  if (!matchesExact && !matchesPrefix) {
    fail(
      'PRESENTATION_MATERIAL_MIME_EXTENSION_MISMATCH',
      `file '${fileName}' is incompatible with MIME '${mimeType}'`,
    )
  }
  return rule
}

export function classifySourceMaterial(
  originalFileName: string,
  rawMimeType: string,
): SourceMaterialCategory {
  const fileName = normalizeFileName(originalFileName)
  const mimeType = normalizeMimeType(rawMimeType)
  const rule = assertExtensionMatchesMime(fileName, mimeType)
  if (rule !== undefined) return rule.sourceCategory
  if (mimeType.startsWith('image/')) return 'images'
  if (mimeType.startsWith('video/')) return 'videos'
  if (mimeType === 'text/csv' || mimeType.includes('json') || mimeType.includes('xml')) {
    return 'data'
  }
  return 'other'
}

export function classifyFormalAsset(
  originalFileName: string,
  rawMimeType: string,
  semanticRole?: string,
): FormalAssetCategory {
  const fileName = normalizeFileName(originalFileName)
  const mimeType = normalizeMimeType(rawMimeType)
  assertExtensionMatchesMime(fileName, mimeType)
  const role = semanticRole?.normalize('NFC').trim().toLowerCase()
  if (role === 'chart') return 'charts'
  if (role === 'diagram') return 'diagrams'
  if (mimeType.startsWith('image/')) return 'images'
  if (mimeType.startsWith('video/')) return 'videos'
  if (mimeType.startsWith('audio/')) return 'audio'
  return 'other'
}

function assertCategory(
  domain: MaterialDomain,
  category: SourceMaterialCategory | FormalAssetCategory,
): void {
  const valid = domain === 'source-materials'
    ? SOURCE_CATEGORIES.has(category as SourceMaterialCategory)
    : ASSET_CATEGORIES.has(category as FormalAssetCategory)
  if (!valid) {
    fail(
      'PRESENTATION_MATERIAL_CATEGORY_INVALID',
      `category '${category}' is invalid for '${domain}'`,
    )
  }
}

function foldedPath(value: string): string {
  return value.normalize('NFC').toLocaleLowerCase('en-US')
}

function splitFileName(fileName: string): { readonly stem: string; readonly extension: string } {
  const lastDot = fileName.lastIndexOf('.')
  if (lastDot <= 0) return { stem: fileName, extension: '' }
  return {
    stem: fileName.slice(0, lastDot),
    extension: fileName.slice(lastDot),
  }
}

function collisionPath(
  domain: MaterialDomain,
  category: SourceMaterialCategory | FormalAssetCategory,
  fileName: string,
  sha256: string,
  occupiedPaths: ReadonlySet<string>,
): string {
  const { stem, extension } = splitFileName(fileName)
  const shortCandidate = `${domain}/${category}/${stem}~${sha256.slice(0, 12)}${extension}`
  if (!occupiedPaths.has(foldedPath(shortCandidate))) return shortCandidate
  const fullCandidate = `${domain}/${category}/${stem}~${sha256}${extension}`
  if (!occupiedPaths.has(foldedPath(fullCandidate))) return fullCandidate
  fail(
    'PRESENTATION_MATERIAL_PATH_COLLISION',
    `cannot allocate a unique path for '${fileName}'`,
  )
}

function validateExistingEntries(
  input: PlanMaterialImportInput,
): {
  readonly byHash: ReadonlyMap<string, ExistingMaterialEntry>
  readonly occupiedPaths: ReadonlySet<string>
} {
  const byHash = new Map<string, ExistingMaterialEntry>()
  const objectIds = new Set<string>()
  const occupiedPaths = new Set<string>()
  const expectedPrefix = `${input.domain}/${input.category}/`

  for (const entry of input.existingEntries) {
    const objectId = entry.objectId.normalize('NFC').trim()
    if (objectId === '') {
      fail('PRESENTATION_MATERIAL_EXISTING_ID_INVALID', 'existing object ID is empty')
    }
    if (objectIds.has(objectId)) {
      fail(
        'PRESENTATION_MATERIAL_EXISTING_ID_DUPLICATE',
        `duplicate existing object ID '${objectId}'`,
      )
    }
    objectIds.add(objectId)

    if (!SHA256_PATTERN.test(entry.sha256)) {
      fail(
        'PRESENTATION_MATERIAL_EXISTING_HASH_INVALID',
        `existing object '${objectId}' has an invalid SHA-256`,
      )
    }
    if (byHash.has(entry.sha256)) {
      fail(
        'PRESENTATION_MATERIAL_EXISTING_HASH_DUPLICATE',
        `existing SHA-256 '${entry.sha256}' is assigned more than once`,
      )
    }

    const relativePath = assertPortableRelativePath(entry.relativePath)
    if (!relativePath.startsWith(expectedPrefix)) {
      fail(
        'PRESENTATION_MATERIAL_EXISTING_PATH_INVALID',
        `existing path '${relativePath}' is outside '${expectedPrefix}'`,
      )
    }
    const folded = foldedPath(relativePath)
    if (occupiedPaths.has(folded)) {
      fail(
        'PRESENTATION_MATERIAL_EXISTING_PATH_DUPLICATE',
        `existing path '${relativePath}' collides after normalization`,
      )
    }
    occupiedPaths.add(folded)
    normalizeFileName(entry.originalFileName)
    byHash.set(entry.sha256, {
      ...entry,
      objectId,
      originalFileName: entry.originalFileName.normalize('NFC').trim(),
      relativePath,
    })
  }

  return { byHash, occupiedPaths }
}

export function planMaterialImport(
  input: PlanMaterialImportInput,
): MaterialImportPlan {
  assertCategory(input.domain, input.category)
  const originalFileName = normalizeFileName(input.originalFileName)
  if (!SHA256_PATTERN.test(input.sha256)) {
    fail('PRESENTATION_MATERIAL_HASH_INVALID', 'sha256 must be lowercase hexadecimal')
  }
  const { byHash, occupiedPaths } = validateExistingEntries(input)
  const duplicate = byHash.get(input.sha256)
  if (duplicate !== undefined) {
    return {
      action: 'deduplicate',
      domain: input.domain,
      category: input.category,
      originalFileName,
      relativePath: duplicate.relativePath,
      sha256: input.sha256,
      existingObjectId: duplicate.objectId,
    }
  }

  const desiredPath = `${input.domain}/${input.category}/${originalFileName}`
  const relativePath = occupiedPaths.has(foldedPath(desiredPath))
    ? collisionPath(
        input.domain,
        input.category,
        originalFileName,
        input.sha256,
        occupiedPaths,
      )
    : desiredPath

  return {
    action: 'copy',
    domain: input.domain,
    category: input.category,
    originalFileName,
    relativePath: assertPortableRelativePath(relativePath),
    sha256: input.sha256,
  }
}
