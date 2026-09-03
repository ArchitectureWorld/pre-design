---
document_id: pre-v2-standard-project-output-handoff
document_version: 2.0.0
status: usage-ready-verified-development-candidate
pre_design_version: 2.0.0
presentation_contract_version: 0.1.0
architecture_branch: architecture/pre-v2.0.0
development_branch: feat/pre-v2.0.0
verified_runtime_code_commit: 521265c541a1d6dacac075849962a4c703530a6d
verified_workflow_run: 33741077517
contract_commit: 974668d308728386ea005c9e77d58ebff9372f0a
schema_set_sha256: 5bd329fcc8503ff7a48b3430e41b38dd264ae486cee7372a39cbbcccc2de2ebc
language: zh-CN
---

# Pre-design 2.0.0 标准项目输出实施 Handoff

## 1. 最终结论

Pre-design 2.0.0 已从“底层标准项目输出模块”推进到“DSH 中可直接调用的使用级别”，并补齐真实安装包中的 Presentation Contract 运行时资源。

当前完整链路为：

```text
DSH UI / 用户命令 / 当前 DSH Agent
→ Pre 2.0.0
→ 冻结当前 Pre 项目 Revision
→ 转换为 Presentation Standard Project Directory 0.1.0
→ staging 写盘
→ Contract 全量验证
→ 原子发布
→ 返回标准目录、Presentation Project ID、Pre Revision 和成功标记
→ Presentation 读取、打开或监听该标准目录
```

本轮没有创建新支线，没有修改 `ArchitectureWorld/presentation-tools`，没有合并主线，也没有创建 Tag 或 Release。

## 2. 固定坐标

| 项目 | 值 |
|---|---|
| Pre 产品／插件／包版本 | `2.0.0` |
| 架构支线 | `architecture/pre-v2.0.0` |
| 开发支线 | `feat/pre-v2.0.0` |
| 已验证运行时代码提交 | `521265c541a1d6dacac075849962a4c703530a6d` |
| 已验证工作流 | `Pre 2.0.0 Integration` Run `33741077517` |
| 外部标准 | `Presentation Standard Project Directory 0.1.0` |
| Contract 仓库 | `ArchitectureWorld/presentation-tools` |
| Contract 固定提交 | `974668d308728386ea005c9e77d58ebff9372f0a` |
| Contract 包 | `@architectureworld/presentation-contracts@0.1.0` |
| Schema Set SHA-256 | `5bd329fcc8503ff7a48b3430e41b38dd264ae486cee7372a39cbbcccc2de2ebc` |
| 成功标记 | `PRESENTATION_STANDARD_PROJECT_V0_1_0_PASS` |
| 发布状态 | 未合并、未发布 |

Presentation Contract 是外部、解耦依赖，不参与 Pre 2.0.0 的产品和分支命名。

## 3. 用户入口

### 3.1 UI 新建项目

现有“前期策划”新建面板不增加新工作区，只在原流程中增加标准项目初始化。

实际调用顺序：

```text
/preplan-new <项目名称>
/preplan-presentation-sync
/preplan-mode <manual|automatic> <图像预算> <standard|extended>
/preplan-run
```

只有 `/preplan-presentation-sync` 完成 Contract 校验并发布标准目录后，UI 才显示：

```text
项目与 Presentation 标准目录已创建，前期策划全流程已经启动。
```

如果 Pre 项目已经创建，但标准项目初始化失败，UI 返回明确错误，并提示用户修正后执行：

```text
/preplan-presentation-sync
```

### 3.2 已有项目

```text
/preplan-open <preDesignProjectId>
/preplan-presentation-sync
```

默认行为：

- 复用稳定 Presentation Project ID；
- 复用 Outline、Page、Draft 和内容块稳定 ID；
- 读取当前 Pre Revision；
- 更新标准文件；
- 拒绝静默覆盖外部修改；
- 验证通过后原子替换旧成果。

