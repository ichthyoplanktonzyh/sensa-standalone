# Production infrastructure

生产 Web 使用 Cloudflare Worker 静态托管，账号、数据库和 API 使用 Supabase，邮件由已配置的邮件服务提供。实际目标由 GitHub environment variables、`wrangler.jsonc` 和 Supabase 配置确定。

主要自动化入口：

- `.github/workflows/sensa-consumer-check.yml`：pull request 和 `main` 的 CI；
- `.github/workflows/sensa-web-deploy.yml`：唯一日常生产发布入口；
- `.github/workflows/sensa-web-candidate.yml`：可选深度验证；
- `.github/workflows/sensa-web-monitor.yml`：生产运行检查；
- `.github/workflows/sensa-learning-content-publish.yml`：独立发布不可变 Book releases 与 Registry；
- `.github/workflows/sensa-auth-config.yml`：单独对齐 Auth redirect 的维护入口。

发布流程、授权和回滚边界见 [`docs/sensa/engineering.md`](../docs/sensa/engineering.md)。本地脚本和内容工具不得直接创建或部署云资源。

学习内容发布使用受保护的 `learning-content-production` GitHub environment。公开 variables 为
`SUPABASE_PROJECT_REF`、`VITE_SUPABASE_URL` 与 `SENSA_WEB_ORIGIN`；secrets 为 server-only
`SUPABASE_SECRET_KEY` 和用于提升 Edge Function 配置的 `SUPABASE_ACCESS_TOKEN`。发布器只创建或
复用公开的 `sensa-learning-content` Storage bucket，按 digest 写入新对象，并在完整验证后更新
`SENSA_PACKAGE_REGISTRY_URL`；它不删除或覆盖旧 release。
