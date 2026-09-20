# 前期策划执行可靠性修复与验收

本页保留首次候选验证记录。后续运行时报错审查、执行保护及最新候选包见 [运行时审查](runtime-error-review-2026-09-16.md)，其中发布记录取代本页旧包哈希。

日期：2026-09-16。开发根目录：`E:\前期策划开发`。
分支：`feat/pre-v2.0.1`；远程基线：`6d77306a6229c44419cf3bcb5d8a7a976e24711b`。

本轮改动尚未安装到正式 DSH，不改变 `D:\shaotanhe` 项目、旧检出、正式配置和会话。没有提交或推送。

## 已定位的原因

1. 原执行器仅在“至少两个 ready 工作项且没有 running 项”时接管。单个首项、恢复中的首项会回退到主会话自由工具调用，绕开已有 Research、受限分析、质量检查和提交链路。现场确为 `preplan.wf.01.01`，不是已经走完整套策划。
2. 现场 DSH 的 Python 命令不可用；通用 `workflow` / `subagent` 调用还出现 `meta.name` / `prompt` 缺失。同级权限升级没有解决实际问题。
3. 部分所谓文件操作只有 `echo "[OK: Action logged ...]"`。这个占位命令已经存在于持久化的 assistant tool call 及流式参数中，不能认定是 PowerShell 改写。现有证据不能进一步区分模型生成与上游兼容网关改写。
4. 独立真实模型验证进一步复现：Research 已通过、模型质量为 `auto_pass` 后，中央提交器把 Research 的自由结构 locator 原样扩展进 v0.6 的封闭 `EvidenceRef.locator`，导致 `ProposalEnvelope validation failed`。原回归测试模拟了成功提交，未使用真实合同校验这一跨版本结构。

`preplanning_get_context` 在现场确实返回过合同和上下文；一次普通 `Write-Output` 也返回了真实文本。因此不能宣称“模型完全收不到工具结果”已被证实。

## 修复内容

- 单个 ready 和遗留 running 项统一进入现有受控执行器；优先恢复 running；不重复进行 running → running 转换。
- 子会话按当前工作项的完成条件、证据规则和禁止动作判断阻断，避免把后续场地分析等工作的前置条件提前强加给项目身份建立。
- 同一项目的执行批次去重；暂停后立即继续会等待仍在执行的批次，避免误报分析器不可用。
- 自动模式缺失 spawn 提供器时明确阻断；协调器异常记录为阻断，存储异常保留 `lastError`，不再留下未处理的异步异常。
- `preplanning_get_context` 增加当前 Session 工作区原始材料清单；增加 `preplanning_read_material`，支持 PDF 按页和 UTF-8 文本按行读取，返回 SHA-256、定位、输出截断和 OCR 需求。
- PDF 使用固定版本 `pdfjs-dist@6.3.289`；不依赖 Python 或 Shell。读取有文件大小、字符数、页数和工作区真实路径边界，支持取消。
- 缺少 Research 数据时列出缺失项并提示原文读取。材料正文视为证据，不能作为执行指令。通用调用纠错次数和禁止用打印代替实际操作写入 Agent 提示。
- Research 引用转为 v0.6 合同允许的来源定位、哈希、可靠性和采集时间；完整 EvidenceRecord 和 AnalysisTrace 保存在 `research.trace` 审计事件中。没有放宽合同或中央质量规则。

## 验证记录

新行为先添加失败测试，再修复并运行通过：单项/恢复、缺证据、提供器不可用、批次去重、暂停恢复、异常阻断；PDF/文本范围、扫描页、截断、大小、路径越界和取消；原生工具上下文和输出；Research 的工作区、网页和 Project State 定位转换使用真实 ProposalEnvelope 合同校验。

已通过：`pnpm typecheck`、`pnpm build`、`pnpm verify:alignment-versions`、`pnpm verify:presentation-contract`、`pnpm verify:automation-semantics`、`git diff --check`。

早期全量回归暴露的工具清单断言已随新增工具更新。另有 4 项测试碰到原有 5 秒超时，其所在 3 个测试文件以原始超时单独复跑，25/25 通过。最后一次全量回归将默认用例超时设为 15 秒，保持单 worker 和原有断言；显式规定的 Edge 测试超时不变。

最终回归命令：`node node_modules/vitest/vitest.mjs run --maxWorkers=1 --testTimeout=15000`。
结果：132 个文件、821 项测试，819 通过、2 失败（见 `work/verified-regression.log`）。其中一项是整理工作区时 Git 将 `SCHEMASET.sha256` 恢复成 CRLF；已在 `.gitattributes` 固定该文件 LF，并重新生成合同资源。随后工具链与打包检查 6/6 通过（`work/final-package-check.log`），包内文件与构建目录逐字节哈希一致。其余源代码未变，没有再次重复全量测试。

当前剩余失败仅为下文已在原始基线复现的打印矩阵断言；不宣称全量测试全部通过。

### 实际项目材料（只读）

