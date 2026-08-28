# D0 真实 DSH Host/Browser 证据

日期：2026-08-27（Asia/Shanghai）

## 安装与配置

- 安装包：`architectureworld-dsh-preplanning-agent-0.1.0.tgz`
- 大小：1,559,386 bytes
- SHA-256：`549ABC379D6105FD5E5E010FD7FE27377963E4F6CBC3A75F231FE11CEA8DA580`
- 使用官方 `dsh plugin --profile web` 完成 add/remove/add 生命周期。
- 脱敏 `--dump-config` 核对结果：
  - `id: preplanning-agent`：1 行
  - `name: '@architectureworld/dsh-preplanning-agent'`：1 行
- Profile 备份：`dsh-web-profile-20260827-214642`，4 个配置文件仍全部存在。
- 当前实时 Profile 与备份相比仅 `package.json` 哈希不同，原因是插件当前处于安装状态；其余 3 个配置文件哈希一致。
- 未读取或记录任何凭据内容。

## 合同快照

- 权威目录与插件目录均为 335 个文件。
- 相对路径缺失 0、额外 0。
- 逐文件 SHA-256 差异 0。
- `python tests/test_contracts.py`：949 passed、0 failed。

## Host

- DSH URL：`http://127.0.0.1:65015/`
- HTTP 探测：200
- 插件命令清单：`preplan-new`、`preplan-open`、`preplan-list`、`preplan-status`、`preplan-confirm`
- 模型工具清单严格限定为：`preplanning_get_context`、`preplanning_apply_commands`

## Browser

页面可见内容：

- 顶部贡献：“前期策划 已加载”。
- 原生 `command/done` 对应命令结果包含项目状态摘要。
- 状态卡标题：`鄂州老城区全民健身中心`。
- 状态卡内容：`需要补充信息 · revision 0 · 阶段 01-01`。
- 计数：`待确认 0 项 · 开放问题 1 项`。

修复后的 Session 冷启动可加载，说明 Browser 状态投影不依赖 Host 临时内存。修复前含未知 `preplanning/status` 事件的旧 Session 保留为失败回归证据。

## 当前 Session 直接命令续验

在 `session-f83acedf-6510-4784-a96b-2154f1ef9dc5` 的真实 DSH 页面中继续执行：

- `/preplan-list`：成功列出“鄂州老城区全民健身中心”，projectId 与当前绑定一致，revision 0。
- `/preplan-status`：成功返回 revision 0、待确认 0、开放问题 1。
- `/preplan-status` 对应的原生 `command/done` 再次生成 Browser 状态卡，卡片与命令文本一致。

以上命令均由 DSH Web 输入框直接执行，不是测试替身或源码内调用。
