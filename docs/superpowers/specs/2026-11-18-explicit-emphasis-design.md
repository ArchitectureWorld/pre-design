# 可追溯强调候选与显式文字绑定

目标：让上传参考稿中的图像强调区域成为可检查候选，并允许用户在自己的项目原文中选择准确文字；不从图像坐标猜测字符，不改源稿/旧版，不增加模型调用。

采用既有 Reference Bundle、fidelityFeatures、参考对照和内容映射。替代方案（自动OCR猜词、独立强调资源库）分别违反明确绑定要求/唯一库架构，故不采用。实现选择由本执行者提出，parent已要求实施同一目标；本文件待确认后执行。

fidelityFeatures 可选 emphasisCandidate v1：componentId、regions（0..1 source-page rect，最多16）、status固定pending-text-binding。限定 feature=rich-text、evidenceKind=image、representation=unverified、editability=unknown、唯一对应text/title槽及既有source SHA/page可达。拒绝任何源文字/权限/已接受字段。新组件语义任务生成，旧任务不变；不改变模型prompt/schema/cache。

原页对照显示候选来源、区域、待审与不能自动转成文字位置的说明。项目内容映射对每个text槽给只读原文选择区；用户自行选中片段并选择strong/accent/accent-strong生成Unicode码点spans。非连续多片段逐项添加；重叠/空选区/代理字符半选拒绝；更换原文清除该槽spans。默认不添加强调；明确保存才提交。服务端继续精确quote/fingerprint/版本校验，失败保留输入。

候选与原文字段不复制进另一个用户的项目正文；导出版式保留来源候选但不带本项目spans/原文。用户整体审阅不自动消除每次新内容的显式映射义务。来源素材共享仍需另行授权。

验收：源值不改；Unicode/重复短语/注入/重叠/过期指纹/并发负测；真实浏览器原页候选可读、选择后精确片段、失败保留；PG绑定与导出隔离；实际served dist核验。无模型调用。
