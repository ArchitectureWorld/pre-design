# Pre-design Presentation Project Alignment v2.0.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `pre-design` 在创建项目时强一致地生成符合 `presentation-tools` 权威标准的项目目录，并按标准写入项目基本对象、大纲、逐页草案、原始资料和正式素材，不生成排版数据。

**Architecture:** 保持 `pre-design` 与 `presentation-tools` 两个独立 DSH 插件。`presentation-tools` 提供版本化目录、Schema、初始化器和验证器；`pre-design` 通过窄适配口消费这些标准，管理项目目录生命周期、原始资料导入、正式素材采用、专业内容投影和节点同步。现有 legacy HTML/PPTX/PDF 路径保留但不再作为新架构事实源扩张。

**Tech Stack:** TypeScript 5.9、Node.js 20+、DSH Storage Domain、Vitest、现有 `pre-design` Repository / Governance / Workflow Runtime、`presentation-tools` 提供的标准契约与验证实现。

**Spec:** `docs/superpowers/specs/2026-09-02-pre-design-presentation-project-alignment-v2.0.0-design.md`

## Global Constraints

- `presentation-tools` 是标准项目目录和 Canonical Schema 的唯一权威。
- 在标准契约、最小实例、初始化器和验证器未交付前，不开始生产代码实现。
- 第一版继续保持两个独立 DSH 插件，不合并仓库。
- 不要求、也不修改 `presentation-tools` 的 UI 或交互功能。
- 本计划不得把 `package.json`、Git Tag 或 Release 提升为正式 `2.0.0`。
- 默认项目位置是 `<DSH 当前工作区>/projects/<projectId>-<projectSlug>/`。
- 项目创建必须具备用户可观察的强一致性；失败不留下可见半成品。
- Canonical JSON 和 Manifest 中禁止保存绝对路径。
- 原始资料默认复制，不移动、不软链接，并按 SHA-256 去重。
- 草案只通过稳定 `assetId` 引用正式素材。
- `pre-design` 不生成 `LayoutPageDocument`，`layouts/` 初始为空。
- 现有 legacy 报告代码第一版不删除。

---

## File Structure

第一版建议新增和修改的文件如下：

```text
src/presentation/
├─ standard-port.ts              Presentation 权威标准的本地窄适配口
├─ standard-adapter.ts           对接 presentation-tools 正式契约实现
├─ project-binding.ts            项目目录控制记录类型与纯校验
├─ project-directory.ts          staging、初始化、验证、rename 和回滚
├─ recovery.ts                   崩溃后孤立目录与创建记录恢复
├─ source-materials.ts           原始资料复制、分类和 Hash 去重
├─ asset-library.ts              正式素材采用、分类和 lineage
├─ projector.ts                  57 项专业成果到 Canonical 内容的投影
├─ sync-service.ts               节点提交、冲突检测和 Revision 映射
└─ types.ts                      pre-design 自身的绑定、导入、同步结果类型

src/state/
├─ domain.ts                     新增 presentation_project_bindings 控制表
├─ repository.ts                 控制记录的创建、读取、状态转换和恢复查询
└─ types.ts                      PresentationProjectBindingRecord

src/commands/register.ts          新建项目、资料导入和显式同步命令接入
src/client/direct-start.ts        保持现有入口语义，并把目录初始化纳入创建成功条件
src/index.ts                      装配 standard adapter、目录服务、恢复器和同步服务

tests/
├─ presentation-standard-adapter.spec.ts
├─ presentation-project-directory.spec.ts
├─ presentation-project-recovery.spec.ts
├─ presentation-source-materials.spec.ts
├─ presentation-asset-library.spec.ts
├─ presentation-projector.spec.ts
├─ presentation-sync.spec.ts
└─ presentation-project-e2e.spec.ts
```

---

### Task 1: 建立 Presentation 标准适配口

**Files:**
- Create: `src/presentation/standard-port.ts`
- Create: `src/presentation/standard-adapter.ts`
- Create: `src/presentation/types.ts`
- Test: `tests/presentation-standard-adapter.spec.ts`

**Interfaces:**
- Consumes: `presentation-tools` 交付的正式目录版本、Canonical Schema、初始化器和验证器。
- Produces:

