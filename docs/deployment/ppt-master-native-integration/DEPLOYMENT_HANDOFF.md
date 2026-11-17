# 本地 Agent 验收交接（尚未部署）

分支固定 `codex/web-v210`。本文件不是已经部署的证明，也不授权改变生产。

## 环境与不变项

遵守根 AGENTS.md：不要改现有 Web/DSH 端口、身份、数据库、模型策略或共享 PostgreSQL 目录。需要部署时仍先备份并按原有部署流程执行。

PPTX需要固定上游 vendor、Python、LibreOffice及Poppler；V3原型需要上游SVG Quality Checker。保留MIT许可证与完整性门禁；不安装PyMuPDF。

## 用户体验验收入口

沿现有“版式助手”上传授权参考，选择“学习设计风格”或“复用页面结构”，再选择设计范围与目标。新Web请求原生V3，不出现独立PPT Master入口。

检查：
- 原件页数/读取范围正确，真实私有SVG收执可追溯。
- 每个原型实际经过 Design Spec、prototype、upstream-validate、native-compile，失败或取消没有候选。
- 预览含真实装饰SVG，不是五模板回退；正文/照片/表格为项目可编辑内容槽。
- 超容量明确要求重新分页，不裁剪事实。
- 新版V3进入当前Q05原页对照；未经当前版本检查/人工确认不能共享发布或应用。
- 旧V1/V2项目、局部覆盖、人工覆盖和冻结版本不自动重排。

结构检查不等于视觉一致。请使用实际参考、实际内容和真实供应商模型验收，不用合成示例代替。镜像PPTX和任意原始SVG直接渲染不在当前支持范围。

详见 `docs/reviews/ppt-master-native-integration/V3_CLOUD_CHECKPOINT.md` 的已过测试及未完成项。
