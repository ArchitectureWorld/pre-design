import { createHash } from 'node:crypto'

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u
const ENCODED_TRAVERSAL_PATTERN = /%(?:2e|2f|5c)/iu
const SCHEME_OR_DRIVE_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:/u

function fail(code: string, detail: string): never {
  throw new Error(`${code}: ${detail}`)
}

export function assertPortableRelativePath(input: string): string {
  if (typeof input !== 'string' || input.trim() === '') {
    fail('PRESENTATION_PATH_NOT_PORTABLE', 'path must be a non-empty string')
  }

  const normalized = input.normalize('NFC')
  if (normalized.length > 1024
    || normalized.startsWith('/')
    || normalized.includes('\\')
    || normalized.includes('//')
    || CONTROL_CHARACTER_PATTERN.test(normalized)
    || ENCODED_TRAVERSAL_PATTERN.test(normalized)
    || SCHEME_OR_DRIVE_PATTERN.test(normalized)) {
    fail('PRESENTATION_PATH_NOT_PORTABLE', `unsafe project-relative path '${input}'`)
  }

  const segments = normalized.split('/')
  if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) {
    fail('PRESENTATION_PATH_NOT_PORTABLE', `unsafe project-relative path '${input}'`)
  }

  return normalized
}

export function normalizeProjectSlug(projectName: string): string {
  const normalizedName = projectName.normalize('NFC').trim()
  if (normalizedName === '') {
    fail('PRESENTATION_PROJECT_NAME_REQUIRED', 'project name is required')
  }

  const asciiCandidate = normalizedName
    .normalize('NFKD')
    .replace(/\p{Mark}+/gu, '')
    .toLowerCase()
    .replace(/[’']/gu, '')
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 80)
    .replace(/-+$/gu, '')

  if (asciiCandidate !== '') return asciiCandidate

  const digest = createHash('sha256')
    .update(normalizedName, 'utf8')
    .digest('hex')
    .slice(0, 12)
  return `project-${digest}`
}
