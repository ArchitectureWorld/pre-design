# 固定局域网入口

2026-11-04用户确认：后续版本升级、重启和故障处理都保持以下入口。

| 服务 | 固定入口 | systemd 用户服务 |
| --- | --- | --- |
| DSH | https://192.168.6.45:3080/ | dsh-web.service |
| Pre-design Web | http://192.168.6.45:4320/ | pre-design-web-v210.service |

Web运行项目为 `/media/zetta/55c3d58e-22b5-4ac9-80d7-435081fb7a10/Development/pre-design-web-v210`。4318属于旧版，不再作为日常入口；不会同时启动旧版争用业务资源。登录仍使用现有凭据。

Web主配置为项目内 `.local/web/config.json`，`port` 必须为4320，`host` 为 `0.0.0.0` 或 `192.168.6.45`。启动脚本会检查，不符合时明确报错，不更换端口。端口被其他进程占用时应定位占用来源；不要将服务搬到新端口。测试进程需使用独立测试环境。

DSH启动脚本显式使用3080，已安装的 `91-lan-tls.conf` 指定局域网地址并启用已有证书。DSH服务重装脚本同步这一配置，不再恢复旧Tailscale入口。DSH首次登录使用其服务启动链接，基础URL不变。

两项Web依赖服务已启用，用户管理器 `Linger=yes`，退出终端不影响服务。Web设置 `Restart=always` 和5秒重试；DSH设置 `Restart=on-failure` 和10秒重试。共享数据库由 `pre-design-local-postgres.service` 在开机时启动，数据仍在旧版 `pre-design-web/.local/web/postgres-data`，不可删除；该oneshot服务不是数据库进程持续健康监控。

```bash
systemctl --user status dsh-web.service pre-design-web-v210.service pre-design-local-postgres.service
systemctl --user restart pre-design-web-v210.service
systemctl --user restart dsh-web.service
```

Web服务模板已保存在 `web/app/systemd/`，与当前安装配置一致。需要恢复时从此项目根目录执行（保留原有私有配置及数据）：

```bash
install -m 600 web/app/systemd/*.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now pre-design-local-postgres.service pre-design-web-v210.service
```

模板针对本机1TB硬盘上的路径。迁移到其他服务器时应调整路径，并保留用户确认的端口；不能复制访问令牌到公开文档。当前IP由网络DHCP提供，此任务未修改网卡或路由器设置。


## 本次验证

- 2026-11-04：DSH安装脚本测试、启动参数测试及实际HTTPS认证页面检查通过；重新运行安装脚本仍保持3080和既有TLS配置，没有重启DSH会话。
- Web错误端口（含0随机端口）和仅回环监听配置均被启动检查拒绝；正确4320配置通过。
- Web无运行任务时实际重启服务，重启后仍为4320；浏览器重新登录、显示项目总览通过，无页面错误。证据 `.cache/fixed-lan-entry-20261104.json`。
- 两个服务与数据库启动依赖均已enabled；用户Linger=yes。未重启整机；不将配置检查称为实机开机验收。
