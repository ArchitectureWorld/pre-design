# R2 review correction

最新修订与复核说明见 [R2 UI review](pre-v2.0.2-r2-review.md)。版本仍为 2.0.2，以候选包 commit/hash 区分；下文保留首轮交接记录。

# Pre 2.0.2 · 液态玻璃 UI / UX 开发交接

## 状态与边界

- 仓库：`ArchitectureWorld/pre-design`；开发支线：`pre-V2.0.2`。
- 基于 `main@801afcc794b34fa734ba624303ed9552b152407c`；接续支线上的 CI 与测试提交 `42076eb2d17c18415b2ee1490e5c1686b32eba90`。
- 本次是实际 React 插件代码，不是将独立 HTML 原型或效果图嵌入插件。
- 候选包版本 `2.0.2`，未合并 main、未发布 npm、未安装或重启用户 DSH。真实宿主界面验收仍待执行。
- DSH SDK 保持 `0.1.5-rc.1`，Node 要求 `>=24.11.0`；Presentation Contract / Project Format 保持 `0.1.0`，研究基线保持 `research/v2.0.1`。不要把 UI 版本传播到协议版本。

## 已完成的界面

`LiquidGlassShell` 包裹原主面板中的 `PreplanningProjectForm` 和 `AgentClassPanel`。不增加产品侧边栏或工作流阶段，不修改 DSH 的主界面、会话和工具调度架构。

| 方案 | 色系 | 折射强度 | 磨砂 | 高光 | 悬浮 |
|---|---|---:|---:|---:|---:|
| A | 浅色克制 | 36 | 21 | 86 | 72 |
| B | 浅色强液态 | 82 | 15 | 100 | 96 |
| C | 深色克制 | 36 | 21 | 86 | 72 |
| D | 深色强液态 | 82 | 15 | 100 | 96 |

C 是 A 的深色版，D 是 B 的深色版；成对方案采用相同的尺寸、圆角、折射与悬浮参数，仅配色不同。首次打开默认 C，此后尝试恢复本浏览器的外观偏好。主题切换不重新挂载业务组件，不发送配置保存或项目启动请求，不清空未保存草稿。

外观面板提供折射、磨砂、高光、悬浮滑杆、动态光影开关、折射观察网格、还原外观。Escape 关闭面板并返回触发按钮焦点。外观采用独立 localStorage key；存储受限时不阻断业务，并在面板显示仅本次有效的提示。

## 真实功能与 UX

- 保留 Workspace-first 零输入启动、原始资料等待/重新检测、真实打开项目文件夹、已有项目关联和运行状态。
- 保留四类实时 DSH 模型目录、Provider 可用状态、ComfyUI 主/备用选项配套 LLM、备用模型添加/删除/排序、原有数量上限。
- 保留服务端配置 revision 冲突保护、5 秒读取刷新和切换会话时的 AbortController 清理。轮询不覆盖未保存草稿。
- 初次配置读取失败可手动重试；当前会话绑定未确认时不允许重复启动项目。无会话的新 Workspace 不因全局配置错误而永久卡死。
- 明确显示“有未保存的修改”，仅服务端保存成功后显示成功；刷新、保存、冲突和缺少配套 LLM 状态分别呈现。
- 新增当前项目执行记录：只展示服务端返回的该项目 execution，最近 20 条，持久执行结果与子会话活动分别显示。`idle` 只表示“子会话空闲”，绝不显示为已完成。
- 启动和打开文件夹增加同步重入保护，避免同一事件轮次的重复操作。

## 实现文件

- `src/client/glass-appearance.ts`：四主题及外观恢复/数值边界。
- `src/client/glass-styles.ts`：全部样式作用域 `.pre-glass`，随客户端 JS 加载，不依赖宿主额外 CSS 请求，不使用全局 reset。
- `src/client/glass-optics.ts`：凸形边缘位移场、SVG backdrop 折射；中心和前景文字不参与形变；动态卡片增删/尺寸变化时更新，卸载时完整清理。
- `src/client/LiquidGlassShell.tsx`、`GlassIcon.tsx`：真实外观组件和内联图标。
- `src/client/AgentClassPanel.tsx`、`ClassExecutionPanel.tsx`：实时配置与执行记录。
- `src/client/PreplanningProjectForm.tsx`、`index.tsx`：工作区入口和状态读取防重复启动。
- `tsdown.config.ts`：只对浏览器产物启用 minify，保留 source map；不放宽原有客户端 `<100,000 bytes` 测试预算。

折射是艺术化屏幕空间模拟，不是物理 IOR 或光线追踪。缺少 SVG backdrop / Canvas / ResizeObserver 时退回 CSS 磨砂与厚度层。原生 select 下拉菜单由浏览器绘制。动态高光和悬停遵循减少动态效果偏好。没有全屏持续渲染循环或新的第三方前端依赖。

## 验证与复现

```sh
pnpm install --frozen-lockfile
pnpm exec vitest run tests/pre-v202-*.spec.* --maxWorkers=1
pnpm typecheck
pnpm test
pnpm test:built
git diff --check
```

本地使用同一源提交的 GitHub Actions 依赖快照及 Node 24.11.0。沙箱无法访问 npm，使用轻量脚本转发器执行仓库现有 package scripts；GitHub CI 使用真正的 pnpm 10.15.1 和 frozen lockfile，应以本提交的远程 CI 结果为完整回归依据。

本地验证记录：新增 UI 测试 14/14，类型检查通过，构建通过，构建产物测试 5/5。首次全量回归 1,997 通过、4 失败、6 跳过：其中客户端包体积超限已启用 minify 修复且构建包测试复核通过；其余 3 项为 `full-flow-golden.spec.ts` 的 PDF 浏览器运行，沙箱 root 启动 Chromium 被限制，未改写业务实现或降低测试门槛规避。

Chromium 页面检查使用真实插件 React 组件和模拟 API 数据：四主题、A/C 与 B/D 的相同几何、切换保留草稿且不写服务端、备用模型与保存、外观调节、Escape、320/390/620/900 像素宽度无横向溢出通过；6 个 SVG 折射层生效，页面异常为 0。本环境导航受管理策略限制，使用 `set_content` 渲染；不是已安装 DSH 的宿主验收，不声称其他浏览器已验证。外观持久化使用 jsdom 重新挂载验证。

## 下一步宿主验收

在不含在途任务的测试 DSH 实例里使用本分支构建的候选包；按照项目已有安装方式加载，不自动更改用户的 cordis 配置。先核对包版本，再检查主面板四主题、真实 Workspace 路径/关联状态、真实模型目录、保存 revision、ComfyUI 配套 LLM、运行中/空闲子会话、窄栏滚动和重新打开面板。A/B/C/D 切换不得启动项目或改动模型配置。

特别检查宿主 WebView 的 SVG backdrop 支持与 CSP；不支持高级折射时允许降级，但所有文字与业务操作必须保持可用。确认用户视觉验收与宿主行为均通过后，再另行决定合并 main；本交付没有授权执行该合并。
