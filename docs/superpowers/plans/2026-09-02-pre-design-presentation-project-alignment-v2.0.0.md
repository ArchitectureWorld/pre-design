# Pre-design Presentation Project Alignment V2.0.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `pre-design` 在创建项目时自行生成并维护符合 `presentation-tools` 权威格式的标准项目目录，输出项目基本信息、大纲、逐页草案、讲解稿、原始资料和正式素材，同时不承担排版，也不依赖 Presentation 的内容治理或 Revision 系统。

**Architecture:** 保持两个独立 DSH 插件。`presentation-tools` 发布只读、版本化的格式 Contract、类型、Fixture 和验证器；`pre-design` 负责项目创建、目录生命周期、资料导入、素材采用、专业内容投影以及外部修改检测。标准文件是中立载体，人或当前 DSH Agent 通过工具继续修改；`pre-design` 只在未检测到外部修改时更新自己曾输出的对象。

**Tech Stack:** TypeScript 5.9、Node.js 20+、DSH Storage Domain、Vitest、Ajv 8、现有 `pre-design` Repository / Governance / Workflow Runtime、`presentation-tools` 最终发布的精确版本 Contract。

**Spec:** `docs/superpowers/specs/2026-09-02-pre-design-presentation-project-alignment-v2.0.0-design.md`

**Content Baseline:** `docs/superpowers/specs/2026-09-02-pre-design-presentation-content-baseline-v2.0.0.md`

## Global Constraints

- `pre-design` 是可执行 DSH 插件，前期策划 Skill 是插件内部能力。
- DSH Harness 是唯一 Agent Runtime。
- 第一版继续保持两个独立 DSH 插件。
- 不修改 `presentation-tools` UI 或交互。
- `presentation-tools` 是标准格式唯一权威。
- `pre-design` 不复制后独立修改 Presentation Schema。
- 项目创建、staging、回滚、恢复和 DSH 项目记录均由 `pre-design` 执行。
- Presentation Contract 只提供格式、类型、Fixture、验证器和稳定错误代码。
- 默认项目位置是 `<DSH 当前工作区>/projects/<projectId>-<projectSlug>/`。
- 项目创建失败不得返回成功。
- Canonical JSON 和 Manifest 不保存绝对路径。
- 原始资料默认复制，不移动、不软链接，并按 SHA-256 去重。
- 草案只通过稳定 `assetId` 引用正式素材。
- `pre-design` 不生成或修改 `layouts/` 内容。
- 第一版不依赖 Presentation Head、CAS、Revision 映射、自动刷新或内容所有权。
- 外部修改由 `pre-design` 自身保存的上次输出 Hash 检测。
- 现有 legacy HTML/PPTX/PDF 路径不删除。
- 当前计划在最终 Presentation Contract 通过审查后执行；正式包坐标和 Schema Set Hash 通过单独的 Contract Lock 提交进入仓库。

---

## File Structure