```ts
export type PresentationDocumentKind =
  | 'project'
  | 'rules'
  | 'outline'
  | 'page-manifest'
  | 'draft-page'
  | 'source-material-manifest'
  | 'asset-manifest'

export interface InitializePresentationProjectInput {
  readonly root: string
  readonly projectId: string
  readonly projectSlug: string
  readonly projectName: string
  readonly createdAt: string
  readonly sourceProvider: 'pre-design'
}

export interface InitializedPresentationProject {
  readonly standardVersion: string
  readonly root: string
  readonly projectId: string
  readonly files: readonly string[]
}

export interface PresentationValidationIssue {
  readonly code: string
  readonly path: string
  readonly message: string
}

export interface PresentationProjectStandard {
  readonly version: string
  initialize(input: InitializePresentationProjectInput): Promise<InitializedPresentationProject>
  validateProject(root: string): Promise<readonly PresentationValidationIssue[]>
  validateDocument(kind: PresentationDocumentKind, value: unknown): readonly PresentationValidationIssue[]
}
```

- [ ] **Step 1: 写失败测试，锁定窄适配口行为**

测试必须验证：

```ts
it('delegates initialization and validation without redefining canonical schemas', async () => {
  const official = fakeOfficialPresentationStandard('presentation-project.v1')
  const adapter = createPresentationStandardAdapter(official)

  const result = await adapter.initialize({
    root: '/workspace/projects/.creating-project_001',
    projectId: 'project_001',
    projectSlug: 'wuhan-cultural-center',
    projectName: '武汉文化中心',
    createdAt: '2026-09-02T08:00:00.000Z',
    sourceProvider: 'pre-design',
  })

  expect(result.standardVersion).toBe('presentation-project.v1')
  expect(official.initialize).toHaveBeenCalledOnce()
  expect(adapter.validateDocument('project', {})).toEqual([
    expect.objectContaining({ code: 'SCHEMA_INVALID' }),
  ])
})
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
pnpm vitest run tests/presentation-standard-adapter.spec.ts
```

Expected: FAIL，原因是适配口和实现尚不存在。

- [ ] **Step 3: 实现最小适配口**

要求：

- 不在 `pre-design` 内复制 Presentation JSON Schema；
- 不重命名 Canonical 字段；
- `standard-adapter.ts` 只把官方实现收窄为本项目需要的接口；
- 官方实现缺少版本、初始化器或验证器时，插件启动直接失败，不使用宽松降级。

- [ ] **Step 4: 运行测试并确认通过**

Run:

```bash
pnpm vitest run tests/presentation-standard-adapter.spec.ts
pnpm typecheck
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/presentation/standard-port.ts src/presentation/standard-adapter.ts src/presentation/types.ts tests/presentation-standard-adapter.spec.ts
git commit -m "feat: add presentation standard adapter"
```

---

### Task 2: 增加项目目录控制记录

**Files:**
- Modify: `src/state/types.ts`
- Modify: `src/state/domain.ts`
- Modify: `src/state/repository.ts`
- Create: `src/presentation/project-binding.ts`
- Test: `tests/presentation-project-directory.spec.ts`

**Interfaces:**
- Consumes: Task 1 的 `PresentationProjectStandard.version`。
- Produces:

```ts
export type PresentationDirectoryState = 'creating' | 'ready' | 'recovery_required'

export interface PresentationProjectBindingRecord {
  readonly projectId: string
  readonly directoryRoot: string
  readonly standardVersion: string
  readonly state: PresentationDirectoryState
  readonly createdAt: string
  readonly updatedAt: string
  readonly lastSyncedPreDesignRevision?: number
  readonly lastPresentationRevision?: number
}
```

Repository 方法：

```ts
putPresentationProjectBinding(record: PresentationProjectBindingRecord): Promise<PresentationProjectBindingRecord>
readPresentationProjectBinding(projectId: string): PresentationProjectBindingRecord | undefined
listPresentationProjectBindingsByState(state: PresentationDirectoryState): readonly PresentationProjectBindingRecord[]
```

- [ ] **Step 1: 写失败测试**

测试创建、更新、按状态读取，以及绝对目录只存在控制记录中，不进入项目 State Snapshot。

- [ ] **Step 2: 运行测试并确认失败**

```bash
pnpm vitest run tests/presentation-project-directory.spec.ts
```

- [ ] **Step 3: 实现控制表和 Repository 方法**

`src/state/domain.ts` 新增：

```ts
presentation_project_bindings: domainTable<string, PresentationProjectBindingRecord>(presentationProjectBindingSchema)
```

