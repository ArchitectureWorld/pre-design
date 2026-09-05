# 项目资料登记与当页素材库

在项目工作区 `.pre-design/materials.json` 明确登记可使用的原件。该索引是 Pre 的配置，不改变 Presentation Contract，也不属于 Pre 重写的标准文件。同步仅读取登记路径和此前由 Pre 导入的文件，不扫描磁盘，不修改原件。

```json
{
  "version": 1,
  "projectId": "当前 Pre 项目 ID",
  "materials": [
    {
      "sourceKey": "site-map",
      "sourcePath": "资料/现场遥感图.jpg",
      "originalFileName": "现场遥感图.jpg",
      "displayName": "现状遥感全图",
      "mimeType": "image/jpeg",
      "semanticRole": "map",
      "importedAt": "2026-09-05T08:00:00.000Z",
      "aliases": ["历史 asset_id"],
      "evidenceIds": ["历史 evidence_id"],
      "objectIds": ["PS07"],
      "role": "supporting",
      "metadata": { "widthPx": 4962, "heightPx": 7019 },
      "pageBindings": [
        { "findingId": "pre-design:project-brief", "role": "background" },
        { "findingId": "pre-design:baseline", "role": "primary" }
      ]
    }
  ]
}
```

- 必填：`sourceKey`、`sourcePath`、`mimeType`、`importedAt`。`sourceKey` 在项目中唯一并长期保持稳定；`projectId` 必须与 Pre 一致。
- `sourcePath` 可为工作区内相对路径，或明确指定的本机绝对路径。相对路径不能通过 `..` 或链接跳出工作区；不接受 URL、目录或符号链接文件。
- `originalFileName`、`displayName` 可省略，默认源文件名。`semanticRole` 可取 `map`、`chart`、`diagram` 等真实用途；图纸不会仅因 MIME 以 `image/` 开头就成为摄影图像。
- 图片必须有 `widthPx`、`heightPx`；视频/音频必须有正数 `durationMs`；PDF 可登记 `pageCount`；数据可登记 `rowCount`、`columnCount`。CAD、PDF、数据可作为原件与页面引用，不能作图像背景。
- `aliases` 对应旧素材标识，`evidenceIds` 对应证据标识；这些是关联标识，不是文件路径。精确等于现有成果对象 ID 的内部来源引用不被误报为丢失原件。
- `objectIds` 是明确的成果关联兜底，不使用整章铺图。资料目录成果可显式关联原件清单；实际内容页优先按素材别名或证据关联。
- `role` 允许 `primary`、`supporting`、`background`、`reference`，默认 `reference`。`pageBindings` 按稳定 `findingId` 覆盖该页角色，也能直接指定该页引用；它不是其他证据关联页的白名单。
- 每份原件进入 `source-materials/manifest.json`，采用素材进入 `assets/manifest.json`，两者有来源关联。仅真实相关素材进入各页 `pageAssets`；同一实体文件的多重引用按页去重。Studio 排版应只使用当前页面素材库。
- 地图、图纸和数据图表应完整显示标注与图例；仅明确指定的相关背景图适用背景排版。登记不会自动编造图表或改变 `layouts`。
- 原件找不到时给出资料提示；已导入副本和稳定 ID 保留。索引暂时缺失不会清空此前导入的库。未解析到实体的外部引用也会提示，格式或元信息无效则停止该次同步。

共用调用接口：

```ts
const { sourceMaterials, assets, materialWarnings } = await preparePresentationMaterials({
  frozenProject,
  workspaceRoot,
  assets: adoptedPresentationAssets(frozenProject),
  previous: binding // stableIds 与 lastExportedFileHashes，用于保留已有受管资料
})
```

手动与自动同步均使用此接口，并把真实资料提示传至同步结果及 DSH 项目面板。
