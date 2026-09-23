# Pre 2.0.2 · R3.1 · 模型下拉菜单稳定性修复

## 问题与复现

接续 `pre-V2.0.2@7588ec02a9fc016a1bdc133ce6fabe9f5dded679`。真实 Chromium 原生 select 菜单打开后，约 5 秒自动退出：`:open` 从 true 变为 false，MutationObserver 记录到 5082 ms 时 disabled=true、5138 ms 时恢复 false。原因是每 5 秒轮询及 window.focus 读取复用了前台 busy 状态。旧测试仅检查 await 完成后的 enabled 状态，未覆盖这段短暂禁用。

## 修复

- 自动读取与前台保存/主动重载分离。自动刷新不再禁用控件，也不会触发整个面板的忙碌状态。
- 任一模型 select 仍有焦点时暂停发起自动读取；已经在途的返回值及错误暂存，不改变目录、选项或选中值。焦点离开选择器后恢复；在主模型和配套 LLM 之间直接 Tab 不应打断选择。
- 使用独立的只读 AbortController 及请求身份检查。保存或主动重载可抢占后台读取，后台迟到结果不能覆盖保存结果或清除保存中的禁用保护。
- 会话切换/卸载中止旧读取、清除暂存并移除监听器。仍保留 revision 冲突、未保存草稿和配套 LLM 必填/工具身份校验。
- R3 的 Klein＋LLM 主/备用同排、单个 `+` 和图标操作，以及 A/B/C/D 的布局、配色、光学参数均不变。没有修改后端、依赖、协议、调度或执行任务。

暂停限于配置面板的自动读取，不会暂停 DSH Agent 或正在执行的生成任务。真实窗口/标签切换本来可以关闭浏览器原生菜单；修复保证重新打开后不再被插件轮询打断，并非强迫操作系统菜单跨窗口保持展开。

## 验证

`tests/pre-v202-dropdown.client.spec.tsx` 新增 10 项，其中 9 项在修复前失败，全部在修复后通过。包括四类菜单保护、慢读取返回期间仍在选择、草稿与 revision 冲突、保存抢占、主动重载、会话切换及延后显示错误。类型检查通过。

本地 UI 合计 49/49；完整仓库回归 2026 通过、3 失败、6 跳过。三个失败均为 `tests/full-flow-golden.spec.ts` 中 PDF 流程在 root Chromium 环境下缺少 --no-sandbox；未修改 PDF 代码或删断言规避。构建与构建包测试 5/5 通过，客户端 87,533 bytes（仍低于原 100,000 bytes 上限）。远程全量回归必须看本提交对应的 Actions 结果，不能借用父提交结果。

原生浏览器菜单检查 28 项通过：主模型打开 12 秒不被刷新关闭，主配套/备用选择/备用配套超过 6 秒不关闭；期间无 disabled 或选项 DOM 变更，窗口 focus 事件不触发禁用，仍可用方向键/Enter 完成选择。实际切换浏览器标签、返回再打开菜单超过 6.5 秒也通过。另有布局/交互 46 项通过，覆盖四主题、主备用同行、独立配套保存排序、帮助键盘操作、320/390/620/900/1440 px 无横向溢出。

## 复现与交付

```sh
pnpm install --frozen-lockfile
pnpm exec vitest run tests/pre-v202-*.spec.* tests/agent-class-panel.client.spec.tsx --maxWorkers=1
pnpm typecheck
pnpm test
pnpm test:built
node scripts/build-ui-review-v202.mjs
```

预览默认路径 `work/ui-review-r3-1/pre-V2.0.2-R3.1-preview.html`。HTML 是本轮真实组件与明确标识的模拟 DSH 数据，不会请求实际模型/写入项目；插件候选包取本提交 CI 的产物，以 COMMIT 和 SHA256 区分同版本候选。宿主 DSH、其他浏览器和真实 ComfyUI 出图仍需实际环境验收。

未合并 main、未发布、未安装或重启用户 DSH。
