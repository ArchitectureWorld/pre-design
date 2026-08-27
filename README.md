# 前期策划 Agent（DSH 插件基线）

本仓库 `ArchitectureWorld/pre-design` 保存前期策划 Agent 的封版交接资料与可执行技术合同，作为后续 DSH 原生插件开发的稳定输入。它不是已经完成的插件，也不是最终插件代码仓库。

## 当前稳定基线

| 项目 | 唯一当前口径 |
|---|---|
| 交接包 | `handoff/FINAL_v2.0/` |
| Canonical 技术合同 | `contracts/v0.6/` |
| 可执行合同断言 | `949 passed / 0 failed` |
| 当前阶段 | 专业方法与技术合同已封版；尚未实现可安装 DSH 插件 |
| 下一阶段 | 按 Handoff 执行 D0 → D1，先确认真实 DSH 环境，再跑通真实模型参与的最小纵向闭环 |

## 仓库与插件身份

两个仓库名称承担不同职责，不得混用：

- 当前基线仓库：`ArchitectureWorld/pre-design`
- 合同指定的目标实现仓库：`dsh-preplanning-agent`
- npm 包：`@architectureworld/dsh-preplanning-agent`
- 插件 ID：`preplanning-agent`
- 交付形态：单 DSH Bundle，包含 Host half 与 Browser half

## 权威顺序

发生数量、状态或实现边界表述不一致时，按以下顺序判定：

1. `contracts/v0.6/manifest.json`、`contracts/v0.6/plugin.manifest.json` 与现场执行 `contracts/v0.6/tests/test_contracts.py` 的结果；
2. `handoff/FINAL_v2.0/01_前期策划Agent_DSH插件开发_HANDOFF_FINAL_v2.0.md`；
3. `handoff/FINAL_v2.0/00_README_START_HERE.md`；
4. 交接包中的其他 HTML、Markdown 和 TXT 资料。

`handoff/FINAL_v2.0/06_前期策划_DSH插件技术合同_v0.6.md` 保留了补齐模型工具合同与最终验收断言前的 `797/797` 历史测试口径。该数字仅用于追溯，不能覆盖当前 Canonical 949，也不能作为开发或验收基线。

## 目录职责

- `handoff/FINAL_v2.0/`：从原始 FINAL v2.0 ZIP 解出的完整交接快照，保持原文件和哈希不变；
- `contracts/v0.6/`：从 `CANONICAL_949` 解出的唯一可编码合同快照；
- `README.md`：仅说明仓库定位、当前状态与权威顺序，不替代合同正文。

## 快速校验

```bash
cd contracts/v0.6
python tests/test_contracts.py
```

预期结果：

```json
{"total": 949, "passed": 949, "failed": 0}
```

## 变更规则

- 不在原位改写 `handoff/FINAL_v2.0/` 或 `contracts/v0.6/`；
- 新合同必须使用新的版本目录，并同时更新 Manifest、测试结果和仓库 README；
- D1 通过前，不建设独立 Web、通用 RuntimeAdapter 产品或产品级 Mock Runtime；
- HTML、PPTX、PDF 只是冻结 Revision 的投影，不能成为 Project State 的事实源；
- Agent 和系统服务不得批准 Gate，Gate 只能由指定自然人 `decision_owner` 批准。