用户明确要求覆盖外部修改时：

```text
/preplan-presentation-sync --force
```

不得由 Agent 自行决定 `--force`。

### 3.3 Agent 入口

工具名称：

```text
preplanning_sync_presentation_project
```

参数：

```json
{
  "confirmExternalChanges": false
}
```

系统提示已要求：

- 用户说“同步到 Presentation”“交付标准项目”时调用该工具；
- 默认 `confirmExternalChanges=false`；
- 只有用户明确要求覆盖时才设为 `true`；
- 成功后报告目录、Presentation Project ID、Pre Revision 和成功标记。

## 4. 项目根目录

默认根目录：

```text
~/.dsh/presentation-projects
```

目标机器可以在启动 DSH 前设置：

```text
PRE_DESIGN_PRESENTATION_PROJECT_ROOT=<绝对目录>
```

推荐将该变量指向 Presentation 实际读取或监听的同一目录。

标准项目最终路径：

```text
<projectRoot>/<presentationProjectId>-<projectSlug>/
```

注意：

- Pre 负责创建、填写、验证和发布目录；
- Presentation 负责读取、可视化、交互、排版和导出；
- Pre 不修改 Presentation UI；
- 若 Presentation 当前未自动监听该目录，需要在 Presentation 中打开或导入该目录。

## 5. UI 版本标识

新增统一底部小字：

```text
Pre 2.0.0 · Project Format 0.1.0
```

显示位置：

1. 新建前期策划项目面板底部；
2. 会话中的前期策划状态卡底部。

版本值来自：

```text
src/version.ts
```

不得在多个 UI 组件中分别硬编码版本。

## 6. 运行时组件

### 6.1 Host 接线

`src/index.ts` 现在负责：

- 打开 `PresentationBindingRepository`；
- 创建 `PresentationStandardProjectService`；
- 确定标准项目根目录；
- 复用 `createFrozenProjectInput` 生成当前 Revision 输入；
- 注册同步 Command 与 Agent Tool；
- 在 Host 上暴露：
  - `standardProjects`；
  - `presentationProjectRoot`；
  - `presentationBindings`。

### 6.2 运行时 Adapter

文件：

```text
src/presentation/runtime-integration.ts
```

职责：

- 从当前 Session 取得 Pre 项目；
- 冻结当前 Revision；
- 将已采用的视觉素材转换为正式 Presentation Asset 输入；
- 调用唯一 `PresentationStandardProjectService`；
- 返回结构化同步结果；
- 注册 Command 与 Agent Tool；
- 不复制或修改 Contract Schema。

### 6.3 标准项目输出引擎

```text
standard-project-adapter.ts
→ standard-project-writer.ts
→ standard-project-service.ts
```

固定执行顺序：

```text
读取绑定和稳定 ID 账本
→ 生成 Canonical 文档
→ 创建 sibling staging
→ 写入 JSON 和文件
→ 计算 MIME / sizeBytes / SHA-256
→ 更新 Manifest
→ Contract Validator 全量校验
→ 备份或保护既有目录
→ 原子发布
→ 更新绑定和 Hash 账本
```

### 6.4 安装包中的 Contract 运行时资源

首次 Windows 人工测试发现：Contract 代码已被打入 `lib/index.js`，但旧包没有携带 `SCHEMASET.sha256`、`schemas/0.1.0/*.schema.json` 和动态 JS 分块，导致安装后从包根目录读取 Schema Set 时出现 `ENOENT`。

修复后执行：

```text
pnpm build / pnpm pack
→ scripts/prepare-presentation-contract-runtime-assets.mjs
→ 从已锁定的 @architectureworld/presentation-contracts@0.1.0 读取资源
→ 重新计算并核对 Schema Set SHA-256
→ 生成包根 SCHEMASET.sha256
→ 生成 schemas/0.1.0/*.schema.json
→ 使用 lib/** 纳入全部构建分块
→ npm pack 清单回归
→ 从真实 lib/index.js 启动 Host 回归
```