```text
src/presentation/
├─ contract-port.ts              pre-design 需要的最小格式 Contract 接口
├─ contract-adapter.ts           对最终官方 Contract 的窄适配
├─ contract-lock.ts              精确版本与 Schema Set Hash 校验
├─ types.ts                      pre-design 自身绑定和输出结果类型
├─ project-binding.ts            项目目录绑定与上次输出 Hash
├─ project-directory.ts          目录创建、staging、验证、rename 和补偿
├─ recovery.ts                   pre-design 创建残留恢复
├─ source-materials.ts           原始资料复制、分类和 Hash 去重
├─ asset-library.ts              正式素材采用、分类和 lineage
├─ projector/
│  ├─ index.ts                   组合完整 Presentation 输出
│  ├─ outline.ts                 8 类主题与大纲投影
│  ├─ pages.ts                   页面拆分与稳定 ID
│  ├─ drafts.ts                  五类内容块和讲解稿
│  └─ identifiers.ts             稳定 ID 保留与新对象生成
├─ export-ledger.ts              pre-design 上次输出对象 Hash
└─ update-service.ts             标准文件更新与外部修改检测

src/state/
├─ domain.ts                     PresentationProjectBindingRecord 表
├─ repository.ts                 绑定记录读写
└─ types.ts                      绑定记录类型

src/commands/register.ts          创建项目、导入资料、采用素材、输出汇报
src/client/direct-start.ts        目录 ready 后才继续启动
src/index.ts                      服务装配与恢复

tests/
├─ presentation-contract-adapter.spec.ts
├─ presentation-contract-lock.spec.ts
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

### Task 0: 接受并锁定最终 Presentation Contract

**Files:**
- Create: `docs/contracts/presentation-standard-project-v1-lock.json`
- Create: `scripts/verify-presentation-contract-lock.ts`
- Modify: `package.json`
- Test: `tests/presentation-contract-lock.spec.ts`

**Interfaces:**
- Consumes: Presentation 正式反馈中的包名、精确版本、Schema Set SHA-256、类型入口和验证器入口。
- Produces:

```ts
export interface PresentationContractLock {
  readonly standardName: string
  readonly standardVersion: string
  readonly packageName: string
  readonly packageVersion: string
  readonly schemaSetSha256: string
}
```

- [ ] **Step 1: 在开始编码前审查正式反馈**

确认反馈同时提供：

```text
standardName
standardVersion
packageName
packageVersion
schemaSetSha256
typesEntry
documentValidatorEntry
projectValidatorEntry
minimalFixturePath
fullExamplePath
validationCommand
commitSHA
```

若任一字段缺失，停止执行后续任务，不自行猜测。

- [ ] **Step 2: 写入精确 Contract Lock**

`presentation-standard-project-v1-lock.json` 必须使用反馈中的真实值，不允许版本范围、分支名或浮动 Tag。

- [ ] **Step 3: 精确安装官方包**

使用 `pnpm add --save-exact` 安装 Lock 指定的包和版本，并提交 `pnpm-lock.yaml` 的 integrity。

- [ ] **Step 4: 写失败测试**

测试内容：

- package version 与 Lock 不一致时失败；
- standardVersion 与 Lock 不一致时失败；
- Schema Set SHA-256 不一致时失败；
- 类型或验证器入口缺失时失败。

- [ ] **Step 5: 运行测试并确认失败**

```bash
pnpm vitest run tests/presentation-contract-lock.spec.ts
```

- [ ] **Step 6: 实现校验脚本并运行**

```bash
pnpm tsx scripts/verify-presentation-contract-lock.ts
pnpm vitest run tests/presentation-contract-lock.spec.ts
pnpm typecheck
```

- [ ] **Step 7: 提交**

```bash
git add package.json pnpm-lock.yaml docs/contracts/presentation-standard-project-v1-lock.json scripts/verify-presentation-contract-lock.ts tests/presentation-contract-lock.spec.ts
git commit -m "build: pin presentation project contract"
```

---

### Task 1: 建立最小 Contract Adapter

**Files:**
- Create: `src/presentation/contract-port.ts`
- Create: `src/presentation/contract-adapter.ts`
- Create: `src/presentation/contract-lock.ts`
- Create: `src/presentation/types.ts`
- Test: `tests/presentation-contract-adapter.spec.ts`

**Interfaces:**
- Consumes: Task 0 锁定的官方类型和验证器。
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

export interface PresentationValidationIssue {
  readonly code: string
  readonly path: string
  readonly message: string
}

export interface MinimalPresentationDocuments {
  readonly project: unknown
  readonly rules: unknown
  readonly outline: unknown
  readonly pageManifest: unknown
  readonly sourceMaterialManifest: unknown
  readonly assetManifest: unknown
}

export interface PresentationFormatContract {
  readonly standardVersion: string
  readonly schemaSetSha256: string
  createMinimalDocuments(input: {
    readonly projectId: string
    readonly projectSlug: string
    readonly projectName: string
    readonly createdAt: string
    readonly sourceProvider: 'pre-design'
  }): MinimalPresentationDocuments
  validateDocument(
    kind: PresentationDocumentKind,
    value: unknown,
  ): readonly PresentationValidationIssue[]
  validateProject(root: string): Promise<readonly PresentationValidationIssue[]>
}
```

- [ ] **Step 1: 写失败测试**

验证 Adapter：

- 只暴露上述最小能力；
- 不暴露 Presentation UI、Layout、Head、Revision 或同步接口；
- 不重新定义 Canonical Schema；
- 版本或 Hash 不匹配时拒绝启动；
- 验证错误保留稳定错误代码。

- [ ] **Step 2: 运行测试并确认失败**