Schema 必须验证：

- `projectId` 非空；
- `directoryRoot` 为绝对路径；
- `standardVersion` 非空；
- Revision 为非负整数；
- `ready` 状态只能由目录服务在验证通过后写入。

- [ ] **Step 4: 运行测试与类型检查**

```bash
pnpm vitest run tests/presentation-project-directory.spec.ts
pnpm typecheck
```

- [ ] **Step 5: 提交**

```bash
git add src/state src/presentation/project-binding.ts tests/presentation-project-directory.spec.ts
git commit -m "feat: persist presentation project bindings"
```

---

### Task 3: 实现强一致项目目录初始化与恢复

**Files:**
- Create: `src/presentation/project-directory.ts`
- Create: `src/presentation/recovery.ts`
- Modify: `src/commands/register.ts`
- Modify: `src/client/direct-start.ts`
- Modify: `src/index.ts`
- Test: `tests/presentation-project-directory.spec.ts`
- Test: `tests/presentation-project-recovery.spec.ts`

**Interfaces:**
- Consumes: `PresentationProjectStandard`、`ProjectRepository`、Task 2 控制记录。
- Produces:

```ts
export interface CreatePresentationProjectDirectoryInput {
  readonly projectId: string
  readonly projectName: string
  readonly createdAt: string
  readonly workspaceRoot: string
  readonly projectRootOverride?: string
}

export interface PresentationProjectDirectoryResult {
  readonly projectId: string
  readonly directoryRoot: string
  readonly standardVersion: string
  readonly recovered: boolean
}

export class PresentationProjectDirectoryService {
  create(input: CreatePresentationProjectDirectoryInput): Promise<PresentationProjectDirectoryResult>
  recoverPending(): Promise<readonly PresentationProjectDirectoryResult[]>
}
```

- [ ] **Step 1: 写失败测试覆盖成功和冲突路径**

必须覆盖：

- 默认目录 `<workspace>/projects/<projectId>-<slug>/`；
- staging 与最终目录位于同一父目录；
- 初始化、验证、rename、控制记录全部完成后才返回成功；
- 同 `projectId` 合法目录返回 `recovered: true`；
- 同名目录但不同 `projectId` 返回 `PRESENTATION_PROJECT_DIRECTORY_CONFLICT`；
- 初始化器失败、验证失败、rename 失败和项目记录失败均不留下可见半成品。

- [ ] **Step 2: 运行测试并确认失败**

```bash
pnpm vitest run tests/presentation-project-directory.spec.ts tests/presentation-project-recovery.spec.ts
```

- [ ] **Step 3: 实现 staging 与补偿**

创建顺序固定为：

```text
creating 控制记录
→ 同文件系统 staging
→ official initialize
→ official validateProject
→ atomic rename
→ ready 控制记录
→ 返回成功
```

任何异常：

```text
删除 staging / final
→ 删除或标记 creating 控制记录
→ 若无法完成补偿，写 recovery_required
→ 抛出原始错误与恢复状态
```

- [ ] **Step 4: 将 `/preplan-new` 纳入同一成功条件**

要求：

- 项目状态和标准目录必须同时 ready；
- 目录创建失败时，不返回“已创建项目”；
- `startDirectPreplanning()` 只能在目录初始化成功后继续切换模式或启动流程；
- 允许通过 pre-design 配置或受控命令参数传入 `projectRootOverride`，不把该绝对路径写入 Canonical JSON。

- [ ] **Step 5: 装配启动恢复**

插件 `apply()` 初始化后、注册可写命令前执行 `recoverPending()`；恢复失败的项目保持不可写并给出结构化诊断。

- [ ] **Step 6: 运行专项与现有回归**

```bash
pnpm vitest run tests/presentation-project-directory.spec.ts tests/presentation-project-recovery.spec.ts tests/direct-start.client.spec.ts tests/commands.spec.ts
pnpm typecheck
```

- [ ] **Step 7: 提交**

```bash
git add src/presentation/project-directory.ts src/presentation/recovery.ts src/commands/register.ts src/client/direct-start.ts src/index.ts tests
git commit -m "feat: initialize presentation project directories"
```

---

### Task 4: 实现原始资料复制、分类和 Hash 去重

**Files:**
- Create: `src/presentation/source-materials.ts`
- Modify: `src/commands/register.ts`
- Test: `tests/presentation-source-materials.spec.ts`

