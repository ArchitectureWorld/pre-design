import type { SiteBoundaryRecord, SiteBoundaryStateSummary } from './types.ts'

const NOT_PROVIDED: SiteBoundaryStateSummary = {
  kind: 'not_provided',
  label: '尚未提供场地边界',
  nextAction: '请提供总平图、红线图或闭合红线坐标。',
}

function hasFormalConfirmation(record: SiteBoundaryRecord, revision: number): boolean {
  if (record.status !== 'confirmed_formal_boundary'
    || record.origin === 'synthetic'
    || record.submissionChannel !== 'dsh_human_command'
    || record.confirmationChannel !== 'dsh_human_command'
    || record.confirmedBy?.role !== 'decision_owner'
    || record.confirmedAt === undefined
    || record.confirmedRevision === undefined
    || record.confirmedRevision < record.submittedRevision
    || record.confirmedRevision > revision
    || record.confirmationStatement !== '该图是本项目采用的总平图或红线图，且图中明确表达项目边界'
    || record.confirmationSourceSha256 !== (record.sourceAsset?.sha256 ?? record.geometry?.sha256)) return false
  if (record.origin === 'user_image') return record.sourceAsset?.attachment !== undefined
  return record.geometry?.derivedAssetId !== undefined
    && record.geometry.derivedFileName !== undefined
    && record.geometry.derivedSha256 !== undefined
}

export function deriveSiteBoundaryState(
  records: readonly SiteBoundaryRecord[],
  revision: number,
): SiteBoundaryStateSummary {
  const current = records
    .filter(record => record.submittedRevision <= revision)
    .sort((left, right) => (right.submittedRevision - left.submittedRevision)
      || right.submittedAt.localeCompare(left.submittedAt)
      || right.boundaryId.localeCompare(left.boundaryId))[0]
  if (current === undefined || current.origin === undefined) return NOT_PROVIDED
  if (current.origin === 'synthetic') {
    return {
      kind: 'synthetic_research',
      boundaryId: current.boundaryId,
      source: current.source,
      label: '模拟研究范围（不可正式确认）',
      nextAction: '请提供真实总平图、红线图或带 CRS 的闭合几何',
    }
  }
  if (hasFormalConfirmation(current, revision)) {
    return {
      kind: 'confirmed_formal_boundary',
      boundaryId: current.boundaryId,
      source: current.source,
      label: '场地边界已正式确认',
      nextAction: '可作为正式边界用于后续工作。',
    }
  }
  return {
    kind: 'pending_confirmation',
    boundaryId: current.boundaryId,
    source: current.source,
    label: '场地边界待项目负责人确认',
    nextAction: '请项目负责人确认采用当前边界表达。',
  }
}
