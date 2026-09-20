# 自动策划旧流程清理

用户要求少潭河文旅休闲策划全自动执行，覆盖开发可行性、业态定位和招商方案，不再设置负责人确认或逐项审批节点。

## 原因与修复

V2.0.1 已声明 `humanApprovalRequired=false`，但注册器仍把 V0.6 的人工确认完成条件、复核标记及阶段审批主体传给运行时。真实 Ollama 子会话因此在 01.01 正常产出后，被中央质量检查以“未确认负责人”阻断。

- 保持冻结的 V0.6 合同和持久化 Schema 原样；运行时 57 个工作项采用有效的自动完成条件，保留各项专业条件，将旧人工签认替换为来源、上游、未知、假设和限制的自动核对。
- 8 个阶段关口描述与实际 GateService 一致：由持有效自动授权的中央系统服务执行，模型不得直接审批；显式 manual 模式仍由原人工路线处理。
- 清理缺失资料策略中的 G1/G8 人工前置和人工审查措辞。外部法律或财政批准仍不能由系统伪造。
- Research 区分已采集记录的有效性与资料完整度。缺失决策主体或正式边界时，按 V2.0.1 Research fallbackPolicy 形成条件式研究；validation 仍保留 false，缺失记录不变成事实。初始项目身份仍需真实来源；无效、拒绝、过期证据不准进入条件式路线。
- 条件式研究经过执行器、分析器、中央质量和提交服务，限制强制进入质量假设及审计。Schema、上游依赖、版本、有效授权和质量门继续执行。
- 父/子 Agent 提示统一为自动策划语义。缺失法定角色保持未知，不要求用户补一个“确认人”才能启动。

## 验证证据

首次失败复现：`work/automatic-residue-red.log`，5 个新用例失败；阶段描述残留复现：`work/automatic-gate-residue-red.log`，1 个失败。

定向首轮：`work/automatic-residue-focused.log`，28/28；最终补查 PS02 的人工选定策略，失败复现见 `work/automatic-missing-policy-red.log`，修复后 16/16 通过（与首轮有重叠）。类型检查通过：`work/automatic-residue-typecheck.log`；全量构建及回归：`work/automatic-residue-full.log`，873/874，唯一失败为既有 PDF 第28页矩阵布局基线问题。最后一条策略修复后的构建和构建产物测试 5/5 通过：`work/automatic-residue-final-build.log`、`work/automatic-residue-final-built-tests.log`。自动化语义、版本一致性、Presentation 合同锁检查通过；冻结 V0.6 合同无修改。

覆盖完整的 57 项规则、资料缺失的条件式推进、错误工作项/策略/缺口、过期与拒绝证据、PS01 身份限制、模型输入、中央质量、自动提交和审计保留。

正式研究输入更新前备份：`work/shaotanhe-research-before-automatic-cleanup.json`。用户的全自动要求写入研究输入，未填造开发主体、投资、红线或审批结论。

最终安装包：`work/release/automatic-residue-final-20260916/architectureworld-dsh-preplanning-agent-2.0.1.tgz`。
SHA256：`82cab6b42631f9f8f2dd56850028ae3da95317ae659c7cdcff04074d8ae5b5d2`。

## 部署

沿用本会话“确认部署”和后续直接测试授权，22:11 安装。备份：`C:\Users\2899\.dsh\backups\automatic-residue-deploy-20260916-221148`。通过官方 CLI 离线安装，正式 loopback 宿主由 PID29112 替换为 PID27508；其他监听进程未动。部署后模型设置、凭据、四个前期策划存储及 Report Studio runtime 均与备份一致；已安装 Host/Client 哈希匹配最终构建。凭据及带认证参数的启动日志不纳入开发文档。

部署核验：`work/automatic-residue-deployment-receipt.json`。22:12 对原项目、原会话执行 `/preplan-run`，恢复真实本地模型工作；最终业务结果另记。

## 真实模型验收

真实子会话 `dab1a94b-7c20-4344-aae3-ea1f92186231` 的输入已确认包含有效自动规则，不含旧“项目负责人确认项目对象及启动原因”条件。首次产出完成条件和证据规则全部通过，无 blocker；置信度0.75低于现有0.80门槛，中央服务自动发起修订，没有请求人工确认。

修订子会话 `39a95bb9-e9ea-49e4-b08d-aeea572ae297` 正常完成，中央质量 `auto_pass`，score=0.97、confidence=0.88、completionCoverage=1、evidenceCoverage=1、blockers=[]。正式 PS01 自动提交，项目 revision 由0升至1，Presentation syncedRevision=1。随后系统自动派发 `c0f8dd21-e12d-4c63-80e4-a5b469353623` 进入01.02；该项 Research 缺少决策主体时已可进入条件式分析。

上述会话实际模型均为 `ollama-local/qwen3.8:27b`。浏览器显示01.02运行中，派发模型与实际模型一致，旧01.01子会话已空闲。原先要求负责人确认的业务阻断已消除：状态为automatic、阻断0、待确认0。自动流程继续运行，尚未完成57项策划或正式报告。

实测证据：`work/automatic-residue-live-prompt.json`、`work/automatic-residue-live.json`、`work/automatic-residue-status.json`及对应子会话候选文件。状态还提示工作区来源尚未关联可读取原件，属于后续成果引用检查，不得把当前同步状态表述为正式报告已验收。
