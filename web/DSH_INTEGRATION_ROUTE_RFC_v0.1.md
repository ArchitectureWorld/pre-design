# Web V1 × DSH 真实接入技术路线（RFC v0.1）

> 状态：**技术路线候选稿，待实机 P0 验证后冻结**。本文件不代表 DSH 对接已经运行成功。  
> 日期：2026-11-03  
> 工作分支：`web_V1`（原型入口 `web/index.html`）  
> 现有稳定主线：Pre-design 2.0.2 / DSH `0.1.5-rc.1` / Presentation Standard Project Directory `0.1.0`  
> 独立研究开发分支：`v2.1.0`（8章62项规划，仅部分研究子模块已实现；不可宣称完整62项已运行）

## 1. 不变的产品目标

- 浏览器是唯一用户入口：项目总览、创建、上传、首轮问询、章/节、文字脚本、成果、批注、批量提交与历史归档。
- 项目文件全部存放服务器，由项目服务自动创建指定根目录下的 `<创建人>_<项目>`；不做本地自动同步。
- DSH 只充当后台 Harness：模型、会话、Agent、Tools、Skills 和执行事件；用户不能在 Web UI 选择/任意配置 LLM。
- 现有标准项目目录、稳定 ID、资料来源、Revision/CAS、外部修改保护保持不变。
- 初期只做一个真实项目全链路闭环，不能以演示数据代替实际 Agent 结果。

## 2. 技术选型和边界

| 模块 | 路线 | 数据权威 |
|---|---|---|
| Web UI | 将 V0.9 行为逐步组件化为 React + TypeScript；保留已确认的视觉与交互语义 | 仅交互草稿与选择状态 |
| API 服务 | Node.js + Fastify + Zod；HTTP 上传/查询/写入指令、SSE 流式状态 | Web 业务记录 |
| 数据库 | PostgreSQL；用户、项目索引、RBAC、文件账本、任务、批注与历史 | 平台元数据 |
| DSH Worker | 官方 `@deepseek-ai/dsh-sdk-client`，每项目受控 SDK runtime，stdio JSON-RPC | DSH Session / Agent 事件 |
| Pre Core | 保留并拆出 `pre-design` 领域服务，SDK profile 内运行；Web 专用 Slot 和 HTTP Route 拆成可选适配器 | Pre 专业状态/Revision/Gate |
| Host 控制 | 受控本机业务桥接层：只暴露受限的项目建立/绑定/状态/审批操作；不使用 DSH 原生 Web 内部私有 API | Pre Core |
| 文件处理 | 上传原件原样保留；PDF/文本复用现有 reader；Office/图文提取评估 MarkItDown / Docling，保存页码/素材引用/原件 Hash | 服务器项目目录 |
| 成果表达 | 结构化脚本/页面数据为工作母版，HTML 用于交互、PPTX/PDF 作为导出 | Presentation Contract `0.1.0` |

外部调用不能直接写 `ProjectRepository` 持久化文件、`project.json` 或标准 `pages`，必须经 Pre Core/Writer/Gate 写入。Report Studio 当前 `local-single-user-only`，不可直接把旧监听端口开放到局域网。

## 3. 运行架构

```text
浏览器（V0.9 行为）
    └── HTTPS / REST + SSE
          └── Web API（身份、项目权限、任务队列、批注、文件账本）
               ├── 数据库（平台业务状态）
               ├── 上传/标准化服务 → 项目目录/原始资料
               ├── 受控 Pre Core 桥接（确定性业务操作）
               └── DSH SDK Client（Agent prompt / event / session）
                      └── dsh --profile sdk（独立 Worker）
                            └── pre-design Host/Core
                                  ├── Research / Gate / Revision
                                  └── Presentation Standard Project Directory
```

推荐每项目一个受控 Worker 及独立 `DSH_HOME`，按需启动、闲置释放；同项目任务写入串行化。实际并发与冷启动开销须测试后确定。切勿把整个浏览器群体直接连接到 DSH Web Profile。

