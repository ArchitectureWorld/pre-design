# 本机部署约定

- 始终使用简体中文回复用户。
- 独立平台项目放在 `/media/zetta/55c3d58e-22b5-4ac9-80d7-435081fb7a10/Development` 下。
- 用户于2026-11-04明确确定固定入口：DSH 为 `https://192.168.6.45:3080/`；Pre-design Web 为 `http://192.168.6.45:4320/`。
- Web正式运行目录为同级 `pre-design-web-v210`，由 `pre-design-web-v210.service` 托管；DSH由 `dsh-web.service` 托管。升级版本、重启、修复故障时保持端口与协议，不另选端口绕过冲突。
- 4318为旧版历史端口，不再作为用户日常入口。旧版目录仍承载共享PostgreSQL数据，不能因停用旧页面而删除。
- 遇到端口占用先查进程与systemd服务，不直接杀死不明进程，也不自动换端口。修改固定入口必须有用户的新指示。
- 固定入口说明见同级 `pre-design-web-v210/web/app/LAN-ACCESS.md`（在该项目内为 `web/app/LAN-ACCESS.md`）。
