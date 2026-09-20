# 自动策划 Schema 纠正

22:35 用户询问进度时，少潭河仍为 revision1、完成1/57项。01.02 的第二轮真实模型分析已通过质量检查（confidence=0.90、无 blocker），但候选在顶层添加了未允许的 `reasoning` 字段，最终写入被 Schema 拒绝。原自动质量循环不校验 Schema，因此没有继续纠正。

## 修复

- 提交前按正式写入相同的受保护元数据规则规范化并校验候选，保留最终提交边界的重复验证。
- 将具体错误路径、禁止字段名称和原候选送回独立子 Agent，至多纠正两次，同时遵守原工作项总尝试上限。修正后重新评估质量；真实外部故障和证据冲突不作为格式问题重试。
- 会话绑定等预检异常按单个工作项失败收尾，不让整个批次成为未捕获异常。
- 额外字段错误显示字段名称，不输出字段值；待修正候选在模型提示中明确标为数据。模型必须返回完整候选，不能复制示例事实或通过删除限制伪造合格。
- 保持原模型选择、授权、版本、上游检查和严格 Schema；不在正式数据中手工删除字段或补写结果。

## 验证与部署

新增失败复现3项、补充异常处理失败复现1项，均随后修复。13套相关测试59/59通过，最终补充后4套21/21通过（有重叠）；最终构建产物5/5、类型、自动化语义、版本一致性和合同锁检查通过。没有重跑无关排版全量；上一轮全量唯一的PDF第28页基线失败仍未解决。

原始真实候选只读复现：`work/ps02-schema-reproduction.json`。原候选只有 `reasoning` 报错，内存副本移除此字段即通过；未借此写入正式项目。

证据：`work/schema-revision-red.log`、`work/schema-revision-context-red.log`、`work/schema-revision-regression.log`、`work/schema-revision-final-focused.log`、`work/schema-revision-final-typecheck.log`、`work/schema-revision-final-built-tests.log`。

最终包：`work/release/schema-revision-20260916/architectureworld-dsh-preplanning-agent-2.0.1.tgz`，SHA256 `39de24e5135014c27f6dfa3b2c964dfc4a0e8a97d3f213921c03e2bc22e3c101`。

沿用用户在本会话的部署及测试授权，于22:45安装并重启正式loopback宿主（PID27508→25544）。备份：`C:\Users\2899\.dsh\backups\schema-revision-deploy-20260916-224543`。模型设置、凭据、四个preplanning存储、Report Studio runtime部署后均与备份一致，安装入口哈希匹配构建。核验记录：`work/schema-revision-deployment-receipt.json`。

安装后立即连接时曾遇启动日志尚未就绪，待宿主监听后再次连接成功。22:46恢复原少潭河会话，从01.02继续；01.01已提交的revision1保留。真实运行结果以 `work/schema-revision-live.json` 和后续记录为准。
