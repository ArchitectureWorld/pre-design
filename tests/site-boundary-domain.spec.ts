import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { afterEach, describe, expect, it } from 'vitest'
import { deriveSiteBoundaryState } from '../src/governance/site-boundary-status.ts'
import { GovernanceRepository } from '../src/governance/repository.ts'
import type { SiteBoundaryGeometryRecord, SiteBoundaryRecord } from '../src/governance/types.ts'
import { siteBoundaryFixture, siteBoundaryOwner } from './site-boundary-fixture.ts'

const roots: string[] = []
const contexts: Context[] = []
const geometry = {
  crs: 'EPSG:4490',
  coordinates: [[0, 0], [4, 0], [0, 3], [0, 0]],
  sha256: 'b'.repeat(64),
  derivedAssetId: 'derived-boundary-map-1',
  derivedFileName: 'project-1/maps/derived-boundary-map-1.svg',
  derivedSha256: 'c'.repeat(64),
} as const satisfies SiteBoundaryGeometryRecord

async function openGovernance(): Promise<GovernanceRepository> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-site-boundary-domain-'))
  roots.push(root)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  return GovernanceRepository.open(ctx.storage.domain)
}

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('site boundary storage contract', () => {
  it('rejects synthetic formal boundaries at the storage boundary', async () => {
    const governance = await openGovernance()
    const syntheticPending = siteBoundaryFixture({
      origin: 'synthetic',
      submissionChannel: 'synthetic_fixture',
      source: 'closed_coordinates',
      sourceAsset: undefined,
      geometry: {
        crs: 'EPSG:4490',
        coordinates: [[0, 0], [4, 0], [0, 3], [0, 0]],
        sha256: 'b'.repeat(64),
        derivedAssetId: 'derived-boundary-map-1',
        derivedFileName: 'project-1/maps/derived-boundary-map-1.svg',
        derivedSha256: 'c'.repeat(64),
      },
    })

    await expect(governance.putSiteBoundary({
      ...syntheticPending,
      status: 'confirmed_formal_boundary',
      confirmedBy: siteBoundaryOwner,
      confirmedAt: '2026-08-30T10:01:00.000Z',
      confirmedRevision: 4,
      confirmationChannel: 'dsh_human_command',
      confirmationStatement: '该图是本项目采用的总平图或红线图，且图中明确表达项目边界',
      confirmationSourceSha256: 'b'.repeat(64),
    })).rejects.toThrow(/synthetic.*formal/iu)
  })

  it('requires frozen attachment evidence for an image-origin boundary', async () => {
    const governance = await openGovernance()
    const missingAttachment = siteBoundaryFixture({
      sourceAsset: {
        assetId: 'boundary-evidence-1',
        fileName: 'project-1/evidence/boundary-evidence-1.png',
        sha256: 'a'.repeat(64),
      },
    })

    await expect(governance.putSiteBoundary(missingAttachment)).rejects.toThrow(/attachment evidence/iu)
  })

  it('requires a derived map identity for a geometry-origin boundary', async () => {
    const governance = await openGovernance()
    const missingDerivedIdentity = siteBoundaryFixture({
      origin: 'user_coordinates',
      source: 'closed_coordinates',
      sourceAsset: undefined,
      geometry: {
        crs: 'EPSG:4490',
        coordinates: [[0, 0], [4, 0], [0, 3], [0, 0]],
        sha256: 'b'.repeat(64),
      } as unknown as SiteBoundaryRecord['geometry'],
    })

    await expect(governance.putSiteBoundary(missingDerivedIdentity)).rejects.toThrow(/derived map identity/iu)
  })

  it('requires the complete human confirmation contract for a formal boundary', async () => {
    const governance = await openGovernance()
    await expect(governance.putSiteBoundary({
      ...siteBoundaryFixture(),
      status: 'confirmed_formal_boundary',
      confirmedBy: siteBoundaryOwner,
      confirmedAt: '2026-08-30T10:01:00.000Z',
      confirmedRevision: 4,
      confirmationChannel: 'synthetic_fixture',
      confirmationStatement: '该图是本项目采用的总平图或红线图，且图中明确表达项目边界',
      confirmationSourceSha256: 'a'.repeat(64),
    })).rejects.toThrow(/formal boundary requires dsh_human_command confirmation/iu)
  })

  it.each([
    ['user_geojson with an approved_redline source and both payloads', siteBoundaryFixture({
      origin: 'user_geojson',
      source: 'approved_redline',
      geometry,
    })],
    ['user_image with a geometry payload mixed into its attachment evidence', siteBoundaryFixture({
      geometry,
    })],
    ['user_coordinates with sourceAsset mixed into its geometry payload', siteBoundaryFixture({
      origin: 'user_coordinates',
      source: 'closed_coordinates',
      geometry,
    })],
  ])('rejects a boundary whose origin/source/payload branch is not closed: %s', async (_name, record) => {
    const governance = await openGovernance()
    await expect(governance.putSiteBoundary(record)).rejects.toThrow(/origin.*source.*payload/iu)
  })

  it.each([
    ['a user origin through synthetic_fixture', siteBoundaryFixture({ submissionChannel: 'synthetic_fixture' })],
    ['a synthetic origin through dsh_human_command', siteBoundaryFixture({ origin: 'synthetic' })],
  ])('rejects an origin/submission channel mismatch: %s', async (_name, record) => {
    const governance = await openGovernance()
    await expect(governance.putSiteBoundary(record)).rejects.toThrow(/origin.*submission channel/iu)
  })

  it('rejects a formal confirmation revision older than its submission revision', async () => {
    const governance = await openGovernance()
    await expect(governance.putSiteBoundary(siteBoundaryFixture({
      status: 'confirmed_formal_boundary',
      confirmedBy: siteBoundaryOwner,
      confirmedAt: '2026-08-30T10:01:00.000Z',
      confirmedRevision: 3,
      confirmationChannel: 'dsh_human_command',
      confirmationStatement: '该图是本项目采用的总平图或红线图，且图中明确表达项目边界',
      confirmationSourceSha256: 'a'.repeat(64),
    }))).rejects.toThrow(/confirmedRevision.*submittedRevision/iu)
  })

  it('persists synthetic research only through the tests-only synthetic fixture channel', async () => {
    const governance = await openGovernance()
    await expect(governance.putSiteBoundary(siteBoundaryFixture({
      origin: 'synthetic',
      submissionChannel: 'synthetic_fixture',
    }))).resolves.toMatchObject({
      origin: 'synthetic',
      submissionChannel: 'synthetic_fixture',
      status: 'pending_confirmation',
    })
  })

  it.each([
    ['user coordinates', siteBoundaryFixture({
      origin: 'user_coordinates',
      source: 'closed_coordinates',
      sourceAsset: undefined,
      geometry,
    })],
    ['user GeoJSON', siteBoundaryFixture({
      origin: 'user_geojson',
      source: 'geojson',
      sourceAsset: undefined,
      geometry,
    })],
    ['synthetic GeoJSON research', siteBoundaryFixture({
      origin: 'synthetic',
      submissionChannel: 'synthetic_fixture',
      source: 'geojson',
      sourceAsset: undefined,
      geometry,
    })],
  ])('persists a valid closed geometry payload branch: %s', async (_name, record) => {
    const governance = await openGovernance()
    await expect(governance.putSiteBoundary(record)).resolves.toMatchObject({
      boundaryId: 'boundary-1',
      geometry: { derivedAssetId: 'derived-boundary-map-1' },
    })
  })
})

