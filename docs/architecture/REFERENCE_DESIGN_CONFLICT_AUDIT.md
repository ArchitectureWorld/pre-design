# 参考设计架构冲突审计

**审计基线：** codex/web-v210@141738bdd242a06a46029725e0fc8598797333b8
**裁决依据：** docs/architecture/REFERENCE_DESIGN_INTEGRATION.md
**规则：** 历史证据不删除；实现和后续文档必须服从新架构原则。

## 1. 已确认的冲突

| 现有文件/实现 | 原有表述或行为 | 冲突点 | 以新原则为准的处理 |
|---|---|---|---|
| docs/superpowers/specs/2026-11-16-v14-reference-design-v2.md | 以 V2 组合版式为最终资源，原生 HTML Renderer 输出 | 不能保留完整 Design Spec、Master/Layout 关系和 SVG 原型 | V2 保持兼容；新增 V3 原生设计包和 SVG-backed Renderer |
| docs/superpowers/plans/2026-11-16-v14-reference-design-v2.md | 目标为独立分支 codex/v14-reference-design-v2 | 与用户明确要求在 Web V2.1 原支线持续迭代冲突 | 后续只更新 codex/web-v210；该计划标记为历史执行记录 |
| web/app/src/layout-library/vendor/ppt_master/README.md | 仅包含 5 个纯 Python 模块，不包含 SVG Renderer、完整导入器和工作流 | 现有 vendor 只是解析子集，不符合技术内核化原则 | 扩充为固定版本完整上游工具链；保留 License、Copyright、Attribution Guard |
| web/app/src/layout-library/reference-pptx.py | 自己重复实现 ZIP/XML 校验、对象读取和结构提取 | 与完整上游导入器职责重叠，易产生解析差异 | Pre-design 保留安全 Adapter；实际解析交给上游完整工具，Adapter 负责资源限制、隔离、收执和平台映射 |
| web/app/src/layout-library/reference-workflow.mjs | Observe → Profile → V2 compile | 缺少 Design Spec、Template Designer、SVG 原型与上游质量检查 | V14 增加 Design Spec / Prototype / Validate / Compile 阶段；仍是唯一工作流入口 |
| web/app/src/layout-library/reference-profile.mjs | 固定少量颜色、字体、区域和页面类型 | 不足以保存完整设计系统、Master/Layout 图、组件与槽位 | 保留为分析事实/兼容 Profile；V3 Native Design Package 保存完整设计语义 |
| web/app/src/layout-library/composition-contract.mjs / composition-render.mjs | V2 声明式 points/columns 等组合组件 | 不能复现上游 SVG 原型和复杂矢量装饰 | 保留 V2；V3 引入受控 SVG 原型和可编辑内容槽 |
| web/app/src/layout-library/skill-bindings.json | V11 只读取 V1/V2 原生 HTML 组合 Renderer | 未定义 SVG-backed 原型消费 | 更新 V08—V13 读取/产出契约和 Renderer 兼容矩阵 |
| docs/reviews/v14-reference-design-v2/README.md | 把 codex/v14-reference-design-v2 作为审查分支 | 历史审查入口与当前开发主线容易混淆 | 保留历史评审证据，增加“已 superseded；当前主线 codex/web-v210”的说明 |

## 2. 不构成冲突、应当保留的能力

- 现有 Fastify、PostgreSQL、DSH Worker、模型路由、权限、配额和作业审计：作为唯一运行基础。
- PDF/图片/DOCX 的平台解析器：继续作为各自格式 Adapter；不强行用 PPTX 解析器处理所有格式。
- PDF 的 Poppler 页面渲染和现有读取上限/取消/权限保护：继续保留。
- V1/V2 资源、已有 HTML 页面、全局/局部绑定、人工覆盖和历史版本：向后兼容，不批量迁移或重排。
- 现有人工确认门禁、Q05/Q07/Q08、来源哈希和资源权限：继续作为发布与应用前提。

## 3. 许可证与依赖冲突

- PPT Master MIT 代码保留原始 LICENSE、Copyright、固定 commit 和逐文件 blob SHA。
- 上游 source_to_md/pdf_to_md.py 依赖 PyMuPDF（AGPL-3.0）；本轮不将其加入平台运行依赖，PDF 继续使用现有 Poppler 路径。
- 上游完整脚本的可选依赖不得整体无差别安装；按实际执行工具建立最小依赖清单和环境诊断。
- 上游 Attribution Guard 所要求的 SKILL.md、赞助归属文件、执行门禁文件必须完整保留；不禁用、不修改其检查逻辑。
- 上游 Skill 不放入 DSH 可自动发现的独立 Skill 目录；仅存于 web/app/src/layout-library/vendor/，由 V14 Adapter 内部调用。

