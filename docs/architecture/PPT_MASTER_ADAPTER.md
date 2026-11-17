# PPT Master 内部 Adapter

本模块是 Pre-design V14 的内部工具适配器，不是独立产品入口。

- 固定上游 revision：3af3e8ef774c4d67ee57e1306d9256d08c9ee1bf。
- 调用完整上游 \`attribution_guard.py\` 和 \`pptx_template_import.py --inheritance-mode both\`。
- 输出 Manifest、Native Structure、Inheritance、Authoring Summary、Conversion Report、SVG 文件清单和哈希收执。
- 固定脚本路径与参数数组，不使用 shell；工作区必须位于私有临时根目录且为空；支持 AbortSignal、超时、文件数/总字节限制和失败清理。
- 本模块只完成上游导入执行与收执。将完整产物持久化到 Reference Bundle、V14 Design Spec/Prototype 阶段和 V3 编译仍是后续集成任务；在这些环节完成前，不得宣称已完成原生设计融合。