```bash
pnpm vitest run tests/presentation-contract-adapter.spec.ts
```

- [ ] **Step 3: 实现 Adapter**

要求：

- 从官方包读取类型和验证器；
- `createMinimalDocuments` 只能调用官方纯文档工厂或从官方最小 Fixture 读取并替换允许的项目字段；
- 不调用 Presentation 项目生命周期或 Revision API；
- 不重命名官方 Canonical 字段。

- [ ] **Step 4: 运行测试**

```bash
pnpm vitest run tests/presentation-contract-adapter.spec.ts tests/presentation-contract-lock.spec.ts
pnpm typecheck
```

- [ ] **Step 5: 提交**

```bash
git add src/presentation/contract-port.ts src/presentation/contract-adapter.ts src/presentation/contract-lock.ts src/presentation/types.ts tests/presentation-contract-adapter.spec.ts
git commit -m "feat: consume presentation format contract"
```

---

### Task 2: 增加项目目录绑定和输出账本

**Files:**
- Modify: `src/state/types.ts`
- Modify: `src/state/domain.ts`
- Modify: `src/state/repository.ts`
- Create: `src/presentation/project-binding.ts`
- Create: `src/presentation/export-ledger.ts`
- Test: `tests/presentation-project-directory.spec.ts`

**Interfaces:**
- Produces:

```ts
export type PresentationDirectoryState =
  | 'creating'
  | 'ready'
  | 'recovery_required'

export interface PresentationProjectBindingRecord {
  readonly projectId: string
  readonly directoryRoot: string
  readonly standardVersion: string
  readonly state: PresentationDirectoryState
  readonly lastExportedPreDesignRevision?: number
  readonly lastExportedAt?: string
  readonly lastExportedObjectHashes: Readonly<Record<string, string>>
  readonly createdAt: string
  readonly updatedAt: string
}
```

Repository methods:

```ts
putPresentationProjectBinding(
  record: PresentationProjectBindingRecord,
): Promise<PresentationProjectBindingRecord>

readPresentationProjectBinding(
  projectId: string,
): PresentationProjectBindingRecord | undefined

listPresentationProjectBindingsByState(
  state: PresentationDirectoryState,
): readonly PresentationProjectBindingRecord[]
```

- [ ] **Step 1: 写失败测试**

覆盖：

- 绑定记录创建和读取；
- `directoryRoot` 是绝对路径；
- 绝对路径不进入专业 Revision Snapshot；
- Hash 键为稳定 Presentation 对象 ID；
- SHA-256 为小写 64 位十六进制；
- 不包含 Presentation Revision、Head 或内容所有权字段。

- [ ] **Step 2: 运行测试并确认失败**

```bash
pnpm vitest run tests/presentation-project-directory.spec.ts
```

- [ ] **Step 3: 实现类型、Schema 和 Repository**

`ready` 只允许目录服务在完整验证通过后写入。

- [ ] **Step 4: 运行测试**

```bash
pnpm vitest run tests/presentation-project-directory.spec.ts
pnpm typecheck
```

- [ ] **Step 5: 提交**

```bash
git add src/state src/presentation/project-binding.ts src/presentation/export-ledger.ts tests/presentation-project-directory.spec.ts
git commit -m "feat: persist presentation directory bindings"
```

---

### Task 3: 由 `pre-design` 实现项目目录创建与恢复

**Files:**
- Create: `src/presentation/project-directory.ts`
- Create: `src/presentation/recovery.ts`
- Modify: `src/commands/register.ts`
- Modify: `src/client/direct-start.ts`
- Modify: `src/index.ts`
- Test: `tests/presentation-project-directory.spec.ts`
- Test: `tests/presentation-project-recovery.spec.ts`

