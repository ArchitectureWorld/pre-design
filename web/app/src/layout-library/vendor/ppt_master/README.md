# PPT Master 内部技术内核

本目录不是第二套产品、不是 DSH 可发现的独立 Skill，也不拥有用户、项目、任务、数据库或模板库。

- 固定上游：hugohe3/ppt-master@3af3e8ef774c4d67ee57e1306d9256d08c9ee1bf
- 许可证：MIT；原始 License、Copyright、Sponsors、SKILL.md 与 Attribution Guard 原样保留。
- 内部调用入口：Pre-design V14 Adapter；工作目录、任务、权限、日志和资源均由 Pre-design 管理。
- 上游 215 个 Create Template 必要依赖文件原样 vendor，保留原目录层级；排除与参考设计无关的图像生成、网页检索、TTS、独立编辑器和测试夹具。
- Create Template 工作流、Template Designer、Design Spec 和 SVG 工具文档作为 V14 内部方法来源；不注册为第二个 DSH Skill。
- V14 使用上游 PPTX importer / OOXML / SVG / quality tools；结果由 Native Design Compiler 转为 Pre-design 原生资源。
- 不运行上游独立工作台、独立注册器或独立用户资源库。
- 不安装上游 PDF 转换中的 PyMuPDF（AGPL-3.0）；PDF 仍走平台 Poppler。
- upstream/requirements.txt 只作依赖参考，不得无差别安装所有可选包；实际 Adapter 按调用路径做环境诊断。
- UPSTREAM.json 记录固定版本、原始上游路径、字节数和 Git Blob SHA；测试会逐文件验证。
