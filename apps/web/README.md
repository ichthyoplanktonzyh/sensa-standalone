# Sensa Web

默认和 `VITE_SENSA_MODE=production` 均进入现有完整 `experience/App.tsx`。
打开 `/profile`、`/content` 等原路径即可使用；不需要专用本机页面或查询参数。
构建不要求配置账号；首次使用需要邮箱注册/登录与在线服务权限。已初始化设备在服务不可用时可继续本机使用。

已接入：首次邮箱验证码与服务权限、完整导航、原学习偏好/计划、文本本机保存、默认 Sensa 服务、高级 Provider 配置、老师澄清与明确接受。
新本机资料保存在独立 IndexedDB；自带 Key 仅存当前页面内存。生成/审核的用途选择不代表
整个资源生成链已完成。学习包本地结算、离线冷启动、备份恢复、E2EE 和上线验收仍在推进。
原 App 内尚有迁移期学习实现；完整页面和成功构建不能视为整个产品已生产就绪。

`VITE_SENSA_MODE=legacy-account` 显式启用旧 consumer 账号链路作迁移回归。
仅此模式要求 `VITE_SUPABASE_URL`、`VITE_SUPABASE_PUBLISHABLE_KEY`、`VITE_SENSA_API_URL`。
其账号独立 IndexedDB/outbox 与旧 API/Postgres 保持原样，不自动迁入新库。
`preview` 目前也是完整应用入口，不再决定另一套页面。

无成本完整应用回归：`npm run sensa:web-local-journey-smoke`，默认指向隔离 loopback 3014，
可设置 `SENSA_LOCAL_WEB_URL`。测试使用独立浏览器上下文和确定性模型响应，不应指向 owner 的
3000 服务。旧账号 smoke 保留独立合成认证与 API 环境检查。

当前范围和验收见 [Web 工作流](../../docs/sensa/web-local-meaning-workflow.md)。

## Preview media

The experience preview uses the installed learning release's immutable audio
files. `npm run web:dev` and Web builds run `scripts/prepareWebMedia.mjs` first.
It reads `content/data/media/audio` by default, or `SENSA_WEB_MEDIA_ROOT`
when provisioned elsewhere, verifies each declared SHA-256, and stages only
release audio in ignored `apps/web/public/golden-audio`. Missing or mismatched
assets fail preparation rather than producing playable-looking broken links.
This step performs no generation or paid provider calls. CI must provision the
approved assets before building; the generated media directory is not committed.
