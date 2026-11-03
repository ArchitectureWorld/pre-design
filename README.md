> **v2.1.0 development / milestone3:** `/preplan-research-peers --input=research/peers.request.json` captures explicitly supplied workspace sources and produces auditable peer/product/audience tables. [Handoff](docs/pre-v2.1.0-milestone3-handoff.md). Not autonomous all62 research or a production release.

> **v2.1.0 milestone 2:** full approved62 research dictionary + source-bound regional OD/SVG/table/audit bundles. See [usage and boundaries](docs/pre-v2.1.0-milestone2-handoff.md). This is not full62 automatic research completion.

# Pre-design 2.1.0 — 开发中

基于已经合并的 `main@a1c1ad12b469d086037ec66e4bd89c7c0e4ac422`（Pre 2.0.2），在 `v2.1.0` 开发支线实现已确认的研究与成果统一规格 v1.2。

| 当前对象 | 状态 |
|---|---|
| Pre 产品 / 插件 / 包版本 | `2.1.0`，开发阶段，未合并、未发布 |
| 新研究架构 | 8章62项，目录、条件依赖、类型化输入门槛和候选成果计划 |
| DSH 新入口 | `/preplan-research-plan`，只读，无取数或模型调用 |
| 现有执行器 | 旧57项继续保留；尚未切换为62项自动执行 |
| DSH / Node / pnpm | `0.1.5-rc.1` / `>=24.11.0` / `10.15.1` |
| Presentation 项目格式 | 标准 `0.1.0`，依赖包 `0.1.1`，保持不变 |

[当前交接](docs/pre-v2.1.0-handoff.md) · [版本矩阵](docs/version-matrix.json) · [开发计划](docs/superpowers/plans/2026-09-24-pre-v2.1.0-foundation.md) · [目录与来源锁](research/planning-v1.2/README.md)

```text
/preplan-research-plan
/preplan-research-plan --industryPlanning=false --existingBuildings=false --externalPartners=false --marketing=false
/preplan-research-plan --item=2.03 --json
```

不填的条件保持待判定，不能被当作不适用。计划有依赖层级不代表研究已经执行；候选图件没有实际文件或输出hash。该入口不修改任何已有项目。

以下Workspace、UI与导出能力继承Pre 2.0.2；历史验收记录见 [2.0.2交接](docs/pre-v2.0.2-ui-handoff.md)。新62项的专业字段编译、执行调度、同源成果发布和双制式版式接入尚在后续开发范围内。

## 产品定位

- Pre-design 是独立、可执行的 DSH 插件。
- 插件内部包含前期策划 Skill、8 章 57 项专业工作流、Tools、Commands、状态、Gate、Revision、资料处理和成果生成能力。
- DSH Harness 负责 Agent、模型、Workspace、Session 和工具执行。
- `presentation-tools` 保持可视化交互、展示和导出工具属性；排版决策属于 Pre / DSH Skill。
- 两个项目通过 `Presentation Standard Project Directory 0.1.0` 解耦，产品版本彼此独立。

## 默认使用模型

```text
一个 DSH Workspace
= 一个项目总文件夹
= 一个 Pre 项目
= 一套 Presentation 标准项目文件

一个 Workspace
可以包含多个 DSH Session
这些 Session 共同使用同一个 Pre 项目
```

Workspace 面板使用 `WorkspaceView.path` 作为项目总文件夹；已有 Session 的 Host 兼容路径为 `SessionHeader.cwd`。Pre 不再默认把正常 UI 项目写到用户级公共输出目录。

例如用户在 DSH 中选择：

```text
D:\Projects\武汉站综合枢纽
```

该目录本身就是标准项目根目录：

```text
D:\Projects\武汉站综合枢纽\
├─ 原始资料\      # 用户拥有的输入目录
├─ project.json
├─ rules.json
├─ outline.json
├─ pages\
├─ source-materials\
├─ assets\
├─ layouts\
└─ 用户自己的其他项目资料
```

Pre 只管理：

```text
project.json
rules.json
outline.json
pages/
source-materials/
assets/
```

以下内容不会被 Pre 的标准项目同步替换：

```text
原始资料/
layouts/
工作区中的其他用户文件和目录
```

## UI 创建和继续流程

打开“前期策划”面板后，UI 读取当前 DSH Workspace 和会话关联状态。已有项目只展示关联状态与执行记录，重新打开面板或切换主题不会重复启动。

没有关联项目时，点击“开始前期策划”后通过 DSH 正式命令桥探测、创建或恢复当前 Workspace 项目，同步标准目录及用户“原始资料”，再按现有 Automatic-first 策略推进。资料为空时显示“等待原始资料”和重新检测入口，不启动资料分析。

UI 不要求项目名、项目描述、报告深度或运行模式输入。模型目录与配置仍来自 DSH，ComfyUI 配套 LLM、备用模型顺序和服务端 revision 校验保留。

## UI 刷新与外观

首次打开默认 C；顶部 A/B/C/D 可直接对比浅/深、克制/强液态玻璃。C 与 A、D 与 B 的面板几何和光学参数相同，只有配色不同。外观按钮可调节折射、磨砂、高光和悬浮。

