# Web 发布与真实服务核查

本页维护配置、候选、发布/回滚与未关闭的真实环境验收门，不维护逐次修复日志。
产品工作状态见 [当前阶段](current-stage.md)，个人内容、资源与运行见 [Web 工作流](web-local-meaning-workflow.md)。
首发只交付 Web，需接通普通账号同步与其他浏览器恢复；原生、E2EE、恢复码和设备批准不作为前置。
普通账号全库同步已通过本地真实浏览器与数据库验证；仍需 CI/CD 应用 `0029_sensa_library_sync.sql` 并发布相应 API/Web。
旧加密采集测试不能替代此项真实环境验收。个人试用不等于公开部署。云端操作必须走 CI/CD，
对应授权见 [发布约定](release-authorization.md)。

## 候选与监控边界

新增 `.github/workflows/sensa-web-candidate.yml`：只生成固定 SHA 的候选包，不部署、迁移或
上传商店。GitHub `web-candidate` environment 配置公开变量：`SENSA_WEB_ORIGIN`、
`VITE_SUPABASE_URL`、`VITE_SUPABASE_PUBLISHABLE_KEY`、`VITE_SENSA_API_URL`。
当前首发适配限定托管 Supabase 的 `functions/v1/sensa-api`；其他服务布局需显式修改发布合同。
没有目标环境时检查失败，不能使用 localhost 或合成配置冒充生产候选。

`node scripts/release/webCandidate.mjs --check` 检查环境；构建后去掉 `--check` 校验 SHA、
Web 实际嵌入配置与插件目标，生成静态托管响应头和 `release-candidate/manifest.json`。
清单包含文件 SHA-256，不包含模型密钥或公开认证 Key。制品有效期 14 天；生成候选不等于
测试或上线已通过。API 新增 X-Request-ID 和仅含方法、服务分类、状态、耗时的结构化日志，
不保存 URL/正文/邮箱/令牌/模型内容；真实告警与仪表盘尚待平台配置。

## 本地真实服务配置

使用隔离测试项目，参考 `apps/api/.env.example` 与 `apps/web/.env.example`。实际值只写忽略的
环境文件或 CI Secrets；管理/模型密钥只在 API，不发到聊天、浏览器或日志。
Web 与 API 必须使用相同项目和 origin。当前本地真实试用使用 API 8081 / Web 3001，
环境文件为 `apps/api/.env.real-service`、`apps/web/.env.real-service.local`，不要叠加旧认证环境。

```sh
NODE_EXTRA_CA_CERTS="$PWD/infra/certs/supabase-prod-ca-2021.crt" node --env-file=apps/api/.env.real-service --import tsx/esm apps/api/src/server.ts
npm run dev -w @sensa/web -- --mode real-service --host 127.0.0.1 --port 3001 --strictPort
```

Auth 回调 origin 与发起登录的 origin 必须一致，不混用 localhost/127.0.0.1/其他端口。
默认登录采用邮件链接、显式 PKCE exchange，同一浏览器完成；验证码仅用于相应模板配置。
过期/重放/缺 verifier 要重新发送，不重复 exchange；回调字段清理，原页面与插件落点保留。
默认邮件适用于已确认的单人试用安排，实际投递限制由项目配置验证；不把历史 SMTP 数值当当前保证。
账号删除独立 OTP 再认证仍需真实演练，链接登录成功不证明删除邮件链已通过。

未配置目录时返回空目录。原创文本包可无模型编译：

```sh
SENSA_WEB_ORIGIN=http://127.0.0.1:3001 SENSA_PACKAGE_OUTPUT=apps/web/public/learning-packages node --import tsx scripts/release/buildStarterPackage.mts
```

按脚本生成的 catalog 配置 `SENSA_PACKAGE_CATALOG_JSON`；生产使用已验收 HTTPS 资产。
borrow/lend 及媒体资源见 [学习包指南](assurance-package-import.md)。不把合成夹具发布为正式内容。

## 隔离数据库初始化

`.github/workflows/sensa-trial-database.yml` 使用受保护 `sensa-trial` environment 和完整已审阅 SHA，
只允许指定隔离项目的 initialize / invite，不部署应用或导入旧学习历史。

- 忽略文件 `apps/api/.env.trial-ci` 保存 `MIGRATION_DATABASE_URL` 与 `SENSA_RUNTIME_DATABASE_URL`。
  `node scripts/release/prepareTrialEnvironment.mjs` 本机检查项目/TLS 并生成或复用运行密码，
  同步 API 连接；不连接数据库、不上传秘密，也不证明远程角色已创建。
- 初始化逐个事务应用版本化迁移，session advisory lock 排除并发；运行角色只继承 backend_app。
  已应用迁移与密码保留，失败中止而非删库回滚。迁移数量以实际仓库和账本为准。
- invite 只接受已验证、未禁用、非匿名 Auth UUID，不恢复已撤销邀请或已删除账号。
- 连接要求项目一致与 TLS，使用仓库公共 CA / `sslmode=verify-full`，不通过关闭证书验证修复连接。

