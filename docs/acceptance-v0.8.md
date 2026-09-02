# DSH 前期策划 v0.8 验收记录

更新时间：2026-08-29（Asia/Shanghai）

## 验收边界

- 当前包版本保持 `0.7.0`，直到工程 Golden、全页视觉 QA 和真实 DSH 主机流程全部通过。
- 工程自动化、PowerPoint/PDF 视觉 QA、真实 DSH E2E 是三个独立门槛，不能互相替代。
- v0.7.0 Golden 保持只读，新产物只能写入新目录。
- 本文中的 `PASS` 只能由本次实际命令或主机操作产生；未执行、只做静态检查或只有历史记录的一律标为 `PENDING`。

## 本机 Reference 输入

Reference 根目录：

`C:\Users\2899\Nutstore\1\开发\12_前期策划\Reference`

以下文件用于“鄂州城市更新—明塘＋洋澜湖地块”标杆内容与视觉复核，原始文件不得修改或重存：

| 文件 | 字节数 | SHA-256 |
|---|---:|---|
| `鄂州城市更新-明塘.pdf` | 21,669,484 | `4a1a8047aa4f451f55ffcb852f662b0dfb45ebfa4449d6254350af98f78b5600` |
| `鄂州城市更新-明塘+洋澜湖地块（汇总）-汇报版1125.pptx` | 515,207,915 | `9e4665b12df4599e9301bb28ed2e19202b0f3318a2ef2c0daf203bbfabfd4ed7` |
| `20251029鄂州城市更新1.pptx` | 494,515,525 | `69e19339f2ea26367c963bb1913f8c37ce0608fa6b0e3ab829629a0f1d4e3927` |
| `鄂州市2025年度策划咨询服务项目12.7.pptx` | 441,663,583 | `0f759135665de3cb6e12782180b0ea2f0cd9650ad6fe78c54b6d6bb27c95eb67` |

工程 Golden 使用仓库内确定性、非敏感夹具；上表材料只用于本机标杆内容校准和真实视觉验收，不复制进公开仓库。

## 输出目录

- v0.7.0 历史基线（只读）：`C:\Users\2899\Documents\Codex\2026-08-27\yue-du\outputs\dsh-preplanning-0.7.0\golden-project`
- v0.8 工程 Golden 首轮：`C:\Users\2899\Documents\Codex\2026-08-27\yue-du\outputs\dsh-preplanning-0.8.0\engineering-golden-r1`
- v0.8 工程 Golden 修正版：`C:\Users\2899\Documents\Codex\2026-08-27\yue-du\outputs\dsh-preplanning-0.8.0\engineering-golden-r2`
- v0.8 专业视觉页工程 Golden：`C:\Users\2899\Documents\Codex\2026-08-27\yue-du\outputs\dsh-preplanning-0.8.0\engineering-golden-r3`
- 鄂州标杆成果：`C:\Users\2899\Documents\Codex\2026-08-27\yue-du\outputs\dsh-preplanning-0.8.0\showcase-mingtang-yanglanhu-r1`

每个正式输出目录应包含：

- `html/index.html` 与本地资产
- `print/index.html` 与本地资产
- `report.pptx`
- `report.pdf`
- `artifact-manifest.json`
- `qa/client-inspection.json`
- `qa/ppt-render/`、`qa/pdf-render/`
- `qa/ppt-montage.png`、`qa/pdf-montage.png`
- `qa/visual-score.json` 与人工复查记录

## 工程门禁

| 项目 | 状态 | 新鲜证据 |
|---|---|---|
| 客户投影、内容政策、三媒介页面计划 | PASS | 2026-08-29 全量测试包含相关回归 |
| HTML/PPTX/PDF 同源身份与禁词检查 | PASS | r2 `qa/client-inspection.json`：身份一致、禁词 0、缺失采用资产 0 |
| `pnpm typecheck` | PASS | 2026-08-29 exit 0 |
| `pnpm build` | PASS | 2026-08-29 exit 0，Host 与 Client 构建完成 |
| `pnpm exec vitest run --maxWorkers=1` | PASS | 2026-08-29：44 个测试文件、111 项测试、0 失败 |
| 专业图件主视觉页 | PASS | r3：HTML/PPTX/PDF 各 3 页 `visual-evidence`；缺少 map、diagram、chart 时发布失败关闭 |
| v0.8 工程 Golden 与覆盖保护 | PASS | r1、r2、r3 均为独立目录；r1 二次构建被 `refusing to overwrite published Golden` 拒绝 |
| v0.7.0 Golden 哈希未变化 | PASS | 141 个文件聚合 SHA-256 `88085a8a9039b29dc7a7e5d8b43e2540e40163b722d68238fb733166cc6e7df1` |

## 全页视觉 QA

必须分别把 PPTX 36 页和 PDF 48 页渲染为 PNG，并生成全册 montage。检查：字体回退、标题换行、正文溢出、对象越界、边距、对齐、图片裁切、概念示意、页码、来源、章节节奏、空白页和机械重复。

至少完成一次：发现问题 → 修改源渲染器或客户画像 → 重新生成 → 全页重渲染 → 复查。

| 项目 | 状态 | 证据路径/说明 |
|---|---|---|
| PPTX 36 页全页渲染 | PASS | r3 `qa/ppt-render/`，Microsoft PowerPoint 16.0 导出 36/36 |
| PPTX montage | PASS | r3 `qa/ppt-montage.png` |
| PDF 48 页全页渲染 | PASS | r3 `qa/pdf-render/`，PyMuPDF 渲染 48/48 |
| PDF montage | PASS | r3 `qa/pdf-montage.png` |
| 至少一次修正闭环 | PASS | r2 发现专业图件被当普通配图；新增 role-aware 主视觉页后生成 r3 并复查 |
| 内容产品性评分 ≥ 85 | FAIL | r3 为 78/100，真实地块内容与产品深度不足 |
| 苹果式美学评分 ≥ 88 | FAIL | r3 为 80/100，专业构图已建立，但工程夹具仍缺真实地图/总平面/图表和项目母题 |
| 真实 Microsoft PowerPoint 字体/错位/溢出检查 | PASS | PowerPoint 16.0 全页导出并检查 montage；未见裁切、越界或拉伸 |

## 真实 DSH E2E

验收链路固定为：

`模式选择 → 任务执行 → 生图 → 采纳 → 发布 → HTML/PPTX/PDF 下载 → DSH 重启恢复`

| 步骤 | 状态 | 新鲜证据 |
|---|---|---|
| DSH 启动且插件真实加载 | PENDING | 不使用历史 PID/端口记录 |
| 模式选择与任务执行 | PENDING | DSH 主机实际操作 |
| 生图完成且结果可见 | PENDING | 队列接收不等于完成 |
| 视觉结果采纳 | PENDING | 采纳后的资产 ID/界面状态 |
| 三格式原子发布 | PENDING | 新 package 与 manifest |
| HTML/PPTX/PDF 真实下载并可打开 | PENDING | 三个下载文件 |
| DSH 正常重启后项目与发布记录恢复 | PENDING | 重启后的界面/存储证据 |

## 完成声明规则

只有工程门禁、全页视觉 QA、双重评分和真实 DSH E2E 的适用行全部为 `PASS`，才允许：

1. 更新包版本；
2. 宣称 v0.8 完成；
3. 进入分支合并、发布或 Release 流程。