仅外观偏好尝试保存在本浏览器；项目身份、模型配置和执行状态不以浏览器缓存为权威。主题切换不清空未保存的模型草稿；保存操作成功后才确认配置已保存。读取失败可重试，项目状态尚未确认时禁止重复启动。

桌面宽度达到 960px 时，主页加宽并将四张子 Agent 配置卡片排成两列；小窗口回到单列。1645×918 的本地 Web profile 常态内容已实测一屏可见。

版本标识：

```text
Pre 2.1.0 · Project Format 0.1.0
```

## 打开项目文件夹

新建面板和项目状态卡提供“打开项目文件夹”。它直接打开当前 DSH Workspace。

命令入口：

```text
/preplan-open-project-folder
```

在 Windows 上调用资源管理器，在 macOS 上调用 Finder，在 Linux 上调用系统默认文件管理器。即使 Pre 项目尚未完成初始化，只要当前 Session 已属于 Workspace，也可以打开该文件夹。

## 与 Presentation 交接

同步命令：

```text
/preplan-presentation-sync
```

成功结果包含当前 Workspace 根目录、Presentation Project ID、Pre Revision 和：

```text
PRESENTATION_STANDARD_PROJECT_V0_1_0_PASS
```

Presentation 应直接打开或监听同一个 DSH Workspace 根目录。

默认拒绝覆盖 Pre 上次输出后被外部修改的标准文件。只有用户明确决定覆盖时才使用：

```text
/preplan-presentation-sync --force
```

也可以直接对 DSH Agent 说“把当前项目同步到 Presentation”，Agent 会调用：

```text
preplanning_sync_presentation_project
```

## 同步开发看板

[同步开发看板](research/v2.0.1/source-audit.html) 按 8 章 57 项工作流展示任务、研究步骤、资料与网站入口、截至记录日期的来源核查、汇总与分析方法、最低证据要求和预期结论。它展示的是 Skill/Research 合同及来源核查记录；具体项目是否已完成取证，需要查看运行证据。

## 历史目录兼容

旧版本默认使用：

```text
~/.dsh/presentation-projects/<projectId>-<projectSlug>/
```

现在该路径与：

```text
PRE_DESIGN_PRESENTATION_PROJECT_ROOT
```

仅作为没有 DSH Workspace 时的显式兼容回退。

已有项目若已在旧公共目录成功发布，第一次迁移到当前 Workspace 根目录需要用户明确执行：

```text
/preplan-presentation-sync --force
```

旧目录不会被自动删除，Stable ID、Pre Revision 和 Presentation Project ID 保持不变。

## 继承的核心能力

1. 创建和维护前期策划项目。
2. 推进 8 章、57 项专业工作流。
3. 管理 Project State、Evidence、Assumption、Question、Gate 和 Revision。
4. 管理原始资料与项目 `assets/images` 中已登记的候选、采用、退役素材。
5. 将冻结的 Pre 项目生成 Presentation 标准项目目录。
6. 输出结构化大纲、页面草案、讲解稿和素材引用。
7. 使用稳定 ID、`sourceRefs`、MIME、字节数和 SHA-256 保证可追溯性。
8. 在完整 Contract 验证通过后安全发布标准文件。
9. 保护 Workspace 中非 Pre 托管文件和 `layouts/`。
10. 保留现有 HTML、PPTX 和 PDF 输出路径。

## 外部项目格式依赖

```text
Presentation Standard Project Directory 0.1.0
@architectureworld/presentation-contracts@0.1.1
ArchitectureWorld/presentation-tools
commit fc54e4052e2ac2b2aa607391a55ab04fb79f4211
Schema Set cc954d1d47cf3a75146190e055be3c3e62eac91f760f9382a9348191e3b19f33
```

该版本仅表示外部 Contract，不参与 Pre 的分支、产品和发布命名。

## 常用命令

```text
/preplan-new <name>
/preplan-open <projectId>
/preplan-list
/preplan-status
/preplan-mode manual|automatic
/preplan-confirm <proposalId>
/preplan-presentation-sync --probe
/preplan-presentation-sync
/preplan-presentation-sync --force
/preplan-open-project-folder
/preplan-export
```

## 开发验证

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

历史 Workspace 根目录代码验证坐标（不代表本轮 UI 的验收结果）：

```text
HEAD: 700a1675ac5801b4ed824b31de48184be2cc1c6c
Workflow: Pre 2.0.0 Integration
Run: 33835245301
Conclusion: success
```

## DSH 部署验证

部署前备份 Web profile 与 storages，检查没有正在运行的任务，并记录候选包 SHA-256。安装后重启 Web profile，验证真实页面和当前项目状态。

```powershell
git switch main
git pull --ff-only
pnpm install --frozen-lockfile
pnpm test
pnpm pack
dsh plugin --profile web add (Resolve-Path '.\architectureworld-dsh-preplanning-agent-2.0.2.tgz').Path
dsh --profile web --no-open
```

重新加载浏览器后使用 `Ctrl + F5` 清理旧 Client 缓存。代码已合入主线，仍未创建 `v2.0.2` Tag 或正式 Release。2026-09-23 的本地部署、紧凑首页验收与支线文案核查见 [支线 Review](docs/pre-v2.0.2-branch-review-2026-09-23.md)。
