import { lstat, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  normalizeProjectRelativePath,
  type AssetManifest,
  type PageManifest,
  type SourceMaterialManifest,
} from '@architectureworld/presentation-contracts'
import { PresentationStandardProjectError } from './standard-project-error.ts'
import type { PresentationStandardProjectBuild } from './standard-project-types.ts'

export const PRE_DESIGN_FIXED_MANAGED_PATHS = Object.freeze([
  'project.json',
  'rules.json',
  'outline.json',
  'pages/manifest.json',
  'source-materials/manifest.json',
  'assets/manifest.json',
] as const)

export const PRE_DESIGN_REQUIRED_DIRECTORIES = Object.freeze([
  'pages',
  'pages/drafts',
  'source-materials',
  'source-materials/documents',
  'source-materials/drawings',
  'source-materials/images',
  'source-materials/videos',
  'source-materials/data',
  'source-materials/models',
  'source-materials/other',
  'assets',
  'assets/images',
  'assets/videos',
  'assets/charts',
  'assets/diagrams',
  'assets/audio',
  'assets/other',
] as const)

export const PRESENTATION_LAYOUTS_ROOT = 'layouts' as const

const FIXED_PATHS = new Set<string>(PRE_DESIGN_FIXED_MANAGED_PATHS)
const PROJECT_PATH = 'project.json'