历史实际执行证据：[隔离库初始化](https://github.com/ichthyoplanktonzyh/sensa-standalone/actions/runs/34475932554)、
[首位试用账号开通](https://github.com/ichthyoplanktonzyh/sensa-standalone/actions/runs/34476564285)。
这些证明对应提交/环境的操作，不代表当前 HEAD 已部署或新的执行授权。owner 已进入真实试用，
不再把早先“项目为空、密码错误、待首次登录”的诊断当当前阻塞。

## 部署与回滚

- `web-candidate`：只生成制品。公开变量见本页前文；包含已编译包目录、catalog 摘要与文件摘要。
- `web-production`：手动填写已成功候选 run ID、完整 SHA、owner 已验收确认；应开启 GitHub
  environment required reviewers。拒绝目标或摘要不一致。实际执行必须有对应发布授权，不从旧日志推断已部署。
- Secrets：独立 `MIGRATION_DATABASE_URL` 与受限 `SENSA_RUNTIME_DATABASE_URL`、
  `SUPABASE_ACCESS_TOKEN`、`DEEPSEEK_API_KEY`、`SENSA_PROVIDER_VAULT_KEY`、
  `CLOUDFLARE_API_TOKEN`。公开项目变量另含 Supabase ref、Cloudflare account/project。数据库
  连接必须匹配项目并要求 TLS；运行角色不允许超级用户/创建角色权限。Supabase 自带 service-role
  环境用于账号删除，不进入 Web。真实 Auth SMTP 与 bucket 策略在项目中配置并验证。
- 公共文本包可随已验收 Web 资产发布；私有/音频媒体按 Storage 授权合同
  独立验收，不能把现有 Storage 适配误称为本次真实媒体发布已通过。
- 首发自动配置为受邀访问。回滚优先重新发布上一份已验收 Web/API 版本，保留已应用的向前兼容
  迁移；**不能回滚至不识别账号删除 lifecycle 的 API**。紧急时先暂停默认模型或关闭 API，
  不删除/重建学习数据。数据库恢复必须另行批准且验证删除屏障仍存在，避免备份恢复复活账号。
- 仓库变量 `SENSA_MONITOR_ENABLED=true` 才启用小时监控；`web-monitor` 放只读
  `MONITOR_DATABASE_URL` 和公开 URL。检查公网、超过一小时的删除 pending 及每日总请求阈值，
  失败由 Actions 通知；必须实际测试通知接收。默认模型可用 `SENSA_MANAGED_MODELS_PAUSED=1`
  暂停，不清空本机学习资料。

发布方式参考 [Supabase 官方 CI 文档](https://supabase.com/docs/guides/functions/examples/github-actions)
与 [Cloudflare 官方 Direct Upload CI 文档](https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/)。

## 账号删除与恢复屏障

完整个人页接入显式确认、邮箱 OTP、处理中/完成状态和持久删除回执。签名 JWT 中最近五分钟的
OTP 认证才可发起，token refresh 不算重新认证。事务先撤销账号、轮换 epoch、清除服务资料及
会话，再调用 Supabase Admin 删除身份；失败保持 deletion_pending。回执可在登录失效后查询及
重试已授权删除，不允许凭回执发起新的删除。请求正文及回执不进入应用日志。

获知账号删除时本机库原子清除，旧页面被 incarnation 阻断。其他离线设备和导出副本不能远程
瞬时擦除，UI 明确要求另行清理。保留账号/身份关联的最小删除屏障及请求时间以拒绝旧身份
重新注册；不保留邮箱或服务内容。已存在服务器权威学习数据的迁移期账号拒绝此自助路径，
不得用新 Web 的范围直接删除其历史；需要单独审查的旧数据删除适配。

新增 migration 0026/0027（含删除回执 RLS）；部署顺序必须先迁移再发布 API。受限 backend_app 事务在独立 Postgres
测试了原子回滚、重新认证、插件旧凭据拒绝、外部身份服务失败/重试、幂等与账号隔离。
完整 Chrome UI 通过取消、确认、OTP、处理中清除、刷新回执恢复及英文反馈；HTTP 为合成服务。
真实 Supabase 删除仍待目标项目验证，不自动删除 owner 账号或数据。

## 发布前仍需核验

- 对应候选的真实邮件/会话续期与撤销、独立测试账号删除、受限数据库/TLS/媒体读取。
- 实际模型质量、耗时、账单/限流和告警接收；本机无限额试用设置不得无意进入默认部署。
- 资源许可与内容质量、目标浏览器存储不足/更新恢复、公开网络弱网与真实设备性能。
- 托管响应头/CSP、固定 SHA 与摘要、部署顺序、可回滚版本和删除屏障保持。
- 插件分发、真实商店权限升级和跨端同步按各自门验收，不从本机 Web 成功推导完成。

检查入口：`sensa:trial-database-smoke`、`sensa:account-service-db-smoke`、
`sensa:email-link-browser-smoke`、`sensa:offline-shell-smoke` 和相关备份/删除脚本；
常规使用隔离数据库、合成 Auth/模型，不能据此认定真实托管门通过。目录见 [测试策略](testing-strategy.md)。

旧配置诊断、修复顺序与逐次测试记录保留在 Git `5f962ae41adb723dee34614060db9e41a8d0a4e8` 的原文件，不再作为当前操作步骤。
