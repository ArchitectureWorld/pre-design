# 开发工作区

本仓库的主要开发目录为 `E:\前期策划开发`，由用户于 2026-09-16 指定。

- 远程仓库：`https://github.com/ArchitectureWorld/pre-design`
- 当前主线：`main`（Pre 2.0.2）
- 合并来源：`pre-V2.0.2@6807a014b268a1130d8f263cf251d3753467cc1d`
- 历史基线：`main@801afcc794b34fa734ba624303ed9552b152407c`（Pre 2.0.1）
- `D:\shaotanhe` 等项目目录用于原始材料和业务测试。读取材料必须绑定具体 DSH Session 的工作区，不能以本开发目录作为缺省材料目录。
- `Reference` 下的旧检出和历史部署目录保留原样，不作为本轮开发位置。
- 忽略目录 `work/` 用于隔离验证、日志和候选发布包。不得将真实凭据、正式 DSH 配置或正式项目状态提交进仓库。

## 本地检查

```powershell
Set-Location -LiteralPath 'E:\前期策划开发'
pnpm install --frozen-lockfile
pnpm typecheck
pnpm verify:automation-semantics
pnpm test
```

Node 版本要求以 `package.json.engines` 为准，版本关系以 `docs/version-matrix.json` 为准。历史 `HANDOFF.md` 不代表当前已部署版本。

开发验证与正式部署分别验收。Pre 2.0.2 已按用户要求合入 `main`，本地 Web profile 曾按授权部署；后续安装或重启前仍应核对候选包哈希、测试结果、运行任务及备份。

本轮修复与验证记录见 [执行可靠性验证](docs/workflow-execution-reliability-verification.md)。

本轮 UI/UX 交接与验证见 [pre-V2.0.2](docs/pre-v2.0.2-ui-handoff.md)。
