# Pre-design 版本权威

> 机器权威：[`docs/version-matrix.json`](version-matrix.json)  
> 架构基线支线：`architecture/pre-v2.0.0`  
> 当前开发支线：`feat/pre-v2.0.0`

## 1. 唯一产品版本

当前产品线只有一个主版本：

```text
pre-design 2.0.0
```

它同时表示本轮 Pre 产品、插件代码和 npm 包候选版本。当前 `package.json#version` 必须为 `2.0.0`。

| 项目 | 当前值 | 含义 |
|---|---:|---|
| Pre 产品版本 | `2.0.0` | 本仓库当前产品版本 |
| npm 包 | `@architectureworld/dsh-preplanning-agent@2.0.0` | 当前开发候选包 |
| 架构支线 | `architecture/pre-v2.0.0` | Pre 2.0.0 架构基线 |
| 开发支线 | `feat/pre-v2.0.0` | Pre 2.0.0 当前代码实现 |
| 发布状态 | 未合并、未发布 | 尚未创建 `v2.0.0` Tag 或 Release |
| 上一正式发布 | `v0.7.0` | 历史稳定版本，不是当前开发版本 |

## 2. 外部 Contract 独立版本

Pre 2.0.0 当前消费的外部项目格式 Contract 为：

```text
Presentation Standard Project Directory 0.1.0
@architectureworld/presentation-contracts@0.1.0
```

这只是 Pre 的一个**外部依赖坐标**，不是 Pre 的分支版本、产品版本或发布版本。

固定坐标：

| 字段 | 值 |
|---|---|
| 权威仓库 | `ArchitectureWorld/presentation-tools` |
| 固定提交 | `974668d308728386ea005c9e77d58ebff9372f0a` |
| Contract 版本 | `0.1.0` |
| Schema Set SHA-256 | `5bd329fcc8503ff7a48b3430e41b38dd264ae486cee7372a39cbbcccc2de2ebc` |
| Lock 文件 | `docs/contracts/presentation-standard-project-v0.1.0-lock.json` |

`presentation-tools` 自身未来使用 `0.1.1`、`0.2.0` 或其他产品版本，不会自动改变 Pre 2.0.0。只有外部 Contract 坐标发生变化并经过独立适配验收时，才更新 Lock。

## 3. 当前运行时接入状态

Pre 2.0.0 已经把外部 Contract 接入实际 DSH 用户流程：

```text
DSH UI 新建项目
→ 创建 Pre 项目
→ 生成并验证标准项目目录
→ 启动专业流程
```

用户和 Agent 可用入口：

```text
/preplan-presentation-sync
preplanning_sync_presentation_project
```

默认项目根目录：

```text
~/.dsh/presentation-projects
```

可通过：

```text
PRE_DESIGN_PRESENTATION_PROJECT_ROOT
```

指定与 Presentation 共用的绝对目录。

UI 统一版本标识：

```text
Pre 2.0.0 · Project Format 0.1.0
```

该标识同时展示 Pre 产品版本和外部项目格式版本，但不表示两者耦合升版。

## 4. 解耦规则

1. Pre 的分支、Tag、包版本只使用 Pre 自身版本。
2. 外部项目或 Contract 版本只出现在依赖锁、Adapter、测试和专项 Handoff 中。
3. 不使用 Presentation 产品版本给 Pre 分支命名。
4. 不因 Presentation 工具升级而自动提升 Pre 版本。
5. 不因 Pre 升级而改写 Presentation Contract 版本。
6. Pre 内部 Session、Gate、Revision、Proposal 和恢复记录不进入 Presentation 标准目录。
7. Presentation Contract 只负责项目格式；Pre 负责生成、写盘、验证和交付。
8. Presentation 读取、打开或监听标准项目目录；Pre 不修改 Presentation UI。

## 5. 当前有效分支

```text
architecture/pre-v2.0.0
feat/pre-v2.0.0
```

以下名称属于此前的过渡命名，已停止作为当前权威入口：

```text
architecture/presentation-project-alignment-v2.0.0
feature/presentation-phase0-foundation-v2.0.0
feat/presentation-standard-project-v0.1.0-integration
```

旧分支只保留用于审计和回退，不再被 README、版本矩阵、CI 或 Handoff 作为当前开发入口引用。

## 6. 版本权威顺序

发生冲突时按以下顺序判定：

1. `docs/version-matrix.json`；
2. 本文件；
3. `package.json`；
4. `docs/contracts/presentation-standard-project-v0.1.0-lock.json`，仅约束外部 Contract；
5. 当前架构规范、实现计划与 Handoff；
6. 历史 Tag、旧分支、旧验收文档和归档目录。

## 7. 发布边界

只有满足下列条件，才允许发布 Pre 2.0.0：

- `feat/pre-v2.0.0` 完整测试与构建通过；
- Presentation Contract 0.1.0 集成和运行时测试通过；
- DSH 目标机器真实 Profile 烟测通过；
- Handoff 和版本矩阵一致；
- 合并到正式发布分支；
- 明确授权创建 `v2.0.0` Tag、Release 和安装包。

在此之前，`2.0.0` 是准确的产品开发版本，但不是已发布版本。