**Interfaces:**
- Consumes: ready 的 `PresentationProjectBindingRecord` 和官方 `SourceMaterialManifest` Schema。
- Produces:

```ts
export type SourceMaterialCategory =
  | 'documents'
  | 'drawings'
  | 'images'
  | 'videos'
  | 'data'
  | 'models'
  | 'other'

export interface ImportSourceMaterialInput {
  readonly projectId: string
  readonly sourcePath: string
  readonly importedAt: string
}

export interface ImportSourceMaterialResult {
  readonly sourceMaterialId: string
  readonly category: SourceMaterialCategory
  readonly relativePath: string
  readonly sha256: string
  readonly deduplicated: boolean
}
```

- [ ] **Step 1: 写失败测试**

覆盖：

- 原文件保留；
- 文件复制到正确分类；
- 相同 Hash 二次导入不复制；
- 同名不同内容安全改名；
- Manifest 更新后通过官方验证器；
- Manifest 不含绝对源路径；
- 中途失败不留下文件有记录无、记录有文件无的状态。

- [ ] **Step 2: 运行测试并确认失败**

```bash
pnpm vitest run tests/presentation-source-materials.spec.ts
```

- [ ] **Step 3: 实现导入服务**

写入顺序：

```text
读取并计算 Hash
→ 检查 Manifest Hash 索引
→ staging copy
→ 校验字节数与 Hash
→ 原子落入分类目录
→ 原子替换 manifest.json
```

- [ ] **Step 4: 增加 pre-design 受控导入入口**

入口只负责调用服务并返回结果，不将导入资料直接判定为正式采用素材。

- [ ] **Step 5: 运行测试**

```bash
pnpm vitest run tests/presentation-source-materials.spec.ts tests/commands.spec.ts
pnpm typecheck
```

- [ ] **Step 6: 提交**

```bash
git add src/presentation/source-materials.ts src/commands/register.ts tests/presentation-source-materials.spec.ts
git commit -m "feat: import presentation source materials"
```

---

### Task 5: 实现正式素材采用与来源链

**Files:**
- Create: `src/presentation/asset-library.ts`
- Test: `tests/presentation-asset-library.spec.ts`

**Interfaces:**
- Consumes: source material、现有 `GovernanceRepository.visualAssets`、官方 `AssetManifest` Schema。
- Produces:

```ts
export type PresentationAssetCategory =
  | 'images'
  | 'videos'
  | 'charts'
  | 'diagrams'
  | 'audio'
  | 'other'

export type PresentationAssetOrigin =
  | { readonly kind: 'source_material'; readonly sourceMaterialId: string }
  | { readonly kind: 'derived_source_material'; readonly sourceMaterialId: string; readonly operation: string }
  | { readonly kind: 'pre_design_generated'; readonly sourceRevision: number; readonly objectIds: readonly string[]; readonly evidenceIds: readonly string[] }
  | { readonly kind: 'external_tool'; readonly provider: string }
  | { readonly kind: 'human_added' }

export interface AdoptPresentationAssetInput {
  readonly projectId: string
  readonly sourcePath: string
  readonly category: PresentationAssetCategory
  readonly semanticRole: string
  readonly origin: PresentationAssetOrigin
  readonly adoptedAt: string
}
```

- [ ] **Step 1: 写失败测试**

覆盖：

- 原始资料采用后原件仍在 `source-materials/`；
- 派生素材进入正确 `assets/<category>/`；
- 页面只需 `assetId`；
- Manifest 保留来源对象、证据、Revision 和 Hash；
- 未采用候选不能写入正式 Manifest；
- 同一 `assetId` 不得指向不同内容；
- Manifest 和文件更新具备失败补偿。

- [ ] **Step 2: 运行测试并确认失败**

```bash
pnpm vitest run tests/presentation-asset-library.spec.ts
```

- [ ] **Step 3: 实现素材采用服务**

素材文件和 Manifest 使用 staging + Hash 校验 + 原子替换；不得修改已有原始资料字节。

- [ ] **Step 4: 运行测试与类型检查**

```bash
pnpm vitest run tests/presentation-asset-library.spec.ts
pnpm typecheck
```

- [ ] **Step 5: 提交**

```bash
git add src/presentation/asset-library.ts tests/presentation-asset-library.spec.ts
git commit -m "feat: adopt presentation assets with lineage"
```

---

### Task 6: 实现专业成果到 Canonical 大纲和草案的投影

