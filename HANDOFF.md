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
| 标准目录运行时接入 | 已实现并通过真实 Host 验证 |
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

`presentation-tools` 的应用版本可以独立发展。除非其 Contract 本身发布新坐标并由 Pre 明确升级适配，否则 Pre 2.0.0 不受影响。

## 3. 当前架构

```text
DSH Harness
├─ Pre-design 2.0.0
│  ├─ 前期策划 Skill
│  ├─ 8 章、57 项专业工作流
│  ├─ Tools / Commands
│  ├─ State / Evidence / Gate / Revision
│  ├─ 原始资料与正式素材管理
│  └─ 标准项目目录生成、验证和交付
│
└─ presentation-tools
   ├─ 独立产品和版本线
   ├─ 读取标准项目目录
   ├─ 可视化与交互编辑
   ├─ 排版
   └─ 导出
```

双方通过标准项目文件解耦，不共享产品版本，不合并运行治理状态。

## 4. 已达到的使用级别

### 4.1 新项目

从 DSH UI 点击“前期策划”并创建项目时，客户端流程现在自动执行：

```text
/preplan-new <项目名称>
/preplan-presentation-sync
/preplan-mode <manual|automatic> <图像预算> <报告深度>
/preplan-run
```

只有标准目录已经完成 Contract 校验并原子发布，UI 才报告创建成功。

### 4.2 已有项目

```text
/preplan-open <preDesignProjectId>
/preplan-presentation-sync
```

默认保护外部修改。用户明确确认破坏性覆盖后才使用：

```text
/preplan-presentation-sync --force
```

### 4.3 Agent 调用

用户可以直接说“把当前项目同步到 Presentation”。系统提示已要求 Agent 调用：

```text
preplanning_sync_presentation_project
```

工具返回：

- 标准目录绝对路径；
- Presentation Project ID；
- Pre Revision；
- Contract 版本；
- `PRESENTATION_STANDARD_PROJECT_V0_1_0_PASS`。

### 4.4 标准项目位置

默认根目录：

```text
~/.dsh/presentation-projects
```

可通过以下环境变量指定与 Presentation 共用的绝对目录：

```text
PRE_DESIGN_PRESENTATION_PROJECT_ROOT
```

Presentation 必须读取、打开或监听同一个根目录。Pre 不修改 Presentation 的 UI 或运行实现。

### 4.5 UI 版本识别

新建面板和项目状态卡最底部均显示：

```text
Pre 2.0.0 · Project Format 0.1.0
```

## 5. 已实现范围

- 固定 Contract 获取、核验、打包和锁定；
- 唯一 Presentation 标准项目 Adapter；
- Stable ID 映射和持久化；
- 项目、Rules、Outline、Page、Draft 映射；
- `heading`、`text`、`list`、`metric_group`、`table`；
- 独立讲解稿和页面素材引用；
- 原始资料与正式素材分离；
- 已采用视觉素材进入 Asset Manifest；
- `sourceRefs` 专业来源追溯；
- MIME、`sizeBytes` 和 SHA-256；
- sibling staging、完整验证、原子发布与失败回滚；
- 外部修改保护；
- DSH 命令、Agent Tool 与 UI 创建流程接线；
- UI 版本标识；
- 既有 HTML、PPTX、PDF 输出兼容。

专业实现交接：

[`handoff/PRE_DESIGN_PRESENTATION_STANDARD_PROJECT_V0.1.0_IMPLEMENTATION.md`](handoff/PRE_DESIGN_PRESENTATION_STANDARD_PROJECT_V0.1.0_IMPLEMENTATION.md)

## 6. 当前禁止混用

- 不使用 Presentation 版本命名 Pre 分支；
- 不把 Pre 2.0.0 写成 Presentation 标准版本；
- 不把 Presentation 0.1.0 写成 Pre 产品版本；
- 不因 `presentation-tools` 升级而自动修改 Pre；
- 不把 Pre 的 Session、Gate、Proposal、Revision/CAS 或恢复记录写进标准项目目录；
- 不在 Pre 仓库维护第二套 Presentation Schema；
- 不默认覆盖 Presentation 或其他工具已经修改的标准文件。

## 7. 当前有效入口

```text
architecture/pre-v2.0.0
feat/pre-v2.0.0
```

旧名称只保留用于审计和回退，不再作为当前开发入口。

## 8. 完整验证

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

运行时验证还必须覆盖：

```text
真实 DSH Host
→ /preplan-new
→ /preplan-presentation-sync
→ 磁盘生成标准目录
→ Contract 全量验证通过
→ project.json 可读取
```

成功标记：

```text
PRE_DESIGN_V2_0_0_VERSION_CONSISTENCY_PASS
PRESENTATION_STANDARD_PROJECT_V0_1_0_PASS
```

当前自动化测试已覆盖上述运行链路。覆盖现用稳定 Profile、合并主线或发布前，仍需在目标机器完成一次真实安装烟测。