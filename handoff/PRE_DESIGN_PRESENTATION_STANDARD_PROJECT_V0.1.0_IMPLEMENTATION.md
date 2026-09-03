---
document_id: pre-v2-standard-project-output-handoff
document_version: 2.0.0
status: implementation-complete-final-verification-pending
pre_design_version: 2.0.0
presentation_contract_version: 0.1.0
architecture_branch: architecture/pre-v2.0.0
development_branch: feat/pre-v2.0.0
phase0_base_commit: bc6fe0347b7725ae3df79c9317d198cd815d41b2
contract_commit: 974668d308728386ea005c9e77d58ebff9372f0a
schema_set_sha256: 5bd329fcc8503ff7a48b3430e41b38dd264ae486cee7372a39cbbcccc2de2ebc
language: zh-CN
---

# Pre-design 2.0.0 标准项目输出实施 Handoff

## 1. 产品与依赖坐标

本交接属于：

```text
Pre-design 2.0.0
```

外部项目格式依赖为：

```text
Presentation Standard Project Directory 0.1.0
```

两者解耦：Pre 的分支、产品和包版本使用 `2.0.0`；外部 Contract 版本 `0.1.0` 只用于依赖锁和兼容验证。

| 字段 | 值 |
|---|---|
| Pre 仓库 | `ArchitectureWorld/pre-design` |
| 架构支线 | `architecture/pre-v2.0.0` |
| 开发支线 | `feat/pre-v2.0.0` |
| Pre 包 | `@architectureworld/dsh-preplanning-agent@2.0.0` |
| Phase 0 基线提交 | `bc6fe0347b7725ae3df79c9317d198cd815d41b2` |
| Contract 仓库 | `ArchitectureWorld/presentation-tools` |
| Contract 固定提交 | `974668d308728386ea005c9e77d58ebff9372f0a` |
| Contract 包 | `@architectureworld/presentation-contracts@0.1.0` |
| Schema Set SHA-256 | `5bd329fcc8503ff7a48b3430e41b38dd264ae486cee7372a39cbbcccc2de2ebc` |
| Contract Lock | `docs/contracts/presentation-standard-project-v0.1.0-lock.json` |

## 2. 已实施能力

- 精确检出固定 Contract 提交；
- 核验标准名、版本和 Schema Set；
- `npm pack` 为不可变 tarball；
- lockfile 固定 tarball integrity；
- 唯一标准项目 Adapter；
- Stable ID 创建和持久化；
- Project、Rules、Outline、PageManifest、DraftPageDocument 映射；
- 五类内容块、讲解稿和页面素材引用；
- `source-materials/` 与 `assets/` 分离；
- MIME、`sizeBytes`、SHA-256 和相对路径；
- `sourceRefs` 保存 Pre 项目、Revision、对象和 Evidence；
- 同文件系统 staging、完整验证、原子发布和失败回滚；
- 已存在目录保护；
- 外部修改检测；
- Contract Minimal Fixture 和完整示例消费；
- Windows/Linux 路径规则测试；
- 现有 HTML/PPTX/PDF 输出兼容。

## 3. 主要实现入口

```text
src/presentation/standard-contract.ts
src/presentation/standard-project-adapter.ts
src/presentation/standard-project-types.ts
src/presentation/standard-project-writer.ts
src/presentation/standard-project-service.ts
src/presentation/standard-project-error.ts
src/presentation/identity-ledger.ts
src/presentation/binding-domain.ts
src/presentation/binding-repository.ts
src/presentation/source-material-writer.ts
src/presentation/asset-writer.ts
```

Contract 与构建入口：

```text
scripts/prepare-presentation-contract.mjs
scripts/verify-presentation-contract-lock.mjs
scripts/verify-presentation-standard-integration.mjs
vendor/presentation-contracts/architectureworld-presentation-contracts-0.1.0.tgz
```

## 4. 数据映射

```text
Pre FrozenProjectInput
→ adaptFrozenProjectToPresentationFindings()
→ stable identity ledger
→ PresentationStandardProjectAdapter
→ Canonical documents
→ managed source-material and asset files
→ Contract validator
→ atomic project-directory publication
```

身份规则：

- `preDesignProjectId` 是 Pre 内部项目身份；
- `presentationProjectId` 由外部 Contract `createStableId('project')` 创建；
- 两者持久化映射；
- 页面、草案、内容块和素材 ID 按稳定业务键复用；
- 标题、数组下标、页码和文件名不作为身份。

## 5. 标准输出

```text
<projectId>-<projectSlug>/
├─ project.json
├─ rules.json
├─ outline.json
├─ pages/
│  ├─ manifest.json
│  └─ drafts/
├─ source-materials/
│  ├─ manifest.json
│  └─ documents|drawings|images|videos|data|models|other/
├─ assets/
│  ├─ manifest.json
│  └─ images|videos|charts|diagrams|audio|other/
└─ layouts/
```

`layouts/` 保持为空。Pre 不输出字体、颜色、坐标、模板、PPT 母版或 CSS。

## 6. 安全发布

```text
创建 sibling staging
→ Factory 生成目录计划
→ 写 Canonical JSON
→ 复制原始资料
→ 写正式素材
→ 更新 Manifest
→ Contract 全量验证
→ 验证通过后原子 rename
```

任何步骤失败时：

- 不覆盖旧成果；
- 不更新成功状态或 ID Ledger；
- 清理 staging；
- 返回结构化错误；
- 不报告成功。

## 7. 验证命令

```bash
pnpm install --frozen-lockfile
pnpm verify:alignment-versions
pnpm verify:presentation-contract
pnpm test:presentation-standard
pnpm typecheck
pnpm test
pnpm test:built
git diff --check
```

成功标记：

```text
PRE_DESIGN_V2_0_0_VERSION_CONSISTENCY_PASS
PRESENTATION_STANDARD_PROJECT_V0_1_0_PASS
```

## 8. DSH 部署边界

当前代码应先部署到独立测试 Profile：

```powershell
dsh plugin --profile pre-v2-test add .\architectureworld-dsh-preplanning-agent-2.0.0.tgz
dsh --profile pre-v2-test --dump-config
dsh --profile pre-v2-test --no-open
```

在同一最终 HEAD 的完整回归和真实 DSH 烟测通过前，不覆盖现用稳定 Profile，不合并主线，不创建 `v2.0.0` Tag 或 Release。

## 9. 回滚

- 代码回滚到 `bc6fe0347b7725ae3df79c9317d198cd815d41b2` 可恢复 Contract 接入前的 Phase 0 基线；
- 已发布 `v0.7.0` Tag 保持不变；
- 外部 Contract tarball 和 Lock 可独立移除，但不得修改其内容；
- 标准项目导出失败不会改变已有成果目录。

## 10. 下一执行入口

下一开发或验收 Agent 从以下顺序开始：

1. 检出 `feat/pre-v2.0.0`；
2. 读取 `docs/version-matrix.json` 与 `docs/VERSIONING.md`；
3. 读取本文件与 Contract Lock；
4. 执行第 7 章全部验证；
5. 仅在全部通过后进行独立 DSH Profile 烟测；
6. 根据烟测结果决定是否提出合并和发布申请。
