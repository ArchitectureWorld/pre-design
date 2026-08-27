# 前期策划 DSH 技术合同包 v0.6

本目录是前期策划 Agent 的**可编码业务合同层**，不是演示文件集合，也不是独立 Web 应用。

## 固定产品形态

```text
仓库：dsh-preplanning-agent
包名：@architectureworld/dsh-preplanning-agent
插件 ID：preplanning-agent
形态：单 DSH Bundle，包含 Host half + Browser half
```

首版直接安装到 DSH Web Profile；不得先建设独立 Web、通用 Runtime Adapter 产品或产品级 Mock Runtime。

## 开发起点

1. 阅读 `docs/technical-contract-v0.6.md`。
2. 读取 `governance/runtime-interfaces.json`，在 DSH 原生 Bundle 内实现 Host/Browser 绑定。
3. 模型只注册两个工具：
   - `preplanning_get_context`
   - `preplanning_apply_commands`
4. `T01—T47` 是 Workflow 内部原子能力，不直接暴露为 47 个无约束模型工具。
5. 通过 `state/`、`tools/`、`workflows/`、`gates/` 注册合同。
6. 运行：

```bash
python tests/test_contracts.py
```

## 核心禁令

- Agent / LLM / Tool / HTML / PPTX / PDF 不得直接写 Project State。
- Agent 和 system service 不得批准章节 Gate。
- 所有写入必须携带 `expected_revision`、`actor`、`reason`、`idempotency_key`，并经过 ProposalEnvelope 与 T42 校验。
- 语义变更必须保留历史，并按依赖 DAG 最小回退。
- 一个项目同一时刻最多存在一个阻断性问题；问题与答案必须持久化并可恢复。

## 目录职责

- `common/`：公共 Schema。
- `state/`：57 个业务对象 Schema。
- `tools/`：47 个内部原子工具合同。
- `model-tools/`：2 个 DSH 模型工具合同。
- `workflows/`：57 个命令式状态机。
- `gates/`：G1—G8 人工决策合同。
- `governance/`：权限、命令、依赖、Revision 与 DSH 原生绑定边界。
- `tests/`：57 正例、57 反例、8 个可执行黄金案例与 20 个规则级验收场景。
- `docs/`：人读版架构、循环自检和技术合同。

生成时间：2026-08-27T05:53:11+00:00


## Canonical 949 说明

本目录为最终规范化快照：在原 797 项基础合同断言上，补入 2 个模型工具合同及 20 个规则级验收场景，当前运行 `python tests/test_contracts.py` 应得到 `949 passed / 0 failed`。旧 ZIP 或旧 HTML 中的 797 数字仅代表补丁前的测试口径，不代表业务合同差异。