## 4. 文件与身份

```text
<服务器根目录>/
  <创建人>_<项目>/          # 命名可读，内部身份必须以项目 UUID 为准
    原始资料/
    project.json
    rules.json
    outline.json
    pages/
    source-materials/
    assets/
    layouts/

<服务器私有数据根目录>/dsh-homes/<projectUUID>/  # 不在项目可见目录
```

- `ownerUserId`、`projectId`、`dshSessionId`、`workspaceRoot`、`dshHome` 有明确映射。
- 文件夹名仅供展示；同名冲突通过稳定项目 ID 处理。目录建立后不随显示名称随意移动。
- 用户上传全部成功、SHA-256 校验完成后，才提交“首次资料处理”任务；失败不得报告已归档。
- `原始资料` 原件不可由 Agent 静默替换/删除；标准化产物进入 `source-materials` 和索引。
- 预防路径穿越、软连接逃逸、文件覆盖和压缩包炸弹；下载仅经 API 权限鉴定。
- **同步不等于备份**：服务器采用独立备份、快照及恢复测试。

## 5. Web UI 与后台事件合同

业务 API 先用以下资源，不提前暴露 DSH 原生对象结构：

- `POST /api/projects`：建立项目与目录（资料为空时保持待上传）。
- `POST /api/projects/:id/materials`：上传原件、校验、写入账本。
- `POST /api/projects/:id/intake/commit`：提交标准化和首次解读任务；幂等。
- `GET /api/projects/:id/state`：章/节/文字脚本/页面成果树，含发布 Revision 和状态。
- `POST /api/projects/:id/chat`：进入当前项目已绑定的受控 Session；由后台选择模型。
- `GET /api/projects/:id/events`：SSE 订阅任务/Agent/成果更新；断线可按事件序号续读。
- `POST /api/projects/:id/annotations`：保存批注（不执行 Agent）。
- `POST /api/projects/:id/annotations/batch-submit`：固定提交批次与基线 Revision，执行异步修改。
- `GET /api/projects/:id/annotations?scope=pending|history`：未提交与历史批注严格分离。

所有写操作必须有 `userId/projectId/requestId/baseRevision`；重放返回同一结果，不重复创建项目、收费或生成。批注锚点使用 `nodeId/sectionId/scriptId/pageId`，图文选区附带元素 ID、文字引文或归一化区域，不能只靠像素坐标。提交批注前仅保存；批次进入执行、完成或失败状态后有审计记录。

DSH SDK **只承担 Agent 对话与事件传输**。现有 SDK JSON-RPC 方法不等于 pre-design 项目 API；确定性“建项目、绑定、审批、查询领域状态”必须通过受控 Host 桥接。不能把自由文本提示词输出当成事务提交凭据。

## 6. DSH 版本与兼容性策略（首要 P0）

现有 `pre-design` 固定于 `0.1.5-rc.1`，而截至本 RFC，官方新候选为 `0.2.1-rc.5`。不得把当前 Web profile 的 `DSH_HOME` 原地拿来升级。测试采用新建隔离的目录、包和数据库。

| 核查项目 | 0.1.5-rc.1 | 0.2.1-rc.5 |
|---|---|---|
| SDK stdio / 任务事件 | 官方文档已有 | 官方文档已有 |
| 持久 Session 原 ID 恢复 | 该版协议未声明 `session/resume` | 官方协议声明支持 |
| `session/wait` | 该版协议未声明 | 官方协议声明支持 |
| 当前 pre-design Host 是否可直接载入 | **待验证：必需 `webServer` 是已知阻碍** | **待适配与验证** |
| 取消正在运行的 Prompt | 官方协议无该方法 | 官方协议仍无该方法 |
| 插件运行与版本锁定 | 现有主线已按该版验证 | 不能视为已兼容 |

决策：**以 `0.2.1-rc.5` 为候选目标版本、`0.1.5-rc.1` 为兼容对照基线**。只有在独立环境中跑通 Host/SDK/数据/恢复的门禁，才锁定正式 Web V1 的实际运行版本；如果失败，先修适配层，不进行生产存储的跨版本迁移。

