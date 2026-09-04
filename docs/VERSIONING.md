# Pre-design 版本权威

本文件解释 `ArchitectureWorld/pre-design` 当前有效版本。机器可执行权威为 [`version-matrix.json`](version-matrix.json)。

## 1. 当前版本矩阵

| 对象 | 当前值 | 含义 |
|---|---:|---|
| Pre 产品版本 | `2.0.0` | 本仓库产品版本 |
| Pre DSH 插件版本 | `2.0.0` | 当前插件版本 |
| Pre npm 包版本 | `@architectureworld/dsh-preplanning-agent@2.0.0` | 当前构建包版本 |
| Presentation 标准版本 | `0.1.0` | 外部、解耦的数据格式 Contract |
| DSH 兼容基线 | `0.1.1-rc.2` | 当前 Host 与 Browser API 基线 |
| 上一正式发布 | `v0.7.0` | 历史发布，不代表当前开发候选 |

固定原则：

- `2.0.0` 只属于 Pre 产品、插件和包；
- `0.1.0` 只属于 `Presentation Standard Project Directory`；
- Presentation-tools 的产品版本独立演进，不自动推动 Pre 升版；
- 当前支线未合并、未打 `v2.0.0` Tag、未创建正式 Release。

## 2. 当前有效支线

```text
architecture/pre-v2.0.0
feat/pre-v2.0.0
```

后续开发继续使用 `feat/pre-v2.0.0`，不得因某个外部 Contract 再创建以 Presentation 版本命名的 Pre 支线。

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

## 4. 当前项目与目录模型

Pre 2.0.0 的默认项目身份模型固定为：

```text
一个 DSH Workspace
= 一个项目总文件夹
= 一个 Pre 项目
= 一套 Presentation Standard Project Directory 0.1.0

一个 Workspace
可以包含多个 DSH Session
这些 Session 共同使用同一个 Pre 项目
```

当前 Session 的 `SessionHeader.cwd` 是项目总文件夹的权威路径。该目录直接包含：

```text
project.json
rules.json
outline.json
pages/
source-materials/
assets/
layouts/
```

Pre 只管理以下标准路径：

```text
project.json
rules.json
outline.json
pages/
source-materials/
assets/
```

Pre 不替换：

```text
layouts/
工作区中的其他用户文件和目录
```

`~/.dsh/presentation-projects` 与 `PRE_DESIGN_PRESENTATION_PROJECT_ROOT` 只保留为没有 DSH Workspace 的显式兼容回退，不再是正常 UI 使用路径。

## 5. Workspace 探测与操作命令

UI 在创建或继续项目前先执行：

```text
/preplan-presentation-sync --probe
```

用于识别当前 Workspace 是否已经绑定 Pre 项目，并让同一 Workspace 的多个 Session 共用该项目。

标准同步与打开目录命令：

```text
/preplan-presentation-sync
/preplan-presentation-sync --force
/preplan-open-project-folder
```

## 6. UI 与刷新恢复

新建面板按 Workspace 路径保存输入草稿：

```text
pre-design:v2:workspace-draft:<workspace-key>
```

保存项目描述、项目名称、确认方式、报告深度和概念图预算；同一 Workspace 刷新后恢复，不同 Workspace 相互隔离，成功创建后清除。

UI 与命令均提供：

```text
/preplan-open-project-folder
```

用于直接打开当前 DSH Workspace 项目总文件夹。

UI 版本标识保持：

```text
Pre 2.0.0 · Project Format 0.1.0
```

## 7. 当前验证坐标

Workspace 根目录实现代码已在以下坐标完成验证：

```text
Code HEAD: 700a1675ac5801b4ed824b31de48184be2cc1c6c
Workflow: Pre 2.0.0 Integration
Run ID: 33835245301
Conclusion: success
```

该运行同时通过定向门禁、TypeScript、全仓回归、构建产物运行与 Git diff hygiene。

## 8. 版本禁止事项

不得：

- 将 Presentation `0.1.0` 写成 Pre 产品版本；
- 将 Pre `2.0.0` 写成 Presentation 标准版本；
- 恢复以 Presentation 名称定义 Pre 当前支线；
- 把历史 `v0.7.0` 当成当前插件版本；
- 把 `contracts/v0.6`、`contracts/v0.7` 改名为 `v2.0.0`；
- 把 Workspace 路径、Session 状态、Gate、Revision 或恢复记录写进 Presentation Canonical 文件；
- 在未完成测试、真实部署验收和合并审批前创建正式 `v2.0.0` Release。
