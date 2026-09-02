# DSH Client Report v0.8 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Build a replaceable client-report projection that produces client-ready HTML, PPTX, and PDF while keeping DSH governance facts in internal metadata and attachments.

**Architecture:** FrozenProjectInput remains the internal snapshot. createClientReportBundle() combines that snapshot with a project profile into a pure ClientReport plus separate ArtifactIdentity and GovernanceAppendix. Media page planners and renderers consume only ClientReport and write identity solely to invisible metadata; policy and artifact validators fail closed before atomic publication.

**Tech Stack:** TypeScript 5.9 ESM, Vitest 3, PptxGenJS 4, Edge headless PDF, Node.js filesystem and crypto APIs, pnpm, tsdown.

**Spec:** docs/superpowers/specs/2026-08-29-dsh-client-report-v080-design.md

## Global Constraints

- Work on branch feat/client-report-v0.8.0 in the existing linked worktree.
- Keep package version 0.7.0 until engineering, Golden, visual QA, and real DSH acceptance pass.
- Preserve the v0.7.0 Golden and every existing governance, workflow, manifest, download, and recovery contract.
- Renderers must contain no project-name branching and no literal 鄂州, 明塘, or 洋澜湖 conditions.
- Client-visible content must exclude Gate IDs, Workflow IDs, Revision labels, work-item status, logs, JSON, manifest paths, and local paths.
- ArtifactIdentity may appear only in file properties, presenter notes, manifest, or invisible HTML metadata.
- HTML, PPTX, and PDF must derive from one ClientReport and the same adopted asset IDs.
- Every production behavior follows RED → observed failure → minimal GREEN → refactor.
- Do not overwrite an output directory that already contains artifact-manifest.json.

---

### Task 1: Client model, project profile, and projection boundary

**Files:**
- Create: src/report/client-types.ts
- Create: src/report/client-projection.ts
- Create: tests/client-report-fixture.ts
- Create: tests/client-report-projection.spec.ts
- Modify: src/report/types.ts
- Modify: src/report/theme.ts

**Interfaces:**
- Consumes: FrozenProjectInput from src/report/types.ts and ClientProjectProfile from src/report/client-types.ts.
- Produces: createClientReportBundle(input, profile): ClientReportBundle.
- Produces: ClientReport, ArtifactIdentity, GovernanceAppendix, ClientProjectProfile, ClientRenderContext.
- Produces: createClientTheme(overrides): ClientTheme.

- [ ] **Step 1: Write the projection RED test**

~~~ts
import { describe, expect, it } from 'vitest'
import { createClientReportBundle } from '../src/report/client-projection.ts'
import { CLIENT_PROFILE, REPORT_INPUT } from './client-report-fixture.ts'

describe('createClientReportBundle', () => {
  it('keeps governance identity outside the client report', () => {
    const bundle = createClientReportBundle(REPORT_INPUT, CLIENT_PROFILE)

    expect(bundle.report.identity.projectName).toBe('滨江文化活力区前期策划')
    expect(bundle.report.chapters.map(chapter => chapter.role)).toEqual([
      'brief', 'diagnosis', 'opportunity', 'positioning', 'strategy',
      'product', 'spatial', 'operation', 'implementation', 'decision',
    ])
    expect(JSON.stringify(bundle.report)).not.toMatch(/Gate|Revision|Workflow|R57/iu)
    expect(bundle.identity).toEqual({
      projectId: 'golden-project',
      sourceRevision: 57,
      recommendationId: 'recommendation-r57-cultural-riverfront',
      adoptedAssetIds: ['concept-1'],
    })
    expect(bundle.governanceAppendix.gateDecisions).toHaveLength(8)
  })

  it('rejects a chapter blueprint that cites a missing frozen object', () => {
    const broken = {
      ...CLIENT_PROFILE,
      chapters: CLIENT_PROFILE.chapters.map((chapter, index) =>
        index === 0 ? { ...chapter, sourceObjectIds: ['missing-object'] } : chapter),
    }
    expect(() => createClientReportBundle(REPORT_INPUT, broken))
      .toThrow(/missing frozen object missing-object/u)
  })
})
~~~

- [ ] **Step 2: Run the projection test and verify RED**

Run: pnpm exec vitest run tests/client-report-projection.spec.ts

Expected: FAIL because src/report/client-projection.ts does not exist.

- [ ] **Step 3: Add the exact client contracts**

In src/report/client-types.ts define the interfaces from design spec sections 5–7, plus:

~~~ts
export interface ClientRenderContext {
  readonly report: ClientReport
  readonly plan: ClientPagePlan
  readonly identity: ArtifactIdentity
}

export interface ClientReportBundle {
  readonly report: ClientReport
  readonly identity: ArtifactIdentity
  readonly governanceAppendix: GovernanceAppendix
}
~~~

Keep FrozenProjectInput and RenderedArtifact in src/report/types.ts; re-export client contracts from that file only where existing imports require a stable public path.

In src/report/theme.ts add DEFAULT_CLIENT_THEME with the exact semantic colors, fonts, grid, type scale, and motion values from Task 3. Add createClientTheme() as a deep-frozen nested merge so the projection never creates theme objects itself.

- [ ] **Step 4: Implement the minimal projection**

~~~ts
export function createClientReportBundle(
  input: FrozenProjectInput,
  profile: ClientProjectProfile,
): ClientReportBundle {
  if (input.projectId !== profile.identity.projectId) {
    throw new Error('client profile project does not match frozen project')
  }
  const sourceObjects = new Set(input.stateObjects.map(object => object.objectId))
  for (const chapter of profile.chapters) {
    for (const objectId of chapter.sourceObjectIds) {
      if (!sourceObjects.has(objectId)) throw new Error('missing frozen object ' + objectId)
    }
  }
  const report = deepFreeze({
    schemaVersion: 'preplan.client-report.v1' as const,
    identity: profile.identity,
    proposition: profile.proposition,
    chapters: profile.chapters.map(({ sourceObjectIds: _sourceObjectIds, ...chapter }) => chapter),
    products: profile.products,
    evidence: profile.evidence,
    assets: bindClientAssets(input.visualAssets, profile.assetBindings),
    theme: createClientTheme(profile.themeOverrides),
  })
  return deepFreeze({
    report,
    identity: {
      projectId: input.projectId,
      sourceRevision: input.revision,
      recommendationId: input.recommendationId ?? 'recommendation-r' + input.revision,
      adoptedAssetIds: [...(input.adoptedAssetIds ?? [])],
    },
    governanceAppendix: {
      sourceRevision: input.revision,
      gateDecisions: [...input.gates],
      workflowCounts: {
        total: input.stateObjects.length,
        completed: input.stateObjects.length,
        blocked: input.gates.filter(gate => gate.decision === 'blocked').length,
      },
    },
  })
}
~~~

bindClientAssets() must require one binding for every rendered asset and copy sourcePath/caption from FrozenProjectInput while taking role, chapterId, productId, hash, dimensions, and disclosure from the binding.

- [ ] **Step 5: Verify GREEN and existing source contracts**

Run: pnpm exec vitest run tests/client-report-projection.spec.ts tests/report-source.spec.ts tests/report-document.spec.ts

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

~~~powershell
git add src/report/client-types.ts src/report/client-projection.ts src/report/types.ts src/report/theme.ts tests/client-report-fixture.ts tests/client-report-projection.spec.ts
git commit -m "feat: add client report projection boundary"
~~~

### Task 2: Client-content policy and fail-closed validation

**Files:**
- Create: src/report/client-policy.ts
- Create: tests/client-report-policy.spec.ts

**Interfaces:**
- Consumes: ClientReport.
- Produces: validateClientReportPolicy(report): readonly ClientPolicyViolation[].
- Produces: assertClientReportPolicy(report): void.

- [ ] **Step 1: Write policy RED tests**

~~~ts
import { describe, expect, it } from 'vitest'
import { assertClientReportPolicy, validateClientReportPolicy } from '../src/report/client-policy.ts'
import { CLIENT_REPORT } from './client-report-fixture.ts'

describe('client report policy', () => {
  it('reports the exact client path for internal governance vocabulary', () => {
    const report = {
      ...CLIENT_REPORT,
      chapters: CLIENT_REPORT.chapters.map((chapter, index) =>
        index === 0 ? { ...chapter, claim: 'Gate G1 已通过 Revision 57' } : chapter),
    }
    expect(validateClientReportPolicy(report)).toContainEqual({
      code: 'CLIENT_FORBIDDEN_TERM',
      path: 'chapters[0].claim',
      message: expect.stringMatching(/Gate/u),
    })
  })

  it('rejects unsupported evidence and undisclosed AI assets', () => {
    const report = {
      ...CLIENT_REPORT,
      evidence: [{ ...CLIENT_REPORT.evidence[0]!, sourceLabel: '' }],
      assets: [{
        ...CLIENT_REPORT.assets[0]!,
        sourceKind: 'ai-concept' as const,
        disclosure: undefined,
      }],
    }
    expect(() => assertClientReportPolicy(report)).toThrow(
      /EVIDENCE_SOURCE_MISSING.*AI_DISCLOSURE_MISSING/su,
    )
  })
})
~~~