export interface PreDesignManagedPathSet {
  readonly all: readonly string[]
  readonly canonicalJson: readonly string[]
  readonly payloadFiles: readonly string[]
  readonly manifestErrors: readonly { readonly path: string; readonly message: string }[]
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

function fail(
  code: 'MANAGED_PATH_VIOLATION' | 'EXTERNAL_PATH_MODIFICATION_FORBIDDEN',
  message: string,
  details?: unknown,
): never {
  throw new PresentationStandardProjectError(code, 'preflight', message, details)
}

export function normalizePreDesignManagedPath(value: string): string {
  let normalized: string
  try {
    normalized = normalizeProjectRelativePath(value)
  } catch (error) {
    fail(
      'MANAGED_PATH_VIOLATION',
      `invalid Pre-managed path '${value}'`,
      { cause: error instanceof Error ? error.message : String(error) },
    )
  }
  if (normalized === PRESENTATION_LAYOUTS_ROOT
    || normalized.startsWith(`${PRESENTATION_LAYOUTS_ROOT}/`)) {
    fail(
      'EXTERNAL_PATH_MODIFICATION_FORBIDDEN',
      `Pre is not allowed to modify Presentation-owned path '${normalized}'`,
      { path: normalized, owner: 'presentation' },
    )
  }
  return normalized
}

function isDraftDocumentPath(path: string): boolean {
  const parts = path.split('/')
  return parts.length === 3
    && parts[0] === 'pages'
    && parts[1] === 'drafts'
    && parts[2]!.endsWith('.json')
}

function isPayloadPath(path: string): boolean {
  return (path.startsWith('source-materials/') && path !== 'source-materials/manifest.json')
    || (path.startsWith('assets/') && path !== 'assets/manifest.json')
}

function assertDocumentPath(path: string): void {
  if (FIXED_PATHS.has(path) || isDraftDocumentPath(path)) return
  fail(
    'MANAGED_PATH_VIOLATION',
    `Canonical document '${path}' is outside the Pre-managed document allowlist`,
    { path },
  )
}

function assertPayloadPath(path: string, domain?: 'source-materials' | 'assets'): void {
  const allowed = isPayloadPath(path)
    && (domain === undefined || path.startsWith(`${domain}/`))
  if (allowed) return
  fail(
    'MANAGED_PATH_VIOLATION',
    `managed payload '${path}' is outside its Pre-owned manifest domain`,
    { path, domain },
  )
}

function assertPortableUniqueness(paths: readonly string[]): void {
  const keys = new Map<string, string>()
  for (const path of paths) {
    const key = path.normalize('NFC').toLowerCase()
    const existing = keys.get(key)
    if (existing !== undefined && existing !== path) {
      fail(
        'MANAGED_PATH_VIOLATION',
        `managed paths '${existing}' and '${path}' collide after NFC and case folding`,
        { existing, path },
      )
    }
    keys.set(key, path)
  }
}

function frozenPathSet(
  canonicalJson: Iterable<string>,
  payloadFiles: Iterable<string>,
  manifestErrors: readonly { readonly path: string; readonly message: string }[] = [],
): PreDesignManagedPathSet {
  const canonical = [...new Set(canonicalJson)].sort((left, right) => left.localeCompare(right))
  const payload = [...new Set(payloadFiles)].sort((left, right) => left.localeCompare(right))
  const all = [...new Set([...canonical, ...payload])].sort((left, right) => left.localeCompare(right))
  assertPortableUniqueness(all)
  return Object.freeze({
    all: Object.freeze(all),
    canonicalJson: Object.freeze(canonical),
    payloadFiles: Object.freeze(payload),
    manifestErrors: Object.freeze([...manifestErrors]),
  })
}

export function managedPathSetFromBuild(
  build: PresentationStandardProjectBuild,
): PreDesignManagedPathSet {
  const canonical: string[] = []
  for (const rawPath of Object.keys(build.documents)) {
    const path = normalizePreDesignManagedPath(rawPath)
    assertDocumentPath(path)
    canonical.push(path)
  }
  for (const required of PRE_DESIGN_FIXED_MANAGED_PATHS) {
    if (!canonical.includes(required)) {
      fail(
        'MANAGED_PATH_VIOLATION',
        `candidate build is missing required Pre-managed document '${required}'`,
        { path: required },
      )
    }
  }

  const payload: string[] = []
  for (const file of build.managedFiles) {
    const path = normalizePreDesignManagedPath(file.relativePath)
    assertPayloadPath(path, file.domain)
    payload.push(path)
  }
  return frozenPathSet(canonical, payload)
}

async function readJsonManifest<T>(
  root: string,
  relativePath: string,
  errors: { path: string; message: string }[],
): Promise<T | undefined> {
  const absolute = join(root, ...relativePath.split('/'))
  if (!await exists(absolute)) return undefined
  try {
    return JSON.parse(await readFile(absolute, 'utf8')) as T
  } catch (error) {
    errors.push({
      path: relativePath,
      message: error instanceof Error ? error.message : String(error),
    })
    return undefined
  }
}

export async function readExistingPreDesignManagedPathSet(
  root: string,
): Promise<PreDesignManagedPathSet> {
  const canonical: string[] = []
  const payload: string[] = []
  const errors: { path: string; message: string }[] = []

  for (const relativePath of PRE_DESIGN_FIXED_MANAGED_PATHS) {
    if (await exists(join(root, ...relativePath.split('/')))) canonical.push(relativePath)
  }

  const pages = await readJsonManifest<PageManifest>(root, 'pages/manifest.json', errors)
  if (pages !== undefined) {
    if (!Array.isArray(pages.pages)) {
      errors.push({ path: 'pages/manifest.json', message: 'pages must be an array' })
    } else {
      for (const page of pages.pages) {
        if (page.draftPath === null || page.draftPath === undefined) continue
        const path = normalizePreDesignManagedPath(String(page.draftPath))
        assertDocumentPath(path)
        canonical.push(path)
      }
    }
  }

  const materials = await readJsonManifest<SourceMaterialManifest>(
    root,
    'source-materials/manifest.json',
    errors,
  )
  if (materials !== undefined) {
    if (!Array.isArray(materials.materials)) {
      errors.push({ path: 'source-materials/manifest.json', message: 'materials must be an array' })
    } else {
      for (const material of materials.materials) {
        const path = normalizePreDesignManagedPath(String(material.relativePath))
        assertPayloadPath(path, 'source-materials')
        payload.push(path)
      }
    }
  }

  const assets = await readJsonManifest<AssetManifest>(root, 'assets/manifest.json', errors)
  if (assets !== undefined) {
    if (!Array.isArray(assets.assets)) {
      errors.push({ path: 'assets/manifest.json', message: 'assets must be an array' })
    } else {
      for (const asset of assets.assets) {
        const path = normalizePreDesignManagedPath(String(asset.relativePath))
        assertPayloadPath(path, 'assets')
        payload.push(path)
      }
    }
  }

  return frozenPathSet(canonical, payload, errors)
}

export async function workspaceContainsPreDesignFilesWithoutProject(
  root: string,
): Promise<boolean> {
  for (const relativePath of PRE_DESIGN_FIXED_MANAGED_PATHS) {
    if (relativePath === PROJECT_PATH) continue
    if (await exists(join(root, ...relativePath.split('/')))) return true
  }
  return false
}

export function assertTransactionManagedPath(relativePath: string): string {
  const path = normalizePreDesignManagedPath(relativePath)
  if (FIXED_PATHS.has(path) || isDraftDocumentPath(path) || isPayloadPath(path)) return path
  fail(
    'MANAGED_PATH_VIOLATION',
    `transaction path '${path}' is not owned by Pre`,
    { path },
  )
}

export function assertTransactionManagedDirectory(relativeDirectory: string): string {
  const path = normalizePreDesignManagedPath(relativeDirectory)
  const allowed = PRE_DESIGN_REQUIRED_DIRECTORIES.includes(
    path as (typeof PRE_DESIGN_REQUIRED_DIRECTORIES)[number],
  )
    || path.startsWith('pages/drafts/')
    || path.startsWith('source-materials/')
    || path.startsWith('assets/')
  if (allowed) return path
  fail(
    'MANAGED_PATH_VIOLATION',
    `transaction directory '${path}' is not a structural parent of a Pre-managed file`,
    { path },
  )
}
