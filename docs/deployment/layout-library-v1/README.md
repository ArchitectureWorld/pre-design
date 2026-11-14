# 原生版式库 V1

部署及范围：[DEPLOYMENT_HANDOFF.md](./DEPLOYMENT_HANDOFF.md)

统一资源格式是 `pre-design.layout-package.v1`，不是PPT/PDF收藏夹。`web/app/src/layout-library/contract.mjs` 定义输入，`render.mjs` 是管理端和项目端共同渲染器，`validation.mjs` 进行真实Chromium测量，`store.mjs` 管理资源/发布/绑定，`jobs.mjs` 接入原队列。

复用既有的Zod、JSZip、Sharp、Fastify、PostgreSQL和DSH适配；新增锁定Playwright Core作为实际页面检查驱动。未引入另一套项目后台或模型配置。

实际测试收执和日志以本次GitHub Actions与本地Agent验收为准。预置资源初始为未发布候选；“有名称、可预览、成功保存”不代表“可发布、可用于项目”。