- [ ] **Step 2: Run and verify RED**

Run: pnpm exec vitest run tests/client-report-policy.spec.ts

Expected: FAIL because src/report/client-policy.ts does not exist.

- [ ] **Step 3: Implement path-aware validation**

~~~ts
const CLIENT_FORBIDDEN = /\b(?:Gate|Workflow|Revision|approved_with_conditions|returned|blocked)\b|工作项|完成度|审批状态|artifact-manifest|[A-Z]:[\\/]/iu

export function validateClientReportPolicy(report: ClientReport): ClientPolicyViolation[] {
  const violations: ClientPolicyViolation[] = []
  walkStrings(report, (path, value) => {
    const match = value.match(CLIENT_FORBIDDEN)
    if (match !== null) {
      violations.push({
        code: 'CLIENT_FORBIDDEN_TERM',
        path,
        message: 'client-visible text contains ' + match[0],
      })
    }
  })
  validateEvidence(report, violations)
  validateAssets(report, violations)
  validateReferences(report, violations)
  validateHeadlineRatio(report, violations)
  return violations
}

export function assertClientReportPolicy(report: ClientReport): void {
  const violations = validateClientReportPolicy(report)
  if (violations.length > 0) {
    throw new Error(violations.map(row => row.code + ' ' + row.path + ': ' + row.message).join('\n'))
  }
}
~~~

Evidence validation must emit EVIDENCE_SOURCE_MISSING for blank sourceLabel/sourceDate/locator; calculations must emit CALCULATION_CONTRACT_MISSING when unit or assumption is absent; AI assets must emit AI_DISCLOSURE_MISSING; unknown evidence/product/asset references must emit REFERENCE_NOT_FOUND; fewer than 80% conclusion-style chapter headlines must emit CLAIM_TITLE_RATIO_LOW.

- [ ] **Step 4: Verify GREEN**

Run: pnpm exec vitest run tests/client-report-policy.spec.ts tests/client-report-projection.spec.ts

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

~~~powershell
git add src/report/client-policy.ts tests/client-report-policy.spec.ts
git commit -m "feat: enforce client report content policy"
~~~

### Task 3: Project theme overrides and media page planning

**Files:**
- Create: src/report/page-plan.ts
- Create: tests/report-page-plan.spec.ts
- Create: tests/report-project-profile.spec.ts
- Modify: src/report/theme.ts
- Modify: tests/client-report-fixture.ts

**Interfaces:**
- Consumes: ClientReport and ClientMedium.
- Produces: createClientTheme(overrides): ClientTheme.
- Produces: planClientPages(report, medium): ClientPagePlan.
- Produces: validateClientPagePlan(plan): readonly ClientPolicyViolation[].
- Produces: assertClientPagePlan(plan): void.

- [ ] **Step 1: Write page-plan RED tests**

~~~ts
import { describe, expect, it } from 'vitest'
import { planClientPages, validateClientPagePlan } from '../src/report/page-plan.ts'
import { CLIENT_REPORT, SECOND_PROJECT_REPORT } from './client-report-fixture.ts'

describe('planClientPages', () => {
  it('creates the three-step opening and a 32-48 slide PPTX plan', () => {
    const plan = planClientPages(CLIENT_REPORT, 'pptx')
    expect(plan.pages.slice(0, 4).map(page => page.kind)).toEqual([
      'cover', 'opening-claim', 'opening-claim', 'opening-claim',
    ])
    expect(plan.pages).toHaveLength(36)
    expect(validateClientPagePlan(plan)).toEqual([])
  })

  it('plans a second project without changing planner code', () => {
    const plan = planClientPages(SECOND_PROJECT_REPORT, 'pptx')
    expect(plan.pages[0]?.headline).toBe('社区生活服务中心更新提案')
    expect(JSON.stringify(plan)).not.toMatch(/鄂州|明塘|洋澜湖/u)
  })
})
~~~

- [ ] **Step 2: Run and verify RED**

Run: pnpm exec vitest run tests/report-page-plan.spec.ts tests/report-project-profile.spec.ts

