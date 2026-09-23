# Pre 2.0.2 / DSH 0.1.5-rc.1 部署说明

本说明对应 `pre-V2.0.2` 的开发与本地部署候选。Pre 是 DSH 的前期策划 Skill / Workspace 插件，实际执行仍由 DSH Agent 完成。Research 合同继续使用 `research/v2.0.1`，其目录版本与 Pre 产品版本独立。

## 固定版本

- Pre: `2.0.2`
- DSH: `0.1.5-rc.1`
- Node.js: `>=24.11.0`
- pnpm: `10.15.1`
- Presentation Standard Project Directory: `0.1.0`

DSH 官方 `0.1.5-rc.1` CLI 将 `dsh plugin --profile <name> <pnpm args>` 定义为 profile 插件管理入口，并在目标 profile 目录中把后续参数转发给 pnpm。Pre 的 package manifest 已声明 `dsh.bundle.patch`，因此安装 tarball 后由 DSH profile 组合加载。

## 从当前仓库构建

```bash
git switch pre-V2.0.2
git pull --ff-only
corepack enable
corepack prepare pnpm@10.15.1 --activate
pnpm install --frozen-lockfile
pnpm test
pnpm test:built
mkdir -p dist
pnpm pack --pack-destination dist
```

部署前应以 GitHub Actions 的 `Pre 2.0.2 UI and UX` 最新成功 run 为准，并确认本地 HEAD 与该 run 的 `head_sha` 一致。安装前备份 DSH Web profile 和 storages，确认无运行中的项目任务，保存包哈希；安装后核对项目数据并在真实页面验收。

## 安装到 DSH Web profile

**必须传 tgz 的绝对路径。** `dsh plugin` 会在 profile 目录里执行 pnpm，因此仓库相对路径 `./dist/...` 会被错误地相对 `$DSH_HOME/profiles/web` 解析。

在仓库根目录先取得绝对路径：

```bash
TGZ="$(pwd)/dist/<生成的-tgz>"
```

若 `dsh` 已在 PATH：

```bash
dsh plugin --profile web add "$TGZ"
```

若不依赖全局 DSH，可固定 rc.1：

```bash
npx -y @deepseek-ai/dsh@0.1.5-rc.1 plugin --profile web add "$TGZ"
```

安装后检查组合配置：

```bash
dsh --profile web --dump-config
```

然后重新启动 Web profile：

```bash
dsh web
```

## Workspace 使用方式

Pre 2.0.2 在第一条聊天消息之前就注册 root 级 `sidebar.panellist + main` 入口。进入一个 DSH Workspace 后可直接打开“前期策划”，不需要先发送 `hello` 或任何占位消息。桌面宽度达到 960px 时，四张子 Agent 设置卡片排成两列；窄窗口自动回到单列。

```text
DSH Workspace/
├─ 原始资料/          # 用户输入区；Pre 只读扫描
├─ project.json
├─ rules.json
├─ outline.json
├─ pages/
├─ source-materials/  # 标准化副本；不要与“原始资料”合并
├─ assets/
└─ layouts/           # Pre 不接管
```

- Workspace 路径本身就是项目根目录。
- 项目显示名来自 Workspace 文件夹名；项目身份仍由 `project.json.projectId` 决定。
- `原始资料/` 不存在时会自动创建。
- `原始资料/` 为空时显示“等待原始资料”，不会启动分析，也不会创建伪造用户消息。
- Pre 只写自身管理的 Canonical 文件；未知文件、用户文件和 `layouts/**` 必须保留。

## 最小部署验收

1. 启动 DSH 0.1.5-rc.1 Web profile，并创建/打开一个 Workspace。
2. 不发送任何聊天消息，确认左侧能看到“前期策划”。
3. 打开前期策划，确认没有项目名或“一句话描述”输入框。
4. 点击“开始前期策划”。空 Workspace 应进入“等待原始资料”。
5. 将一个 PDF/图片/Office 文件放入 `原始资料/`，再次检测后应登记到标准资料链。
6. 确认 `source-materials/` 是标准化副本，而 `原始资料/` 原文件未被移动、重命名或删除。
7. 确认 `layouts/` 和任意未知文件保持不变。
8. 正常推进后确认 `project.json / rules.json / outline.json / pages/ / assets/` 可被 Presentation 0.1.0 直接读取。

## 边界

该分支目前是“可部署候选”，不是 npm 正式发布版：没有 `v2.0.2` Tag，也未合并到 `main`。部署时应固定最终通过 CI 的 commit SHA，避免直接跟随移动分支头。本地验收与当前支线文案 Review 见 [2026-09-23 记录](pre-v2.0.2-branch-review-2026-09-23.md)。
