# Pre-design 2.1.0 Web 平台

基于 `origin/v2.1.0` 的研究和报告核心，复用 V0.9 页面布局。项目、原件、任务、额度、配置版本保存在服务器。项目名称、地点、案例和产品均来自当前项目资料及用户要求，运行时不装载演示项目或预置业务方案。

## 本机候选环境

- 代码：`Development/pre-design-web-v210`，分支 `codex/web-v210`。
- Linux 本机页面：`http://127.0.0.1:4320`。另一台电脑须使用 `http://Linux局域网IP:4320`，`127.0.0.1` 始终指向打开浏览器的电脑。
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

同一局域网访问已有环境时，将私有 `.local/web/config.json` 中的 `host` 设置为 `0.0.0.0`，然后重启服务。初始默认 `127.0.0.1` 仅允许 Linux 本机访问；修改初始化环境变量不会覆盖已有配置。浏览器使用 Linux 的实际局域网 IP 和 `http://`，不要使用 `0.0.0.0` 或另一台电脑自己的 `localhost`。

本机候选环境已改由 systemd 用户服务常驻运行，单元文件位于 `~/.config/systemd/user/`：

- `pre-design-web-v210.service` 运行当前候选目录的 `start-local.sh`，读取既有私有配置；进程退出后等待 5 秒自动重启。
- `pre-design-local-postgres.service` 是启动时的数据库准备服务，调用原 `Development/pre-design-web/web/app/local-postgres.sh start`，复用原数据目录及 socket，不创建第二套数据库实例。Web 启动依赖它成功完成。
- 两个服务已启用，当前用户已开启 linger，因此不依赖终端或登录会话。已验证 Web 进程退出后的自动恢复；没有为验收重启整台 Linux。

日常操作使用以下命令；服务运行期间不要再手动执行 `start-local.sh`，避免端口和数据库执行器冲突：

```bash
systemctl --user status pre-design-web-v210.service
systemctl --user restart pre-design-web-v210.service
journalctl --user -u pre-design-web-v210.service -n 50 --no-pager
```

`systemctl --user stop pre-design-web-v210.service` 会停止 Web，不停止共用数据库。数据库准备服务正常状态为 `active (exited)`；它负责启动时确保数据库可用，不监控已运行的 PostgreSQL 进程。

## 使用流程

1. 登录，创建项目并上传真实资料。支持 PDF、TXT、Markdown、CSV、JSON 和 PNG/JPEG/WebP 图片，每份不超过 10 MB。创建和上传不自动调用模型。
2. 打开“研究范围”，从 62 项模块中明确选择范围，检查依赖；执行前明确四项研究条件。依赖不会自动加入，已有兼容成果可复用。
3. 在“任务与成果”查看真实终态、资料缺口、取消任务或下载成果。选中模块可局部重做；资料或任务背景变化后建立新快照，旧成果保留。
4. “汇编所选研究成果”组合已有结果，不调用模型；报告保留来源、限制及未完成模块，并标记未经报告审查。
5. “章节生产”中填写本章要求、可选补充意见和真实图片，保存后按前置条件依次制定计划、补充研究、写作、生图、排版、导出和审查。缺研究、请求、图片、计划或模型能力会明确阻止提交。已取得的概念图及原生 HTML/PDF 可下载；概念图标记待审阅，不代表现场事实。

原有项目问询、提案预览/确认、批注统一提交继续连接专业核心。保存批注不会自动运行模型。普通用户没有模型配置入口，也不能借业务请求覆盖 provider、model、备用路由或推理配置。

## 管理员模型配置

管理员“模型管理”包含 15 项允许模型，按 `provider + model` 区分身份：原有 SenseNova 6 项、DeepSeek 官方 4 项、ComfyUI Klein、启航图像 3 项，以及用户明确选定的 `yaoguang-codex / yaoguang02-gpt-6-astra`。保留各自上下文/输出预算、Kimi 的 `max_completion_tokens` 与明确的主备顺序。

接入步骤：

1. 在服务器准备 DSH provider 配置及凭据引用文件，格式见 `../worker/settings.example.yaml`。
2. 在私有 Web 配置的 `worker.settings`、`worker.credentials` 中填写路径。凭据内容只保留在私有文件；页面只接受 `credential:NAME` 引用。
3. 管理员填写对应实际 provider 映射，按真实验证结果填写文本、工具、视觉和图像能力以及验证状态，再为角色设置主备。文本角色用于带图章节时，其主备链也必须通过视觉能力验证。
4. 配置保存使用版本校验。每个任务保存不可变策略快照，后续改配置不会改变已入队任务。管理员运行记录分别展示保存的候选路由与有原生证据的实际调用；未记录的用量不估算成实际消耗。

