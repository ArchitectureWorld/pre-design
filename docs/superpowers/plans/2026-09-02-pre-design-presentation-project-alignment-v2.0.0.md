---
document_id: pre-design-presentation-project-alignment-implementation-plan
document_version: 2.0.0
alignment_baseline: v2.0.0
status: ready
approved_at: 2026-09-02
branch: architecture/presentation-project-alignment-v2.0.0
scope: pre-design-implementation-plan
implementation_status: blocked-by-contract-lock
version_matrix: docs/version-matrix.json
version_authority: docs/VERSIONING.md
spec: docs/superpowers/specs/2026-09-02-pre-design-presentation-project-alignment-v2.0.0-design.md
content_baseline: docs/superpowers/specs/2026-09-02-pre-design-presentation-content-baseline-v2.0.0.md
language: zh-CN
---

# Pre-design × Presentation 对齐实施计划 v2.0.0

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` or `superpowers:executing-plans`; implement task by task with review gates.

## Goal

让 `pre-design` 自行创建和维护符合锁定 Presentation Contract 的标准项目目录，输出项目基本信息、大纲、逐页草案、讲解稿、原始资料和正式素材，同时不承担排版，也不依赖 Presentation 内容治理或 Revision 系统。

## Version rule

所有版本值读取 [`docs/version-matrix.json`](../../version-matrix.json)。

本计划不得：

- 修改 `package.json#version`；
- 创建或移动 Git tag；
- 创建 GitHub Release；
- 选择未写入 Contract Lock 的 Presentation 包或分支；
- 把对齐基线描述为插件 Release。

Contract Lock 未通过时，Task 1–8 不得执行。

## Architecture

```text
Presentation Contract
├─ Schema
├─ Types
├─ ID Factory
├─ minimal document factory / Fixture
├─ validators
└─ stable errors
        ↓ exact lock
pre-design
├─ project creation and recovery
├─ dual project identity binding
├─ source-material import
├─ formal asset adoption
├─ outline/draft projection
├─ export ledger
└─ external-change protection
```

## Global constraints

- 两个 DSH 插件保持独立；
- DSH Harness 是唯一 Agent Runtime；
- `pre-design` 是可执行插件，Skill 是其内部能力；
- `presentation-tools` 是格式权威与可视化工具；
- 双项目 ID 必须显式映射；
- 项目生命周期由 `pre-design` 执行；
- 所有 Presentation ID 使用锁定 Contract 的 ID Factory；
- Canonical 文件只保存相对路径；
- 原始资料复制、不移动、不软链接；
- 正式草案只引用正式 `assetId`；
- `pre-design` 不生成或修改 Layout；
- 外部修改以 `pre-design` 上次输出 Hash 识别；
- legacy HTML/PPTX/PDF 保留；
- 每个任务先写失败测试，再实现，再验证，再提交。

## Planned files

```text
docs/contracts/
└─ presentation-standard-project-v1-lock.json

scripts/
├─ verify-alignment-version-consistency.mjs
└─ verify-presentation-contract-lock.ts

src/presentation/
├─ contract-port.ts
├─ contract-adapter.ts
├─ contract-lock.ts
├─ types.ts
├─ project-binding.ts
├─ project-directory.ts
├─ recovery.ts
├─ source-materials.ts
├─ asset-library.ts
├─ export-ledger.ts
├─ update-service.ts
└─ projector/
   ├─ index.ts
   ├─ outline.ts
   ├─ pages.ts
   ├─ drafts.ts
   └─ identifiers.ts

tests/
├─ presentation-contract-lock.spec.ts
├─ presentation-contract-adapter.spec.ts
├─ presentation-project-directory.spec.ts
├─ presentation-project-recovery.spec.ts
├─ presentation-source-materials.spec.ts
├─ presentation-asset-library.spec.ts
├─ presentation-outline-projector.spec.ts
├─ presentation-draft-projector.spec.ts
├─ presentation-update-service.spec.ts
└─ presentation-project-e2e.spec.ts
```

---

## Task 0: Lock the Presentation Contract

