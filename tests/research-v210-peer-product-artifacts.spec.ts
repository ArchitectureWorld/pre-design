import { describe, expect, it } from 'vitest'
import * as execution from '../src/research-v2/module-execution.ts'
import { getModuleFieldContracts } from '../src/research-v2/module-contracts.ts'
import { sha256CanonicalJson as hash } from '../src/presentation/canonical-json.ts'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getResearchModuleSpec } from '../src/research-v2/specification.ts'

function candidate() {
  const records = ['peer-a', 'peer-b'].map((peerId, index) => ({ recordId: `record-${index}`,
    ...Object.fromEntries(getModuleFieldContracts('3.05').ports.peer_products.fields.map(field => [field.name,
      { value: null, claimClass: 'missing', limitations: ['本次未核。'], claimRefs: [] }])),
    peerId: { value: peerId, claimClass: 'decision', limitations: ['研究编号。'], claimRefs: [`id-${index}`] },
    coreProduct: { value: index ? '露营' : '<img src=x onerror=alert(1)>', claimClass: 'source_conclusion', limitations: ['仅来源描述。'], claimRefs: [`product-${index}`] },
  }))
  const claims = records.flatMap((record, index) => [
    { claimId: `id-${index}`, selector: `/outputs/peer_products/records/${index}/peerId/value`, kind: 'proposal', value: record.peerId.value, rationale: '本轮内部研究编号。' },
    { claimId: `product-${index}`, selector: `/outputs/peer_products/records/${index}/coreProduct/value`, kind: 'source', value: record.coreProduct.value, sourceId: `source-${index}` },
  ])
  return { outputs: { peer_products: { quality: 'limited', scope: '测试', asOf: '2026-10-05', limitations: ['资料有界。'], records } },
    claims, sourceValues: records.map((record, index) => ({ sourceId: `source-${index}`, path: `sources/${index}.txt`, contentHash: 'a'.repeat(64),
      quote: record.coreProduct.value, rawValue: record.coreProduct.value })), limitations: ['资料有界。'], steps: [] }
}
function build(value = candidate()): any {
  const fn = (execution as Record<string, unknown>).buildPeerProductArtifacts
  expect(typeof fn, 'native module execution must produce reviewable peer-product artifacts').toBe('function')
  return (fn as (value: unknown) => unknown)(value)
}

