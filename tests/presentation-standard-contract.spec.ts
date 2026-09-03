import { cp, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ERROR_CODES,
  isStableId,
  normalizeProjectRelativePath,
  validateDocumentWithAjv,
  validateProjectDirectoryWithAjv,
} from '@architectureworld/presentation-contracts'
import {
  PRESENTATION_STANDARD_CONTRACT_LOCK,
  assertPresentationContractCoordinates,
  getPresentationStandardContract,
  presentationContractPackageRoot,
} from '../src/presentation/standard-contract.ts'

const roots: string[] = []

async function tempCopy(source: string): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), 'pre-design-presentation-contract-'))
  roots.push(parent)
  const target = join(parent, 'project-copy')
  await cp(source, target, { recursive: true })
  return target
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('pinned Presentation Standard Project Contract', () => {
  it('exposes only the fixed 0.1.0 Contract coordinates and official factories', async () => {
    expect(PRESENTATION_STANDARD_CONTRACT_LOCK).toMatchObject({
      standardName: 'Presentation Standard Project Directory',
      standardVersion: '0.1.0',
      authorityRepository: 'ArchitectureWorld/presentation-tools',
      sourceCommitSHA: '974668d308728386ea005c9e77d58ebff9372f0a',
      packageName: '@architectureworld/presentation-contracts',
      packageVersion: '0.1.0',
      schemaSetSha256: '5bd329fcc8503ff7a48b3430e41b38dd264ae486cee7372a39cbbcccc2de2ebc',
    })

    const contract = await getPresentationStandardContract()
    expect(contract.standardName).toBe(PRESENTATION_STANDARD_CONTRACT_LOCK.standardName)
    expect(contract.standardVersion).toBe(PRESENTATION_STANDARD_CONTRACT_LOCK.standardVersion)
    expect(contract.schemaSetSha256).toBe(PRESENTATION_STANDARD_CONTRACT_LOCK.schemaSetSha256)
    expect(isStableId('project', contract.createId('project'))).toBe(true)
    expect(contract.createProjectDirectoryPlan({
      name: 'Contract Consumer',
      projectSlug: 'contract-consumer',
    }).documents).toHaveProperty('project.json')
  })

  it('fails closed when any fixed coordinate is changed', () => {
    expect(() => assertPresentationContractCoordinates({
      ...PRESENTATION_STANDARD_CONTRACT_LOCK,
      schemaSetSha256: '0'.repeat(64),
    })).toThrow('PRESENTATION_CONTRACT_COORDINATE_MISMATCH')
    expect(() => assertPresentationContractCoordinates({
      ...PRESENTATION_STANDARD_CONTRACT_LOCK,
      sourceCommitSHA: 'feat/report-studio-v0.1.1-hardening',
    })).toThrow('PRESENTATION_CONTRACT_COORDINATE_MISMATCH')
  })

  it('consumes both the packaged minimum Fixture and complete example', async () => {
    const packageRoot = presentationContractPackageRoot()
    const projects = [
      join(packageRoot, 'fixtures/minimal/project_01992a80-0000-7000-8000-000000000001-minimal-project'),
      join(packageRoot, 'examples/unformatted-project/project_01992a80-0000-7000-8000-000000000101-campus-renewal-brief'),
    ]
    for (const project of projects) {
      await expect(validateProjectDirectoryWithAjv(project, { allowGitKeep: true }))
        .resolves.toMatchObject({ valid: true, standardVersion: '0.1.0' })
    }
  })

  it('uses the same portable path policy on Windows and Linux hosts', () => {
    expect(normalizeProjectRelativePath('source-materials/data/site.csv')).toBe('source-materials/data/site.csv')
    for (const value of [
      '../escape.csv',
      '/tmp/absolute.csv',
      'C:\\project\\file.csv',
      '\\\\server\\share\\file.csv',
      'source-materials\\data\\file.csv',
    ]) {
      expect(() => normalizeProjectRelativePath(value)).toThrow()
    }
  })

  it('rejects duplicate IDs, missing Manifests and pre-design governance fields', async () => {
    const packageRoot = presentationContractPackageRoot()
    const example = join(packageRoot, 'examples/unformatted-project/project_01992a80-0000-7000-8000-000000000101-campus-renewal-brief')

    const missingManifest = await tempCopy(example)
    await unlink(join(missingManifest, 'assets/manifest.json'))
    const missingResult = await validateProjectDirectoryWithAjv(missingManifest, { allowGitKeep: true })
    expect(missingResult.valid).toBe(false)
    expect(missingResult.errors.some(issue => issue.code === ERROR_CODES.DIRECTORY_MISSING_REQUIRED_PATH)).toBe(true)

    const duplicateProject = await tempCopy(example)
    const pageManifestPath = join(duplicateProject, 'pages/manifest.json')
    const pageManifest = JSON.parse(await readFile(pageManifestPath, 'utf8'))
    pageManifest.pages.push({ ...pageManifest.pages[0], order: 99 })
    await writeFile(pageManifestPath, `${JSON.stringify(pageManifest, null, 2)}\n`)
    const duplicateResult = await validateProjectDirectoryWithAjv(duplicateProject, { allowGitKeep: true })
    expect(duplicateResult.valid).toBe(false)
    expect(duplicateResult.errors.some(issue => issue.code === ERROR_CODES.DUPLICATE_ID)).toBe(true)

    const projectDocument = JSON.parse(await readFile(join(example, 'project.json'), 'utf8'))
    projectDocument.lastModifiedRevision = 7
    const governanceResult = await validateDocumentWithAjv('ProjectManifest', projectDocument)
    expect(governanceResult.valid).toBe(false)
  })
})