注意：SDK 的任务超时、网络断开或取消订阅不会自动撤销实际写盘。第一阶段不得把“停止显示”当成“Agent 已停止”；必要时结束专属 Worker 并从安全快照检查后恢复。

## 7. 对现有 pre-design 的最小侵入式改造

当前 `src/index.ts` 的 `inject` 将 `webServer` 列为必需，且注册下载、打开服务器目录等 Web 专属路由。目标改为：

1. **Host/Core**：依赖 DSH Tools、Session、Storage、LLM、Workspace 等执行服务，注册 pre-design 专业能力；无 Web UI 要求。
2. **Web-only Adapter**：保留旧 DSH 插件 UI、Report Download Route、文件管理器打开路由，仅 `web` profile 装配。
3. **SDK Adapter**：装配 Host/Core、SDK RPC Server、预设模型和受控项目业务桥；不装载 DSH Web UI。
4. 保留已有 `preplanning_apply_commands`、Revision/Gate、Workspace Writer、外部文件修改检测及 Contract 验证。
5. 不在 Web V1 直接重做 57/62 项专业执行器；`v2.1.0` 后续通过独立合同与兼容性测试接入。

## 8. 实施 Gate

| Gate | 交付物 | 通过条件 |
|---|---|---|
| P0-A 版本/进程 | 两版本隔离的 SDK smoke、启动/关闭/事件/会话恢复对照记录 | 实测结果明确；失败停止 |
| P0-B 插件装配 | SDK profile 能载入精简后的 pre-design Host，读取受控 Workspace | 无 `webServer` 注入错误，工具已注册 |
| P1 项目与资料 | Web 创建→服务器建目录→上传 PDF + PPTX→登记来源/Hash→Agent 解读 | 来源可定位，不能出现虚构分析 |
| P2 首轮交互 | 首轮缺项问询→人机确认→真实章/节与文字脚本 | 项目可恢复、同名不重复、资料不丢失 |
| P3 成果与批注 | 脚本确认→HTML 页面生成→缩略图/整册→保存批注→统一提交 | 修订 CAS、批次状态及历史隔离正确 |
| P4 可靠性与安全 | 浏览器断开、Worker 崩溃、同时请求、跨项目访问、回滚 | 不越权、无重复修改或不一致成品 |

每 Gate 必须保存：固定提交与依赖版本、实际命令、测试日志、真实文件/样本、失败条件和可复现步骤。单元测试通过不能替代 DSH 实机集成验收。

## 9. 不能提前宣布完成的事项

- 当前仅有 V0.9 前端原型与既有 DSH 插件；**尚未完成 SDK 装配的真实对接**。
- 当前材料 reader 只原生读 PDF 与 UTF-8 文本；Office/CAD/OCR 必须单独实现或整合可靠的转换器。
- `presentation-tools` 现有 `local-single-user-only` 不能直接对外开放。
- DSH 仍是 Developer Preview，所有版本升级都可能需要修改插件和 Session 数据迁移。

## 10. 来源

- 官方 SDK（0.1.5-rc.1）：https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.1/packages/sdk/protocol/README.md
- 官方 SDK（0.2.1-rc.5）：https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.5/packages/sdk/protocol/README.md
- 官方 TS Client（0.2.1-rc.5）：https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.5/packages/sdk/client/README.md
- 现有 pre-design Host：https://github.com/ArchitectureWorld/pre-design/blob/web_V1/src/index.ts
- 当前 Pre 模型与标准目录：https://github.com/ArchitectureWorld/pre-design/blob/web_V1/README.md
- Report Studio 安全边界：https://github.com/ArchitectureWorld/presentation-tools/blob/main/README.md

---
**实施建议**：先实施 P0-A + P0-B，实测 SDK 与 Pre Host 的装配，之后才启动任何大规模 Web 后端重构。
