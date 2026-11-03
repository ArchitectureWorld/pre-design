# Linux Web 接入验收记录

日期：2026-11-03。状态：最小真实闭环验收，未发布。所有修改在本地工作树，未提交/推送。

## 界面约束

用户明确要求“已经设计好了一版原型，不要有大的改动”。已移除本轮临时新增的React替代页面，直接使用`web/index.html` V0.9。原型文件git diff为空。构建时原CSS逐字相等，DOM节点ID序列相同；仅移除模拟业务数据、连接真实API，并更正“演示”等状态文案。身份输入使用同一套原型玻璃面板。

原图谱、分栏、归拢/全展开、明暗配色、缩放、预览和选中批注仍用原型实现。实际仅有一个专业对象时显示一个对象，不以原型假数据凑满4章8节。

## 真实链路

- 模型：yaoguang-codex / yaoguang02-gpt-6-astra，官方SDK0.2.1-rc.5、Node24.22.2；凭据仅引用本机受限文件。
- 项目：Web实机验证 · 社区服务中心（明确隔离验收样本，非真实委托）。Web ID `1b050fe9-977a-4212-9e23-6b2b775a91a2`。
- 创建受控SDK Session与标准项目目录，上传真实TXT任务书；模型通过材料工具读取原文。
- 首次分析因缺少原件引用ID拒绝提交提案。补齐真实上传账本后，模型提交PS01提案；原型预览确认后Core升至Revision1。
- 在原型里引用文字并保存批注，确认保存时任务数不变；统一提交一次产生一个真实Agent任务及修订提案。
- 原型确认修订后Core升至Revision2，批注状态completed；API和PostgreSQL重启后保持原项目、原会话与版本。
- 源文件/标准目录均由现有Core与Writer/Gate路线管理，未直接伪造专业状态文件。
- 独立SDK smoke另验证真实受限子Agent启动，以及关闭进程后恢复原Session历史。

证据（本机忽略目录，含隔离样本）：
- `.cache/dsh-p0/run-9iyIiM/report.json`：新版SDK、Host、真实受限子Agent、会话恢复。
- `.cache/web-e2e/state.json`：Revision2、两份已确认提案、一条已完成批注。
- `.cache/web-e2e/annotation-submit.json`：保存批注未运行模型，批量提交产生一个任务。
- `.cache/web-e2e/prototype-*.png`：原型总览、创建、图谱、提案及批注界面。
- `.cache/web-e2e/worker-crash-recovery.json`：单项目Worker崩溃后的原会话恢复，未重放任务。

## 检查与审查

- 根项目typecheck、构建通过。专业全量：2068通过、6跳过、1项既有冷启动用例超过5秒（5233ms）；仅该用例改为15秒后，该文件40项全部通过（60.49秒），结果见`.cache/visual-cold-recheck.log`。没有把这次全量命令记成全绿。
- Web使用Node test，六个测试组通过，覆盖真实PostgreSQL、权限、幂等、原件Hash、批注生命周期、核心恢复、Worker清理、网络丢失收执、导航竞态，以及原型CSS/DOM保持。
- Playwright验证原型总览→图谱→真实提案预览→确认、保存批注→批量提交、主题切换、归拢展开、迟到响应不得覆盖返回总览、再次打开项目与历史批注。
- 一次独立代码审查，4项重要问题经红绿回归修复。没有第二次独立复审；最后由实现者运行验收。

保留限制：完整57项报告、Office/CAD/OCR、全册图文编排和导出尚未接通本Web入口；当前展示的已确认成果是专业文字状态，不是完整设计图文报告。项目总览的更新时间仍以创建时间为准。身份为本地配置的用户令牌，未做注册/密码管理界面。当前已开放局域网HTTP体验；HTTPS部署与完整备份恢复尚未验收。


## 2026-11-03 局域网体验入口

- 本机私有配置改为 `0.0.0.0:4318`，当前物理网卡地址 `192.168.6.45/23`；访问仍需用户令牌，数据库和 Worker 不开放网络端口。
- 修复普通 HTTP 缺少 `crypto.randomUUID` 的问题：使用 `crypto.getRandomValues` 生成 UUIDv4，覆盖创建、上传和变更请求；布局与原型文件未修改。
- 回归先复现 `crypto.randomUUID is not a function`，修复后 Web 7 项测试、构建和语法检查通过。
- 本机浏览器通过局域网 IP 实测：未认证 API 返回401、令牌登录、新建入口、已有项目 Revision2 读取通过，页面错误为零。证据 `.cache/web-e2e/lan-workspace.png`。没有声称已从另一台物理设备测试。
- 本机浏览器系统代理曾导致 LAN 页面加载失败，测试使用直连；体验设备如启用代理，应将此局域网地址设为直连。当前是可信内网 HTTP 体验入口，正式部署使用 HTTPS。


## 2026-11-03 从局域网页面新建的真实运行复验

- 硬盘核实：项目位于 `/dev/sdb1` 的 ext4 挂载分区，`findmnt` 显示983.2G，总体对应用户的1TB数据盘；本次检查可用883.4G。
- 首次独立样本 `e55e46d2-ebc2-431e-b60d-0c5bb2e9cc3c` 成功调用真实模型并生成提案，但预览缺少实际quality.issues，且模型误填历史时间。该诊断提案保留pending_review，未确认。
- 修复：原型既有“研究依据 / 缺失项”侧栏展示实际quality.issues（包含待确认及已确认对象）；每次模型任务传入当前服务器UTC时间及新旧对象时间规则。后者是时间依据提示，并非系统强制重写或校验全部模型时间字段。
- 两项回归均先失败再通过。最终Web八项测试、构建和JS语法检查通过，原型文件SHA256保持 `c7213df3f3a63d8d4bd6084524e057b28fdbb4ae99b803110257719733c0939e`。
- 复验项目：“局域网实跑验证·社区阅读空间（复验）”，Web ID `fdffa554-219a-487f-900b-853cbccd95c6`。输入为明确标注的模拟任务书，非真实委托。
- 实际从 `http://192.168.6.45:4318` 浏览器创建并上传；调用 `yaoguang02-gpt-6-astra`，持久会话记录一次get_context、一次read_material、一次apply_commands。
- 模型首轮产生待审PS01；本次提案时间 `2026-11-03T05:50:48.779Z` 与服务器任务时间一致。浏览器预览包含模拟声明及860平方米未核验限制，确认后Revision1，两个任务均completed。刷新重开项目仍为Revision1，浏览器错误为零。
- 原件SHA256验证一致；标准 `project.json`、`outline.json`、`pages/manifest.json`、`source-materials/manifest.json` 及两个页面草稿文件均存在且为有效JSON。标准草稿存在不代表完整图文报告已完成。
- 证据：`.cache/web-live-20261103-recheck/` 下的 `run.log`、`result.json`、`state.json`、`storage.json`、`proposal.png`、`confirmed.png`。首次诊断保存在 `.cache/web-live-20261103/`。
- 范围仍是PS01真实闭环；未声称完整57项流程、Office/CAD/OCR和全册导出已接通。本次没有额外重跑此前已验收的批注修订链路。
