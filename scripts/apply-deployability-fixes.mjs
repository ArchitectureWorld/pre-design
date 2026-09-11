import { readFile, writeFile } from 'node:fs/promises'

async function replaceOnce(path, before, after) {
  const source = await readFile(path, 'utf8')
  const first = source.indexOf(before)
  if (first < 0) throw new Error(`${path}: patch target not found`)
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`${path}: patch target is not unique`)
  await writeFile(path, source.slice(0, first) + after + source.slice(first + before.length))
  console.log(`patched ${path}`)
}

// Authorization must be validated before automatic quality, then quality guards confirmation.
await replaceOnce(
  'src/proposals/gateway.ts',
`    if (decision.source === 'automation_authorization') {
      requireAutomaticQuality(descriptor, decision.quality)
      approvalActor = this.requireValidAuthorization(
        context.project.projectId,
        context.project.currentRevision,
        descriptor,
        decision.authorizationId,
        committedAt,
      )
    }`,
`    if (decision.source === 'automation_authorization') {
      approvalActor = this.requireValidAuthorization(
        context.project.projectId,
        context.project.currentRevision,
        descriptor,
        decision.authorizationId,
        committedAt,
      )
      requireAutomaticQuality(descriptor, decision.quality)
    }`,
)

// When an analytical visual is correctly withheld for lack of evidence, keep the page visual
// by reusing a real project asset as backdrop rather than fabricating analytical content.
await replaceOnce(
  'src/report/page-plan.ts',
`  return pages.map(page => {
    const isTarget = page.pageId === 'opening-project' || page.pageId === 'opening-value' || page.kind === 'chapter-divider'
    if (!isTarget) return page
    const material = materialConcepts.find(asset => !usedBackdropIds.has(asset.assetId))`,
`  return pages.map(page => {
    const isTarget = page.pageId === 'opening-project' || page.pageId === 'opening-value' || page.kind === 'chapter-divider'
    const isSparseContentPage = page.assetIds.length === 0
      && page.analyticalVisual === undefined
      && page.backdropAssetId === undefined
      && page.kind !== 'cover'
      && page.kind !== 'opening-claim'
      && page.kind !== 'chapter-divider'
      && page.kind !== 'appendix'
      && page.kind !== 'decision'
      && page.pageId !== 'closing-decision'
    if (!isTarget && !isSparseContentPage) return page
    const material = materialConcepts.find(asset => !usedBackdropIds.has(asset.assetId))`,
)

// Report plan: no evidence means no synthetic demand matrix.
await replaceOnce(
  'tests/report-page-plan.spec.ts',
`    expect(visualKind('chapter-08-block-02')).toBe('daypart-matrix')
    expect(pages.find(page => page.pageId === 'chapter-08-block-02')?.analyticalVisual).toMatchObject({
      kind: 'daypart-matrix',
      values: [
        ['高', '中', '低'],
        ['中', '高', '高'],
        ['中', '高', '高'],
      ],
    })`,
`    expect(visualKind('chapter-08-block-02')).toBeUndefined()
    expect(pages.find(page => page.pageId === 'chapter-08-block-02')?.analyticalVisual).toBeUndefined()`,
)
await replaceOnce(
  'tests/report-page-plan.spec.ts',
`  it('assigns material concept backdrops only to HTML opening and chapter divider pages', () => {`,
`  it('assigns real project backdrops to HTML opening, chapter dividers, and sparse content pages', () => {`,
)
await replaceOnce(
  'tests/report-page-plan.spec.ts',
`    expect(htmlPlan.pages.filter(page => !backdropTargets.includes(page)).every(page => page.backdropAssetId === undefined)).toBe(true)
    expect(pptxPlan.pages.every(page => page.backdropAssetId === undefined)).toBe(true)`,
`    const sparseContentPages = htmlPlan.pages.filter(page => !backdropTargets.includes(page)
      && page.assetIds.length === 0
      && page.analyticalVisual === undefined
      && page.kind !== 'cover'
      && page.kind !== 'opening-claim'
      && page.kind !== 'decision')
    expect(sparseContentPages.some(page => page.backdropAssetId !== undefined)).toBe(true)
    expect(pptxPlan.pages.every(page => page.backdropAssetId === undefined)).toBe(true)`,
)