Expected: FAIL because src/report/page-plan.ts does not exist.

- [ ] **Step 3: Verify semantic theme defaults and nested project overrides**

~~~ts
export const DEFAULT_CLIENT_THEME: ClientTheme = Object.freeze({
  themeId: 'client-editorial-v1',
  tokens: {
    colors: {
      background: 'F5F5F7',
      surface: 'FFFFFF',
      ink: '1D1D1F',
      muted: '6E6E73',
      primary: '0D5D66',
      accent: 'B85C3A',
    },
    fonts: {
      display: 'Noto Sans CJK SC',
      body: 'Noto Sans CJK SC',
      fallbacks: ['Microsoft YaHei', 'Segoe UI'],
    },
    grid: { columns: 12, safeMarginRatio: 0.06, spacingBase: 8 },
    typeScale: {
      pptxPt: { cover: 64, chapter: 52, title: 34, body: 18, caption: 10 },
      htmlPx: { cover: 80, chapter: 64, title: 44, body: 18, caption: 14 },
    },
    motion: { durationMs: 500, easing: 'ease-out', respectsReducedMotion: true },
  },
})
~~~

The Task 1 implementation already provides these defaults. Add a RED assertion that overriding primary changes only primary while background, typography, grid, and motion remain unchanged. Then make createClientTheme() merge color and font overrides one semantic key at a time and return a deeply frozen object.

- [ ] **Step 4: Implement deterministic page planning**

~~~ts
export function planClientPages(report: ClientReport, medium: ClientMedium): ClientPagePlan {
  const pages: ClientPage[] = [
    coverPage(report),
    propositionPage(report, 'projectDefinition'),
    propositionPage(report, 'urgency'),
    propositionPage(report, 'coreValue'),
  ]
  for (const chapter of report.chapters) {
    pages.push(chapterDivider(chapter))
    chapter.blocks.forEach((block, blockIndex) => {
      pages.push(blockPage(report, chapter, block, blockIndex))
    })
  }
  if (medium === 'pdf') pages.push(...evidenceAppendixPages(report))
  pages.push(closingDecisionPage(report))
  return { medium, pages }
}
~~~

The fixture must contain exactly 21 chapter blocks, producing 4 opening pages + 10 chapter dividers + 21 block pages + 1 final decision page = 36 PPTX pages. It must contain 12 distinct evidence entries so the PDF plan adds 12 evidence appendix pages and reaches 48 pages. Do not create filler or duplicate pages to reach either target.

validateClientPagePlan() must reject PPTX plans outside 32–48, PDF plans outside 48–72, a run of three identical page kinds after the opening, missing primaryFocus, unknown references, unsafe margins, or typography below the specification.

- [ ] **Step 5: Verify GREEN**

Run: pnpm exec vitest run tests/report-page-plan.spec.ts tests/report-project-profile.spec.ts tests/client-report-policy.spec.ts

Expected: PASS.

- [ ] **Step 6: Commit Task 3**

~~~powershell
git add src/report/page-plan.ts src/report/theme.ts tests/client-report-fixture.ts tests/report-page-plan.spec.ts tests/report-project-profile.spec.ts
git commit -m "feat: plan client report pages by medium"
~~~

### Task 4: Client-ready offline HTML

**Files:**
- Modify: src/report/render-html.ts
- Modify: src/report/theme.ts
- Modify: tests/report-html.spec.ts

**Interfaces:**
- Consumes: ClientRenderContext and outputRoot.
- Produces: renderHtml(context, outputRoot): Promise<RenderedArtifact>.

- [ ] **Step 1: Replace the legacy HTML test with a RED behavior test**