describe('deriveSiteBoundaryState', () => {
  it.each([
    ['reports not_provided when no boundary exists', [], 4, { kind: 'not_provided', label: '尚未提供场地边界' }],
    ['reports pending_confirmation for a current human submission', [siteBoundaryFixture()], 4, { kind: 'pending_confirmation', boundaryId: 'boundary-1' }],
    ['reports confirmed_formal_boundary only after the complete human contract', [siteBoundaryFixture({
      status: 'confirmed_formal_boundary',
      confirmedBy: siteBoundaryOwner,
      confirmedAt: '2026-08-30T10:01:00.000Z',
      confirmedRevision: 4,
      confirmationChannel: 'dsh_human_command',
      confirmationStatement: '该图是本项目采用的总平图或红线图，且图中明确表达项目边界',
      confirmationSourceSha256: 'a'.repeat(64),
    })], 4, { kind: 'confirmed_formal_boundary', boundaryId: 'boundary-1' }],
    ['fails closed when confirmation predates the submitted boundary revision', [siteBoundaryFixture({
      status: 'confirmed_formal_boundary',
      confirmedBy: siteBoundaryOwner,
      confirmedAt: '2026-08-30T10:01:00.000Z',
      confirmedRevision: 3,
      confirmationChannel: 'dsh_human_command',
      confirmationStatement: '该图是本项目采用的总平图或红线图，且图中明确表达项目边界',
      confirmationSourceSha256: 'a'.repeat(64),
    })], 4, { kind: 'pending_confirmation', boundaryId: 'boundary-1' }],
    ['reports synthetic_research for a synthetic current boundary', [siteBoundaryFixture({
      origin: 'synthetic',
      submissionChannel: 'synthetic_fixture',
    })], 4, { kind: 'synthetic_research', boundaryId: 'boundary-1', label: '模拟研究范围（不可正式确认）' }],
    ['does not select a legacy record with no origin as a formal boundary', [{
      ...siteBoundaryFixture({
        status: 'confirmed_formal_boundary',
        confirmedBy: siteBoundaryOwner,
        confirmedAt: '2026-08-30T10:01:00.000Z',
        confirmedRevision: 4,
        confirmationChannel: 'dsh_human_command',
        confirmationStatement: '该图是本项目采用的总平图或红线图，且图中明确表达项目边界',
        confirmationSourceSha256: 'a'.repeat(64),
      }),
      origin: undefined,
    } as unknown as SiteBoundaryRecord], 4, { kind: 'not_provided', label: '尚未提供场地边界' }],
  ])('%s', (_name, records, revision, expected) => {
    expect(deriveSiteBoundaryState(records as readonly SiteBoundaryRecord[], revision)).toMatchObject(expected)
  })
})
