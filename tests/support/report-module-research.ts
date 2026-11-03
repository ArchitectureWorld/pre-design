import type { FrozenModuleResearch } from '../../src/report/module-source.ts'
import { getModuleFieldContracts } from '../../src/research-v2/module-contracts.ts'

/** Projection fixture; actual snapshot/native acceptance is covered by report-module-source.spec. */
export function reportModuleResearchFixture(fingerprint = 'research-a', manifestRunId = 'run-a'): FrozenModuleResearch {
  const contract = getModuleFieldContracts('1.01')
  return { selectionId: 'private-selection', manifestRunId, snapshotId: 'private-snapshot', snapshotHash: 'a'.repeat(64),
    catalogHash: 'catalog', planHash: 'plan', corpusFingerprint: 'corpus', taskBrief: 'PRIVATE RAW TASK TRANSCRIPT',
    expectedModuleIds: ['1.01'], limitations: [], fingerprint,
    moduleRuns: [{ itemId: '1.01', status: 'completed', bundleRunId: 'bundle', resultHash: 'b'.repeat(64) }],
    results: [{ itemId: '1.01', moduleId: contract.moduleId, outputs: Object.fromEntries(Object.entries(contract.ports).map(([name, port]) => [name, {
      type: port.type, quality: 'limited', records: [], claimRefs: [], scope: '少潭河生态游憩与研学策划；实施范围待边界复核。',
      asOf: '2026-09-26', limitations: ['历史资料不能证明当前运营状态。'],
    }])), claims: [], sourceValues: [], limitations: ['委托范围仍须业主确认。'] }],
  } as unknown as FrozenModuleResearch
}
