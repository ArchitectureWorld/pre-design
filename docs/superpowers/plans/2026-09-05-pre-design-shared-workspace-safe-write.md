# Pre-design 共享 Workspace 安全增量写盘实施计划

> 执行方式：继续使用 `feat/pre-v2.0.0`，采用 TDD；不创建支线，不修改 Presentation Contract 0.1.0。

## 目标

将共享 Workspace 写入从“按受管根目录整体重建”改为“精确受管文件 + 持久事务 + 自动恢复”，并在 Linux/Windows 上通过同一安全验收套件。

## 任务 1：建立 RED 验收基线

**新增：**

- `tests/helpers/shared-workspace-fixture.ts`
- `tests/presentation-workspace-ownership.spec.ts`
- `tests/presentation-workspace-identity.spec.ts`
- `tests/presentation-workspace-transaction.spec.ts`

**修改：**

- `tests/workspace-project-root.spec.ts`
- `package.json`
- `.github/workflows/presentation-standard-project-integration.yml`

步骤：

- [ ] 修复现有测试中的 `previousStableIds` 类型错误，使新失败只来自本任务缺失能力；
- [ ] 编写 layouts/ 与未知路径字节级保留测试；
- [ ] 编写三次连续更新、projectId 稳定和无意义重写测试；
- [ ] 编写 projectId 冲突、缺失、非法测试；
- [ ] 编写中途故障回滚、遗留事务恢复、并发锁测试；
- [ ] 编写兼容扩展键保留和受管路径越权测试；
- [ ] 将同一测试入口加入 Ubuntu/Windows Node 24.11.0 CI；
- [ ] 推送并确认测试按预期 RED。

## 任务 2：精确文件所有权与单一身份

**新增：**

- `src/presentation/workspace-managed-paths.ts`
- `src/presentation/workspace-project-identity.ts`

**修改：**

- `src/presentation/standard-project-service.ts`

步骤：

- [ ] 从当前 Build 和 Manifest 提取精确受管路径；
- [ ] 禁止 `layouts/**` 和所有非受管候选路径；
- [ ] 读取 `project.json.projectId` 并验证稳定 ID；
- [ ] Workspace projectId 与 Binding/Build 不一致时写前失败；
- [ ] Binding 缺失 Canonical ID 时从现有 `project.json` 恢复，而非新生成；
- [ ] 运行身份和所有权测试至 GREEN。

## 任务 3：持久化写事务与恢复

**新增：**

- `src/presentation/workspace-write-transaction.ts`

**修改：**

- `src/presentation/workspace-project-writer.ts`
- `src/presentation/standard-project-types.ts`
- `src/index.ts`

步骤：

- [ ] 用同级固定事务目录的原子 mkdir 实现跨进程写锁；
- [ ] 持久化 owner、journal、candidate 和 backup；
- [ ] 逐文件原子移动，禁止根目录或受管目录整体替换；
- [ ] 同哈希文件 no-op；
- [ ] 故障时逆序恢复旧文件并删除新文件；
- [ ] 死亡 PID 遗留事务在下一次启动或写入前自动恢复；
- [ ] Host 启动时恢复已绑定 Workspace；
- [ ] 运行事务、并发和跨平台测试至 GREEN。

## 任务 4：兼容扩展字段与 Contract 校验

**修改：**

- `src/presentation/workspace-project-writer.ts`

步骤：

- [ ] 对现有和候选 Canonical JSON 执行“候选字段优先、兼容未知键保留”的对象合并；
- [ ] 数组保持候选整体语义；
- [ ] 合并后逐文档及全项目执行 Contract 0.1.0 校验；
- [ ] 不修改 Schema、Contract 包或 Schema Hash；
- [ ] 运行兼容字段测试至 GREEN。

## 任务 5：机器可读兼容验收与文档

**新增：**

- `scripts/emit-workspace-compatibility-result.mjs`
- `docs/architecture/shared-workspace-ownership.md`
- `docs/acceptance/pre-design-presentation-workspace-compatibility.md`
- `docs/acceptance/pre-design-presentation-workspace-compatibility.json`
- `docs/handoff/2026-09-05-pre-design-presentation-workspace-handoff.md`

**修改：**

- `README.md`
- `HANDOFF.md`
- `docs/version-matrix.json`
- `scripts/verify-alignment-version-consistency.mjs`

步骤：

- [ ] 输出 Contract、projectId、所有权、rollback 和平台结果 JSON；
- [ ] 记录精确受管路径、事务与错误码；
- [ ] 明确 Presentation V0.2.0 负责 layouts/ 和排版同步状态；
- [ ] 明确当前仓库 Fixture 验证与仍需下游联合 E2E 的边界；
- [ ] 记录最终分支、实现提交、CI 和复现命令。

## 任务 6：最终门禁

在最终提交代码上重新执行：

```text
pnpm install --frozen-lockfile
pnpm verify:alignment-versions
pnpm verify:presentation-contract
pnpm test:workspace-safety
pnpm typecheck
pnpm build
pnpm test
pnpm test:built
git diff --check
git status --short
```

GitHub Actions 必须同时满足：

```text
Ubuntu workspace safety = success
Windows workspace safety = success
Ubuntu full regression = success
```

最后确认：

- [ ] 最终远端 HEAD 未被其他提交抢占；
- [ ] Contract Schema 与 Hash 未变化；
- [ ] 未创建新分支；
- [ ] 未合并 main；
- [ ] 工作区清洁；
- [ ] Handoff 可供下一会话直接继续。
