# R5.1 项目总档：本地 Agent 部署交接

## 先读结论

本分支已直接集成 R5.1 代码，不是只有压缩包。运行源文件在 `web/app/src/dossier/`，`server.mjs` 和 `build-prototype.mjs` 已应用对应接入改动。**不要再次运行旧压缩包的 INSTALL.sh：旧安装器针对安装前源码并拒绝覆盖已存在文件。**

仓库 `ArchitectureWorld/pre-design`；分支 `codex/web-v210`。上一基线为 `be0591f708ed1ffe6dfd0f968c28293aceda8edb`。这次只同步开发代码，没有远程部署、操作生产数据库或调用真实模型。

## 不可改变的约束

- 使用现有 `pre-design-web-v210` 目录、私有配置、PostgreSQL、DSH Worker 和模型策略，不另建生产后台。
- Web 保持 HTTP 4320；DSH 保持 HTTPS 3080；不重启 DSH、不停共享数据库、不自动换端口。
- 保留 `.local/`、原件、既有项目、访问令牌和全部成果。不得将私有配置、密钥或用户资料提交 Git。
- 不删除旧 `pre-design-web` 目录：它仍可能承载共享数据库。
- 有本地改动或分支分叉时先审阅合并，不执行 `reset --hard`、`clean -fdx` 或强推。

## 部署顺序

1. 检查 `AGENTS.md`、`web/app/LAN-ACCESS.md`、本交接和当前 `git status`。确认运行目录、systemd 服务以及真实数据库与模型配置。
2. 记录现有提交号，并备份私有配置、原件/成果、数据库及当前 `web/app/dist`。备份不得进入仓库。数据库备份要可恢复，不能只备份代码。
3. 拉取远端：`git fetch origin codex/web-v210`。干净且能够快进时才 `git switch codex/web-v210`、`git merge --ff-only origin/codex/web-v210`；存在未提交改动先保护并审阅，不覆盖。
4. 使用现有 `web/worker/node_modules/node/bin/node`（生产要求 Node >=24.11）。复用已安装依赖；依赖缺失时按 `web/app/README.md` 安装锁定依赖，不更换模型来源。
5. 在同一运行账号下做离线测试、真实 PG 隔离测试和 Web 构建。全部通过才重启 Web；失败不启用新构建。生产数据不会由测试清空，测试会创建并删除自身随机 schema。
6. `systemctl --user restart pre-design-web-v210.service`，检查状态、日志及认证健康。不得启动另一 API 进程争用端口或执行租约。
7. 运行下方只读预检；明确允许模型调用后再执行一次真实 DSH 验收。检查页面、更正、旧任务失效；重启 Web 后再次回查测试报告中的同一 projectId 和版本。
8. 将目标机结果追加至本地验收记录；报告代码版本、测试输出、测试项目ID和剩余问题。技术成功、抽取质量和用户采用分别判断。

### 测试与构建

在仓库根目录执行，确保使用项目配套 Node：

```bash
export PATH="$PWD/web/worker/node_modules/node/bin:$PATH"
node --test web/app/tests/dossier-contract.test.mjs web/app/tests/dossier-store.test.mjs web/app/tests/dossier-service.test.mjs
node --check web/app/src/server.mjs
node --check web/app/build-prototype.mjs
```

真实 PostgreSQL 测试必须设置 `PRE_DOSSIER_TEST_DATABASE`，不要打印连接信息。下面在子进程环境内从现有私有配置读取，测试只使用独立随机 schema：

```bash
node --input-type=module <<'NODE'
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const config=JSON.parse(readFileSync('.local/web/config.json','utf8'));
const result=spawnSync(process.execPath,['--test','web/app/tests/dossier-api.test.mjs'],{
  stdio:'inherit',env:{...process.env,PRE_DOSSIER_TEST_DATABASE:JSON.stringify(config.database)}
});
process.exit(result.status ?? 1);
NODE
```

构建先输出到独立目录，成功后按既有部署方式原子替换 `web/app/dist` 并保留回滚副本；不要把生产页面直接作为失败构建的临时输出：

```bash
PRE_WEB_BUILD_DIR="$PWD/.local/dossier-build-r51" node web/app/build-prototype.mjs
```

同时按当前环境补跑已有 Web 回归；本交接不把专项通过冒充整个仓库全量通过。

### 服务验收

```bash
# 不创建项目、不调用模型
bash scripts/dossier-r5.1/VERIFY-LIVE.sh

# 明确允许一条真实模型整理任务；新建隔离测试项目，保留记录
bash scripts/dossier-r5.1/VERIFY-LIVE.sh --allow-model
```

脚本读取当前私有配置，不外发凭据，不自动重试付费任务。成功后仍须人工检查抽取内容和页面，以及重启后的同版本回读。任何未知结果先检查原作业，不直接重新提交。

## 数据迁移与回滚

总档初始化在 `createDossierStore` 中使用 `CREATE TABLE IF NOT EXISTS` 追加 `pd_dossier_*` 表；不覆盖 Core 状态或 Presentation 的 `project.json`。服务账号需有新表权限；PG 测试账号需可创建隔离 schema。

回滚采用部署前的代码版本与构建备份，并保留本次新增表及原件供恢复；不要在回滚中 DROP DATABASE/TABLE。先停 Web，再恢复明确的代码和构建快照，检查后启动同一服务。存在人工后续改动时先审阅，不能直接覆盖。

## 验收范围

本批接入 D01—D09 的有限资料链：文件/原话归并、来源约束、总档版本、更正、任务冻结和失效提示。矩阵中的其他技能不代表已接入。总档建立后的普通聊天保持只读讨论；专业修改走对应任务入口。整理需用户点击，不后台自动付费归并。

离线阶段已重新核验原接入包 52 份文件哈希；包测试 60 项，59 通过、0 失败、1 个真实 Fastify/PostgreSQL 测试明确跳过。同步流水线只验证它实际执行的项目，收执见 `SYNC_VERIFICATION.json`。真实 DSH、目标服务器、生产数据库、全量回归、97项业务验收仍须由本地环境证明。
