# R5.1 接入与维护说明

## 边界与版本

这是针对已确认的11章体系的资料总档纵向接入，不改变75节目录，也不把目录/方法文档视为97项运行完成。现有Web API、DSH Worker和生产PostgreSQL是唯一部署架构。SQLite仅在离线测试使用。

总档版本与Core项目revision相互独立：请求同时带baseRevision（已有Core保护）与expectedDossierRevision（新总档保护）。不能把一个版本号拿来代替另一种快照。

## 新增存储（只增不删）

| 表 | 作用 |
|---|---|
| pd_dossier_sources | 按项目、来源ID和原文哈希保存当时原话/来源描述，支持旧引文回查。材料原件仍保留在现有原始资料目录。 |
| pd_dossier_interactions | 总档补充、显式更正的原话、提出者和理由。 |
| pd_dossier_versions | 不可变JSON快照及版本、输入哈希、前版关系、关联作业。 |
| pd_dossier_requests | 写操作幂等与重复请求内容冲突检查。 |
| pd_dossier_tasks | 冻结查询、所选成员、数据哈希、原版本及任务指令身份。 |
| pd_dossier_audits | 发布或拒绝记录及可信工具收执。 |

已有materials、jobs和annotations是其他入口的真实来源，不复制模型回答为独立外部事实。编辑或撤回的来源使相应条目标为source_changed/source_withdrawn；不是把整份新文档没提到的旧信息删除。明确更正会保留superseded关系。

读取覆盖与信息采用分开：read_segments表示实际读到片段，不保证全文抽取；metadata_only不能支持图中建筑或红线；所有引用都保留independentlyVerified=false。本批不是事实自动认证系统。

## API（继承原Bearer和项目所有权）

根路径：`/api/projects/:id/dossier`

| 方法与后缀 | 输入 / 输出 |
|---|---|
| GET / | 当前快照、输入差异、库存、覆盖、历史版本、任务状态、真实作业状态 |
| GET /versions/:revision | 固定总档版本 |
| GET /export/json 或 /export/md | `?revision=N`，同源导出 |
| GET /sources/:sourceId | 可选`?hash=SHA256`，回查当时版本原话 |
| POST /messages | requestId、text、intent；仅保存，不消耗模型额度 |
| POST /sync | requestId、baseRevision、expectedDossierRevision，可选inputHash/sourceIds；进入现有队列 |
| POST /corrections | requestId、expectedDossierRevision、recordId、valueText、reason |
| POST /tasks | requestId、expectedDossierRevision、query（all/fields/entityKeys/recordIds/chapters） |
| GET /tasks/:taskId | 冻结输入与当前是否兼容 |
| GET /capabilities | 11章75节×97项映射、D组接入边界和真实版本/作业摘要 |

取消继续调用已有`/api/projects/:id/jobs/:jobId/cancel`。不新建重复取消协议。

## 执行与并发

1. 入队冻结原输入哈希、总档版本、所选来源和Skill文件哈希。
2. 前后校验材料原件身份；DSH只读运行并调用已有preplanning_read_material。
3. 服务端校验模型JSON结构、逐字原值和工具真实收执，严禁模型指定系统ID或审批状态。
4. 提交时重新核对所有原输入与当前版本，并锁定对应jobs行；只有running可发布。
5. 发布总档与jobs终态同一事务提交；取消采用既有workflow-finalize锁，不允许先发布后变成“已取消但未发生”。
6. 正常chat/outline/workflow取得冻结资料包；绑定总档的普通chat强制只读，不能先写Core再由末端校验宣告失败。任务自己的原话是任务指令，不自动成为已采用项目事实；只有这一项可在指纹比较中排除。其他新输入仍触发待归并。这样既不死循环，也不绕过外部变化检查。
7. 按查询内容判断任务过期，包含以前为空、现在出现成员的情况；不只比较旧记录ID。所有新原始输入尚未归并时先保守阻止旧写入。
8. 最终采用与原文正确性不同。表中显示“接口已接”也不意味着目标机或专业能力已经验收。

## 取消与故障

不自动重复付费调用。超时/未知结果沿用原Web interrupted状态；确认已持久化的总档版本可恢复标记。模型错误、伪引文、原件变化、旧版本和取消均保持旧总档不变。客户端有明确失败提示，而不是通过空表宣布成功。

## 维护与下一批

先在目标机完成这条链的真实DSH测试。之后再细化D04实体/单位、D06同口径时效与冲突判断，完善自主文件解析与97项工具适配。当前运行时Skill是D组的受控组合入口，不声称丢失的R3全方法层已恢复。

若新源码已经偏离固定基线，不能仅修改SHA绕过预检。应审阅源码差异、调整补丁锚点、重新运行目标API/取消/并发测试，再生成新包。不要把本包的测试数据库适配或受控Worker装入正式服务。
