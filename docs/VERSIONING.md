# Version Authority

> 机器权威：[`docs/version-matrix.json`](version-matrix.json)  
> 人类可读解释：本文件  
> 对齐基线支线：`architecture/presentation-project-alignment-v2.0.0`  
> 当前实施支线：`feature/presentation-phase0-foundation-v2.0.0`

## 1. 唯一版本矩阵

| 命名空间 | 当前值 | 准确含义 |
|---|---:|---|
| 对齐基线 | `v2.0.0` | 本轮架构、内容投影和实施计划的基线版本 |
| 对齐基线支线 | `architecture/presentation-project-alignment-v2.0.0` | 保存已冻结设计与计划 |
| Phase 0 实施支线 | `feature/presentation-phase0-foundation-v2.0.0` | 保存 Contract 无关的初步代码实现 |
| 可执行 npm 包 | `0.7.0` | `package.json#version` 的真实值；本轮未提升 |
| 已发布 Tag / Release | `v0.7.0` | 既有历史发布基线；不可移动 |
| 业务 Contract | `contracts/v0.6` | 既有 57 项专业业务合同线 |
| 治理 Contract | `contracts/v0.7` | 既有治理合同线 |
| Presentation Contract 版本 | **尚未锁定** | 在正式反馈通过前不得写入具体版本 |
| Presentation 包名、版本、Hash | **尚未锁定** | 必须由一次正式 Contract Lock 原子写入 |
| Phase 0 foundation | `implemented` | 已实现 Contract Port、绑定、文件系统、投影、外部修改保护和资料规划基础 |
| Contract 依赖集成 | `blocked-by-contract-lock` | 尚未接入真实 Schema、ID Factory、Fixture、Validator 或 DSH 命令 |
| 历史客户报告候选线 | `v0.8` | 未发布历史候选与证据标签；不是当前包版本 |
| 历史交接目录标签 | `FINAL_v2.0` | 历史归档目录名；不是 SemVer 权威 |

## 2. 不可混用的版本轴

1. `v2.0.0` 只表示对齐基线，不表示 npm 包、DSH 插件、Git Tag 或 GitHub Release。
2. `0.7.0` 是当前可执行插件包版本。
3. `v0.7.0` 是现有历史发布标签。
4. `contracts/v0.6` 和 `contracts/v0.7` 是既有领域 Contract 目录，不因对齐基线自动升级。
5. Presentation Contract 的 `standardVersion`、包名、包版本和 Schema Set Hash 在正式锁定前均为 `null`。
6. `v0.8` 只属于历史客户报告候选线。
7. `FINAL_v2.0` 只属于历史归档目录名。

## 3. 命名规则

1. 机器字段中的 SemVer 使用 `2.0.0`、`0.7.0`，不加前缀。
2. 人类标签、分支名、文件名和 Git Tag 使用小写 `v`，例如 `v2.0.0`。
3. 当前规范性文件禁止使用大写 `V2.0.0`。
4. 不得将对齐基线描述为插件或包版本。
5. 不得在 Contract Lock 前写死 Presentation 的 `standardVersion`、包名、包版本、分支或 Hash。
6. 预留锁文件路径为 `docs/contracts/presentation-standard-project-v1-lock.json`。该文件名是对齐基线中的内部占位路径，不构成对最终 Presentation 标准版本或包版本的声明。
7. Phase 0 可以实现 Contract 无关基础，但不得生成或声称兼容某个未锁定的 Canonical Schema。

## 4. 当前实施边界

### 4.1 Phase 0 已实现

`src/presentation/` 当前包含：

- Contract Port 与未锁定时的失败关闭；
- 双项目绑定类型和独立 Storage Domain；
- Canonical JSON 与 SHA-256；
- 可移植相对路径和项目 Slug；
- 同父目录 staging、原子写入、校验复制和清理；
- 8 类默认叙事骨架与五类语义内容块的纯投影；
- 外部修改检测和输出台账推进规则；
- 原始资料与正式素材的分类、去重和安全命名计划。

### 4.2 仍被 Contract Lock 阻断

- 正式 Presentation 包依赖；
- 真实 `standardVersion` 和 Schema Set Hash；
- 真实 ID Factory；
- Canonical JSON 字段适配；
- 最小 Fixture 和完整 Validator；
- `/preplan-new` 的标准目录接入；
- Manifest 写入；
- 正式项目目录 E2E；
- 包升版、Tag 和 Release。

## 5. 权威顺序

发生版本、状态或命名冲突时，按以下顺序判定：

1. `docs/version-matrix.json`；
2. 本文件；
3. `package.json`，仅用于可执行包版本；
4. 对齐规范、内容基线和实施计划；
5. `docs/implementation/presentation-phase0-foundation.md`，仅用于当前实施范围与证据；
6. `README.md`；
7. `HANDOFF.md`；
8. `HANDOFF_HISTORY.md`、`docs/acceptance*.md`、`contracts/v0.6`、`contracts/v0.7` 和旧 Release Notes，仅作历史记录。

## 6. Contract Lock 转换

当 Presentation 正式反馈通过时，一个原子提交必须：

1. 创建 `docs/contracts/presentation-standard-project-v1-lock.json`；
2. 将 `presentationStandard.contractLockStatus` 改为 `locked`；
3. 写入真实 `standardVersion`、`packageName`、`packageVersion` 和 `schemaSetSha256`；
4. 将 `implementation.contractDependentIntegration.status` 改为 `ready-for-implementation`；
5. 更新适配计划与当前交接，但保持对齐基线为 `v2.0.0`；
6. 运行 `pnpm verify:alignment-versions`。

Contract Lock 不改变：

- `package.json#version`；
- 已发布 `v0.7.0` Tag；
- `contracts/v0.6`；
- `contracts/v0.7`；
- 对齐基线 `v2.0.0`；
- 已完成的 Phase 0 Contract 无关代码。

## 7. 后续版本变更

- 新架构基线需要新的 SemVer、分支和文件标签。
- 可执行包发布需要独立授权、完整验证、包版本变更和 Release 流程。
- Presentation Contract 升级只更新 Contract Lock 与兼容适配，除非同时改变总体架构。
- 历史 Tag、Release 和版本化 Contract 目录保持不可变。
