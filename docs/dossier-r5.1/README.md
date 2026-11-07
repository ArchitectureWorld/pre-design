# R5.1 Web / DSH 项目总档接入

部署先读 [本地Agent交接](DEPLOYMENT_HANDOFF.md)。本目录是已集成源码的使用说明，不要求重新应用旧压缩包安装器。

- [数据与接口说明](INTEGRATION.md)
- [原包验证范围](PACKAGE_VERIFICATION.md)
- `SOURCE_MANIFEST.json`：原始包及此次同步的源文件哈希。
- `SYNC_VERIFICATION.json`：本次分支同步实际运行结果。
- 真实目标机验收入口：`bash scripts/dossier-r5.1/VERIFY-LIVE.sh --allow-model`。

尚未部署或验收的能力不标成运行完成。保留现有11章、75节、97项矩阵，不改 main。
