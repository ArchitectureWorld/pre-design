# 详细汇报大纲编制

标准项目导出采用 `compileReportOutline`，不再将全部成果固定压成十页。旧的 Contract-neutral 摘要投影器保留兼容，标准目录输出不再用其内容作为最终草案。

## 编制规则

- 章节 → 专题 → 页级编写任务；每页包含要回答的问题、论证要点、依据、来源和建议图表。
- 按背景、条件、问题、机会、定位、比选、功能、空间、投资实施组织成果；同一专题可引用多个成果，一个复杂成果可展开多页。
- 项目的 `DG06.topics` 转为有名称的关键议题页；跨成果页对照建设必要性、推荐依据、功能规模、空间可行性及投资实施条件。
- 详细内容来自冻结成果的完整专业字段，不受旧 `facts` 八条限制。仅按单页内容密度分组，不设置项目总页数；专业实体不截断。
- `text` 保留完整信息，`contentText` 去除重复的来源元信息，`basis/fieldPath/evidenceRefs` 保留依据与证据身份；纯资料元信息进入来源说明，不单独凑正文页。
- 不修改源数据、不调用模型重跑 57 项。缺失依据、审批条件与测算假设不升级成已证实事实。投资基线和财务模型不一致时，提示核对而非替用户改数。

这是可编辑的详细汇报编写大纲，不等同于已完成图表、排版或独立事实核验的正式汇报文件。

## 兼容与更新

保留原十页的 page、draft、叶节点与主内容块标识，新增专题和细页使用稳定语义键。相同成果版本可重新同步，无须伪增 Pre Revision。继续使用现有标准项目事务写入、外部修改冲突保护与布局所有权边界；不自动使用 `--force`。

## 验证

```powershell
pnpm test
pnpm typecheck
node scripts/verify-presentation-standard-integration.mjs
```

读取现有存储生成可读预览（不会修改 DSH、成果、布局或标准目录；输出文件必须尚不存在）：

```powershell
pnpm exec tsx scripts/preview-report-outline.ts --project-id PROJECT_ID --storage-root C:\PATH\TO\storages --out C:\EXISTING_DIR\outline.html
```

重点回归覆盖：57 项实际内容去向、动态细化、项目关键议题、投资口径冲突、零值/区间/公式/URL 保真、局部实体引用、证据身份、三层父链、同版本更新、旧 ID 迁移、外部修改保护及幂等性。
