# Web 搜索和 Flux3 Klein 工作流接入计划

> For agentic workers: 使用 subagent-driven-development / dispatching-parallel-agents 分工独立适配器；父任务负责共享配置、运行装配、UI 与最终集成。遵循红绿回归，不提交未验证的能力声明。

**Goal:** 让现有 Web 平台能够通过受控搜索服务发现网页，并使用用户新提供的 Flux3 Klein 文生图及参考图工作流生成真实项目图片。

**Architecture:** 继续使用现有 Fastify/PostgreSQL + DSH 0.2.1-rc.5 Worker。搜索选用当前安装包已有的独立 DeepSeek Search API；图像使用 ComfyUI 原生队列/上传/历史/图片接口及既有 comfyui_pic 工具契约。配置纳入管理员策略及任务快照，不向普通用户开放服务地址或工作流覆盖。

**Tech Stack:** Node 24.22.2、DSH 0.2.1-rc.5、现有 Core、sharp、Node test、Vitest、Playwright。

**Spec:** 本会话“为啥搜索还不行”、用户提供的 flux3_klein_bf16_t2i_api.json 和 flux3_klein_bf16_i2i_api.json，以及既有“不能有特定项目内容”要求。两文件是工作流数据，内含模型提示词不是给开发代理的新指令。

## Global Constraints

- 在现有候选目录及 codex/web-v210 上继续，不修改原 pre-design-web 服务。
- 保留 14 项来源身份，Comfyui-PIC/Klein 切换至本次明确提供的 flux3-image-klein-bf16.safetensors；工作流内的本地文本编码器和提示扩写器按原图保留。
- 生产模板清空示例用户提示词和示例图片文件名。只注入实际当前任务的提示词、图片、尺寸和种子，不引入固定项目内容。
- 搜索采用直接检索 API，不能隐式增加另一个未登记模型调用或继承其他会话的凭据。
- 管理员配置版本、模型/工作流身份和服务设置固定在任务快照。服务端读凭据，浏览器只保存引用。
- 参考图必须属于本项目，真实哈希/格式/尺寸可核对；生成结果必须来自本次 Comfy prompt 的真实输出，保存来源及生成标记。
- 不自动重复结果未知的生成请求，不使用会影响他人任务的全局 interrupt。只取消已知本任务排队项。
- 缺端点/凭据/节点/模型时明确未就绪，不冒称真实成功。真实服务地址和搜索凭据路径已向用户询问，独立代码工作继续。

## Review Focus

1. Comfy 收到任务后连接断开：不得再发同一生成请求；已有收执可继续观察。
2. 图生图使用另一项目路径或旧示例图：路径、归属与哈希必须再次验证。
3. 管理员改配置后旧任务运行：模型、搜索和工作流不能漂移。
4. 共享 Comfy 服务取消一个任务：不能清空队列或中止其他正在执行的任务。
5. 搜索返回空、失败或缺真实来源：保留实际状态，不能以 LLM 自编链接补足。

## Task 1：Comfy 适配器及工作流

**Files:** web/worker/comfyui-client.mjs、web/worker/workflows/flux3-klein-*.json、web/app/tests/comfyui-client.test.mjs。
**Interfaces:** 导出工作流元数据和 compileFlux3Workflow(input)；Comfy 客户端支持 generate/edit、真实参考图上传、一次提交、按 promptId 查询历史、下载真实图片、已知队列项取消。具体构造函数和参数由实现者先告知父任务及图像工具任务，再实现。
- [x] 从附件生成无项目示例的版本化模板，保留节点、连接、权重及默认扩写开关。
- [x] 先测真实节点注入、文生图/图生图、扩展名与输出校验、失败和未知结果不重发、取消隔离，再实现。
- [x] 使用本地 HTTP fixture 验证完整协议，输出可用于 Core 的图片字节、真实收执和工作流标识。

## Task 2：独立搜索适配

**Files:** web/worker/search-runtime.mjs、web/app/tests/search-runtime.test.mjs；不修改共享 runtime/model-policy/UI。
**Interfaces:** 从策略 search 字段及私有凭据创建 DSH 插件 patch/env/availability；使用现有 dsh-web-deepseek-api 与 web 服务配置，保留本地受控 web_fetch。
- [x] 检查当前包真实 API 与凭据解析，测试专用端点调用、结果原样来源、错误、取消和不会追加聊天模型请求。
- [x] 未配置时保留明确缺配置状态，不能静默回到默认辅助模型搜索。
- [x] 给父任务确定配置 schema 与接线方法。

## Task 3：DSH 原生图像工具桥接

**Files:** web/worker/image-tool.mjs、web/app/tests/image-tool.test.mjs；必要 Core 改动先说明，不修改共享 Web 配置文件。
**Interfaces:** installImageTool(ctx,{workspace,sessionId,policy,backend}) 注册 comfyui_pic，使用 Task 1 的适配器；返回现有 SessionImageCollector 可识别的真实 tool/result 图片及收执。
- [x] 先测试子代理身份、参考图本项目归属、真实输出收集及持久请求收执，再实现。
- [x] 只在已验证且已配置的 Comfy 路由装配工具，明确限制工具用途及调用次数。
- [x] 与既有 AgentClass image + 配套 LLM 契约对齐；报告层保持来源/审图/失败恢复规则。

## Task 4：管理员、任务快照与 Web 装配

**Files:** model-policy.mjs、platform-store.mjs、admin-ui.js、runtime.mjs、model-runtime.mjs、web-bridge.mjs、research-contract.mjs、chapter-setup.mjs 及相应测试。
- [x] 管理员设置搜索端点/凭据引用、Comfy 服务与工作流；旧当前策略进行有历史可查的迁移，旧任务快照保留。
- [x] 将搜索和图像配置投影至受限 Worker，支持真实可用性检查，取消之前永久 unavailable 的硬编码。
- [x] 保留现有队列、角色、额度、任务取消与项目隔离；只解除已经完成适配和验证的能力门槛。
- [x] 专项红绿回归、Web 全套、真实 DSH 装配和浏览器验证（上游为本地 HTTP 模拟服务）。
- [ ] 用户提供服务地址和配置路径后，执行最小真实搜索及 GPU 文生图/图生图验证；用户正在查找，当前不冒称完成。
- [x] 更新 README/验收记录并保存本地代码提交，分别报告协议测试与真实服务结果。