**Interfaces:**
- Consumes: `PresentationFormatContract` 和 `PresentationProjectBindingRecord`。
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
  create(
    input: CreatePresentationProjectDirectoryInput,
  ): Promise<PresentationProjectDirectoryResult>

  recoverPending(): Promise<readonly PresentationProjectDirectoryResult[]>
}
```

- [ ] **Step 1: 写失败测试**

覆盖：

- 默认目录；
- 同文件系统 staging；
- `pre-design` 自己创建所有目录；
- 使用官方文档工厂写六份 JSON；
- 完整验证后才 rename；
- 同 `projectId` 的合法目录恢复；
- 同名不同身份拒绝覆盖；
- 初始化、写文件、验证、rename 和绑定记录失败均不返回成功；
- `layouts/` 创建为空；
- 不调用 Presentation Revision 或项目生命周期 API。

- [ ] **Step 2: 运行测试并确认失败**

```bash
pnpm vitest run tests/presentation-project-directory.spec.ts tests/presentation-project-recovery.spec.ts
```

- [ ] **Step 3: 实现创建流程**

```text
creating 绑定记录
→ 同父目录 staging
→ 创建固定目录
→ 写六份最小文档
→ 官方完整验证
→ 原子 rename
→ ready 绑定记录
→ 返回成功
```

- [ ] **Step 4: 实现补偿和恢复**

异常时：

```text
删除 staging / 尚未确认最终目录
→ 恢复或删除 creating 记录
→ 无法补偿则写 recovery_required
→ 抛出结构化错误
```

- [ ] **Step 5: 接入 `/preplan-new`**

`/preplan-new` 只有在专业项目记录和标准目录均 ready 后才返回成功。

- [ ] **Step 6: 运行专项和回归**

```bash
pnpm vitest run tests/presentation-project-directory.spec.ts tests/presentation-project-recovery.spec.ts tests/direct-start.client.spec.ts tests/commands.spec.ts
pnpm typecheck
```

- [ ] **Step 7: 提交**

```bash
git add src/presentation/project-directory.ts src/presentation/recovery.ts src/commands/register.ts src/client/direct-start.ts src/index.ts tests
git commit -m "feat: create presentation project directories"
```

---

### Task 4: 实现原始资料导入

**Files:**
- Create: `src/presentation/source-materials.ts`
- Modify: `src/commands/register.ts`
- Test: `tests/presentation-source-materials.spec.ts`

**Interfaces:**
- Produces:

```ts
export interface ImportSourceMaterialInput {
  readonly projectId: string
  readonly sourcePath: string
  readonly importedAt: string
}

export interface ImportSourceMaterialResult {
  readonly sourceMaterialId: string
  readonly category: string
  readonly relativePath: string
  readonly sha256: string
  readonly deduplicated: boolean
}
```

- [ ] **Step 1: 写失败测试**

覆盖：

- 原文件保留；
- 正确分类；
- 相同 Hash 去重；
- 同名不同内容安全改名；
- Manifest 无绝对源路径；
- 文件与 Manifest 一致；
- 更新后通过官方验证器；
- 中途失败可补偿。

- [ ] **Step 2: 运行测试并确认失败**

```bash
pnpm vitest run tests/presentation-source-materials.spec.ts
```

- [ ] **Step 3: 实现导入**

```text
读取和 Hash
→ 检查现有 Manifest
→ staging copy
→ 复核字节数和 Hash
→ 原子落盘
→ 原子替换 Manifest
→ 完整验证
```

- [ ] **Step 4: 接入受控命令**

命令只导入原始资料，不自动采用为正式素材。

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

### Task 5: 实现正式素材采用和来源链

**Files:**
- Create: `src/presentation/asset-library.ts`
- Modify: `src/commands/register.ts`
- Test: `tests/presentation-asset-library.spec.ts`

**Interfaces:**
- Produces:

```ts
export type PresentationAssetOrigin =
  | { readonly kind: 'source_material'; readonly sourceMaterialId: string }
  | {
      readonly kind: 'derived_source_material'
      readonly sourceMaterialId: string
      readonly operation: string
    }
  | {
      readonly kind: 'pre_design_generated'
      readonly sourceRevision: number
      readonly objectIds: readonly string[]
      readonly evidenceIds: readonly string[]
    }
  | { readonly kind: 'external_tool'; readonly provider: string }
  | { readonly kind: 'human_added' }