// HTML/PDF/PPTX expectations follow the evidence-safe no-fabrication rule.
await replaceOnce(
  'tests/report-html.spec.ts',
`    for (const kind of ['urgency-signals', 'spatial-sequence', 'public-operation', 'daypart-matrix', 'decision-triad', 'decision-flow']) {
      expect(html).toContain(\`data-analysis-kind=\"\${kind}\"\`)
    }
    const investment`,
`    for (const kind of ['urgency-signals', 'spatial-sequence', 'public-operation', 'decision-triad', 'decision-flow']) {
      expect(html).toContain(\`data-analysis-kind=\"\${kind}\"\`)
    }
    expect(html).not.toContain('data-analysis-kind="daypart-matrix"')
    const investment`,
)
await replaceOnce(
  'tests/report-pdf.spec.ts',
`    expect(operationEvidence?.querySelector('[data-analysis-kind="daypart-matrix"]')).not.toBeNull()`,
`    expect(operationEvidence?.querySelector('[data-analysis-kind="daypart-matrix"]')).toBeNull()`,
)
await replaceOnce(
  'tests/report-pdf.spec.ts',
`    const matrix = page('28')
    expect(Array.from(matrix?.querySelectorAll('.analysis-matrix td') ?? []).map(cell => cell.textContent?.trim())).toEqual([
      '高', '中', '低',
      '中', '高', '高',
      '中', '高', '高',
    ])`,
`    const matrix = page('28')
    expect(Array.from(matrix?.querySelectorAll('.analysis-matrix td') ?? []).map(cell => cell.textContent?.trim())).toEqual([])
    expect(matrix?.querySelector('[data-analysis-kind="daypart-matrix"]')).toBeNull()`,
)
await replaceOnce(
  'tests/report-pptx.spec.ts',
`    for (const label of ['日常休闲', '周末活动', '城市节庆', '周边居民', '城市家庭', '青年客群']) {
      expect(deck.slideTexts[matrix - 1]).toContain(label)
    }`,
`    expect(deck.slideTexts[matrix - 1]).toContain('多时段内容组合提升设施与空间使用效率')
    expect(deck.slideTexts[matrix - 1]).toContain('项目证据 9 支撑对应的客户判断。')
    for (const fabricatedLabel of ['周边居民', '城市家庭', '青年客群']) {
      expect(deck.slideTexts[matrix - 1]).not.toContain(fabricatedLabel)
    }`,
)

// Non-renderable source materials remain traceable originals but are not promoted to visual assets.
await replaceOnce(
  'tests/presentation-material-runtime.spec.ts',
`  it('loads registered originals and formal data assets in manual synchronization', async () => {`,
`  it('loads registered originals without promoting non-renderable data into visual assets in manual synchronization', async () => {`,
)
await replaceOnce(
  'tests/presentation-material-runtime.spec.ts',
`      sourceMaterials: [expect.objectContaining({ sourceKey: 'site-metrics', sourcePath: join(root, '原件', '指标.csv') })],
      assets: [expect.objectContaining({ sourceKey: 'site-metrics', evidenceIds: ['ev-site-metrics'], aliases: ['legacy-data-asset'], role: 'reference', rowCount: 1 })],`,
`      sourceMaterials: [expect.objectContaining({ sourceKey: 'site-metrics', sourcePath: join(root, '原件', '指标.csv') })],
      assets: [],`,
)
await replaceOnce(
  'tests/presentation-material-runtime.spec.ts',
`        sourceMaterials: [expect.objectContaining({ sourceKey: 'site-metrics' })],
        assets: [expect.objectContaining({ sourceKey: 'site-metrics' })],`,
`        sourceMaterials: [expect.objectContaining({ sourceKey: 'site-metrics' })],
        assets: [],`,
)
await replaceOnce(
  'tests/presentation-page-visual-fill.spec.ts',
`    expect((await preparePresentationMaterials({ frozenProject: source, workspaceRoot: root })).assets).toHaveLength(1)`,
`    const preparedCad = await preparePresentationMaterials({ frozenProject: source, workspaceRoot: root })
    expect(preparedCad.assets).toHaveLength(0)
    expect(preparedCad.sourceMaterials).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceKey: 'cad', mimeType: 'image/vnd.dwg' }),
    ]))`,
)