**Files**
- Create: `docs/contracts/presentation-standard-project-v1-lock.json`
- Create: `scripts/verify-presentation-contract-lock.ts`
- Modify: `package.json`
- Test: `tests/presentation-contract-lock.spec.ts`

**Lock shape**

```ts
interface PresentationContractLock {
  standardName: string
  standardVersion: string
  packageName: string
  packageVersion: string
  schemaSetSha256: string
  typesEntry: string
  idFactoryEntry: string
  documentValidatorEntry: string
  projectValidatorEntry: string
  minimalFixturePath: string
  fullExamplePath: string
  validationCommand: string
  sourceCommitSHA: string
}
```

- [ ] Verify the external delivery contains every field.
- [ ] Confirm `standardVersion` equals the version-matrix target.
- [ ] Reject version ranges, floating tags and branch-only dependencies.
- [ ] Write the exact lock values; do not guess missing values.
- [ ] Install the exact package with lockfile integrity.
- [ ] Write tests for package-version, entry-point and Schema Set mismatches.
- [ ] Run:
  ```bash
  pnpm verify:alignment-versions
  pnpm vitest run tests/presentation-contract-lock.spec.ts
  pnpm typecheck
  ```
- [ ] Atomically update `docs/version-matrix.json` and all normative document statuses according to `docs/VERSIONING.md`.
- [ ] Commit:
  ```bash
  git commit -m "build: lock presentation standard project contract"
  ```

**Gate:** do not start Task 1 until this task passes.

---

## Task 1: Minimal Contract Adapter

**Files**
- Create: `src/presentation/contract-port.ts`
- Create: `src/presentation/contract-adapter.ts`
- Create: `src/presentation/contract-lock.ts`
- Test: `tests/presentation-contract-adapter.spec.ts`

**Required interface**

```ts
type PresentationDocumentKind =
  | 'project'
  | 'rules'
  | 'outline'
  | 'page-manifest'
  | 'draft-page'
  | 'source-material-manifest'
  | 'asset-manifest'

type PresentationIdKind =
  | 'project'
  | 'rules'
  | 'outline'
  | 'outline-node'
  | 'page'
  | 'draft'
  | 'content-block'
  | 'list-item'
  | 'metric'
  | 'table-row'
  | 'table-column'
  | 'table-cell'
  | 'script-block'
  | 'page-asset'
  | 'source-material'
  | 'asset'

interface PresentationFormatContract {
  standardVersion: string
  schemaSetSha256: string
  createId(kind: PresentationIdKind): string
  createMinimalDocuments(input: {
    presentationProjectId: string
    preDesignProjectId: string
    projectSlug: string
    projectName: string
    createdAt: string
  }): Record<string, unknown>
  validateDocument(
    kind: PresentationDocumentKind,
    value: unknown,
  ): readonly PresentationValidationIssue[]
  validateProject(root: string): Promise<PresentationProjectValidation>
}
```

- [ ] Write a failing test proving the adapter delegates to the locked package.
- [ ] Reject missing ID Factory, types or validators.
- [ ] Reject standard version or Schema Set mismatches.
- [ ] Do not expose UI, Layout, Head, CAS, Revision or sync APIs.
- [ ] Run adapter tests and typecheck.
- [ ] Commit:
  ```bash
  git commit -m "feat: add presentation format contract adapter"
  ```

---

## Task 2: Dual Project Identity Binding

**Files**
- Create: `src/presentation/types.ts`
- Create: `src/presentation/project-binding.ts`
- Modify: `src/state/types.ts`
- Modify: `src/state/domain.ts`
- Modify: `src/state/repository.ts`
- Test: `tests/presentation-project-directory.spec.ts`

```ts
type PresentationDirectoryState =
  | 'creating'
  | 'ready'
  | 'recovery_required'

interface PresentationProjectBindingRecord {
  preDesignProjectId: string
  presentationProjectId: string
  directoryRoot: string
  standardVersion: string
  state: PresentationDirectoryState
  lastExportedPreDesignRevision?: number
  lastExportedAt?: string
  lastExportedObjectHashes: Readonly<Record<string, string>>
  createdAt: string
  updatedAt: string
}
```