export interface AdoptPresentationAssetInput {
  readonly projectId: string
  readonly sourcePath: string
  readonly category: string
  readonly semanticRole: string
  readonly origin: PresentationAssetOrigin
  readonly adoptedAt: string
}
```

- [ ] **Step 1: 写失败测试**

覆盖：

- 原始资料原件保留；
- 派生素材进入正确目录；
- 未采用候选不能进入正式 Manifest；
- 同一 `assetId` 不指向不同内容；
- 页面只需 `assetId`；
- lineage 保留专业对象、证据和 Revision；
- 文件和 Manifest 更新失败可补偿；
- 完整项目通过官方验证器。

- [ ] **Step 2: 运行测试并确认失败**

```bash
pnpm vitest run tests/presentation-asset-library.spec.ts
```

- [ ] **Step 3: 实现素材采用服务**

使用 staging、Hash 复核和原子 Manifest 替换，不修改原始资料字节。

- [ ] **Step 4: 运行测试**

```bash
pnpm vitest run tests/presentation-asset-library.spec.ts tests/commands.spec.ts
pnpm typecheck
```

- [ ] **Step 5: 提交**

```bash
git add src/presentation/asset-library.ts src/commands/register.ts tests/presentation-asset-library.spec.ts
git commit -m "feat: adopt presentation assets"
```

---

### Task 6: 实现大纲、页面和草案投影

**Files:**
- Create: `src/presentation/projector/index.ts`
- Create: `src/presentation/projector/outline.ts`
- Create: `src/presentation/projector/pages.ts`
- Create: `src/presentation/projector/drafts.ts`
- Create: `src/presentation/projector/identifiers.ts`
- Test: `tests/presentation-outline-projector.spec.ts`
- Test: `tests/presentation-draft-projector.spec.ts`

**Interfaces:**
- Consumes: 同一冻结 `pre-design` Revision 的项目、专业对象、Evidence、Assumption、Decision、Gate 和正式素材。
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
  readonly sourceMaterialManifest: unknown
  readonly assetManifest: unknown
  readonly objectHashes: Readonly<Record<string, string>>
}
```

`unknown` 表示 `pre-design` 不复制官方 Canonical 类型；实际值由 Contract Adapter 验证。

- [ ] **Step 1: 写大纲失败测试**

覆盖：

- 8 类默认骨架；
- 不适用章节省略；
- 章节合并和拆分；
- 多个专业对象汇聚；
- 不生成 57 页工作流目录；
- 具体案例词不进入默认骨架；
- `sourceRefs` 可追溯；
- 稳定 `outlineNodeId` 保留。

- [ ] **Step 2: 写草案失败测试**

覆盖：

- 单页单核心结论；
- 页面主标题唯一；
- 核心结论唯一；
- 五类内容块；
- 独立讲解稿；
- 内容性质；
- assetId 引用；
- 不产生任何排版字段；
- 所有文档通过官方验证器。

- [ ] **Step 3: 运行测试并确认失败**

```bash
pnpm vitest run tests/presentation-outline-projector.spec.ts tests/presentation-draft-projector.spec.ts
```

- [ ] **Step 4: 实现纯投影函数**

要求：

- 不读取 UI、DOM、Layout 或 legacy page-plan；
- 相同冻结输入产生稳定内容；
- ID 只在语义新对象产生时生成；
- 内容 Hash 使用固定 Canonical JSON；
- 不写文件系统。

- [ ] **Step 5: 运行测试**

```bash
pnpm vitest run tests/presentation-outline-projector.spec.ts tests/presentation-draft-projector.spec.ts
pnpm typecheck
```

- [ ] **Step 6: 提交**

```bash
git add src/presentation/projector tests/presentation-outline-projector.spec.ts tests/presentation-draft-projector.spec.ts
git commit -m "feat: project predesign content to presentation format"
```

---

### Task 7: 实现标准文件更新和外部修改检测

**Files:**
- Create: `src/presentation/update-service.ts`
- Modify: `src/presentation/export-ledger.ts`
- Modify: `src/state/repository.ts`
- Modify: `src/commands/register.ts`
- Test: `tests/presentation-update-service.spec.ts`

**Interfaces:**
- Produces:

```ts
export interface PresentationFileUpdateResult {
  readonly projectId: string
  readonly preDesignRevision: number
  readonly createdIds: readonly string[]
  readonly updatedIds: readonly string[]
  readonly unchangedIds: readonly string[]
  readonly reviewRequiredIds: readonly string[]
  readonly status: 'updated' | 'review_required' | 'failed'
}
```

- [ ] **Step 1: 写失败测试**

覆盖：

