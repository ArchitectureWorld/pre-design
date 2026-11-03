# 前期策划 2.1.0 源码同步说明

日期：2026-11-03。交付对象为 GitHub `v2.1.0` 开发分支及相同内容的本地产品源码。

本次从已发布的 `56dc81bbf2f6cce9874b1d20ac331faa8780f874` 整理源码快照，纳入后续模型路由、研究证据校验、章节生产、图像审查、报告导出及相应测试。源码快照不包含本地项目资料、报告输出、运行日志、会话或凭据；也不引入包含这些材料的本地存档提交历史。

## 版本和范围

- 插件：`@architectureworld/dsh-preplanning-agent`，版本仍为 `2.1.0`，开发状态。
- 当前源码兼容基线仍为 DSH `0.1.5-rc.1`，Node 要求 `>=24.11.0`。
- 本次只同步产品源码、测试、必要验证脚本、依赖和构建配置；未操作 Linux 安装或运行服务。
- Linux 平台对 DSH `0.2.1-rc.5` 的适配是后续开发工作，本提交不声称已经完成适配或多人平台验收。
- 研究看板中的项目执行信息为带时间戳的历史开发记录，不代表同步当天或目标服务器的实际运行状态。
- 本地历史工作目录保持独立。其他开发分支继续保留，后续应通过正常的 Git 比较、合并和测试整合变更。

## 干净检出的验证入口

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm test:built
```

两个安装／启动验证脚本及其必要类型声明位于 `scripts/verification/`。对应测试不再依赖本地 `work/` 目录。

## 后续平台要求

平台采用统一服务器、DSH 后台和业务 Web 前端，多用户访问。只有管理员可以修改模型配置；普通用户只使用项目、资料、模块、任务和成果功能，权限在服务端执行。

目标模型目录排除 Antigravity、Ollama 和 OpenAI 接入，包括瑶光 Codex 与 ChatGPT 动态提供的 OpenAI 模型；保留其他服务商使用的 OpenAI 兼容协议。下列 14 项是迁移目标，未在本次源码同步中修改实际运行配置：

| 来源 | 精确模型 ID |
|---|---|
| SenseNova | `sensenova-6.7-flash-lite`、`sensenova-6.8-flash-lite`、`deepseek-v4-flash`、`deepseek-v4-pro`、`glm-5.2`、`kimi-k3` |
| DeepSeek 官方 | `deepseek-flash`、`deepseek-v4-flash`、`deepseek-v4-pro`、`deepseek-v4-flash-vision-exp` |
| ComfyUI | `Klein` |
| 启航引擎 AIGC 组 | `tt-image-2.5`、`tt-image-2.5-flare`、`tt-image-2.5-sunburst` |

来源和模型 ID 共同构成模型身份，同名 DeepSeek 条目分别保留。迁移须保留各自预算、兼容参数和生图工作流，清理父任务默认、主备链、生图配套 LLM 和路由器中的排除项。候选主备分配与能力验证应在后续执行计划中明确。

研究和报告继续保留来源、未验证项和审阅状态。模型生成完成、程序测试通过和用户业务验收分别记录。
