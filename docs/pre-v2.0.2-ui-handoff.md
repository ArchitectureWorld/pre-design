# Pre 2.0.2 · R4 · 当前 UI/UX 交接

开发支线 `pre-V2.0.2`，main 基准 `801afcc794b34fa734ba624303ed9552b152407c`。本轮接续 `28865472503dc37e3f02cd02970b2367d8158f9c`，完整保留并行落地的 R3 同行配置与 R3.1 下拉菜单修复。产品仍为 **2.0.2**；R4 为候选修订，须通过 COMMIT.txt / SHA256SUMS.txt 区分，不能只比较包版本。

## 当前实现

- A/B/C/D 液态玻璃；C/A、D/B 的尺寸与光学参数配对，只有色系不同。保留静态厚度/悬浮投影，模型卡片不再随悬停移动。按钮的动态光影可关闭。
- 主/备用 Klein 与各自必填 LLM 同排；普通生图 API 不附加配套。添加仅 `+`，次级操作图标化；完整可访问名称保留。说明按需展开，错误/必填/revision 冲突直接可见。
- 保留 R3.1 对原生 select 被5秒刷新关闭的修复：读取与写入互不混淆，选择期间不改变选项，过期读取不覆盖保存，切换会话完整清理。
- 执行历史为原生模态窗口，独立滚动，最大700px/80dvh，按任务启动时间倒序，展示当前项目所有已接收记录；新记录在前但不自动强拉正在阅读旧记录的滚动位置。保留实际/选用模型、配套 LLM、冻结链和错误，不把子会话空闲当作完成。
- 背景在「外观 → 背景图片」选择、更换、恢复默认。支持有效 JPEG/PNG/WebP，输入≤20MB，等比静态规范化；仅存当前浏览器 IndexedDB，切换主题不清空、不进入项目/服务器/模型配置。存储受限会提示且允许临时体验。
- 原工作区启动、原始资料等待、打开文件夹、已关联项目不重复启动、未保存草稿、显式配套/备用提升与工具身份过滤不变。

## 文件及验证

新文件：`glass-background.ts`（校验/等比处理/存储/异步清理）、`glass-session-styles.ts`（不覆盖旧同行样式的功能补充）、`tests/pre-v202-r4.client.spec.tsx`、`tests/pre-v202-background.client.spec.tsx`、`scripts/verify-ui-browser-v202.mjs`。

本地 pre-v202 系列58/58，全部客户端及构建包合计105/105，类型/构建通过，客户端98,661 bytes（保持原100,000限制）。本地12项浏览器检查因沙箱导航限制使用opaque origin，不宣称原生持久化已验证；本轮CI额外以HTTP源验证真实IndexedDB刷新恢复/清除后刷新。最终是否完整通过以本提交Actions和候选内browser-result.json为准，不借用父提交状态。

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm test:built
node scripts/build-ui-review-v202.mjs
node scripts/verify-ui-browser-v202.mjs
```

默认交互预览 `work/ui-review-r4/pre-V2.0.2-R4-preview.html`。使用本轮生产组件与模拟数据，不连接真实DSH或模型。只在禁止导航的渲染环境使用 `--offline-render`，该模式不能替代持久化验收。

DSH SDK仍为0.1.5-rc.1，Node≥24.11.0，Project Format / Presentation Contract0.1.0，research/v2.0.1。没有后端、调度、依赖、契约改动。ComfyUI 地址、工作流与模型文件仍在原DSH插件中管理；目录可见不等于已验证工具能力。

## 宿主验收与历史

候选包取本轮通过检查的CI产物，核对commit/hash。用户授权安装后，检查真实菜单停留选择、Klein独立配套/保存、四主题、背景恢复、历史排序/内部滚动、宿主CSP/WebView和ComfyUI出图。高级折射不支持可降级，但不能影响控件。**未自动安装、重启、合并main或发布。**

- [R4 静止面板、历史窗口、背景及集成验证](pre-v2.0.2-r4-review.md)
- [R3.1 下拉稳定性和竞争条件](pre-v2.0.2-dropdown-fix.md)
- [R3 主/备用同行配置](pre-v2.0.2-r3-inline.md)
- [R2 简约比例与生图要求](pre-v2.0.2-r2-review.md)
