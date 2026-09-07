# Pre report Skill：本批开发验证记录

日期：2026-09-07。仅在 `feat/pre-v2.0.0` 继续开发；没有新增远程分支、合并 main、发布 Release 或改动生产 DSH。

## 实际源码

报告 Skill 基线提交：`89a5a2a044051652cab0847c478e7e09bebc684e`。T05/T06 实现以本文件所在 `feat/pre-v2.0.0` 分支提交为权威。
保留开始开发时已有的 `a4a2d4cb47c504c246507787a667a11199ece02f` 成果，在其上补齐报告设计 Skill 1.0.2。产品包仍为 2.0.0，不把 Skill 版本当作产品版本。

实际修改为 `src/prompts/report-design-skill.ts`、其测试和当日交接。Skill 仍由主系统提示词实际导入：Pre 负责写作、叙事与排版策略；Presentation 负责工具执行；DSH 提供主会话与模型。

增加 annotationResults 的批注版本与命令映射、commands=[]/no_changes、scopeInherited/newPageIds、local_saved_conflict、conflict/apply_failed 的新基线重试，以及 link_failed 通过稳定请求身份恢复，并记录 Studio 最终挂接回执。图片来源内部记录；不恢复报告 Proposal 的人工审批。不调整 Pre 专业状态的 Gate 与 ProposalEnvelope。

## 已完成的验证

GitHub Actions `Pre direct edit Skill verified delivery`，run `34089271319`：检查和同分支源码提交步骤均成功。该作业先对精确源文件哈希校验并应用改动，再构建测试；成功后才提交上述实现。中转文件及一次性工作流已删除。

- `pnpm test`：101 个测试文件通过、2 个跳过；701 项测试通过、3 项跳过、0 失败。包含构建、版本与固定合同检查。
- `pnpm typecheck`：退出码 0。
- `pnpm test:built`：2 个文件、5 项测试全部通过。此 5 项与全套存在重叠，不相加为 706 项独立测试。
- `git diff --check`：通过。

测试证据由该作业的 `pre-direct-edit-skill-evidence` artifact 保存。第一次完整回归发现旧集成测试要求的“不重复付费”表述缺失，已在 Skill 补回并以第二次全套结果为准，没有删除该集成断言。

## 验证边界

没有执行真实 DSH 主会话与实际付费模型的双插件联合验收；没有将上述测试等同于真实视觉质量通过。Pre 既有独立报告导出链的全部历史图注/页脚仍需另行盘点，本批不宣称所有旧导出入口已迁移。Pre adopted_unlinked 与 Studio 挂页成功的最终回执已具备自动化闭环；真实双插件安装包和付费模型联调仍在后续任务内。

下一步以 Presentation 同分支实现的实际工具返回值联调，不重新创建平行的排版策略或审批工作流，不因策划 nextWorkflow=null 阻止已经授权的汇报修改。


## T05/T06 后续验证

Pre 侧新增 `linked` 内部状态、原始 runId 持久绑定和 `presentation-tools.page-visual-link.v1` 回执校验；Studio 侧可按原四项请求身份补挂页或补回执。回执字段与已有请求不一致时拒绝，不覆盖 Studio 自有文件。
