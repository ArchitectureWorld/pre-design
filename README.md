# 前期策划 Agent（DSH 插件）

本仓库用于研发可在 DSH 中运行的前期策划 Agent 插件。

## 当前稳定基线

- 交接包：`handoff/FINAL_v2.0/`
- Canonical 技术合同：`contracts/v0.6/`
- 合同断言：`949 passed / 0 failed`
- 当前阶段：专业方法与技术合同已封版，尚未实现可安装 DSH 插件
- 下一阶段：按 Handoff 执行 D0 → D1，先确认真实 DSH 环境，再跑通真实模型参与的最小纵向闭环

## 快速校验

```bash
cd contracts/v0.6
python tests/test_contracts.py
```

预期结果：

```text
{"total": 949, "passed": 949, "failed": 0}
```

## 权威入口

1. `handoff/FINAL_v2.0/01_前期策划Agent_DSH插件开发_HANDOFF_FINAL_v2.0.md`
2. `contracts/v0.6/README_START_HERE.md`
3. `contracts/v0.6/plugin.manifest.json`
4. `contracts/v0.6/model-tools/`
5. `contracts/v0.6/workflows/`

除非经正式版本升级，不得以旧版 `797/797` 合同包替代当前 Canonical 949 基线。