## 4. 实施顺序与回滚边界

1. 先合并本审计和架构原则到 codex/web-v210。
2. 再完整 vendor 固定上游技术包并通过 Attribution Guard。
3. 建立内部 Adapter 与 V14 分阶段流程。
4. 新增 V3 和 Native Design Compiler；V1/V2 不动。
5. 将 V08—V13 接入 V3，并执行真实参考样稿试排。
6. 完成浏览器、PostgreSQL、DSH 和 CI 验收后再交给本地 Agent 部署。

若上游工具缺少目标机依赖，明确报错并保持现有 V1/V2 工作流；不得静默回退成简化解析器并把结果标为“参考设计已理解”。


## 5. 2026-11-17 当前分支复核（基线 ef41eb6a）

本次按用户要求在既有 `codex/web-v210` 上复核，不创建新分支。

### 已落库且与新原则一致

- `docs/architecture/REFERENCE_DESIGN_INTEGRATION.md` 已成为架构权威文件。
- `AGENTS.md` 已明确指向该文件。
- V2 规格、V2 计划、旧 Claude 评审入口均已加历史/取代声明。
- PPT Master 固定版本 MIT 上游 Create Template 依赖闭包已 vendor；`UPSTREAM.json` 声明 215 个必要文件及逐文件 Git Blob SHA。
- 上游 LICENSE、SPONSORS、SPONSORS_CN、SKILL、Attribution Guard 均在 vendor 内。
- 许可证边界明确排除 PyMuPDF/AGPL，PDF 继续走平台 Poppler。

### 尚未完成、不能误标为已融合

| 原则要求 | 当前代码事实 | 裁决 |
|---|---|---|
| 完整上游 PPTX importer | 已新增 `ppt-master-adapter.mjs`，并在 `extractPptxReference()` 中调用固定上游 `pptx_template_import.py --inheritance-mode both`；旧 `reference-pptx.py` 暂时仍作为兼容事实适配器二次运行 | 主解析已开始切换到上游，但重复解析尚未移除；完整产物工作区还未持久化到 Reference Bundle |
| 上游 SVG 转换和原型产物 | Adapter 已生成并校验 Manifest/Native Structure/Inheritance/Authoring Summary/Conversion Report 及分层、平面 SVG 文件清单；文件仍在临时工作区，上传存储尚未持久化其字节 | 部分完成；必须将原生产物持久化并由 V14 实际消费，才算完成 |
| Design Spec / Template Designer 阶段 | 当前工作流仍为 inventory → observe → profile → compile | 与新阶段要求不一致；需加入 design-spec、prototype、upstream-validate |
| Native Design Package V3 | 当前 `contract.mjs` 仅有 V1/V2；V2 是声明式组合布局 | 未完成；V1/V2 只保留兼容，不再作为新资源最终上限 |
| SVG-backed V11 | 当前 renderer 仍以 V1/V2 HTML 组合渲染为主 | 未完成；需让 V11 直接消费 SVG 原型及可编辑槽位 |
| 上游质量检查/导出工具 | 尚无 Pre-design Adapter 调用上游 SVG Quality Checker 和 Template Preview PPTX 的集成 | 未完成；不得声明可编辑 PPTX 输出已支持 |

### 其他冲突与边界

1. 现有 `reference-pptx.py` 中的简化解析逻辑不得继续作为“完整上游解析”的替代。完成 Adapter 后，它只能保留为兼容/安全预检入口，或被移除。
2. V2 的 `designProfile` 和五类/组合布局不能被新任务继续当作 V3 的替代；旧资源必须只读兼容。
3. PPT Master 的上游 SKILL/工作流只能作为 V14 内部方法来源，不得放入 DSH 自动发现目录。
4. 上游 PDF 转换若引入 PyMuPDF 将违反许可证边界；继续使用平台 Poppler。
5. 真实供应商模型调用与视觉迁移质量仍需目标环境验收；合成响应和 CI 不能替代。

### 当前执行状态

- 架构原则、冲突裁决、上游固定版本及 vendor 完整性：已提交。
- 内部 Adapter 已新增并接入 PPTX 参考解析；完整 Reference Bundle 持久化、V14 Design Spec/Prototype 阶段、Native Compiler V3、SVG-backed V11、上游质量工具和部署交接：待实施。
- 当前分支 CI 仅证明已有代码和 vendor 门禁通过，不代表以上待实施项目完成。

