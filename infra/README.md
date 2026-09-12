# Production infrastructure

生产 Web 使用 Cloudflare Worker 静态托管，账号、数据库和 API 使用 Supabase，邮件由已配置的邮件服务提供。实际目标由 GitHub environment variables、`wrangler.jsonc` 和 Supabase 配置确定。

主要自动化入口：

- `.github/workflows/sensa-consumer-check.yml`：pull request 和 `main` 的 CI；
- `.github/workflows/sensa-web-deploy.yml`：唯一日常生产发布入口；
- `.github/workflows/sensa-web-candidate.yml`：可选深度验证；
- `.github/workflows/sensa-web-monitor.yml`：生产运行检查；
- `.github/workflows/sensa-auth-config.yml`：单独对齐 Auth redirect 的维护入口。

发布流程、授权和回滚边界见 [`docs/sensa/engineering.md`](../docs/sensa/engineering.md)。本地脚本和内容工具不得直接创建或部署云资源。
