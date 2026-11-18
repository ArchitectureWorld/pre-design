# 全页参考读取：实现计划与验证

## 批准范围与实现

1. 移除 native-v3 会话人为总页数 300 门槛；原件大小、权限、正安全整数、每批提取 30 页和视觉批次最多 6 图不变。
2. Coverage 以实际观察原页集合限定输出长度，先拒绝超长数组再解析字段；逐页来源、原 fact ID、完整性与唯一性仍验证。UI 支持超过 300 的真实计数。
3. sparse derivation 和 component selection 路由去掉人为页码 300 门槛；实际来源证据/页数校验不变。Compare 原本没有该上限，不改。
4. 预算保持每任务 30 分钟、每阶段 180 秒、最多 60 个新模型阶段。使用现有 retry→enqueue→execute 和拥有者隔离 checkpoint，不新增状态或迁移。预算耗尽明确可继续，仅复用仍匹配且验证通过的检查点。
5. 发现既有摘要后，301 页合成 inventory 65,349 字符 + observations 76,865 字符，仍超 140k。仅原成功路径均无法容纳时采用显式 `grouped-design-facts-v1`：相同来源与设计值分组，每页保留原页码和有序 extracted/observed fact IDs，值与 provenance 不改。原 compact 上下文继续验证模型证据。
6. 同一编码仅在原型已有摘要仍超过 200k 的原失败路径启用。保留完整 sourceSelection、私有原始观察、逐页 coverage；直接图像仍最多 6 张。旧成功 prompt、属性顺序与 checkpoint 不变。

## TDD 与验证

首次红测试复现：301/601 coverage .max(300)、总页 admission 413、UI/路由拒绝 301，以及超长输出在长度拒绝前访问页字段。预算红测试复现缺少可继续提示。端到端合成再发现 140k 综合和 200k 原型瓶颈，加入编码后验证通过。

定向命令（仓库根目录）：

```sh
node --test web/app/tests/layout-reference-all-pages.test.mjs web/app/tests/layout-reference-coverage.test.mjs web/app/tests/layout-reference-jobs.test.mjs web/app/tests/layout-conversation-ui.test.mjs web/app/tests/layout-sparse-route.test.mjs web/app/tests/reference-stage-checkpoint.test.mjs web/app/tests/layout-reference-checkpoint-store.test.mjs web/app/tests/*image-slot-contract.test.mjs web/app/tests/reference-image-batches.test.mjs web/app/tests/layout-native-workflow.test.mjs web/app/tests/*design-summary*.test.mjs
```

初次与独立审查：67/67 通过；补充逐事实解码与 provenance 负控后的最终定向回归：68/68 通过。执行日志：`/tmp/reference-all-pages-regression.log`。

新增全页测试初次单独复验 11/11，补充逐事实解码负控后为 12 项：301/601 真实 jobs.retry→enqueue→execute 多轮、每轮≤60新调用、所有已完成阶段全程只调用一次；最终全部原页 observed/synthesized 且完整、真实 Native compile gate 通过。实际 profile≤140k、prototype≤200k、全页来源列表保留、最多6图均断言。未选原事实仍保留。不同结构、property、value 与 source 不错误合并。UI验证301合法、302超301页源拒绝、缺kind但明确image MIME的单页默认兼容。

旧兼容验证包括 image-slot-contract 的 legacy 精确 JSON 属性顺序，以及 checkpoint 的完整重复运行零新调用、来源/图像实际字节/策略/skill/input变化不复用、篡改拒绝和owner隔离。`git diff --check` 通过。

## 证据边界

- 301/601 使用合成元数据、合成图像字节和受控模型答复；实际执行工作流、预算恢复、事实验证和编译门禁。不是业务 PDF，也不是外部真实模型或美感验收。
- 后续新增真实301页低复杂度合成PDF解析验收，见下节；DB上传持久化仍未由该脚本实证。
- 解除总页数硬限制不等于全文逐字无损：已有每页文字与阶段输入预算仍在，原始观察私有保存；综合采用已选设计事实。
- 极端完全不同事实即使编码仍超过140k/200k时明确失败，保留检查点，不建议截断文档，也不声称原样重试必成功或任意大小文档必成功。
- 冻结HTML→PDF导出两份未完成草稿不属于本批，不提交、不接API/UI、不发布。


## 真实301页PDF解析补充验收

```sh
node web/app/tests/reference-pdf-301.acceptance.mjs
```

脚本以 pdf-lib 生成301页、每页带唯一原页码的低复杂度PDF，直接通过产品 `extractReferenceDocument` 与真实 Poppler 分11批读取。结果通过：1–300每批30页、末批301–301；每批pageCount始终301，readPages/pages/images原页码逐一对应，无遗漏、无重复；逐页文字、图像尺寸与sha校验，原件hash不变。真实运行15.3秒。末页文本为 `SYNTHETIC ORIGINAL PAGE 301`，并通过像素检查及人工view_image确认独特绿色背景和页码。

临时证据目录 `/tmp/pre-design-pdf-301-acceptance/`：receipt.json（全部301页图文哈希与批次收执）、page-301.png、page-301.txt、synthetic-301-pages.pdf。源PDF和图像产物不提交仓库。该脚本不调用外部模型、不读私有业务资料，不等于DB上传持久化或业务文件设计质量验收。

补充分组编码回归：解码后每页每项fact的id、完整value、provenance与附加元数据深等；相同property/value但不同provenance不能合并。