本机文本、网络查询、图片理解与生图配套角色已按用户选择接入 `yaoguang02-gpt-6-astra`，使用 `openai-responses`、输出上限 8192；文本、结构化工具调用及图片输入均经过真实验证。只允许这个精确瑶光身份，不允许其他模型借映射冒充；其他未授权来源仍被排除。历史 14 项任务快照保持原文，现行策略在新修订中追加第 15 项。

## 搜索与 Flux3 生图配置

本机已验证 Exa 中文官方来源检索和 ComfyUI Flux3 文生图、参考图编辑。它们与模型角色共用版本化策略，普通业务请求不能覆盖地址、工作流或凭据；新安装的初始状态仍为待验证。

- 在“模型管理 → 独立搜索服务”选择 Exa、Bing、DuckDuckGo 或 DeepSeek Search API。Exa / Bing / DuckDuckGo 无需密钥，固定使用各自搜索端点；只提取真实网页来源，不自动换引擎或额外调用问答模型。验证码、重定向、网络错误和无法确认的空白页均明确失败。本机默认选 Exa；本次中文查询返回住建部和中国政府网来源。Bing 的中文结果相关性在实测中不稳定，DuckDuckGo 当前出口返回人工验证页。公开免密服务有频率限制，失败不会自动切换服务。
- 使用 DeepSeek Search API 时，填写 Search API 路径前缀（DeepSeek 官方默认为 `https://api.deepseek.com/v1/tools`，不带末尾 `/search`）和 `credential:SEARCH_KEY`。服务必须兼容该协议。密钥放在 `worker.credentials` 指向的私有 YAML/JSON 文件的 `refs.SEARCH_KEY`。支持每次结果数、查询数及超时限制；没有额外的 Messages 问答模型调用，不继承 DSH 登录账号或其他环境密钥。公开网页原文读取继续使用受控 HTTP 抓取。
- 若服务器需代理访问公开搜索，在私有配置设置 `worker.searchProxyURL`，只允许无账号密码、路径或查询参数的 HTTP(S) 代理地址。该配置只作用于 Exa / Bing / DuckDuckGo，不继承系统代理，不改变文本模型、ComfyUI 或网页原文抓取的连接。搜索代理使用配套 Undici fetch/dispatcher，固定 TLS 目标主机并保留证书验证。
- 展开 `Comfyui-PIC / Klein`，填写 ComfyUI 地址，如 `http://主机地址:8188`。如需 Bearer 鉴权，填写凭据引用并在同一私有文件登记；无鉴权服务可留空。不要在地址或页面中填写密钥。
- 固定使用本次提供的 `flux3-image-klein-bf16.safetensors`、文生图 `flux3-klein-t2i@2026-11-03.1`、图生图 `flux3-klein-i2i@2026-11-03.1`。模板只清空示例提示词和示例参考图，其余节点保留；工作流里的 Qwen 文本编码器/提示扩写器是 ComfyUI 模型文件，不是新的 LLM 提供方。
- ComfyUI 必须安装两份工作流所需节点及模型。运行前检查 `/object_info`，不符合时在调用生图配套 LLM 前拒绝。文生图省略尺寸时保持原 2:3、4MP；图生图保持参考图比例、4MP；任务明确指定尺寸时覆盖。参考图必须是当前项目登记且哈希仍匹配的图片，不接受任意文件或 URL。
- 选定并验证 `imageLlm` 配套 LLM；本版该角色备用链须为空。确认真实端点能工作后再把 Klein 标记已验证。填写地址、通过本地模拟测试均不会自动将真实模型标记为已验证。
- 生成请求在提交前持久写入收执，返回后保存 ComfyUI `promptId`、工作流版本/摘要和输出哈希。未知提交、超时或进程中断不自动重发；取消仅尝试删除本请求的排队项，不调用全局 `/interrupt`。已经在 GPU 上运行的任务可能继续，迟到图片需核对原收执，当前没有普通用户的自动恢复入口。

旧 Flux2 策略在启动时迁移为新的 Flux3 修订，状态重置为待验证；旧策略和任务快照保持原样。启航图像来源仍保留身份，但本版未装配其后端适配器。

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
node web/worker/probe-services.mjs
```

Web 数据库测试使用独立临时 schema 并清理。浏览器测试创建明确标注的验收样本，不调用收费模型。真实 Worker 探针 `node web/worker/probe-research.mjs` 使用本地模拟协议服务，不代表真实提供方成功。

真实验收已覆盖 yaoguang02 文本/工具/图片输入、Exa 原生搜索工具返回来源，以及两套 Flux3 GPU 工作流。搜索质量会随查询和远端页面变化；完整业务研究和长篇章节质量仍需按实际项目资料验收，最小能力探针不能替代质量评审。Office/CAD/OCR、注册密码管理、HTTPS 入口和备份恢复不在本次已验收范围。详细证据见 `VERIFICATION.md`。原型原 CSS 和 DOM 保持测试见 `tests/prototype.test.mjs`。
