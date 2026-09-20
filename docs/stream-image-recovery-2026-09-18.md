# 生图流失败后的完整图片回收

本轮继续用户已授权的 pre-design 通用修复。代码位于 `E:\前期策划开发` 的既有 `feat/pre-v2.0.1`；不更换分支，不提交推送。此机制适用于任何项目的视觉子会话。

## 已证实的问题

2026-09-18 20:57 启动的原生导出包含两项 Gemini 生图任务。第一项最终采用的图片来自超时终止前的 `assistant/message seq19`。该任务更早的两个失败 `assistant/attempt` 也各有完整图片，但旧收集器完全忽略这些事件，后台继续重试。

第二项 `tea:safety-699e3c11e0976eb6` 的 `assistant/attempt seq13` 已有可解码 JPEG（1024×1024，869780 字节），随后出现 `TRANSPORT: Stream ended without finish_reason`。最终消息没有图，导出失败。原图 SHA256 为 `6bebd699e128e26fd79d9077b316c4b1255e01947915dcd59fccbbaaa3aed372`。这项场景名称只用于说明运行证据，不写入通用程序分支。

网关日志证实一次响应体读取连接错误；其 request_logs 表为空，无法据此声称掌握每次请求的 HTTP 状态或耗时。不得把图像回收修复描述为修复了上游网络。

## 通用修复

- 收集同一子会话当前 turn 的失败流文本，保留 attempt 的 eventSeq/turn/step 标识；忽略其他 turn、游标之前的事件、推理文本和工具参数。
- JPEG 严格解码完整像素并检查结束标记；PNG 校验像素、CRC 及 IEND。限制编码大小、像素数和解码内存，禁止把只有尺寸头的文件当成成图。
- 最终消息中的残缺图片不遮蔽失败流里的完整图片；大量短分片逐段累积，在拼接前限制总长度。
- 活动重试只能由原父 Agent 中止。停止请求后继续观察原会话的终结，重新核验 turn 和图片，再写入资产及完成 execution。无法证明终结、父任务取消或 turn 改变时不采用、不启动替代模型任务。
- 已结束任务可通过原有恢复入口回收原图，保留原 task、attempt、execution 和已选择模型；现有页面来源版本核验与质量门禁继续生效。
- 新增 `jpeg-js 0.4.4`、`pngjs 7.0.0` 及 PNG 类型定义；锁文件只增加33行，原 SDK 依赖解析保持不变。

## 验证

已分别复现：四项缺失回收/提前采用失败、最终残图覆盖与分片栈溢出失败。修复后专项6文件108项通过，类型检查通过。真实失败JPEG经生产解码器读取后哈希与原字节完全一致，记录在 `work/stream-image-probe/decoder-verification.json`。

全量 `pnpm test`：175文件、1334项全部通过（包含构建与安装包测试）。22:26部署包SHA256为 `250fe7517d3d96d67a5f4cf8dafa08dd4d0b142907f80c608d54424ab1714693`，183项安装代码匹配、7项保护数据未变，认证访问HTTP 200。备份目录：`C:\Users\2899\.dsh\backups\visual-story-deploy-20260918-222547`。

首次离线安装因C盘DSH缓存缺少新解码包而失败，已恢复原profile并核对保护数据；恢复时归档并重建了tar展平的DSH模块fallback目录。补齐C盘缓存后重新部署成功，原失败安装/profile也保留在22:20的独立备份中。E盘开发依赖缓存与C盘DSH缓存不共享，不能用开发库安装成功代替宿主缓存检查。

部署前项目仍r103、57项已完成工作流、文字237/图像42条执行、0活动任务；场景覆盖12/33。已启动一次原生`/preplan-export`回收与继续补图。新版汇报HTML尚未交付。

22:27原生流程真实回收成功：旧任务保持execution `0eb069a4-2cfa-4c41-b56b-bdffd49496e3`、原child和attempts=1，采用资产 `472e0b3f-c35e-4e88-b305-16714738fdb9`，文件哈希与失败流原图完全一致。证据：`work/stream-image-probe/deployed-recovery-observation-142830.json`、`work/stream-image-recovery-final-receipt.json`。

随后新请求execution `52df2a9c-7d27-43ef-aead-e768624e2d71` 在22:28:25以completed结束，但最终消息只有reasoning，没有图片、attempt或retry；程序将图像任务标为failed。没有明确provider错误、限额或恢复时刻，不能继续沿用此前的配额阻塞结论。本次没有实测到“活动failed-attempt有图后停止重试”分支，该分支由专项测试覆盖。当前覆盖13/33，仍缺20项；280条项目执行中文字237、图像43，0活动请求，原稿和57项工作流保持不变。30分钟监督继续，新HTML仍未交付。
