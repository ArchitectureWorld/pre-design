# Pre-design 当前交接

> 版本机器权威：[`docs/version-matrix.json`](docs/version-matrix.json)  
> 版本规则：[`docs/VERSIONING.md`](docs/VERSIONING.md)  
> 对齐基线支线：`architecture/presentation-project-alignment-v2.0.0`  
> 当前实施支线：`feature/presentation-phase0-foundation-v2.0.0`

## 1. 当前版本状态

| 命名空间 | 当前状态 |
|---|---|
| Alignment baseline | `v2.0.0` |
| Executable npm package | `0.7.0` |
| Published historical tag | `v0.7.0` |
| Business contract line | `contracts/v0.6` |
| Governance contract line | `contracts/v0.7` |
| Presentation Contract version | 尚未锁定 |
| Presentation package / Hash | 尚未锁定 |
| Presentation Contract Lock | `pending` |
| Phase 0 foundation | `implemented` |
| Contract-dependent integration | `blocked-by-contract-lock` |
| Package version bump | 未授权 |
| Historical report candidate | `v0.8` |
| Historical archive label | `FINAL_v2.0` |

`v2.0.0` 是对齐基线，不是插件 `2.0.0` Release。当前插件包和安装包仍使用 `0.7.0`。

## 2. 当前权威文档

1. [`docs/version-matrix.json`](docs/version-matrix.json)：机器版本权威。
2. [`docs/VERSIONING.md`](docs/VERSIONING.md)：版本、分支和转换规则。
3. [`docs/superpowers/specs/2026-09-02-pre-design-presentation-project-alignment-v2.0.0-design.md`](docs/superpowers/specs/2026-09-02-pre-design-presentation-project-alignment-v2.0.0-design.md)：总体架构。
4. [`docs/superpowers/specs/2026-09-02-pre-design-presentation-content-baseline-v2.0.0.md`](docs/superpowers/specs/2026-09-02-pre-design-presentation-content-baseline-v2.0.0.md)：大纲、草案和素材投影规则。
5. [`docs/superpowers/plans/2026-09-02-pre-design-presentation-project-alignment-v2.0.0.md`](docs/superpowers/plans/2026-09-02-pre-design-presentation-project-alignment-v2.0.0.md)：Contract 锁定后的正式实施计划。
6. [`docs/implementation/presentation-phase0-foundation.md`](docs/implementation/presentation-phase0-foundation.md)：当前 Phase 0 代码范围和限制。

## 3. 当前架构

- `pre-design` 是独立可执行 DSH 插件，内置前期策划 Skill、57 项工作流、Tools、Commands、状态、Gate、Revision 和资料处理能力。
- `presentation-tools` 是独立的可视化交互、排版和导出工具。
- DSH Harness 是唯一 Agent Runtime。
- 标准 Presentation 项目文件是插件、人和 DSH Agent 共同操作的中立载体。
- `pre-design` 负责创建和填写标准项目目录，但不生成 Layout。
- 现有 HTML/PPTX/PDF 路径在第一阶段继续保留。

## 4. Phase 0 已实现

当前实施支线已经建立 `src/presentation/` Contract 无关基础：

```text
contract-port.ts
  未锁定 Contract 时失败关闭，不猜包名、版本或字段

types.ts + binding-domain.ts + binding-repository.ts
  双项目身份、目录状态、独立持久化和输出 Hash 台账

canonical-json.ts + path-policy.ts
  稳定语义 Hash、Unicode NFC、可迁移相对路径和安全 Slug

filesystem.ts
  同父目录 staging、原子写入、校验复制、SHA-256 和安全清理

projector/
  8 类默认汇报骨架、项目自适应、单页单结论、五类内容块、讲解稿和素材引用

update-plan.ts
  新增、更新、未变、保留和 review_required 的确定性判定

material-plan.ts
  原始资料/正式素材分类、MIME 与扩展名校验、Hash 去重和同名安全命名
```

专项验证已覆盖 6 个测试文件、36 项测试，并通过全仓 TypeScript 类型检查。

## 5. 当前明确未实现

Contract Lock 通过前，不得宣称已完成以下能力：

- 安装或依赖真实 Presentation Contract 包；
- 写死 Presentation `standardVersion`；
- 生成真实 Canonical `project.json`、`outline.json`、Draft 或 Manifest；
- 使用真实 ID Factory；
- 调用真实项目 Validator；
- 将标准目录接入 `/preplan-new`；
- 从 57 项真实 Repository 构建生产 Projection；
- 将资料和素材正式写入 Manifest；
- 完成标准项目目录 E2E；
- 提升包版本、创建 Tag 或 Release。

## 6. 下一阻断门

必须取得并审查 Presentation 正式反馈，形成唯一 Contract Lock，至少包含：

```text
standardName
standardVersion
packageName
packageVersion
schemaSetSha256
typesEntry
idFactoryEntry
documentValidatorEntry
projectValidatorEntry
minimalFixturePath
fullExamplePath
validationCommand
sourceCommitSHA
```

在锁定前：

- 不选择候选 Presentation 分支作为依赖；
- 不猜测包坐标、Schema 字段或 ID 格式；
- 不复制 Schema 到本仓库；
- 不把 Phase 0 中间模型冒充 Canonical Project；
- 不修改 `package.json#version`；
- 不创建 Tag 或 Release。

## 7. 历史资料

原长篇交接已经替换为非权威索引：[`HANDOFF_HISTORY.md`](HANDOFF_HISTORY.md)。

`docs/acceptance.md`、`docs/acceptance-v0.8.md`、`handoff/FINAL_v2.0/` 及旧 evidence 保留历史价值，但不覆盖当前版本矩阵、Phase 0 状态或 Contract Lock 状态。

## 8. 当前验证命令

```bash
pnpm install --frozen-lockfile
pnpm verify:alignment-versions
pnpm exec vitest run tests/presentation-*.spec.ts --maxWorkers=1
pnpm typecheck
pnpm test
pnpm test:built
git diff --check
```

版本检查成功标记：

```text
PRE_DESIGN_ALIGNMENT_VERSION_CONSISTENCY_PASS
```
