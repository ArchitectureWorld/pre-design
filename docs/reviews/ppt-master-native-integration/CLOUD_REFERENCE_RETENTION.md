# 云端接续：Reference Bundle 与私有产物保留

基线：`2b811d4`，分支：`codex/web-v210`。本增量在云端开发，未部署或改动服务器。

## 已实施

- 修复 `extractPptxReference` 内层 `const upstream` 在作用域外引用的运行时错误。测试先复现 `ReferenceError: upstream is not defined`，修复后成功取得上游收执。
- ZIP/XML、关系及资源限制检查先于上游 importer，使用同一总体截止时间。此前非法 PPTX 测试错误地进入上游并返回 422；调整后完整 PPTX 安全回归通过。
- 在临时目录清理前捕获分层/平面 SVG、原生 JSON 和衍生素材，排除 `sources/` 原件副本。每份产物校验路径、文件类型、SHA256、字节数、符号链接，累计最多 64 MiB、12000 文件；超限明确失败，不静默截断。
- 复用已有拥有者私有上传目录保存字节，以固定 `artifact-N` 文件名落盘。按拥有者查询、固定存储名及 SHA256 读取；不新增公开 SVG 路由，不把原件或原型 SVG 注入页面。
- V14 inventory 阶段生成私有 Reference Bundle，保留母版/版式/页面继承图、原生结构、导入收执和覆盖范围；明确区别 `inventory-only` 与 `private-upload`。旧上传没有字节时不伪称产物可用。
- 公开上传摘要、复用资源包不包含产物字节；原件数据和原生结构仍只属于拥有者私有分析。

## 本轮验证

- `node --test web/app/tests/layout-reference-{bundle,artifacts,preview,pptx-receipt,pptx,workflow}.test.mjs web/app/tests/layout-ppt-master-vendor.test.mjs web/app/tests/ppt-master-adapter.test.mjs`：40/40 通过。
- 新收执测试使用真实 pinned PPT Master importer 和 Poppler，**仅 Office 转换边界为受控替身**，不算真实 LibreOffice 或视觉质量验收。
- 上传持久化测试使用现有 SQLite 离线 harness，不冒充 PostgreSQL 验收。
- `cd web/app && npm run build`：通过。
- 独立增量审查未发现阻断级安全/持久化问题；已修正其发现的图像页数回填缺失，新增红绿测试。
- 初次扩大 `layout-*.test.mjs` 回归：171 项，150 通过、8 失败、13 跳过。其中非法 PPTX 前置校验失败已修复并由上述 40 项重新验证。其余未宣称通过：Chromium 在受限云机 socket/crashpad 启动失败、`/proc/.../children` 不可访问、worker SDK 缺失、复杂 PPTX 合成样本存在重复对象 ID。云机未安装真实 LibreOffice，普通系统安装权限不足。

## 仍未完成

本增量是 Task 4 的产物保留与来源索引基础，不是完整融合验收。

- Design Spec / Template Designer 的实际 DSH 多阶段模型调用。
- Native Design Compiler V3、严格 SVG 清洗和 V08–V13 原型/槽位消费。
- 上游质量检查、Q05 人工确认、真实样稿与真实内容试排。
- PostgreSQL、真实 LibreOffice、Chromium、供应商模型及远端 CI 全链验收。
- 任何导出能力、生产部署或用户视觉质量结论。

后续阶段必须通过现有拥有者授权的私有上传读取接口取得产物，不能依赖已清理临时路径；不得把尚未清洗的参考 SVG 直接渲染或发布。