- Gate、用户或已授权 Agent 触发；
- 同一专业 Revision 重试不重复写入；
- 当前对象 Hash 等于上次输出 Hash 时允许更新；
- 当前对象 Hash 不等时返回 `review_required`；
- 不判断修改者是人、Agent 还是其他工具；
- 无冲突对象可以更新；
- `review_required` 对象不被覆盖；
- `layouts/` 不创建新内容、不修改既有内容；
- 失败后输出账本不前进；
- 不依赖 Presentation Revision、Head、CAS 或 UpstreamSyncRecord。

- [ ] **Step 2: 运行测试并确认失败**

```bash
pnpm vitest run tests/presentation-update-service.spec.ts
```

- [ ] **Step 3: 实现更新流程**

```text
读取 ready 绑定
→ 读取冻结 pre-design Revision
→ 构建 Projection
→ 读取当前标准文件
→ 按稳定 ID 计算当前语义 Hash
→ 与上次输出账本比较
→ 生成 created / updated / unchanged / review_required
→ 将可更新文件写入 staging
→ 官方完整验证
→ 原子替换可更新文件和 Manifest
→ 更新输出账本
```

- [ ] **Step 4: 增加显式输出命令**

命令属于 `pre-design` 插件，返回对象数量和 `reviewRequiredIds`，不要求 Presentation 增加 UI。

- [ ] **Step 5: 运行测试**

```bash
pnpm vitest run tests/presentation-update-service.spec.ts tests/commands.spec.ts
pnpm typecheck
```

- [ ] **Step 6: 提交**

```bash
git add src/presentation/update-service.ts src/presentation/export-ledger.ts src/state/repository.ts src/commands/register.ts tests/presentation-update-service.spec.ts
git commit -m "feat: update presentation files safely"
```

---

### Task 8: 完成真实纵向 E2E 和 legacy 回归

**Files:**
- Create: `tests/presentation-project-e2e.spec.ts`
- Modify: `docs/acceptance.md`
- Modify: `HANDOFF.md`

**Interfaces:**
- Consumes: Tasks 0–7。
- Produces: 不依赖 Presentation UI 的完整 `pre-design` 标准项目输出证据。

- [ ] **Step 1: 写 E2E 测试**

固定场景：

```text
全新 DSH Storage 和临时工作区
→ /preplan-new
→ pre-design 创建标准目录
→ 验证最小空项目
→ 导入文档、图片、视频和重复文件
→ 采用一张原始图片
→ 生成并采用一张图表
→ 提交若干专业状态并通过 Gate
→ 输出大纲、页面和草案
→ 验证全部结构文件
→ 确认 layouts/ 为空
→ 模拟外部修改一段草案
→ 再次输出并得到 review_required
→ 确认外部修改未被覆盖
→ 重启插件
→ 恢复项目绑定和输出账本
```

- [ ] **Step 2: 增加故障注入**

至少覆盖：

- Contract 版本或 Hash 不一致；
- 文档工厂失败；
- Schema 验证失败；
- staging 写入失败；
- rename 失败；
- 绑定记录失败；
- Manifest 替换失败；
- 外部修改；
- 恢复残留 staging。

- [ ] **Step 3: 运行专项和完整回归**

```bash
pnpm vitest run tests/presentation-project-e2e.spec.ts
pnpm test
pnpm typecheck
pnpm test:built
```

Expected:

- 新增测试全部通过；
- 现有测试不回退；
- legacy HTML/PPTX/PDF 测试仍通过；
- npm 包版本仍为当前正式版本；
- 没有创建正式 `v2.0.0` Tag 或 Release；
- `layouts/` 未被 pre-design 写入。

- [ ] **Step 4: 更新验收与交接**

记录：

- Presentation Contract 精确版本和 Hash；
- E2E 测试数量；
- 创建、资料、素材、草案和外部修改保护证据；
- legacy 回归结果；
- 已知非阻断风险。

- [ ] **Step 5: 提交**

```bash
git add tests/presentation-project-e2e.spec.ts docs/acceptance.md HANDOFF.md
git commit -m "test: verify presentation project output flow"
```

---

## Final Verification

在声明完成前运行：

```bash
pnpm tsx scripts/verify-presentation-contract-lock.ts
pnpm test
pnpm typecheck
pnpm test:built
git diff --check
git status --short
```

完成声明必须包含实际命令输出、通过数量、当前 commit SHA 和仍存在的非阻断风险。
