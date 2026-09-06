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

## 外部 AI 概念图、确定性图解与授权通用图

原件继续使用上面的写法，不填 `provenance`。补图需要明确填写 `provenance`，并提供有效的 `pageBindings`。下列三类补图只进入 `assets`，不会伪装成 `source-materials` 原件。同步不调用模型、不搜索图库。

```json
{
  "version": 1,
  "projectId": "当前 Pre 项目 ID",
  "materials": [
    {
      "sourceKey": "page-concept-waterfront-v1",
      "sourcePath": "配图/滨水公共空间.png",
      "originalFileName": "滨水公共空间.png",
      "displayName": "陆侧滨水公共空间意向",
      "mimeType": "image/png",
      "semanticRole": "concept_visual",
      "importedAt": "2026-09-06T02:00:00.000Z",
      "metadata": { "widthPx": 1536, "heightPx": 1024 },
      "role": "primary",
      "pageBindings": [{ "findingId": "pre-design:project-brief", "role": "primary" }],
      "provenance": {
        "kind": "ai_concept",
        "tool": { "name": "Codex image_gen", "version": "2026-09" },
        "model": "填写实际模型；工具未报告时明确写 not-reported-by-tool",
        "prompt": "填写实际提交的完整提示词；说明这是概念意向，不冒充项目现场。"
      }
    },
    {
      "sourceKey": "page-decision-diagram-v1",
      "sourcePath": "配图/决策条件.svg",
      "displayName": "决策条件与工作顺序",
      "mimeType": "image/svg+xml",
      "semanticRole": "analytical_diagram",
      "importedAt": "2026-09-06T02:00:00.000Z",
      "metadata": { "widthPx": 1600, "heightPx": 900 },
      "role": "primary",
      "pageBindings": [{ "findingId": "pre-design:decision", "role": "primary" }],
      "provenance": {
        "kind": "deterministic",
        "tool": { "name": "Native SVG renderer", "version": "1.0" },
        "sources": ["填写实际成果对象、字段或原件路径及采用口径；不得填虚构数值或审批状态"]
      }
    },
    {
      "sourceKey": "general-waterfront-reference-v1",
      "sourcePath": "配图/授权滨水参考.jpg",
      "displayName": "滨水设施通用参考",
      "mimeType": "image/jpeg",
      "importedAt": "2026-09-06T02:00:00.000Z",
      "metadata": { "widthPx": 1600, "heightPx": 1000 },
      "role": "supporting",
      "pageBindings": [{ "findingId": "pre-design:project-brief", "role": "supporting" }],
      "provenance": {
        "kind": "licensed_reference",
        "sourceUrl": "https://example.org/actual-source-page",
        "license": "填写实际许可或授权范围",
        "author": "填写实际作者/权利人"
      }
    }
  ]
}
```

- AI/确定性图解使用现成 `generated_by_tool` 来源；通用参考使用 `human_added`。工具名、版本、模型、提示词或引用依据保存在 `origin.method` 的 JSON 中，工具身份也保留在 `origin.sourceTool`。程序不能代替人工验证授权合法性。
- AI 自动加可见“AI概念示意（非现场实拍）”标识；确定性图解注明“依据资料绘制的信息图解”；通用图注明“非项目现场”。这些前缀进入 `displayName` 和当页素材说明，不只存在日志。
- 三类补图强制 `pageBindingOnly=true`：只挂指定 findingId，不因 objectIds、evidenceIds、aliases 或工作项关系扩散。普通原件 `pageBindings` 的角色覆盖行为不变。
- 不存在的 findingId、无效图片 MIME、缺工具/来源信息或缺许可字段均停止同步。不存在的图片文件给出真实缺失提示，不计为已覆盖。格式、尺寸和来源填写必须对应实际文件。
- 索引暂时缺失时，已导入的图与其来源、稳定 pageAssetId、精确挂页边界继续保留。此登记只采用外部已经确认的文件，不是生图请求。

## 显式按页补图命令

```text
/preplan-visual-fill plan
/preplan-visual-fill generate pre-design:project-brief {"prompt":"陆侧安全公共空间概念示意，不冒充现场实拍","style":"低饱和自然材料、清晰空间层次、无文字"}
/preplan-visual-fill adopt pre-design:project-brief <candidateAssetId>
```

`plan` 只在内存编制 canonical 页面配图清单，不写文件、不生图。CAD、PDF、未知图片 MIME 和 `reference` 角色不计为可上版图片。`generate` 每次只显式处理一页，固定使用现有 VisualAgent 模型，产生候选但不自动采用或同步；`adopt` 验证候选归属和页面内容未变后采用，再请求标准同步。已有图不自动替换，手工布局不会重排。

覆盖判定还读取实际图片字节：PNG/JPEG/WebP 复用既有结构完整性与尺寸校验，SVG 检查基础文档、命名空间和尺寸；空文件、明显损坏或声明尺寸不符时给出 `PAGE_VISUAL_IMAGE_UNAVAILABLE`，不计为覆盖。暂不能结构核验的其他图片格式保留原素材登记/同步能力，但计划中明确提示未核验，不默认当作可用图。此检查不是完整浏览器解码或构图质量验收。

状态记录位于 `.pre-design/page-visual-fill.json`，以项目、稳定 findingId、实际页面内容、提示词和风格的 hash 标识请求。同请求复用已确认候选/已采用图片，同进程合并并发请求；工作区独占锁阻止另一进程重复付费请求。异常退出遗留的 `page-visual-fill.lock` 会明确阻断，必须先确认原请求不再运行再人工处理，不能自动偷锁。生成失败/取消不会标为已覆盖，修改内容或提示词会形成新任务身份，但不会因此默认替换已存在图片。

锁释放后，如果持久记录已有 candidate/adopted/generating，而当前进程治理快照不能安全恢复该结果，命令返回 `PAGE_VISUAL_RECOVERY_REQUIRED`，保留原状态且不再次付费；旧快照也不能把 adopted 降回 candidate。重新加载治理状态并核查原请求后才能继续；已有明确 failed 状态仍允许用户显式重试。

候选与采用仍经过现有视觉治理；程序生成图沿 `generated_by_plugin` 来源进入标准素材库，sidecar 仅覆盖同一 sourceKey 的精确页面关联，不额外注入一个宽泛别名。普通 `preplan-presentation-sync` 和自动同步始终只读取已采用的结果。

补图 sidecar 缺失时，从已管理标准清单恢复的精确 pageBindings、pageBindingOnly、来源与披露说明不会被实时治理的宽泛 adopted 输入清空。新的显式登记/补图状态仍可应用；没有精确限制的旧原件继续保持原对象/证据关联语义。
