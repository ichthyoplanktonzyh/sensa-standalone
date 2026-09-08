# Sensa Web

React/Vite Web 的正常入口使用已确认的 `experience` 页面与正式 consumer API。
`experience/account/SensaApp.tsx` 负责账号链路组合；原简化 `AccountRoot` 及其页面已删除。
首页、我的学习、账号、目录与 Runtime 共享已有界面组件，不以原型数据替代学习事实。

正常运行需配置 `VITE_SENSA_MODE=production`、`VITE_SUPABASE_URL`、
`VITE_SUPABASE_PUBLISHABLE_KEY` 和 `VITE_SENSA_API_URL`。Web 使用账号独立 IndexedDB
与 outbox，按 Sync v3 push → pull 收敛到 Postgres；模型密钥只在 API 服务端。

`VITE_SENSA_MODE=preview` 仍可显式查看先前的行为原型；它使用独立预览存储，
不代表已发布能力，也不是正式账号数据的导入来源。

本地可用合成认证和无成本 mock API 验证。浏览器 smoke 会检查服务端的
`/__test/environment`，拒绝运行在真实 Provider 体验服务上。
可通过 `SENSA_BROWSER_TEST_URL` / `SENSA_BROWSER_TEST_API_URL` 配置隔离测试端口。
实际集成范围与证据见 [M1/M2 界面接入记录](../../docs/sensa/m1-m2-ui-integration-handoff.md)。

## Preview media

The experience preview uses the installed learning release's immutable audio
files. `npm run web:dev` and Web builds run `scripts/prepareWebMedia.mjs` first.
It reads `content/data/media/audio` by default, or `SENSA_WEB_MEDIA_ROOT`
when provisioned elsewhere, verifies each declared SHA-256, and stages only
release audio in ignored `apps/web/public/golden-audio`. Missing or mismatched
assets fail preparation rather than producing playable-looking broken links.
This step performs no generation or paid provider calls. CI must provision the
approved assets before building; the generated media directory is not committed.
