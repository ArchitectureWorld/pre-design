# Pre-design 版本权威

本文件解释 `ArchitectureWorld/pre-design` 当前有效版本。机器可执行权威为 [`version-matrix.json`](version-matrix.json)。

## 1. 当前版本矩阵

| 对象 | 当前值 | 含义 |
|---|---:|---|
| Pre 产品版本 | `2.0.1` | Source-Traceable Research 独立开发线 |
| Pre DSH 插件版本 | `2.0.1` | 当前 2.0.1 分支插件版本 |
| Pre npm 包版本 | `@architectureworld/dsh-preplanning-agent@2.0.1` | 当前构建包版本 |
| Presentation 标准版本 | `0.1.0` | 外部、解耦的数据格式 Contract |
| DSH 兼容基线 | `0.1.1-rc.2` | 当前 Host 与 Browser API 基线 |
| V2.0.0 正式基线 | `main@49140423e14f3d3abcf3815c9bdf68e8e5e26730` | V2.0.0 已进入 main，2.0.1 从该坐标继续演进 |
| 上一正式发布 | `v0.7.0` | 历史发布，不代表当前开发候选 |

固定原则：

- `2.0.1` 只属于 Pre 产品、插件和包；
- `0.1.0` 只属于 `Presentation Standard Project Directory`；
- V2.0.0 已合并进 `main`，正式基线固定为 `main@49140423e14f3d3abcf3815c9bdf68e8e5e26730`；
- `feat/pre-v2.0.1` 专门承载可查数据源、Evidence、AnalysisTrace、ResearchStep 与 Research Provider；
- 不再把 `feat/pre-v2.0.0` 作为 2.0.1 的活动基线；
- Presentation-tools 的产品版本独立演进，不自动推动 Pre 升版；
- 当前 2.0.1 支线未合并、未打 `v2.0.1` Tag、未创建正式 Release。

## 2. 当前有效支线

```text
main                    # Pre V2.0.0 正式基线
feat/pre-v2.0.1         # Source-Traceable Research 独立开发线
```

历史 `architecture/pre-v2.0.0` 和 `feat/pre-v2.0.0` 可保留用于追溯，但不再作为 2.0.1 的当前基线坐标。

## 3. 外部 Contract 固定坐标

```text
Standard: Presentation Standard Project Directory
Version: 0.1.0
Repository: ArchitectureWorld/presentation-tools
Commit: 974668d308728386ea005c9e77d58ebff9372f0a
Package: @architectureworld/presentation-contracts@0.1.0
Schema Set SHA-256: 5bd329fcc8503ff7a48b3430e41b38dd264ae486cee7372a39cbbcccc2de2ebc
```

它是 Pre 当前消费的外部格式依赖，不是 Pre 的产品版本，也不参与 Pre 的分支命名。

## 4. 2.0.1 新增权威

Source-Traceable Research 设计：

```text
docs/superpowers/specs/2026-09-12-pre-v2.0.1-source-traceable-research-design.md
```

实施计划：

```text
docs/superpowers/plans/2026-09-12-pre-v2.0.1-source-traceable-research.md
```

Research Runtime 资源统一位于：

```text
research/v2.0.1/
```

## 5. Workspace 与 Presentation 基线

2.0.1 继承 `main` 中 V2.0.0 已验证的 Workspace 模型：

```text
一个 DSH Workspace
= 一个项目总文件夹
= 一个 Pre 项目
= 一套 Presentation Standard Project Directory 0.1.0
```

当前 Session 的 `SessionHeader.cwd` 仍是项目总文件夹权威路径。Pre 继续只管理 `project.json / rules.json / outline.json / pages / source-materials / assets`，并保留 `layouts/` 与全部无关用户文件。

## 6. 2.0.1 数据可信原则

- 项目正式资料、政府/法定机构、官方标准和权威专业数据优先；
- LLM inference / assumption 不能作为独立事实依据；
- 关键事实必须保留真实 Source URI、时间、定位、原始值、标准化值和 Evidence ID；
- 可确定性计算必须交由确定性函数或专业工具完成；
- 结论必须通过 AnalysisTrace 反查输入证据和方法；
- Workflow Research 必须显式保存 `Workflow → ResearchStep → DataPoint → DataSource → Evidence → AnalysisTrace → OutputClaim`；
- 无完整追溯链的关键结论不能获得完全可信的自动通过状态。

## 7. UI 版本标识

2.0.1 分支显示：

```text
Pre 2.0.1 · Project Format 0.1.0
```

`main` 的 V2.0.0 基线保持 `Pre 2.0.0 · Project Format 0.1.0`。

## 8. 版本禁止事项

不得：

- 将 `feat/pre-v2.0.0` 继续写成 2.0.1 活动基线；
- 在 V2.0.1 Runtime/UI/打包元数据中残留 V2.0.0 身份；
- 将 Presentation `0.1.0` 写成 Pre 产品版本；
- 将 Pre `2.0.1` 写成 Presentation 标准版本；
- 把历史 `v0.7.0` 当成当前插件版本；
- 把 `contracts/v0.6`、`contracts/v0.7` 改名为 `v2.0.1`；
- 把 Workspace 路径、Session 状态、Gate、Revision 或恢复记录写进 Presentation Canonical 文件；
- 在未完成测试、真实部署验收和合并审批前创建正式 `v2.0.1` Release。
