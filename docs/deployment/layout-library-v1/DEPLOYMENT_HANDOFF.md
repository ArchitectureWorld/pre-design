# 原生版式库 V1 — 本地部署交接

## 本批交付

代码直接接入现有 Web、PostgreSQL、任务队列、模型策略和 DSH。不是独立演示页或第二套生产后台。

- 用户与开发者共用版式库；没有当前业务项目也可以创建、批量导入、试排和发布。
- 三套原创主题候选、每套五种原生布局（要点、双栏、重点、左图右文、数据表）；预置为草稿，不绕过发布检查。
- 资源默认私有，候选版本不可变；发布必须通过实际浏览器检查和人工确认。共享/官方资源由管理员发布，其他用户的资源还需其本人提交共享申请。
- 全局/局部/显式人工属性覆盖；保存配置不等于应用。应用后生成新成果版本，保存实际规范、资源引用、检查和固定HTML。旧下载不随库更新改变。
- 正文、数据和项目图像不进入可复用资源；保存页面变体只保存规则，记录父资源版本。
- 原生JSON与PPTX结构导入；PPTX只读取可核实主题色和文本占位结构，不拷贝图片/文字/Logo/字体文件，不声称母版保真。原件私有保存。
- V14文字参考提炼使用现有平台模型政策的独立、无项目、无工具DSH会话；候选仍需检查/人工确认后才可发布。
- 同一原生契约由V07/V08/V10/V11/V12/V13和Q07使用。映射见 `web/app/src/layout-library/skill-bindings.json`，V14在现有矩阵中登记。

## 明确的V1边界

画布为1600×900，已声明的交付格式只有HTML。可打印不等于已认证PDF；旧“对外报告PDF”仍是独立文字报告，不冒充视觉导出。原生可编辑PPTX、PDF/截图风格视觉识别、品牌字体文件导入、混合图表照片同页、任意自然语言批注自动转布局补丁未实现。

单页支持标题、主结论、要点以及独立图片或结构化表格之一。图片必须为本项目已登记核验原件；超过容量时拒绝生成新版本，回到脚本/版式修改，不暗中丢数据、缩成不可读字号或自行加页。

本版提供点击操作等效入口，没有拖拽绑定。人工保护仅指明确保存的结构化覆盖，不把待处理批注当作已生效修改。库查询暂为小中型资源集合，超大规模检索和组织租户分组后续完善。

## 安全部署

1. 检查 `AGENTS.md` 和 `web/app/LAN-ACCESS.md`。固定现有 Web HTTP4320 / DSH HTTPS3080；不另启后台、不修改私有模型配置、原件、项目资料或共享数据库目录。
2. 备份现有代码提交号、`web/app/dist`、私有配置、数据库及原件/成果。检查未提交改动；有冲突先审阅，禁止 `reset --hard`、强推和清空目录。
3. `git fetch origin codex/web-v210` 后在干净工作区快进更新。使用现有配套 Node >=24.11.0。
4. 原生试排新增直接运行依赖 `playwright-core@1.58.2`；`web/app/package-lock.json` 同步更新。在 `web/app` 执行 `npm ci`（仅变更锁定依赖，不安装新的浏览器）。沿用已有 Chrome/Chromium 以及 `src/report/browser-executable.ts` 的路径选择。JSZip/Sharp沿用根项目锁定依赖。
5. 检查服务账号具备追加表权限。启动只新增 `layout_*` 表、`jobs.owner_id` 及请求唯一索引，不删除/重写既有项目表。独立库任务的 `project_id=NULL`，以 `owner_id` 参与原有配额/调度。
6. 先跑下列测试和独立构建，成功后按原部署方式替换构建并重启同一个Web服务。不要重启DSH或共享数据库。

```bash
export PATH="$PWD/web/worker/node_modules/node/bin:$PATH"
node --test web/app/tests/layout-library*.test.mjs
# 必须提供测试数据库配置，才会运行完整服务器/调度器PG测试。
# PRE_DOSSIER_TEST_DATABASE 是 JSON 配置；使用独立随机 schema，账号需要 CREATE SCHEMA 权限。
# 不把真实凭据打印到日志或提交Git。
node --input-type=module <<'NODE'
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const config=JSON.parse(readFileSync('.local/web/config.json','utf8'));
const r=spawnSync(process.execPath,['--test','web/app/tests/layout-library*.test.mjs'],{
 shell:true,stdio:'inherit',env:{...process.env,PRE_DOSSIER_TEST_DATABASE:JSON.stringify(config.database)}
});process.exit(r.status??1);
NODE
PRE_WEB_BUILD_DIR="$PWD/.local/layout-library-build-v1" node web/app/build-prototype.mjs
```

不要在生产设置 `PRE_LAYOUT_TEST_NO_SANDBOX=1`。此变量仅供隔离的root测试容器；生产以普通用户运行且启用Chromium沙箱。无浏览器或沙箱不可用时明确返回503，不允许跳过检查发布。

## 本地用户验收

登录后点击顶部“版式库”。管理员在无当前项目时：预置3套候选 → 打开一套 → 检查实际页面 → 确认授权和参考适用性 → 发布为官方资源。换普通账号检查只能看到已发布共享/官方与本人私有资源。

已有确认整稿的项目：版式库 → 当前项目应用 → 选择全局资源 → 保存 → 状态应为待应用 → 应用到成果 → 预览/下载新HTML。字体/颜色/布局必须真变，而不是仅保存配置。局部修改一页，保存人工标题颜色；换全局/移除局部时人工设置仍保留。旧成果下载字节保持不变。

从满意页面保存变体后导出JSON，检查没有项目正文、数据表、图片及客户名称。导入同一资源到另一用户仍为私有候选，不继承原资源的发布或QA状态。

V14真实DSH验收需明确允许一次模型调用：填参考文字和名称 → 发起提炼 → 查看独立任务终态 → 候选预览/校验/修改/发布。不创建业务项目、不读取其他项目、不得自动重复付费调用。取消、坏响应和模型不可用必须明确记录。

## 回滚

回滚前停止新提炼入队，取消或等待 `kind='layout-reference'` 队列结束；确认没有执行结果未知的模型任务，再停止Web。恢复部署前代码和构建副本，保留新增表、资源原件、库任务与已发布HTML；不要DROP表或删除数据。旧代码不会消费新增独立库任务，因此不能把仍排队的库任务遗留给旧调度器。

## 验收分层

程序结构、SQLite离线、真实PostgreSQL、浏览器操作、真实DSH调用、用户业务接受分别记录。仓库测试的模型返回是受控替身，不等于真实模型效果。目标服务器和真实DSH仍由本地Agent执行并报告。