- [ ] Test creation, read, state transition and both-ID uniqueness.
- [ ] Test that `directoryRoot` is absent from professional Revision snapshots.
- [ ] Validate the standard version against the Contract Lock.
- [ ] Implement repository methods keyed by `preDesignProjectId`.
- [ ] Run tests and typecheck.
- [ ] Commit:
  ```bash
  git commit -m "feat: persist presentation project bindings"
  ```

---

## Task 3: Project Directory Creation and Recovery

**Files**
- Create: `src/presentation/project-directory.ts`
- Create: `src/presentation/recovery.ts`
- Modify: `src/commands/register.ts`
- Modify: `src/client/direct-start.ts`
- Modify: `src/index.ts`
- Test: `tests/presentation-project-directory.spec.ts`
- Test: `tests/presentation-project-recovery.spec.ts`

```ts
interface CreatePresentationProjectDirectoryInput {
  preDesignProjectId: string
  projectName: string
  createdAt: string
  workspaceRoot: string
  projectRootOverride?: string
}

interface PresentationProjectDirectoryResult {
  preDesignProjectId: string
  presentationProjectId: string
  directoryRoot: string
  standardVersion: string
  recovered: boolean
}
```

- [ ] Test default directory `<presentationProjectId>-<projectSlug>`.
- [ ] Test Presentation ID generation through the official Factory.
- [ ] Test `createdBy.sourceProjectId = preDesignProjectId`.
- [ ] Test same-filesystem staging, complete validation and atomic rename.
- [ ] Test same-identity recovery and different-identity conflict.
- [ ] Inject failures at directory, file, validation, rename and binding steps.
- [ ] Ensure `/preplan-new` returns success only after project and directory are ready.
- [ ] Recover only `.creating-*` directories created by this plugin.
- [ ] Run targeted tests, command tests and typecheck.
- [ ] Commit:
  ```bash
  git commit -m "feat: create presentation project directories"
  ```

---

## Task 4: Source-material Import

**Files**
- Create: `src/presentation/source-materials.ts`
- Modify: `src/commands/register.ts`
- Test: `tests/presentation-source-materials.spec.ts`

```ts
interface ImportSourceMaterialInput {
  preDesignProjectId: string
  sourcePath: string
  importedAt: string
}
```

- [ ] Test copy without moving the original.
- [ ] Test category mapping and relative paths.
- [ ] Test SHA-256 deduplication.
- [ ] Test same-name/different-content safe naming.
- [ ] Test Manifest/file atomicity and absolute-path exclusion.
- [ ] Validate the complete project after each successful import.
- [ ] Run tests and typecheck.
- [ ] Commit:
  ```bash
  git commit -m "feat: import presentation source materials"
  ```

---

## Task 5: Formal Asset Adoption

**Files**
- Create: `src/presentation/asset-library.ts`
- Test: `tests/presentation-asset-library.spec.ts`

```ts
type PresentationAssetOrigin =
  | { kind: 'source_material'; sourceMaterialId: string }
  | {
      kind: 'derived_source_material'
      sourceMaterialId: string
      operation: string
    }
  | {
      kind: 'pre_design_generated'
      preDesignRevision: number
      objectIds: readonly string[]
      evidenceIds: readonly string[]
    }
  | { kind: 'external_tool'; provider: string }
  | { kind: 'human_added' }
```

- [ ] Test that source originals remain untouched.
- [ ] Test assets enter the correct category.
- [ ] Test stable `assetId`, file Hash and lineage.
- [ ] Reject unadopted candidates and cache files.
- [ ] Test file/Manifest compensation on failure.
- [ ] Run tests and typecheck.
- [ ] Commit:
  ```bash
  git commit -m "feat: adopt presentation assets"
  ```

---

## Task 6: Outline and Draft Projection

**Files**
- Create: `src/presentation/projector/index.ts`
- Create: `src/presentation/projector/outline.ts`
- Create: `src/presentation/projector/pages.ts`
- Create: `src/presentation/projector/drafts.ts`
- Create: `src/presentation/projector/identifiers.ts`
- Test: `tests/presentation-outline-projector.spec.ts`
- Test: `tests/presentation-draft-projector.spec.ts`