~~~ts
it('renders an offline client story without visible governance vocabulary', async () => {
  const artifact = await renderHtml(CLIENT_HTML_CONTEXT, root)
  const html = await readFile(join(root, 'html', 'index.html'), 'utf8')
  const body = html.match(/<body[\s\S]*<\/body>/u)?.[0] ?? ''

  expect(artifact.fileName).toBe('html/index.html')
  expect(html).toContain('<meta name="preplan-source-revision" content="57">')
  expect(body).not.toMatch(/Gate|Revision|Workflow|工作项|完成度/iu)
  expect(html).toContain('data-page-kind="product"')
  expect(html).toContain('@media (prefers-reduced-motion: reduce)')
  expect(html).toContain(':focus-visible')
  expect(html).not.toMatch(/https?:\/\//iu)
  expect(await findBrokenLocalLinks(join(root, 'html'))).toEqual([])
})
~~~

- [ ] **Step 2: Run and verify RED**

Run: pnpm exec vitest run tests/report-html.spec.ts

Expected: FAIL because renderHtml still accepts ReportDocument and renders visible Revision text.

- [ ] **Step 3: Implement page-kind render dispatch**

~~~ts
const PAGE_RENDERERS: Readonly<Record<ClientPageKind, PageRenderer>> = {
  cover: renderCover,
  'opening-claim': renderOpeningClaim,
  'chapter-divider': renderChapterDivider,
  evidence: renderEvidence,
  opportunity: renderOpportunity,
  positioning: renderPositioning,
  product: renderProduct,
  scene: renderScene,
  implementation: renderImplementation,
  decision: renderDecision,
  appendix: renderAppendix,
}

export async function renderHtml(
  context: ClientRenderContext,
  outputRoot: string,
): Promise<RenderedArtifact> {
  assertClientReportPolicy(context.report)
  assertClientPagePlan(context.plan)
  const assetNames = await copyClientAssets(context.report.assets, outputRoot)
  const pages = context.plan.pages.map(page =>
    PAGE_RENDERERS[page.kind](context.report, page, assetNames)).join('\n')
  return writeOfflineHtml(context, pages, outputRoot)
}
~~~

The body must contain only client report fields. Identity metadata belongs in head meta elements. CSS must provide semantic tokens, focus-visible states, reduced-motion rules, no horizontal overflow, 12-column desktop composition, and mobile stacking below 760px.

- [ ] **Step 4: Verify GREEN and PDF source compatibility**

Run: pnpm exec vitest run tests/report-html.spec.ts

Expected: PASS.

- [ ] **Step 5: Commit Task 4**

~~~powershell
git add src/report/render-html.ts src/report/theme.ts tests/report-html.spec.ts
git commit -m "feat: render client-ready offline html"
~~~

### Task 5: Multi-layout editable PPTX

**Files:**
- Modify: src/report/render-pptx.ts
- Modify: tests/report-pptx.spec.ts
- Create: tests/support/pptx-inspector.ts

**Interfaces:**
- Consumes: ClientRenderContext and outputPath.
- Produces: renderPptx(context, outputPath): Promise<RenderedArtifact>.
- Produces test-only inspectPptx(path) with slideTexts, notesTexts, mediaNames, slideCount, and objectBounds.

- [ ] **Step 1: Write the PPTX RED test**

~~~ts
it('creates 36 editable slides with varied layouts and no visible governance terms', async () => {
  await renderPptx(CLIENT_PPTX_CONTEXT, output)
  const deck = await inspectPptx(output)

  expect(deck.slideCount).toBe(36)
  expect(deck.pageKinds).toEqual(expect.arrayContaining([
    'cover', 'opening-claim', 'chapter-divider', 'product', 'scene', 'decision',
  ]))
  expect(deck.slideTexts.join('\n')).not.toMatch(/Gate|Revision|Workflow|工作项|完成度/iu)
  expect(deck.notesTexts.join('\n')).toContain('sourceRevision=57')
  expect(deck.mediaNames.length).toBeGreaterThanOrEqual(CLIENT_REPORT.assets.length)
  expect(deck.outOfBoundsObjects).toEqual([])
  expect(deck.textBelowMinimum).toEqual([])
})
~~~

- [ ] **Step 2: Run and verify RED**

Run: pnpm exec vitest run tests/report-pptx.spec.ts

Expected: FAIL because the legacy renderer emits fixed two-slide sections and visible成果版本 text.

- [ ] **Step 3: Implement layout dispatch and safe geometry**

~~~ts
const PPTX_LAYOUTS: Readonly<Record<ClientPageKind, PptxPageRenderer>> = {
  cover: addCoverSlide,
  'opening-claim': addOpeningClaimSlide,
  'chapter-divider': addChapterDividerSlide,
  evidence: addEvidenceSlide,
  opportunity: addOpportunitySlide,
  positioning: addPositioningSlide,
  product: addProductSlide,
  scene: addSceneSlide,
  implementation: addImplementationSlide,
  decision: addDecisionSlide,
  appendix: addAppendixSlide,
}

for (const page of context.plan.pages) {
  const slide = pptx.addSlide()
  PPTX_LAYOUTS[page.kind](slide, context.report, page)
  slide.addNotes(
    '[PageKind]' + page.kind + '\n[PreplanIdentity]\nsourceRevision=' +
    context.identity.sourceRevision,
  )
}
~~~

All content geometry must use SLIDE_WIDTH 13.333, SLIDE_HEIGHT 7.5, SAFE_X 0.8, SAFE_Y 0.5, and CONTENT_BOTTOM 6.88. Captions use at least 10pt, body at least 16pt by default and never below 14pt, titles at least 24pt. Image helpers must preserve aspect ratio with crop/contain chosen by page role.

- [ ] **Step 4: Verify GREEN**

Run: pnpm exec vitest run tests/report-pptx.spec.ts tests/client-report-policy.spec.ts tests/report-page-plan.spec.ts

Expected: PASS.

- [ ] **Step 5: Commit Task 5**

~~~powershell
git add src/report/render-pptx.ts tests/report-pptx.spec.ts tests/support/pptx-inspector.ts
git commit -m "feat: render multi-layout client pptx"
~~~

### Task 6: Print HTML, PDF, and artifact validation

**Files:**
- Create: src/report/render-print-html.ts
- Create: src/report/inspect-pptx.ts
- Modify: src/report/render-pdf.ts
- Modify: src/report/validate-artifacts.ts
- Modify: tests/report-pdf.spec.ts
- Modify: tests/report-pdf-edge.spec.ts
- Modify: tests/validate-artifacts.spec.ts

**Interfaces:**
- Consumes: ClientRenderContext and outputRoot.
- Produces: renderPrintHtml(context, outputRoot): Promise<string>.
- Keeps: renderPdf(htmlPath, outputPath, browserExecutable, runner).
- Extends: validateAndHashReportArtifacts(stagingRoot, identity).

- [ ] **Step 1: Write RED tests for print source and identity mismatch**

~~~ts
it('builds a 48-72 page print source without client-visible governance fields', async () => {
  const path = await renderPrintHtml(CLIENT_PDF_CONTEXT, root)
  const html = await readFile(path, 'utf8')
  expect(countPrintPages(html)).toBeGreaterThanOrEqual(48)
  expect(countPrintPages(html)).toBeLessThanOrEqual(72)
  expect(html).not.toMatch(/Gate|Revision|Workflow|工作项|完成度/iu)
  expect(html).toContain('data-page-kind="appendix"')
})

it('rejects an artifact set with a different invisible identity', async () => {
  await expect(validateAndHashReportArtifacts(root, EXPECTED_IDENTITY))
    .rejects.toThrow(/recommendation identity/u)
})
~~~

- [ ] **Step 2: Run and verify RED**

Run: pnpm exec vitest run tests/report-pdf.spec.ts tests/validate-artifacts.spec.ts

Expected: FAIL because render-print-html.ts does not exist and validation only checks HTML revision.

- [ ] **Step 3: Implement print source and metadata extraction**

renderPrintHtml() must render the PDF page plan into one section.print-page per page, include explicit page breaks, source footnotes, embedded/local fonts only, and invisible meta elements for projectId, sourceRevision, recommendationId, and adoptedAssetIds.

~~~ts
export function readHtmlArtifactIdentity(html: string): ArtifactIdentity {
  return {
    projectId: requiredMeta(html, 'preplan-project-id'),
    sourceRevision: Number(requiredMeta(html, 'preplan-source-revision')),
    recommendationId: requiredMeta(html, 'preplan-recommendation-id'),
    adoptedAssetIds: requiredMeta(html, 'preplan-adopted-assets')
      .split(',').filter(Boolean).sort(),
  }
}
~~~

validateAndHashReportArtifacts() must compare all four identity fields, scan browser and print HTML plus visible PPTX slide text for forbidden terms, verify PPTX/PDF signatures, ensure all three artifacts are non-empty, and hash only after every validation passes. src/report/inspect-pptx.ts must unzip PPTX XML, keep notes separate from slide text, and return slide count, visible text, notes, media names, and identity metadata.

- [ ] **Step 4: Verify GREEN**

Run: pnpm exec vitest run tests/report-pdf.spec.ts tests/report-pdf-edge.spec.ts tests/validate-artifacts.spec.ts

Expected: PASS.

- [ ] **Step 5: Commit Task 6**

~~~powershell
git add src/report/render-print-html.ts src/report/inspect-pptx.ts src/report/render-pdf.ts src/report/validate-artifacts.ts tests/report-pdf.spec.ts tests/report-pdf-edge.spec.ts tests/validate-artifacts.spec.ts
git commit -m "feat: validate client pdf and artifact identity"
~~~

### Task 7: Atomic package integration and regression compatibility

**Files:**
- Modify: src/report/package-service.ts
- Modify: src/report/source.ts
- Modify: tests/report-package.spec.ts
- Modify: tests/report-source.spec.ts
- Modify: tests/download-route.spec.ts

**Interfaces:**
- Consumes: source(projectId, revision), profile(projectId), page planner, renderers, validator.
- Produces: ReportPackageService.publish(projectId, revision) with unchanged return type ArtifactManifestRecord.

- [ ] **Step 1: Write package RED tests**

~~~ts
it('publishes only after client policy, three page plans, renderers, and identity validation pass', async () => {
  const manifest = await fixture(root).publish('golden-project', 57)
  expect(manifest.artifacts.map(row => row.format).sort()).toEqual(['html', 'pdf', 'pptx'])
  expect(ports.policy).toHaveBeenCalledBefore(ports.renderers.html)
  expect(ports.planner).toHaveBeenCalledWith(expect.anything(), 'html')
  expect(ports.planner).toHaveBeenCalledWith(expect.anything(), 'pptx')
  expect(ports.planner).toHaveBeenCalledWith(expect.anything(), 'pdf')
})

it('keeps the previous package when policy validation fails', async () => {
  ports.policy.mockImplementation(() => { throw new Error('CLIENT_FORBIDDEN_TERM') })
  await expect(service.publish('golden-project', 57)).rejects.toThrow(/CLIENT_FORBIDDEN_TERM/u)
  await expect(access(existingPublishedPackage)).resolves.toBeUndefined()
  await expect(access(newPublishedPackage)).rejects.toThrow()
})
~~~

- [ ] **Step 2: Run and verify RED**

Run: pnpm exec vitest run tests/report-package.spec.ts tests/report-source.spec.ts tests/download-route.spec.ts

Expected: FAIL because package service still builds ReportDocument and old renderer signatures.

- [ ] **Step 3: Integrate the new pipeline**

~~~ts
const input = await this.options.source(projectId, revision)
const profile = await this.options.profile(projectId)
const bundle = createClientReportBundle(input, profile)
assertClientReportPolicy(bundle.report)
const plans = {
  html: planClientPages(bundle.report, 'html'),
  pptx: planClientPages(bundle.report, 'pptx'),
  pdf: planClientPages(bundle.report, 'pdf'),
}
const htmlContext = { report: bundle.report, plan: plans.html, identity: bundle.identity }
const pptxContext = { report: bundle.report, plan: plans.pptx, identity: bundle.identity }
const pdfContext = { report: bundle.report, plan: plans.pdf, identity: bundle.identity }
~~~

Render browser HTML first, then print HTML; use Promise.allSettled for PPTX and PDF; validate; write artifact-manifest.json; rename staging atomically; persist the report package. On any error remove only the newly resolved staging/published path and retain previous packages.

- [ ] **Step 4: Verify GREEN and package regression**

Run: pnpm exec vitest run tests/report-package.spec.ts tests/report-source.spec.ts tests/download-route.spec.ts tests/restart-recovery.spec.ts

Expected: PASS.

- [ ] **Step 5: Commit Task 7**

~~~powershell
git add src/report/package-service.ts src/report/source.ts tests/report-package.spec.ts tests/report-source.spec.ts tests/download-route.spec.ts
git commit -m "feat: publish client report bundle atomically"
~~~

### Task 8: Engineering Golden, replaceability proof, QA output, and acceptance handoff

**Files:**
- Modify: scripts/build-golden-project.ts
- Modify: scripts/build-golden-project-cli.ts
- Modify: tests/full-flow-golden.spec.ts
- Create: tests/fixtures/golden-project/client-profile.json
- Create: scripts/inspect-client-artifacts.ts
- Create: docs/acceptance-v0.8.md
- Modify: package.json

**Interfaces:**
- Consumes: frozen engineering fixture, client-profile.json, existing visual assets, Edge.
- Produces: pnpm golden:build-v080.
- Produces: inspect-client-artifacts.ts output with page counts, forbidden-term hits, identity equality, missing assets, and visual-render input paths.

- [ ] **Step 1: Write Golden RED tests**

~~~ts
it('publishes the v0.8 engineering Golden without overwriting an existing manifest', async () => {
  const result = await runGoldenProject(fixtureRoot, outputRoot, { browserExecutable: edge })
  expect(result.manifest.artifacts.map(row => row.format).sort()).toEqual(['html', 'pdf', 'pptx'])
  expect(result.client).toMatchObject({
    schemaVersion: 'preplan.client-report.v1',
    pptxPages: 36,
    pdfPages: expect.any(Number),
    forbiddenTermHits: [],
  })
  await expect(runGoldenProject(fixtureRoot, outputRoot, { browserExecutable: edge }))
    .rejects.toThrow(/refusing to overwrite published Golden/u)
})

it('uses the same core value and assets in all three formats', async () => {
  const inspection = await inspectClientArtifacts(outputRoot)
  expect(inspection.identitiesEqual).toBe(true)
  expect(inspection.coreValueOccurrences).toEqual({ html: 1, pptx: 1, pdfSource: 1 })
  expect(inspection.missingAssetIds).toEqual([])
})
~~~

- [ ] **Step 2: Run and verify RED**

Run: pnpm exec vitest run tests/full-flow-golden.spec.ts

Expected: FAIL because the Golden builder still uses ReportDocument and permits an existing output root.

- [ ] **Step 3: Migrate the Golden builder and add overwrite protection**

Before creating output files, resolve outputRoot and check for outputRoot/artifact-manifest.json. If present, throw exactly refusing to overwrite published Golden. Load client-profile.json, build the client bundle and media plans, then use the same pipeline as ReportPackageService.

Add:

~~~json
{
  "golden:build-v080": "tsx scripts/build-golden-project-cli.ts --profile client-v080",
  "golden:inspect-v080": "tsx scripts/inspect-client-artifacts.ts"
}
~~~

- [ ] **Step 4: Verify the engineering Golden**

Run: pnpm exec vitest run tests/full-flow-golden.spec.ts

Expected: PASS.

Run: pnpm golden:build-v080 -- --output C:\Users\2899\Documents\Codex\2026-08-27\yue-du\outputs\dsh-preplanning-0.8.0\engineering-golden-r1

Expected: HTML, PPTX, PDF, artifact-manifest.json, and inspection JSON appear in the new directory; the v0.7.0 Golden remains unchanged.

- [ ] **Step 5: Run fresh engineering verification**

Run: pnpm typecheck

Expected: exit 0.

Run: pnpm build

Expected: exit 0.

Run: pnpm exec vitest run --maxWorkers=1

Expected: every test file and test pass with zero failures.

- [ ] **Step 6: Prepare real showcase and DSH acceptance without claiming it passed**

In docs/acceptance-v0.8.md record the exact local Reference inputs and SHA-256 values for 鄂州城市更新—明塘＋洋澜湖地块, the intended showcase output directory, required full-page PPTX/PDF renders, montage paths, score thresholds, and the DSH flow:

模式选择 → 任务执行 → 生图 → 采纳 → 发布 → HTML/PPTX/PDF 下载 → DSH 重启恢复。

Mark every acceptance row as PASS only after the real command or host action has been observed. Automated engineering success must remain separate from PowerPoint visual QA and DSH host acceptance.

- [ ] **Step 7: Commit Task 8**

~~~powershell
git add scripts/build-golden-project.ts scripts/build-golden-project-cli.ts scripts/inspect-client-artifacts.ts tests/full-flow-golden.spec.ts tests/fixtures/golden-project/client-profile.json package.json docs/acceptance-v0.8.md
git commit -m "feat: build v0.8 client report golden"
~~~

## Final verification checklist

- [ ] Read the approved design spec and map every requirement to Tasks 1–8.
- [ ] Run pnpm typecheck and record exit 0.
- [ ] Run pnpm build and record exit 0.
- [ ] Run pnpm exec vitest run --maxWorkers=1 and record exact test-file/test counts.
- [ ] Run git diff --check and confirm no whitespace errors.
- [ ] Run git status --short --branch and distinguish committed work from any user changes.
- [ ] Confirm v0.7.0 Golden hashes are unchanged.
- [ ] Confirm engineering Golden exists in a new directory and overwrite protection works.
- [ ] Render all PPTX and PDF pages, create montages, and complete at least one correction/re-render/review loop.
- [ ] Score content product quality at least 85 and visual quality at least 88.
- [ ] Complete real DSH publish/download/restart E2E.
- [ ] Do not update package version or claim v0.8 completion until every applicable row above has fresh evidence.
