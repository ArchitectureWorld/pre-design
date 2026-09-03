---
document_id: pre-design-presentation-standard-project-v0.1.0-integration-plan
document_version: 1.0.0
status: approved-for-execution
approved_at: 2026-09-03
base_branch: feature/presentation-phase0-foundation-v2.0.0
base_commit: bc6fe0347b7725ae3df79c9317d198cd815d41b2
implementation_branch: feat/presentation-standard-project-v0.1.0-integration
pre_design_product_version: 2.0.0
presentation_standard_version: 0.1.0
contract_repository: ArchitectureWorld/presentation-tools
contract_commit: 974668d308728386ea005c9e77d58ebff9372f0a
contract_root: contracts/presentation-standard-project
schema_set_sha256: 5bd329fcc8503ff7a48b3430e41b38dd264ae486cee7372a39cbbcccc2de2ebc
language: zh-CN
---

# Presentation Standard Project Directory 0.1.0 接入实施计划

> **执行要求：** 每一阶段先提交失败测试并确认 RED，再实现最小生产代码，最后执行专项与全量回归。不得修改或复制维护 Presentation Schema。

## 目标

让 `pre-design` 2.0.0 通过固定 Git 提交打包得到的 `@architectureworld/presentation-contracts@0.1.0`，将冻结的项目 Revision 转换、写入、验证并原子发布为 Presentation Standard Project Directory 0.1.0。

## 权威边界

- Schema、类型、Stable ID Factory、Fixture、示例和 Validator 只来自 `ArchitectureWorld/presentation-tools@974668d308728386ea005c9e77d58ebff9372f0a`。
- `feat/report-studio-v0.1.1-hardening` 不是 Schema 权威。
- `pre-design` 产品版本 `2.0.0` 与 Presentation 标准版本 `0.1.0` 独立管理。
- Session、Gate、Proposal、ProjectHead、Revision/CAS、同步与恢复状态只保存在 `pre-design` 内部。

## 实施架构

```text
FrozenProjectInput + 原始资料 + 正式素材
        ↓
contract-neutral projection
        ↓ stable identity ledger
Presentation 0.1.0 Adapter
        ↓
Canonical documents + managed files
        ↓ sibling staging directory
Contract full validator
        ↓ valid only
atomic rename to final directory
```

## Task 1 — 固定 Contract 获取、打包与完整性锁定

**新增**
- `docs/contracts/presentation-standard-project-v0.1.0-lock.json`
- `scripts/prepare-presentation-contract.mjs`
- `scripts/verify-presentation-contract-lock.mjs`
- `vendor/presentation-contracts/architectureworld-presentation-contracts-0.1.0.tgz`

**修改**
- `package.json`
- `pnpm-lock.yaml`
- CI workflow

**验收**
- 精确检出固定提交。
- 核对标准名、版本、包名、包版本和 Schema Set SHA-256。
- `npm pack` 产物作为精确 file dependency，lockfile 记录 integrity。
- Node.js 22 执行 Contract 包及消费者测试。

## Task 2 — Stable ID Ledger 与绑定持久化

**修改**
- `src/presentation/types.ts`
- `src/presentation/binding-domain.ts`
- `src/presentation/binding-repository.ts`

**新增**
- `src/presentation/identity-ledger.ts`

**验收**
- project、outline node、page、draft、content、script、page asset、source material、asset 等 ID 均由 Contract `createStableId()` 首次创建。
- 键由 pre-design 稳定业务身份构成，不使用标题、数组下标、页码或文件名。
- 重复导出、改名、移动和排序变化时保留已有 ID。

## Task 3 — 唯一 Contract Adapter 与 Canonical 映射

**新增**
- `src/presentation/standard-project-adapter.ts`
- `src/presentation/standard-project-types.ts`

**修改**
- `src/presentation/projector/*`
- `src/presentation/index.ts`

**验收**
- Project、Rules、Outline、PageManifest、DraftPageDocument、SourceMaterialManifest、AssetManifest 全部按 0.1.0 类型生成。
- 内容分别映射为 heading、text、list、metric_group、table、scriptBlocks 和 pageAssets。
- `sourceRefs` 保存 pre-design project/revision/object/evidence/snapshot 信息。
- 不出现 Layout、字体、颜色、坐标、模板、CSS 或 pre-design 私有治理字段。

## Task 4 — Source Materials 与正式 Assets

**新增**
- `src/presentation/source-material-writer.ts`
- `src/presentation/asset-writer.ts`

**验收**
- 原始输入文件按字节复制至 `source-materials/`。
- 正式采用、加工或生成文件写入 `assets/`；候选与缓存不进入 Manifest。
- 记录稳定 ID、POSIX relativePath、MIME、sizeBytes、SHA-256 和来源关系。
- 同内容复用记录，同名异内容安全分配路径。

## Task 5 — 原子 Writer、回滚和结构化错误

**新增**
- `src/presentation/standard-project-writer.ts`
- `src/presentation/standard-project-error.ts`

**验收**
- 同文件系统 sibling staging。
- 先写全部 Canonical JSON 与 managed files，再执行 Contract 全量验证。
- 仅验证通过后原子发布。
- 任一步失败清理 staging，不覆盖旧成果，不更新成功 Ledger。
- 已存在目标默认拒绝；显式 replace 时先备份且可恢复。

## Task 6 — 导出服务与 DSH 接入

**新增**
- `src/presentation/standard-project-service.ts`

**修改**
- `src/index.ts`
- `src/commands/register.ts`

**验收**
- Host 暴露标准项目服务。
- 新命令从当前绑定项目及 Revision 导出标准项目目录。
- 校验失败必须返回错误，不得返回成功。
- 既有 HTML/PPTX/PDF `preplan-export` 保持兼容。

## Task 7 — 最低 18 类自动化测试

**新增**
- `tests/presentation-standard-contract.spec.ts`
- `tests/presentation-stable-identity.spec.ts`
- `tests/presentation-standard-adapter.spec.ts`
- `tests/presentation-standard-writer.spec.ts`
- `tests/presentation-standard-project-e2e.spec.ts`

**必须覆盖**
1. 空项目合法。
2. 大纲、页面与草案合法。
3. 原始资料与正式素材合法。
4. Stable ID 格式与重复导出稳定性。
5. Outline/Page/Draft/Script/Asset 引用。
6. sourceRefs。
7. MIME、sizeBytes、SHA-256。
8. 路径、重复 ID、缺失 Manifest 拒绝。
9. 中途失败不发布。
10. 已存在成果不静默覆盖。
11. Contract 全量验证。
12. 私有治理字段隔离。
13. 最小 Fixture 和完整示例消费。
14. Windows/Linux 路径一致性。

## Task 8 — 版本、文档、Handoff 与最终验证

**修改**
- `README.md`
- `docs/VERSIONING.md`
- `docs/version-matrix.json`
- `HANDOFF.md`

**新增**
- `handoff/PRE_DESIGN_PRESENTATION_STANDARD_PROJECT_V0.1.0_IMPLEMENTATION.md`

**最终命令**

```bash
pnpm prepare:presentation-contract
pnpm verify:presentation-contract
pnpm test:presentation-standard
pnpm typecheck
pnpm test
pnpm test:built
git diff --check
```

最终集成验证必须输出：

```text
PRESENTATION_STANDARD_PROJECT_V0_1_0_PASS
```

## 完成边界

- 推送开发分支并保留完整 Actions 证据。
- 不创建 Tag 或 Release。
- 未经完整验证不得合并到 `main`、架构母线或 Phase 0 基线。