```ts
interface PresentationProjectionInput {
  preDesignProjectId: string
  presentationProjectId: string
  preDesignRevision: number
  generatedAt: string
}
```

- [ ] Test the eight-topic default skeleton and project adaptation.
- [ ] Test omission, merge, split and additional project-specific topics.
- [ ] Test many professional objects converging into one conclusion.
- [ ] Prohibit 57-object-to-57-page mapping.
- [ ] Test one page title and one key message maximum.
- [ ] Test all five content-block types, speaker notes and asset references.
- [ ] Test content nature and generic `sourceRefs`.
- [ ] Ensure local `projectId` uses `presentationProjectId`.
- [ ] Ensure source project identity uses `preDesignProjectId`.
- [ ] Ensure no Layout, font, coordinate or template fields.
- [ ] Generate new identities only through the official ID Factory.
- [ ] Use deterministic Canonical JSON hashes.
- [ ] Run projector tests and typecheck.
- [ ] Commit:
  ```bash
  git commit -m "feat: project predesign content to presentation format"
  ```

---

## Task 7: File Update and External-change Protection

**Files**
- Create: `src/presentation/export-ledger.ts`
- Create: `src/presentation/update-service.ts`
- Modify: `src/state/repository.ts`
- Modify: `src/commands/register.ts`
- Test: `tests/presentation-update-service.spec.ts`

```ts
interface PresentationFileUpdateResult {
  preDesignProjectId: string
  presentationProjectId: string
  preDesignRevision: number
  createdIds: readonly string[]
  updatedIds: readonly string[]
  unchangedIds: readonly string[]
  reviewRequiredIds: readonly string[]
  failedIds: readonly string[]
  status: 'updated' | 'review_required' | 'failed'
}
```

- [ ] Compare current semantic Hash with the last pre-design export Hash.
- [ ] Update only objects unchanged since the last export.
- [ ] Return `review_required` for any externally modified object.
- [ ] Never infer whether the modifier was a human, Agent or another plugin.
- [ ] Same professional Revision and same projection must be a no-op.
- [ ] Validate candidate documents before replacing files.
- [ ] Use staging and atomic replacement for all affected documents.
- [ ] Never create or modify Layout content.
- [ ] Persist the new export ledger only after successful file updates.
- [ ] Run update-service tests, command tests and typecheck.
- [ ] Commit:
  ```bash
  git commit -m "feat: update presentation files safely"
  ```

---

## Task 8: End-to-end and Legacy Regression

**Files**
- Create: `tests/presentation-project-e2e.spec.ts`
- Modify: `docs/acceptance.md`
- Modify: `HANDOFF.md`

**E2E flow**

```text
fresh DSH Storage and workspace
→ /preplan-new
→ dual project identities created
→ standard directory created and validated
→ source document/image/video imported
→ duplicate import deduplicated
→ source image adopted
→ generated chart adopted
→ professional state and Gate completed
→ outline and drafts output
→ complete directory validated
→ external actor modifies one draft block
→ next pre-design output returns review_required
→ plugin restart
→ binding, directory and export ledger restored
→ unchanged output becomes a no-op
```

- [ ] Add failure injection for Contract mismatch, staging, validation, rename, Manifest and external-modification paths.
- [ ] Run:
  ```bash
  pnpm verify:alignment-versions
  pnpm test
  pnpm typecheck
  pnpm test:built
  ```
- [ ] Verify the executable package version still equals the version matrix.
- [ ] Verify no new tag or Release was created by this plan.
- [ ] Verify all legacy report tests still pass.
- [ ] Update acceptance and handoff with exact commands and fresh results.
- [ ] Commit:
  ```bash
  git commit -m "test: verify presentation project integration"
  ```

---

## Completion gate

Implementation is complete only when:

- the Contract Lock is exact and verified;
- version consistency passes;
- all new tests and full regressions pass;
- a fresh workspace can create, populate, validate and reopen a standard project;
- external modifications are never silently overwritten;
- Layout remains untouched by `pre-design`;
- the executable package version and historical Release remain unchanged unless separately authorized.
