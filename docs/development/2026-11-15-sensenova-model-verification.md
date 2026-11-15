# SenseNova 模型 ID 修正与实际接入验证

日期：2026-11-15。测试平台固定入口为 HTTP 4320，DSH 固定入口为 HTTPS 3080。使用用户提供的 SenseNova 接口及凭据，凭据只保存在本机私有配置。

平台配置 V17 完成两项 SenseNova ID 修正：deepseek-v4-flash → deepseek-flash，glm-5.2 → glm-5.3。DeepSeek 官方同名条目不受影响。历史配置与 68 份任务模型快照保持原样。V18 配置 SenseNova 接口及凭据引用，V19 回填实测状态。当前角色路由和每日不限设置保留。

## 真实结果

| 平台模型 ID | 基础回复与流式 | 工具调用与回传 | DSH 接入 | 模型管理状态 |
| --- | --- | --- | --- | --- |
| sensenova-6.7-flash-lite | HTTP 404，当前接口未提供 | 未执行 | 未执行 | 不可用 |
| sensenova-6.8-flash-lite | 通过 | 通过 | 原配置输出预算 65536 通过 | 已验证 |
| deepseek-flash | HTTP 429，TPM/RPM 限流 | 未执行 | 未执行 | 待验证 |
| deepseek-v4-pro | HTTP 404，当前接口未提供 | 未执行 | 未执行 | 不可用 |
| glm-5.3 | 通过 | 通过 | 原配置输出预算 131072 通过 | 已验证 |
| kimi-k3 | 低输出预算下通过 | HTTP 429，TPM 限流，验证未完成 | 未执行 | 待验证 |

6.8-flash-lite 另通过受控图片测试，正确识别左右色块和数字。其余模型没有新增未经验证的图像能力。

## 测试口径

读取平台私有配置，通过真实 HTTP 请求检查随机 nonce、19+23 的结构化答案、非空 finish_reason 和 SSE 的 [DONE]。工具测试校验函数名、参数及回传后的最终答复；图像测试使用无项目资料的合成色块图片。接入确认由平台 ProjectWorkers 启动真实 DSH 子进程，读取同一配置，核对实际 provider / model 和回复。未用受控模型替身作为此次实测结果。

最初测试输出预算为 8192；限流项以 1024 预算复核。DeepSeek 仍限流，Kimi 基础回复成功但后续工具调用被限流。未把限流记为模型不支持工具，也未将待验证条目加入自动备用链。

服务端 /v1/models 返回的 8 项中包含 deepseek-flash、glm-5.3 和 kimi-k3，但未包含 sensenova-6.7-flash-lite、deepseek-v4-pro。平台目录中的 6 项均已发起实际基础请求；未擅自加入服务端返回的其他型号。

44 项模型策略、历史快照迁移、管理界面和 PostgreSQL 回归通过。当前配置迁移幂等，未覆写历史版本。

本机详细证据：.cache/model-id-correction-20261115/；其中 sensenova-results/ 和 sensenova-retry/ 保存原始服务返回、阶段断言和结果，sensenova-native.json 保存真实 DSH 执行身份，sensenova-summary.json 保存汇总。原始凭据、图片与调用日志未提交到仓库。