describe('native peer-product artifacts use the exact candidate and preserve evidence boundaries', () => {
  it('produces an actual native HTML matrix with every field and null retained, and binds each cell to its candidate selector', () => {
    const value = candidate(), before = hash(value), audit = build(value)
    expect(hash(value)).toBe(before)
    expect(audit.candidateHash).toBe(before)
    expect(audit.publicationGranted).toBe(false)
    expect(audit.cells).toHaveLength(36)
    const cell = audit.cells.find((c: any) => c.recordId === 'record-0' && c.field === 'coreProduct')
    expect(cell).toMatchObject({ selector: '/outputs/peer_products/records/0/coreProduct/value', value: value.outputs.peer_products.records[0].coreProduct.value,
      claimRefs: ['product-0'], sourceIds: ['source-0'] })
    const missing = audit.cells.find((c: any) => c.recordId === 'record-0' && c.field === 'price')
    expect(missing).toMatchObject({ value: null, claimClass: 'missing', claimRefs: [], sourceIds: [] })
    expect(audit.files['items/3.05/TAB-3.05.html']).toContain('data-selector="/outputs/peer_products/records/0/coreProduct/value"')
    expect(audit.files['items/3.05/TAB-3.05.html']).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(audit.files['items/3.05/TAB-3.05.html']).not.toContain('<img src=x')
    expect(JSON.parse(audit.files['items/3.05/peer-offers.json'])).toEqual(value.outputs.peer_products)
    expect(audit.artifacts.find((a: any) => a.artifactId === 'FIG-3.05-02').state).toBe('omitted')
  })
  it('does not manufacture a unified taxonomy or operating share from unclassified records', () => {
    const audit = build()
    expect(audit.artifacts.find((a: any) => a.artifactId === 'FIG-3.05-01').state).toBe('omitted')
    expect(audit.files['items/3.05/FIG-3.05-01.html']).toBeUndefined()
  })
  it('renders the authored taxonomy and operating/planned status without filling unobserved combinations as zero', () => {
    const value: any = candidate()
    value.outputs.peer_products.records.forEach((record: any, index: number) => {
      for (const [field, text] of [['formatId', index ? '餐饮' : '露营'], ['status', index ? 'planned' : 'operating'], ['classificationBasis', '本轮研究分类']]) {
        record[field] = { value: text, claimClass: 'decision', limitations: ['仅研究选择。'], claimRefs: [`${field}-${index}`] }
        value.claims.push({ claimId: `${field}-${index}`, selector: `/outputs/peer_products/records/${index}/${field}/value`, kind: 'proposal', value: text, rationale: '本轮研究选择。' })
      }
    })
    const audit = build(value), html = audit.files['items/3.05/FIG-3.05-01.html']
    expect(html).toContain('餐饮')
    expect(html).toContain('planned')
    expect(html).toContain('未核')
    expect(html).not.toContain('100%')
  })
  it('replays rendered bytes and rejects a substituted cell', () => {
    const value = candidate(), audit = build(value)
    const verify = (execution as Record<string, unknown>).verifyPeerProductArtifacts as (value: unknown, audit: unknown) => void
    expect(typeof verify).toBe('function')
    expect(() => verify(value, audit)).not.toThrow()
    audit.cells[0].value = 'substituted-business-id'
    expect(() => verify(value, audit)).toThrow('MODULE_PEER_ARTIFACT_MISMATCH')
  })
  it('archives the actual HTML and rejects substituted archived bytes even with a recomputed file manifest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'native-peer-artifact-test-'))
    try {
      const value: any = candidate(), digest = (s: string) => createHash('sha256').update(s).digest('hex')
      const documents = value.sourceValues.map((source: any) => {
        source.contentHash = digest(source.quote)
        return { path: source.path, text: source.quote, contentHash: source.contentHash, byteLength: Buffer.byteLength(source.quote) }
      })
      const corpus = { documents, limitations: [], fingerprint: digest(JSON.stringify({ documents, limitations: [] })) }
      const validateOutputs = () => undefined
      const run = await execution.runModuleExecution({ workspaceRoot: root, projectId: 'test', snapshotId: 'test', corpus,
        flags: { industryPlanning: false, existingBuildings: false, externalPartners: false, marketing: false }, moduleIds: ['3.05'] },
      { validateOutputs, analyze: async context => {
        if (context.module.id !== '3.05') return { outputs: Object.fromEntries(context.module.ports.map(port => [port.name,
          { type: port.type, quality: 'limited', scope: '测试', asOf: '2026-10-05', limitations: ['测试来源。'], claimRefs: ['text-'+port.name], records: [{ text: documents[0].text }] }])),
          claims: context.module.ports.map(port => ({ claimId: 'text-'+port.name, selector: `/outputs/${port.name}/records/0/text`, kind: 'source' as const,
            value: documents[0].text, sourceId: 'source-0' })), sourceValues: value.sourceValues, limitations: ['测试来源。'] }
        value.outputs.peer_products.type = context.module.ports[0].type
        value.outputs.peer_products.claimRefs = value.claims.map((claim: any)=>claim.claimId)
        const steps = [1,2,3,4].map(step=>({ step, status:'limited' as const, summary:'测试实际数据归档。', claimRefs:[], limitations:['仅测试。'] }))
        const candidate = { ...value, steps }, artifacts = build(candidate)
        return { ...value, execution: { kind:'full-candidate-v1' as const, executionId:'author', childId:'author-child', actualModel:{provider:'test',model:'test'}, stopReason:'completed',
          steps, peerProductArtifacts:artifacts, reviewReceipts:[{executionId:'review',childId:'review-child',actualModel:{provider:'test',model:'test'},stopReason:'completed',
            candidateHash:hash(candidate),peerProductArtifactsHash:hash(artifacts),checks:getResearchModuleSpec('3.05').qa.map(criterion=>({criterion,status:'limited' as const,rationale:'测试限制。',claimRefs:[]})),limitations:['测试限制。']}] } }
      } })
      const row = run.moduleRuns.find(row=>row.itemId==='3.05')!
      expect(run.moduleRuns.filter(row=>row.status==='failed' && row.itemId!=='3.05')).toEqual([])
      expect(row.error).toBeUndefined()
      expect(row.status).toBe('limited')
      const loaded = await execution.readModuleExecutionResult(root,row.bundleRunId!,{validateOutputs})
      expect(loaded.execution?.peerProductArtifacts).toBeDefined()
      const artifactPath = join(root,'research','runs',row.bundleRunId!,'items','3.05','TAB-3.05.html')
      expect(await readFile(artifactPath,'utf8')).toEqual(loaded.execution?.peerProductArtifacts?.files['items/3.05/TAB-3.05.html'])
      const changed = 'substituted HTML'
      await writeFile(artifactPath,changed)
      const manifestPath=join(root,'research','runs',row.bundleRunId!,'manifest.json'), manifest=JSON.parse(await readFile(manifestPath,'utf8'))
      const file=manifest.files.find((file: any)=>file.path==='items/3.05/TAB-3.05.html')
      file.sha256=digest(changed);file.sizeBytes=Buffer.byteLength(changed)
      const {manifestHash:_old,...core}=manifest;manifest.manifestHash=hash(core)
      await writeFile(manifestPath,JSON.stringify(manifest))
      await expect(execution.readModuleExecutionResult(root,row.bundleRunId!,{validateOutputs})).rejects.toThrow('MODULE_PEER_ARTIFACT_FILE_MISMATCH')
    } finally { await rm(root,{recursive:true,force:true}) }
  })
})