生成的文件是固定 Contract 的构建产物，不是第二套 Schema 权威。权威仍是固定提交和 Contract Lock。

## 7. 标准数据映射

### Project

- `preDesignProjectId` 保留为上游来源身份；
- `presentationProjectId` 使用 Contract ID Factory；
- 项目改名和重复同步不重新生成 ID；
- `projectSlug` 只用于目录名。

### Outline / Page / Draft

- 57 项专业成果先投影为汇报主题和页面；
- Outline 使用稳定节点 ID；
- Page 使用稳定 `pageId`；
- 每页独立 Draft 文件；
- 内容块使用 `heading / text / list / metric_group / table`；
- 讲解稿使用 `scriptBlocks`；
- 页面素材使用 `pageAssets`；
- 不写字体、颜色、坐标、模板、母版或 CSS。

### Assets

当前运行时自动纳入：

- 已采用的概念图；
- 已采用的确定性图表或示意图；
- 已采用的证据图片。

候选、缓存和临时文件不进入 Asset Manifest。

### sourceRefs

保留：

- provider；
- Pre 项目 ID；
- Pre Revision；
- 对象 ID；
- Evidence ID；
- 可选 Snapshot Hash。

`sourceRefs` 只承担追溯，不承担自动覆盖或所有权。

## 8. 错误与恢复

同步失败时：

- 不返回成功标记；
- 不发布未通过验证的目录；
- 清理 staging；
- 不静默覆盖旧成果；
- 保存结构化失败信息；
- 允许用户修正后重试。

外部修改保护：

```text
当前标准文件 Hash
≠ Pre 上次发布 Hash
→ 默认拒绝覆盖
→ 返回 review_required / structured error
```

只有明确命令 `--force` 或工具参数 `confirmExternalChanges=true` 才允许覆盖。

## 9. 关键新增和修改文件

### 新增

```text
src/version.ts
src/client/VersionFooter.tsx
src/presentation/runtime-integration.ts
scripts/prepare-presentation-contract-runtime-assets.mjs
tests/presentation-runtime-integration.spec.ts
tests/built-presentation-runtime.spec.ts
```

### 重点修改

```text
src/index.ts
src/client/direct-start.ts
src/client/PreplanningProjectForm.tsx
src/client/PreplanningStatusCard.tsx
src/prompts/preplanning-system.ts
src/presentation/index.ts
src/presentation/filesystem.ts
tests/direct-start.client.spec.ts
tests/preplanning-dashboard.client.spec.tsx
tests/browser-plugin.client.spec.tsx
tests/host-apply.spec.ts
tests/built-package.spec.ts
tests/package-manifest.spec.ts
package.json
.gitignore
README.md
HANDOFF.md
docs/version-matrix.json
docs/VERSIONING.md
scripts/verify-alignment-version-consistency.mjs
.github/workflows/presentation-standard-project-integration.yml
```

Windows 文件同步保护仍保留：

```text
src/presentation/filesystem.ts
open(path, 'r+')
```

## 10. 验证证据

已验证运行时代码提交：

```text
521265c541a1d6dacac075849962a4c703530a6d
```

GitHub Actions：

```text
Workflow: Pre 2.0.0 Integration
Run: 33741077517
Conclusion: success
```

同一代码提交通过：

- Pre 2.0.0 版本权威校验；
- 固定 Contract 完整性校验；
- Node.js 22 原生构建配置校验；
- Presentation 专项测试；
- TypeScript 校验；
- 真实 DSH Host 标准目录发布测试；
- UI 创建流程测试；
- Agent Tool 测试；
- 完整构建；
- 全仓回归；
- 从真实 `lib/index.js` 启动 Host 并同步标准项目；
- npm pack 清单包含 8 个 Schema、`SCHEMASET.sha256` 和全部生成 JS 分块；
- 构建产物测试；
- Git diff hygiene。