- 路径：`D:\shaotanhe\source-materials\documents\少潭河水库“一库一策”方案.pdf`。
- SHA-256：`00983f354ed06aec04c4b54ff506002e496d067962120107912c69a53432aa7b`。
- 66 页；成功读取第 1–3 页，下一页 4，无输出截断。
- 第 1 页包含“新洲区少潭河水库‘一库一策’方案（2021-2025年）”“湖北省武汉市水文水资源勘测局”“二〇二二年六月”。

### 独立 DSH 与真实模型

隔离根目录：`work/verification-dsh`；仅使用合成测试项目。DSH 为已安装的 `0.1.5-rc.1`，验证进程使用 Node `v25.4.0`，模型维持 `antigravity / gemini-3.8-flash-high`，未切换模型。

使用真实 DSH core、agents、spawn、tools、storage 和构建后的插件。webServer 仅提供注册桩，不开启第二个浏览器服务。所需 provider 配置选择性复制到隔离 settings；密钥只传入隔离子进程环境，没有写入仓库或日志。正式 profile 和会话目录未修改。

第一轮产生真实子会话 `3479cab0-55b7-46e6-b94c-8b5953a0b843`，模型指出合成材料缺少负责人确认；中央质量系统正确阻断，revision 保持 0。

第二轮补全合成事实，产生真实子会话 `e1564e8a-52df-497d-9912-ba0e323dd7be`，质量 `auto_pass`，并复现上文 locator 格式错误，revision 保持 0。构建后的原生工具已通过 DSH 工具管线准确返回测试 PDF 第 2 页、页数和哈希。

中间验证还捕获了模型提前要求后续工作项红线资料，以及验证脚本遗漏所属 G1 授权范围的问题：前者补充当前工作项范围说明，后者仅修正测试授权配置。权限规则没有放宽。

最终验证成功：

- 父 Session：`session-98392466-318d-4ca3-84e7-0c478976ff2b`。
- 独立子 Session：`5abe942e-759c-41b5-aa04-f4ea57ae757d`，持久化 `parentSession` 指向上述父会话。
- 合成项目：`verification-afa72c7d-6c7f-443e-8dc0-486709dc37c3`。
- 真实模型调用 1 次，子会话产生 1 条 assistant message，唯一工具为 DSH 的 `structured_output`；没有 Shell、文件写入或递归子代理工具。父会话没有 model request / assistant message。
- 批次：`attempted=1, completed=1, blocked=0, needsHuman=0, revised=0, approvedGates=0`。
- `PS01` 已通过真实 Gateway 提交，revision 从 0 升到 1。
- 持久化审计 `proposal-030017f8-fa2d-4940-8484-c968c44e11d3:research-trace` 包含 3 条完整 EvidenceRecord 和 `trace-12fe549e4b53195dbb9891d9`，追溯到 3 个输入证据。
- 证据文件：`work/verification-dsh/result.json`、`work/isolated-dsh.log`、`work/isolated-session-evidence.json`、`work/source-material-verification.json`。前三轮和第四轮结果也分别保留在 `work/isolated-dsh-*-result.json`。

这是一个工作项、一个合成项目的真实模型验证，不代表整个 57 工作项流程、真实少潭河成果或每次模型运行均已验收。

### 候选包

- 文件：`work/release/architectureworld-dsh-preplanning-agent-2.0.1.tgz`。
- SHA-256：`d69a5dd17b9d479a3d2c029ea9544085a3e20e6f2bb9f38a77037f0e691339fb`。
- 包内 `lib/index.js` 与真实模型验证所用构建文件哈希一致：`22bd767ea5df846382d5b44bba5f855843c34a8c7b144f7773d356c785f46135`。
- 包内声明 `pdfjs-dist=6.3.289`。依赖锁仅增加 PDF.js 及其可选 canvas 依赖，没有升级 DSH 依赖。
- 包版本仍为分支既定 `2.0.1`，是本地候选包，不是新发布版本。

## 已知边界

- 原生 PDF 读取不等于自动事实入库。目前自动 Research 仍从结构化 JSON/GeoJSON 中提取精确字段；尚未把任意 PDF 正文自动转换为经过业务确认的 Research facts。
- 扫描 PDF 仅明确提示 OCR 需求。本轮不增加 OCR、DWG、Office 或压缩包解析。长页/长行的内容截断会显式标记，不能宣称全文已读。
- 主会话通用工具的“两次纠错”是提示约束，不是 DSH 全局强制熔断；自动工作项的子会话则禁止一般工具，仅允许结构化结果提交。
- 打印回归中的固定第 28 页“时段—客群矩阵”断言在未经修改的基线 `6d77306` 上同样失败，证据见 `work/baseline-original-print.log`。本轮没有改动报告版式来掩盖该已有问题。
- 正式 DSH 此前以 Node 22.22.2 启动，低于插件声明的 Node >=24.11.0。本次真实验证使用 Node 25；没有替用户更换正式启动器。正式部署需核对启动环境。
- 上游模型/兼容网关的占位命令成因没有被本插件修复所证明消除。已验证范围是受控工作项链路及原生资料读取。

## 正式部署

候选包准备好后，由用户确认本次安装与重启，再备份当前插件及 profile、安装指定哈希的包、核查实际 Node 版本、重启并验证原生工具和业务状态。不得将隔离验收描述为正式少潭河会话已修复。
