# Resource-style 内容适配验证

## 目的与边界
独立“基于当前风格创建内容适配版”，不要求或伪造模型任务，不宣称恢复原PDF分析。owner明确确认后，从已保存package的安全风格创建固定0–3要点/纯段落布局，同资源新草稿，原版/权限/素材保持。无模型调用、不自动发布/绑定。

来源审阅依赖服务端私有mutation精确匹配输出/源版本hash；新增layout左侧显示冻结源资源合成样例，右侧平台重新设计。原layout仍须原图对照。公开marker不能授予免审。普通改名/编辑后尚不传播私有来源收执，明确拒绝重新审阅，历史/既有成果保留；不承诺回旧版重审。

## 本地证据
- UI新增确认/dirty/POST及GET锁/迟到保护：先RED后GREEN，新旧11通过。
- 私有来源helper 13通过；独立comparison二次resolver及双hash 4通过；review-ui含双预览/切换7通过。
- 整合78项通过；普通修订新反例先复现后修复，相关18通过。独立审查37项通过，后续修订保护代码复核通过。
- 41391bb全Web运行1150项：1078通过、56失败、16跳过。所有失败名称与堆栈保存在私有/tmp/resource-style-final-web.log；主要PG Unix socket connect EPERM、Chromium/Poppler不可用，未将此称为全绿。必须后续完整CI取得实际通过。

## 未计入通过
完整真实业务package/首页/授权raster的PG+Chrome预览→选用→HTML尚在进行，现网仍前版f042037。本文件不构成视觉质量、生产部署或真实业务闭环通过证明。新PDF/PPTX导出不在范围内。

## 真实业务私有验证完成（部署前）
完整现有源候选与真实业务首页，仅复制已有授权raster及原source SHA记录到临时PG，不读取PDF源或受限native提取，不伪造参考jobs。新derive-style→validate→旧layout原页compare、新layout冻结源资源样例compare→review→私有publish→binding→visual→HTML实际通过；5槽无溢出，全文、outerHTML、槽几何一致，0外部模型/0生产写入。

真实UI追加通过：未勾确认时0 POST，确认后1 POST生成同资源V2；矩阵实际原文和双击大预览可见，未自动审核/发布/绑定，bindings深等。测试脚本SHA256 eb9865350f0d67f4ae2c1a929367300e64adfcc03279ea59c36f654741f9a94e，与CSADI实跑版本一致。
作者亲看实际页与UI大预览：暖白底赭色大标题、原段落和两点清楚，无虚构图片；仍是极短内容的留白版，不称复杂页面品质或原件保真。仅当前实际页已验，不泛化为全项目成功率。UI中的蓝框是悬浮批注高亮，不是导出版式线。
私有manifest、业务原文、源图、截图与收执不进入Git或公共CI；公共CI另用明确合成输入回归。
