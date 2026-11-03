# Pre-design Web 本地接入

沿用 `web/index.html` 的 V0.9 原型。该文件仍是界面权威来源，未经覆盖；构建脚本逐字提取原 CSS 和页面 DOM，只用 `src/prototype-api.js` 替换模拟业务。项目总览、紧凑创建、首轮问询、关系图、归拢/全展开、预览与批注箱继续使用原组件和样式。原型演示项目不会进入真实数据库。

## 运行

环境：Linux，Node >=24.11，DSH CLI/SDK 固定0.2.1-rc.5，PostgreSQL。仓库内可使用 `web/worker/node_modules/node/bin/node`（24.22.2）。

首次安装：

```bash
npm ci --prefix web/worker
export PATH="$PWD/web/worker/node_modules/node/bin:$PWD/.cache/bin:$PATH"
pnpm install --frozen-lockfile
pnpm build
node web/worker/build-host-probe.mjs
npm ci --prefix web/app
npm run build --prefix web/app
```

创建私有配置 `.local/web/config.json`，目录700、文件600，参考 `config.example.json`。用户访问令牌至少32字符、随机生成；不要写入源码。模型凭据只引用既有本地 YAML 文件中的指定 provider credential，不下发浏览器。

本机已配置用户目录 PostgreSQL，使用私有 Unix socket，不监听网络；不会修改系统 PostgreSQL。Ubuntu24.04首次可运行以下脚本下载并解包发行版 PostgreSQL16（无需sudo）：

```bash
web/app/local-postgres.sh start
web/app/start-local.sh
```

浏览器打开 `http://127.0.0.1:4318`，使用私有配置中对应用户的访问令牌。示例配置默认仅本机访问。局域网体验时，将私有配置的 `host` 设为 `0.0.0.0` 并重启，通过 `http://服务器局域网IP:4318` 登录；访问令牌仍然必填。普通 HTTP 适用于可信内网临时体验，正式部署应配置 HTTPS 入口。不要将体验端口映射到公网，也不要开放 Worker socket 或旧 Report Studio 端口。生产可使用配置中的独立 PostgreSQL 地址，直接启动main，无需本地数据库脚本。

持久数据：`.local/web/projects/`原件与标准项目；`.local/web/workers/`独立DSH_HOME与会话；`.local/web/postgres-data/`本地数据库。`.cache/`仅构建及测试证据。备份应同时覆盖这三个持久目录；尚未验证完整备份恢复，不要把服务重启测试当备份验收。

## 当前实际范围

- 用户令牌身份、本人项目隔离、项目元数据与服务器目录。
- PDF及UTF-8文本（TXT/MD/CSV/JSON）原样上传、SHA-256账本、受控读取；单份10MB。扫描PDF若无文本会报告需OCR。Office/CAD/图片识别尚未接入，界面明确提示。
- 首闭环是PS01项目基本情况：读取实际资料、问询、提交专业提案、通过原型预览确认、Core Revision与标准Writer同步。
- 保存批注不运行Agent；统一提交后形成修订提案，确认后批注归档。原型批注编辑/删除对接服务端；旧版本批注可编辑并重新绑定当前版本。
- 页面中的已确认成果来自实际专业状态，不包含演示指标/假图。完整57项专业流程、全册图文排版和PPTX/PDF导出尚未从此Web入口接通。
- 同项目串行；同数据库只允许一个API执行器；写请求保留requestId以防网络重试重复执行。SSE按序号恢复通知。
- SDK子进程按项目隔离。空闲Worker退出后，失败请求不会直接重放，下次读取恢复原会话。进程中断的模型任务不自动重跑；恢复先核对Core中的提案与版本。

## 验证

```bash
pnpm typecheck
pnpm test
npm run build --prefix web/app
npm test --prefix web/app
node web/app/tests/prototype-browser.mjs
node web/app/tests/prototype-navigation.mjs
# 局域网 HTTP 验证（将地址换成当前服务器 IP）
PRE_WEB_TEST_URL=http://192.168.6.45:4318 node web/app/tests/lan-browser.mjs
```

Web API集成测试使用私有socket `/tmp/pre-design-pg-1000:55439`、数据库 `pre_design_web`，在独立临时schema里运行并清理；可按环境修改tests中的连接参数。真实浏览器脚本读取本机私有配置与隔离验收项目，不输出令牌。`annotation-browser.mjs`会真实提交修改任务，勿当无成本的页面截图脚本反复执行。

真实验收与限制见 `VERIFICATION.md`。原型CSS与DOM保持测试见 `tests/prototype.test.mjs`。新增Web测试由Node test运行，根Vitest明确排除 `web/app/**`，避免混用测试运行器。

`tests/live-lan-smoke.mjs` 是显式启用的真实模型验收，会创建测试项目并确认测试提案，产生模型调用费用。准备一个证据目录及其中的 `任务书.txt`（脚本的内容断言针对已标注为模拟测试的860平方米阅读空间样本），设置 `PRE_WEB_TEST_URL`、`PRE_WEB_EVIDENCE` 和唯一的 `PRE_WEB_TEST_NAME` 后运行。它从浏览器上传原件，等待实际提案，检查预览中的模拟声明与面积限制、提案时间，确认后验证版本与刷新恢复；不属于默认 `npm test`。
