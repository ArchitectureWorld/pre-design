# Pre-design 2.0.0 当前交接

> 机器版本权威：[`docs/version-matrix.json`](docs/version-matrix.json)  
> 人类可读规则：[`docs/VERSIONING.md`](docs/VERSIONING.md)  
> 架构支线：`architecture/pre-v2.0.0`  
> 开发支线：`feat/pre-v2.0.0`

## 1. 当前版本

| 项目 | 当前状态 |
|---|---|
| Pre 产品版本 | `2.0.0` |
| npm 包 | `@architectureworld/dsh-preplanning-agent@2.0.0` |
| 架构支线 | `architecture/pre-v2.0.0` |
| 开发支线 | `feat/pre-v2.0.0` |
| 发布状态 | 未合并、未发布 |
| 上一正式发布 | `v0.7.0`，仅作历史基线 |
| 外部 Presentation Contract | `0.1.0`，已精确锁定 |

Pre 2.0.0 是本仓库自身的产品和插件版本。Presentation `0.1.0` 只是外部项目格式 Contract 版本，两者没有同步升版关系。

## 2. 固定外部 Contract 坐标

```text
Standard: Presentation Standard Project Directory
Version: 0.1.0
Repository: ArchitectureWorld/presentation-tools
Commit: 974668d308728386ea005c9e77d58ebff9372f0a
Package: @architectureworld/presentation-contracts@0.1.0
Schema Set SHA-256: 5bd329fcc8503ff7a48b3430e41b38dd264ae486cee7372a39cbbcccc2de2ebc
Lock: docs/contracts/presentation-standard-project-v0.1.0-lock.json
```

`presentation-tools` 的应用版本可以独立发展到 `0.1.1`、`0.2.0` 或其他版本。除非其 Contract 本身发布新坐标并由 Pre 明确升级适配，否则 Pre 2.0.0 不受影响。

## 3. 当前架构

```text
DSH Harness
├─ Pre-design 2.0.0
│  ├─ 前期策划 Skill
│  ├─ 8 章、57 项专业工作流
│  ├─ Tools / Commands
│  ├─ State / Evidence / Gate / Revision
│  ├─ 原始资料与正式素材管理
│  └─ 标准项目目录生成与验证
│
└─ presentation-tools
   ├─ 独立产品和版本线
   ├─ 标准项目文件可视化
   ├─ 人或 Agent 交互编辑
   ├─ 排版
   └─ 导出
```

双方通过标准项目文件解耦，不共享产品版本，不合并运行治理状态。

## 4. Pre 2.0.0 已实现范围

- 固定 Contract 获取、核验、打包和锁定；
- 唯一 Presentation 标准项目 Adapter；
- Stable ID 映射和持久化；
- 项目、Rules、Outline、Page、Draft 映射；
- `heading`、`text`、`list`、`metric_group`、`table`；
- 独立讲解稿和页面素材引用；
- 原始资料与正式素材分离；
- `sourceRefs` 专业来源追溯；
- MIME、`sizeBytes` 和 SHA-256；
- sibling staging、完整验证、原子发布与失败回滚；
- 外部修改保护；
- Presentation Contract Fixture 和完整示例消费；
- 既有 HTML、PPTX、PDF 输出兼容。

专业实现交接：

[`handoff/PRE_DESIGN_PRESENTATION_STANDARD_PROJECT_V0.1.0_IMPLEMENTATION.md`](handoff/PRE_DESIGN_PRESENTATION_STANDARD_PROJECT_V0.1.0_IMPLEMENTATION.md)

## 5. 当前禁止混用

- 不使用 Presentation 版本命名 Pre 分支；
- 不把 Pre 2.0.0 写成 Presentation 标准版本；
- 不把 Presentation 0.1.0 写成 Pre 产品版本；
- 不因 `presentation-tools` 升到 0.1.1 而自动修改 Pre；
- 不把 Pre 的 Session、Gate、Proposal、Revision/CAS 或恢复记录写进标准项目目录；
- 不在 Pre 仓库维护第二套 Presentation Schema。

## 6. 过渡分支

以下旧名称只保留用于审计和回退，不再作为当前开发入口：

```text
architecture/presentation-project-alignment-v2.0.0
feature/presentation-phase0-foundation-v2.0.0
feat/presentation-standard-project-v0.1.0-integration
```

当前所有后续开发、CI 和交接均指向：

```text
feat/pre-v2.0.0
```

## 7. 完整验证

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

只有同一最终 HEAD 完整通过上述验证并完成独立 DSH Profile 烟测，才可申请合并和发布 Pre 2.0.0。