真实构建产物测试实际执行：

```text
lib/index.js
→ /preplan-new
→ /preplan-presentation-sync
→ Contract Schema Set 校验
→ 读取磁盘 project.json
→ standardVersion = 0.1.0
→ PRESENTATION_STANDARD_PROJECT_V0_1_0_PASS
```

## 11. 本地验证命令

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

## 12. DSH 部署与验收

从当前开发支线构建：

```bash
git switch feat/pre-v2.0.0
git pull --ff-only
pnpm install --frozen-lockfile
pnpm test
pnpm pack
```

`pnpm build` 和 `pnpm pack` 都会自动生成并验证 Contract 运行时资源。不得继续使用 `521265c541a1d6dacac075849962a4c703530a6d` 之前生成的同名 tgz。

独立 Profile 安装：

```powershell
dsh plugin --profile pre-v2-test add .\architectureworld-dsh-preplanning-agent-2.0.0.tgz
dsh --profile pre-v2-test --dump-config
dsh --profile pre-v2-test --no-open
```

验收步骤：

1. 确认安装的是本轮重新生成的 tgz；
2. 打开新建前期策划面板；
3. 确认底部显示 `Pre 2.0.0 · Project Format 0.1.0`；
4. 对已经创建的测试项目执行 `/preplan-open <projectId>`；
5. 执行 `/preplan-presentation-sync`，不要重复新建同一项目；
6. 确认返回 `PRESENTATION_STANDARD_PROJECT_V0_1_0_PASS`；
7. 记录返回目录和 Presentation Project ID；
8. 在 Presentation 中打开或监听同一目录；
9. 确认能读取 `project.json / rules.json / outline.json / pages / assets / source-materials / layouts`；
10. 修改 Pre 内容后再次同步，确认稳定 ID 保持不变；
11. 检查默认保护外部修改。

## 13. 已知边界

- 本轮完成 Pre 侧的使用级标准目录交付，不修改 Presentation 的项目发现 UI。
- Presentation 是否自动出现在其项目列表中，取决于 Presentation 是否读取或监听同一根目录。
- 当前 UI 成功提示不显示绝对目录；显式命令和 Agent Tool 会返回完整目录。
- `--force` 是破坏性操作，必须由用户明确授权。
- 当前仍是开发候选，未合并、未打 Tag、未发布正式 Release。

## 14. 回滚

代码回滚基点：

```text
3e0fceed75945ac83be01d05870430efd956ea5d
```

该提交包含 Windows 文件同步修复，但不包含本轮运行时接线、版本 UI 和安装包 Contract 资源修复。

回滚部署时：

1. 卸载当前测试 Profile 中的 Pre 2.0.0 包；
2. 安装上一已知可用包；
3. 不删除已经生成的标准项目目录；
4. 保留 `~/.dsh/presentation-projects` 以便审计或重新导入；
5. 不回滚或修改 Presentation Contract 源码。

## 15. 下一开发 Agent 入口

```text
Repository: ArchitectureWorld/pre-design
Branch: feat/pre-v2.0.0
Version authority: docs/version-matrix.json
Human version rules: docs/VERSIONING.md
Runtime adapter: src/presentation/runtime-integration.ts
Standard service: src/presentation/standard-project-service.ts
Host composition: src/index.ts
UI version source: src/version.ts
Runtime asset preparation: scripts/prepare-presentation-contract-runtime-assets.mjs
Runtime verification: tests/host-apply.spec.ts
Built Host verification: tests/built-presentation-runtime.spec.ts
Packed contents verification: tests/built-package.spec.ts
Contract lock: docs/contracts/presentation-standard-project-v0.1.0-lock.json
```

下一步不得新增支线；继续在 `feat/pre-v2.0.0` 上处理真实 DSH 与 Presentation 联调反馈，完整验证后再申请合并与发布。