**Files:**
- Create: `src/presentation/projector.ts`
- Test: `tests/presentation-projector.spec.ts`

**Interfaces:**
- Consumes: `ProjectRevisionSnapshot`、当前 Revision 的 Gate、Evidence、已采用素材，以及官方 Canonical 类型。
- Produces:

```ts
export interface PresentationProjectionInput {
  readonly projectId: string
  readonly preDesignRevision: number
  readonly generatedAt: string
}

export interface PresentationProjection {
  readonly project: unknown
  readonly rules: unknown
  readonly outline: unknown
  readonly pageManifest: unknown
  readonly drafts: ReadonlyMap<string, unknown>
  readonly assetManifest: unknown
  readonly sourceObjectIds: readonly string[]
}
```

`unknown` 表示本地服务不重新定义 Canonical 类型；实际值由官方 `presentation-tools` 类型和 Schema 约束。

- [ ] **Step 1: 写失败测试**

必须验证：

- 多个专业 State Object 能汇聚为一个大纲节点或页面；
- 一个复杂结论可以拆分为多页；
- 不出现 57 个对象机械对应 57 页；
- 页面具有稳定 ID；
- 页面主标题、核心结论、正文、列表、指标、表格、讲解稿和素材引用符合官方 Schema；
- 每个 `pre-design` 生成内容块保留通用 `sourceRefs`；
- 不产生任何 `x/y/w/h`、字体、主题或版式字段；
- 投影结果全部通过官方文档验证器。

- [ ] **Step 2: 运行测试并确认失败**

```bash
pnpm vitest run tests/presentation-projector.spec.ts
```

- [ ] **Step 3: 实现项目级投影器**

职责拆分为纯函数：

```ts
projectProjectManifest(...)
projectProjectRules(...)
projectOutline(...)
projectPages(...)
projectDrafts(...)
projectAssets(...)
```

禁止读取 DOM、UI 状态或 legacy 页面规划结果；输入必须来自冻结的 `pre-design` Revision。

- [ ] **Step 4: 运行测试与类型检查**

```bash
pnpm vitest run tests/presentation-projector.spec.ts
pnpm typecheck
```

- [ ] **Step 5: 提交**

```bash
git add src/presentation/projector.ts tests/presentation-projector.spec.ts
git commit -m "feat: project predesign content to presentation canonical model"
```

---

### Task 7: 实现节点同步、冲突检测和 Revision 映射

**Files:**
- Create: `src/presentation/sync-service.ts`
- Modify: `src/state/types.ts`
- Modify: `src/state/repository.ts`
- Modify: `src/commands/register.ts`
- Test: `tests/presentation-sync.spec.ts`

**Interfaces:**
- Consumes: Task 6 Projection、官方标准验证器、当前 Presentation Head / Revision 契约。
- Produces:

```ts
export type PresentationSyncTrigger =
  | { readonly kind: 'gate_approved'; readonly gateId: string }
  | { readonly kind: 'explicit'; readonly actorId: string }

export interface PresentationSyncConflict {
  readonly objectType: string
  readonly objectId: string
  readonly reason: 'presentation_modified' | 'base_revision_changed' | 'source_identity_changed'
}

export interface PresentationSyncResult {
  readonly projectId: string
  readonly preDesignRevision: number
  readonly presentationBaseRevision: number
  readonly presentationRevision?: number
  readonly createdIds: readonly string[]
  readonly updatedIds: readonly string[]
  readonly unchangedIds: readonly string[]
  readonly conflicts: readonly PresentationSyncConflict[]
  readonly status: 'committed' | 'conflicted' | 'failed'
}
```

- [ ] **Step 1: 写失败测试**

覆盖：

- Gate 未批准且无显式触发时拒绝正式同步；
- 同一 `pre-design` Revision 重试不生成重复 Revision；
- 同步基于冻结 Revision；
- Presentation 已人工修改同一内容对象时返回冲突，不静默覆盖；
- 无冲突对象可以按标准允许的原子提交协议落盘；
- 同步后保存 `pre-design Revision → Presentation Revision` 映射；
- `layouts/` 不被创建或修改；
- 同步失败后当前正式 Presentation Head 不变化。

- [ ] **Step 2: 运行测试并确认失败**

```bash
pnpm vitest run tests/presentation-sync.spec.ts
```

- [ ] **Step 3: 实现同步服务**

固定流程：

