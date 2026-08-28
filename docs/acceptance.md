# DSH 前期策划插件 0.7.0 验收记录

更新时间：2026-08-28（Asia/Shanghai）

## 结论

`@architectureworld/dsh-preplanning-agent@0.7.0` 已通过三个相互独立的验收层：

1. **真实 DSH Host/UI**：0.7.0 已使用官方 CLI 安装到 Web Profile，`http://127.0.0.1:3080/` 正在监听；页面显示“插件正常运行”、8 章 57 项、人工确认模式，以及 `antigravity / gemini-3.1-flash-image` 概念表现图路由。创建面板同时提供“人工确认”和“全自动完成”。
2. **自动化闭环**：40 个测试文件、97 项测试全部通过；类型检查、构建、构建产物回归、下载路由和三格式报告按钮通过；`contracts/v0.6` 合同门禁 949/949 通过。
3. **Golden 甲方成果**：同一 Revision 57 冻结成果已真实生成 HTML、PPTX、PDF，覆盖 57/57 工作项、8/8 Gate、12 条视觉记录和 17 张确定性图表。PowerPoint 原生渲染为 42 页，PDF 渲染为 64 页，均完成溢出和关键页面视觉检查。

## 必须保留的验收边界

真实 DSH 页面中当前绑定的项目仍为 **Revision 0、0/57**。它已恢复 11 张采用图和 1 个视觉阻断，但尚未满足发布条件，因此页面如实显示“尚未发布”，没有报告下载链接。

Golden 项目是用于证明完整 57 项、8 Gate 和三格式报告链路的确定性验收夹具。它不能冒充真实 Session 已完成，也不能证明当前实机项目已经走完 57 项。真实 Host/UI 验收与 Golden 报告闭环在本记录中始终分开陈述。

## 分层结果

| 层级 | 状态 | 证据 |
| --- | --- | --- |
| DSH 版本与监听 | 通过 | DSH `0.1.1-rc.2`；`127.0.0.1:3080`；当前监听进程为 Node |
| 官方插件安装 | 通过 | Web Profile 中安装包版本为 `0.7.0`；旧 `0.2.0` 包和安装前备份保留 |
| 真实 Host/UI | 通过 | 页面显示“插件正常运行”、8 章 57 项、人工确认、文本模型继承当前 Session、生图固定走 Gemini 路由 |
| 双模式入口 | 通过 | 新建项目面板可选“人工确认”或“全自动完成”，默认恢复为人工确认 |
| 状态恢复 | 通过 | 11 张 adopted、1 个视觉阻断已恢复；未修改 Session、Storage、模型设置或凭据 |
| 单元/集成测试 | 通过 | 40 个测试文件、97/97 测试通过 |
| 类型与构建 | 通过 | `pnpm typecheck`、`pnpm build` 均退出码 0 |
| 构建产物回归 | 通过 | built package 2/2 通过 |
| 合同 v0.6 | 通过 | 949/949 通过 |
| 报告生成 | 通过 | HTML、PPTX、PDF 同源生成；PPTX 42 页，PDF 64 页 |
| 视觉质量门禁 | 通过 | PowerPoint 42/42 页原生渲染；PPTX 溢出检查通过；PDF 64/64 页渲染并检查关键页 |
| 实机项目发布 | 未完成 | 当前为 Revision 0、0/57，报告下载入口尚未出现；这是预期的治理门禁 |

## 发布成果

发布目录：

`C:\Users\2899\Documents\Codex\2026-08-27\yue-du\outputs\dsh-preplanning-0.7.0`

安装包：

- `architectureworld-dsh-preplanning-agent-0.7.0.tgz`
- SHA-256：`0215FB43C9B8404B2A9928020FEED9EC15D57EC700E259FDDB1C3D509776FE8C`

Golden 甲方成果：

- HTML：`golden-project/html/index.html`，SHA-256：`E22A5A45B3708F35DEAC7090277C0BAC213C7390EE593BFFF0CA4C37DFC5C5FF`
- PPTX：`golden-project/report.pptx`，SHA-256：`C570C9FF922BD36E7172C4569CE138F086D5EF1781CA8B0E69C215519989AEC7`
- PDF：`golden-project/report.pdf`，SHA-256：`DAB7D7C6FA02710B373BDF173B7D3DAD674C027A1111E975E72EBE8D50A79730`

安装前 Web Profile 备份：

`work/profile-backups/web-20260828-2112-v070-preinstall`

## 证据索引

- [D0 Host/Browser](../evidence/d0/2026-08-27-host-browser.md)
- [D1 Qwen3.8 人工确认闭环](../evidence/d1/2026-08-28-qwen3.8-confirmation-closure.md)
- [D2 Gemini 直接使用验收](../evidence/d2/2026-08-28-direct-use-acceptance.md)
- [D3 0.7.0 全流程验收](../evidence/d3/2026-08-28-full-flow-acceptance.md)
- [D3 真实 DSH Dashboard 截图](../evidence/d3/2026-08-28-dsh-dashboard-v0.7.0.jpg)