// Proposal matrix tests now provide central trusted quality and explicitly preserve local review for H-risk workflows.
await replaceOnce(
  'tests/proposal-gateway-all-workflows.spec.ts',
`async function envelopeFor(descriptor: WorkflowDescriptor, expectedRevision = 0) {`,
`function qualityFor(descriptor: WorkflowDescriptor, attempt = 1) {
  return {
    workflowId: descriptor.workflowId,
    targetObjectId: descriptor.targetObjectId,
    disposition: 'auto_pass' as const,
    score: 0.95,
    completionCoverage: 1,
    evidenceCoverage: 1,
    confidence: 0.9,
    attempt,
    maxAttempts: 3,
    reasons: [],
    blockers: [],
    assumptions: [],
  }
}

async function envelopeFor(descriptor: WorkflowDescriptor, expectedRevision = 0) {`,
)
await replaceOnce(
  'tests/proposal-gateway-all-workflows.spec.ts',
`    const result = await gateway.commitProposal('proposal-PS01', {
      source: 'automation_authorization',
      authorizationId: 'authorization-1',
      actor: { actorId: 'system-1', name: '前期策划运行时', role: 'system_service' },
    }, sessionId)`,
`    const ps01 = registry.workflow('preplan.wf.01.01')
    const result = await gateway.commitProposal('proposal-PS01', {
      source: 'automation_authorization',
      authorizationId: 'authorization-1',
      quality: qualityFor(ps01),
      actor: { actorId: 'system-1', name: '前期策划运行时', role: 'system_service' },
    }, sessionId)`,
)
await replaceOnce(
  'tests/proposal-gateway-all-workflows.spec.ts',
`  it('automatically commits every schema-valid workflow payload without injecting unsupported data fields', async () => {`,
`  it('automatically commits quality-passing L/M workflows while keeping H-risk workflows for local review', async () => {`,
)
await replaceOnce(
  'tests/proposal-gateway-all-workflows.spec.ts',
`      const result = await gateway.commitProposal(envelope.proposal_id, {
        source: 'automation_authorization',
        authorizationId: 'authorization-all',
        actor: { actorId: 'system-1', name: '前期策划运行时', role: 'system_service' },
      }, sessionId)
      revision += 1
      expect(result.revision, descriptor.targetObjectId).toBe(revision)
      const committed = repository.readContext(sessionId).stateObjects
        .find(row => row.objectId === descriptor.targetObjectId)
      expect(registry.validateStateObject(descriptor.targetObjectId, committed?.value), descriptor.targetObjectId)
        .toEqual({ valid: true, errors: [] })`,
`      const automaticDecision = {
        source: 'automation_authorization' as const,
        authorizationId: 'authorization-all',
        quality: qualityFor(descriptor),
        actor: { actorId: 'system-1', name: '前期策划运行时', role: 'system_service' },
      }
      if (descriptor.risk.trim().toUpperCase() === 'H' || descriptor.risk.trim().toLowerCase() === 'high') {
        await expect(gateway.commitProposal(envelope.proposal_id, automaticDecision, sessionId), descriptor.targetObjectId)
          .rejects.toMatchObject({ code: 'high-risk-human-review' })
        continue
      }
      const result = await gateway.commitProposal(envelope.proposal_id, automaticDecision, sessionId)
      revision += 1
      expect(result.revision, descriptor.targetObjectId).toBe(revision)
      const committed = repository.readContext(sessionId).stateObjects
        .find(row => row.objectId === descriptor.targetObjectId)
      expect(registry.validateStateObject(descriptor.targetObjectId, committed?.value), descriptor.targetObjectId)
        .toEqual({ valid: true, errors: [] })`,
)

console.log('deployability fix pass completed')
