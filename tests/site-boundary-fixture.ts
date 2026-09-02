import type { SiteBoundaryRecord } from '../src/governance/types.ts'

export const siteBoundaryOwner = {
  actorId: 'owner-1',
  name: '项目负责人',
  role: 'decision_owner' as const,
}

export function siteBoundaryFixture(
  overrides: Partial<SiteBoundaryRecord> = {},
): SiteBoundaryRecord {
  return {
    boundaryId: 'boundary-1',
    projectId: 'project-1',
    submittedRevision: 4,
    status: 'pending_confirmation',
    source: 'approved_redline',
    origin: 'user_image',
    submissionChannel: 'dsh_human_command',
    sourceAsset: {
      assetId: 'boundary-evidence-1',
      fileName: 'project-1/evidence/boundary-evidence-1.png',
      sha256: 'a'.repeat(64),
      attachment: {
        origin: 'user_image',
        attachmentId: 'attachment-1',
        mediaType: 'image/png',
        displayName: 'redline.png',
        bytes: 68,
        width: 1,
        height: 1,
        storageSha256: 'a'.repeat(64),
        submittedBy: siteBoundaryOwner,
        submittedRevision: 4,
      },
    },
    submittedBy: siteBoundaryOwner,
    submittedAt: '2026-08-30T10:00:00.000Z',
    ...overrides,
  }
}