```text
读取 ready 绑定
→ 读取冻结 pre-design Revision
→ 构建 Projection
→ 读取 Presentation baseRevision
→ 比较 sourceRefs 与 lastModifiedRevision
→ 生成 ChangeSet / 冲突清单
→ 官方 Schema 验证
→ 按 Presentation 原子提交协议提交
→ 更新 Revision 映射
```

- [ ] **Step 4: 增加显式同步命令**

命令只属于 `pre-design` 插件；不得要求修改 Presentation UI。命令返回新增、修改、未变和冲突数量及对象 ID。

- [ ] **Step 5: 运行测试**

```bash
pnpm vitest run tests/presentation-sync.spec.ts tests/commands.spec.ts
pnpm typecheck
```

- [ ] **Step 6: 提交**

```bash
git add src/presentation/sync-service.ts src/state src/commands/register.ts tests/presentation-sync.spec.ts
git commit -m "feat: sync predesign revisions to presentation projects"
```

---

### Task 8: 完成真实项目纵向 E2E 与 legacy 兼容验证

**Files:**
- Create: `tests/presentation-project-e2e.spec.ts`
- Modify: `docs/acceptance.md`
- Modify: `HANDOFF.md`

**Interfaces:**
- Consumes: Tasks 1–7 全部能力。
- Produces: 一条无需 Presentation UI 改动的完整 `pre-design` 项目目录生成证据。

- [ ] **Step 1: 写 E2E 测试**

场景固定为：

```text
全新 DSH Storage / 临时工作区
→ /preplan-new 创建项目
→ 自动生成完整标准目录
→ 校验最小合法 JSON
→ 导入文档、图片、视频和重复文件
→ 采用一张原始图片
→ 生成并采用一张图表/分析图
→ 提交若干专业状态并通过章节 Gate
→ 显式同步大纲和草案
→ 校验所有 Canonical 文件
→ 确认 layouts/ 为空
→ 重启 Repository 与插件服务
→ 恢复项目并再次幂等同步
```

- [ ] **Step 2: 增加故障注入测试**

至少覆盖：

- 初始化器失败；
- Schema 验证失败；
- staging rename 失败；
- 项目控制记录写入失败；
- Manifest 更新失败；
- 进程在最终 rename 后、ready 记录前中断；
- Presentation baseRevision 冲突。

- [ ] **Step 3: 运行专项和完整回归**

```bash
pnpm test
pnpm typecheck
pnpm test:built
```

Expected:

- 新增测试全部通过；
- 现有测试不回退；
- legacy HTML/PPTX/PDF 测试仍通过；
- npm 包版本仍为原版本；
- 没有创建正式 `v2.0.0` Tag 或 Release。

- [ ] **Step 4: 更新验收和 HANDOFF**

必须记录：

- Presentation 标准版本和来源 commit；
- pre-design 实现 commit；
- E2E 命令和新鲜输出；
- 示例项目目录路径与 Hash；
- legacy 路径仍保留的边界；
- 尚未进入本版的功能。

- [ ] **Step 5: 提交**

```bash
git add tests/presentation-project-e2e.spec.ts docs/acceptance.md HANDOFF.md
git commit -m "test: verify presentation project integration end to end"
```

---

## Plan Self-Review

### Spec coverage

- 两插件独立：Task 1–8 均不合并仓库或插件。
- 标准权威在 Presentation：Task 1 使用适配口消费官方标准，不复制 Schema。
- 创建时自动建目录：Task 3。
- 强一致与恢复：Task 2–3、Task 8 故障注入。
- 最小合法文件：Task 1、Task 3。
- 原始资料复制和去重：Task 4。
- 正式素材分类和溯源：Task 5。
- 大纲、草案和素材 Canonical 输出：Task 6。
- Gate / 显式触发同步：Task 7。
- Revision 分离与映射：Task 7。
- 不生成 Layout：Task 6–8 均有断言。
- 不改 Presentation UI：全局约束和所有任务均遵守。
- legacy 输出不删除：Task 8 回归验证。

### Execution gate

本计划已经可执行，但必须先收到 `presentation-tools` 对以下内容的正式交付：目录版本、Schema、最小实例、初始化器、验证器、稳定 ID、sourceRefs、素材 lineage、Revision 提交方式和跨仓消费方式。未满足该门槛时，只允许继续审查规范，不允许在 `pre-design` 中用临时私有结构抢跑。
