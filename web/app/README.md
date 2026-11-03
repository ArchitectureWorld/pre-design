# Pre-design 2.1.0 Web 平台

基于 `origin/v2.1.0` 的研究和报告核心，复用 V0.9 页面布局。项目、原件、任务、额度、配置版本保存在服务器。项目名称、地点、案例和产品均来自当前项目资料及用户要求，运行时不装载演示项目或预置业务方案。

## 本机候选环境

- 代码：`Development/pre-design-web-v210`，分支 `codex/web-v210`。
- 页面：`http://127.0.0.1:4320`；旧环境的 4318/3080 服务独立运行。
- 私有配置：`.local/web/config.json`。管理员和两个普通用户的访问令牌见 `.local/web/access.txt`，文件权限 600。
- 数据库：`pre_design_web_v210`；项目和独立 Worker 会话分别在 `.local/web/projects/`、`.local/web/workers/`。
- 模型初始状态均为待验证。没有配置接入、凭据和所需能力时，收费任务不会入队。

## 安装与启动

需要 Linux、Node >=24.11、pnpm 和 PostgreSQL。DSH CLI/SDK 精确固定 `0.2.1-rc.5`；Worker 安装包含 Node 24.22.2。

从仓库根目录执行：

```bash
npm ci --prefix web/worker
export PATH="$PWD/web/worker/node_modules/node/bin:$PATH"
pnpm install --frozen-lockfile
npm ci --prefix web/app
pnpm build
node web/worker/build-host-probe.mjs
node web/app/build-prototype.mjs
```

首次配置前准备可用 PostgreSQL。当前机器已在 `/tmp/pre-design-pg-1000:55439` 运行本地实例，直接复用实例并创建独立数据库，不启动第二个实例。没有既有实例的新机器可使用 `web/app/local-postgres.sh start`，或使用自行维护的 PostgreSQL。

```bash
node web/app/init-local.mjs
web/app/start-local.sh
```

初始化脚本仅在配置不存在时创建数据库和三个随机令牌，不覆盖已有配置。可使用 `PRE_WEB_DATABASE`、`PRE_WEB_PG_HOST`、`PRE_WEB_PG_PORT`、`PRE_WEB_HOST`、`PRE_WEB_PORT` 指定本地环境。正式部署可按 `config.example.json` 使用其他数据库和身份配置；API 只接受服务端验证的 Bearer 令牌，角色不能由请求自行声明。

## 使用流程

1. 登录，创建项目并上传真实资料。支持 PDF、TXT、Markdown、CSV、JSON 和 PNG/JPEG/WebP 图片，每份不超过 10 MB。创建和上传不自动调用模型。
2. 打开“研究范围”，从 62 项模块中明确选择范围，检查依赖；执行前明确四项研究条件。依赖不会自动加入，已有兼容成果可复用。
3. 在“任务与成果”查看真实终态、资料缺口、取消任务或下载成果。选中模块可局部重做；资料或任务背景变化后建立新快照，旧成果保留。
4. “汇编所选研究成果”组合已有结果，不调用模型；报告保留来源、限制及未完成模块，并标记未经报告审查。
5. “章节生产”中填写本章要求、可选补充意见和真实图片，保存后按前置条件依次制定计划、补充研究、写作、排版、导出和审查。缺研究、请求、图片、计划或模型能力会明确阻止提交。原生 HTML/PDF 成果可下载；这不等于已经完成真实模型质量验收。

原有项目问询、提案预览/确认、批注统一提交继续连接专业核心。保存批注不会自动运行模型。普通用户没有模型配置入口，也不能借业务请求覆盖 provider、model、备用路由或推理配置。

## 管理员模型配置

管理员“模型管理”包含完整的 14 项允许模型，按 `provider + model` 区分身份：SenseNova 6 项、DeepSeek 官方 4 项、ComfyUI Klein 和启航图像 3 项。保留各自上下文/输出预算、Kimi 的 `max_completion_tokens` 与明确的主备顺序。

接入步骤：

1. 在服务器准备 DSH provider 配置及凭据引用文件，格式见 `../worker/settings.example.yaml`。
2. 在私有 Web 配置的 `worker.settings`、`worker.credentials` 中填写路径。凭据内容只保留在私有文件；页面只接受 `credential:NAME` 引用。
3. 管理员填写对应实际 provider 映射，按真实验证结果填写文本、工具、视觉和图像能力以及验证状态，再为角色设置主备。文本角色用于带图章节时，其主备链也必须通过视觉能力验证。
4. 配置保存使用版本校验。每个任务保存不可变策略快照，后续改配置不会改变已入队任务。管理员运行记录分别展示保存的候选路由与有原生证据的实际调用；未记录的用量不估算成实际消耗。

被排除的 GPT/OpenAI、瑶光 Codex、Ollama 和 Antigravity/Gemini 来源不能用于新 Web 任务。允许保留模型使用 OpenAI 兼容协议。

## 执行与数据边界

- PostgreSQL 事务控制全局/用户并发、用户排队数和每日任务数。同项目串行，同一数据库/schema 只允许一个 API 执行器。
- 请求幂等。排队任务取消释放额度；运行取消保留已有结果。服务重启后，执行结果未知的任务标记中断，不自动重复调用模型。
- 归属校验覆盖项目、资料、任务、事件和下载。Worker 使用独立会话、私有目录和最小凭据环境；禁用任意文件/命令工具。
- 上传原件保存 SHA-256；下载、章节图片和 Worker 读取再次校验路径与内容，拒绝符号链接逃逸。图片还核验格式、尺寸、单帧和像素上限。
- 备份需覆盖数据库、项目目录及 Worker 会话；完整备份恢复尚未验收。

## 验证与当前限制

```bash
pnpm typecheck
pnpm test
node web/app/build-prototype.mjs
node --test web/app/tests/*.test.mjs
node web/app/tests/platform-browser.mjs
```

Web 数据库测试使用独立临时 schema 并清理。浏览器测试创建明确标注的验收样本，不调用收费模型。真实 Worker 探针 `node web/worker/probe-research.mjs` 使用本地模拟协议服务，不代表真实提供方成功。

当前没有获得允许模型的实际接入配置，因此尚未验证真实研究生成和报告质量。ComfyUI/启航图像适配器与独立网页搜索后端尚未装配；网页原文抓取可用。Office/CAD/OCR、注册密码管理、HTTPS 入口和备份恢复不在本次已验收范围。详细证据见 `VERIFICATION.md`。原型原 CSS 和 DOM 保持测试见 `tests/prototype.test.mjs`。
