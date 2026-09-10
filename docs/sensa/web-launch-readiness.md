# 正式 Web 上线核查与首条修复

2026-09-10。Owner 要求暂停原生界面优化，优先完成 Web 并达到上线可用。
本文登记实际代码与本轮证据；顺序由 production-migration-plan.md 裁决，不新增并行路线图。
核查起点 `504f9059`，原工作树无未提交修改。主代理直接实施，无 worker、push、部署或用户数据迁移。

## Web 首发范围与发布候选（2026-09-10 更新）

Owner 已确认只推进 Web 生产收尾，然后由 owner 作为首位真实用户进行使用验收、修复后部署。
首发暂缓自动跨设备同步；不等待原生 UI/三端 G1–G3。资料保存在当前浏览器，换设备通过
加密备份恢复；不得宣称自动同步或云端资料已备份。此范围调整不撤销账号删除、隔离、
可靠持久化与生产服务验收。

本文下方“核查起点”表是历史盘点，不能继续将已完成的本地运行时、离线壳、备份恢复视为
尚未实现。最新实现与测试见 current-stage.md 和 web-local-meaning-workflow.md。

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

交给 owner 真实使用前仍需逐项完成：

- 真实邮箱 OTP、会话续期/撤销、默认模型配置和实际质量/费用验证。
- 真实学习包/媒体目录，以及实际安装插件后的采集交接。
- 浏览器存储不足与版本升级恢复验收；账号删除真实 Supabase 演练。
- 生产限流覆盖、费用处置与告警配置。
- 发布部署工作流、目标迁移/回滚清单和实际托管验收。

候选生成流水线只是上述发布准备的一部分，不表示这些缺口已关闭。

## 上线差距与验收门

| 范围 | 当前代码证据 | 缺口、依赖与关闭条件 |
| --- | --- | --- |
| 正式入口 | 默认/production 均进入原完整 App，无账号/API 配置构建和页面回归已通过；旧账号入口明确隔离为 legacy-account 回归模式 | 已关闭入口与账号配置前置问题；既有学习仍含迁移期实现，不能把切换入口视为本地学习闭环 |
| 本地领域执行 | `data/replica/accountStore.ts` 保存账号独立 IndexedDB；`initialRuntime.ts` 支持已取得授权 Run 的离线动作；`data/consumer/client.ts` 向 sync push/pull、home 请求权威投影 | 新目标、开始 Run、Completion/Handoff/FSRS 仍依赖 API。须完成 LF-1 Web 本机事务、三 purpose、真实持久与 TS/Rust 差分；现有断网答题不能关闭此门 |
| 安装与冷启动 | `vite.config.ts` 普通静态构建；当前未发现正式 service worker/离线外壳入口 | 需要安装资源与必要材料/媒体缓存、浏览器独立重启断网启动、升级和配额失败验收。打开的页面断网不算冷启动 |
| 账号与隔离 | Supabase 客户端 PKCE、consumer JWT/邀请校验；原浏览器 smoke 使用合成 Auth | 本轮修复跨标签切换期间的客户端身份混用。真实托管邮箱 OTP、会话续期/撤销、目标地区送达仍未验收 |
| 媒体 | `apps/api/src/sensa/media/consumer.ts` 已有私有 Supabase Storage 适配，HTTPS、大小上限/超时；consumer 路由先授权再校验摘要；Web 也校验摘要 | 不能称“尚无 Storage 适配”，也不能称“已接好生产媒体”。缺目标 bucket/策略、授权资源清单及上传发布、真实访问/缺失/撤销/离线恢复证据 |
| 个人意义与供给 | 正式 `AccountContent` 接 consumer 解析/接纳/准备；已有任务和材料校验代码 | 本地库接纳与准备结果落地、Provider 选择/私有上下文边界、实际内容质量/费用验收需贯通；替身响应不能代表生产模型 |
| 恢复与数据控制 | 副本有 outbox、bootstrap 和 retained 状态；当前 consumer 路由无完整数据导出/账号删除生命周期 | LF-1c 完整库导出/独立恢复、LF-3 可选 E2EE/密钥恢复、M3 删除与旧设备屏障、跨日/版本/多标签故障矩阵均未关闭；不自动迁移 owner 数据 |
| 安全与运行监控 | consumer 有请求体上限、邀请限制、部分用途日预算；Edge 配置 origins；异常主要记录错误名并返回 503 | 不能把局部限额当完整防滥用。缺可审阅的按身份限流/用途预算覆盖表、结构化请求关联、同步/准备/媒体告警、隐私日志与费用处置演练 |
| 正式功能覆盖 | SensaApp 以首页/内容/学习和账号链为主，已有 catalog、轻量 Runtime、统计与签到 | 按已确认 PRD 逐项核对独立内容/个人意义两旅程、偏好、词典/练习实际资源及 unavailable 状态；原型/原生有能力不代表正式 Web 已接入 |
| CI/CD 与发布 | `.github/workflows/sensa-consumer-check.yml` 只有本地检查、临时 Postgres、Node/Deno 和合成 Auth 浏览器检查 | 缺部署工作流、固定目标项目/域名/SHA/媒体清单、迁移回滚与恢复演练、公网 smoke。实际操作仍需 release-authorization.md 的具体授权，不能在本地 shell 部署 |

**结论：当前不能标记 Web 上线就绪。** 本次调整优先级没有降低 LF/M3/M4 门，
也没有把旧明文服务器同步变成可选 E2EE。无账号本地使用与受邀在线服务要分别验收。
线上配置尚未指定不阻止本地实现与流水线准备，也不是现在反复索取凭据的理由。

## 本轮纵切：账号切换后保留原账号工作

沿用 PRD 6.11、11 及 M0-2 已确认的账号隔离、退出和待提交工作保留体验，不新增产品页面。

修复前 `syncAccount(accountA)` 虽然写入 A 的 IndexedDB，但每次 HTTP 请求从全局 Auth
获取当前 session。bootstrap/pull 等待过程中若另一标签页切到 B，后续请求可能携带 B 的
令牌。服务器的请求隔离并不能阻止客户端把 B 的 home 返回写入 A 的副本；初始化也可能
把错误身份的返回缓存到传入的 subject key 下。

修复将初始化/缓存恢复的 `AccountContext` 在内存绑定到原 subject。全部 consumer 请求，
包括目录、目标、文本/音频材料、语义查找、准备、插件授权和退出，发起前核对当前身份。
身份不符返回 `account_changed`，不发出请求、不丢弃 outbox。初始化在响应返回后再次检查，
防止迟到响应建立当前授权。凭据不写入副本、文档或新映射。已发出的 A 请求仍仅使用 A 令牌，
合法 A 响应可以保留在 A 库中；后续请求不得换用 B 的令牌。

UI 在 Auth subject 改变时清除当前展示引用，并阻止过期 recover 的无 session 分支覆盖新恢复。
退出 A 的迟到流程也会在 signOut 前复核身份，不能退出当前 B。此修复不改变结算或服务器合同。

## 验证与边界

`npm run sensa:web-account-isolation-smoke`：真实 Chromium、Supabase JS 客户端、
跨标签 Auth 通知和 IndexedDB；HTTP 为确定性替身，无 Postgres、真实邮箱或 Provider。
覆盖延迟 bootstrap 后跨标签切换、十个账号请求入口拒绝、待提交数量保留、页面刷新、
原账号重登录恢复，以及延迟初始化不会写入缓存。已加入现有无成本 CI，尚未在远程 Actions 执行。

本机使用已安装 Google Chrome，通过 `SENSA_CHROMIUM_PATH` 指定可执行文件；
隔离临时 browser context、随机 loopback 端口，不连接 owner 服务/浏览器 profile。
该脚本验证客户端集成，不是完整页面旅程或云端发布 E2E；UI 重置部分通过类型检查，
完整正式页面账号切换走查仍应与后续 Web 本地入口整体验收一起执行。

本轮根级 `npm run typecheck`、`npm run build`、`npm run lint` 均通过；lint 当前等同类型检查，
不代表独立静态安全或可访问性审计。构建结果不改变上述未关闭的发布门。

## 账号删除纵切（Web 本地库账号）

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

## 首位真实用户验收前的交付状态（2026-09-10）

| 项目 | 本地交付与证据 | 仍需真实环境确认 |
| --- | --- | --- |
| 完整 Web 两条学习路径 | IndexedDB + 实际 Chrome，下载/入学/澄清/生成审核/学习/备份恢复通过 | 真实邮件、默认模型质量与请求耗时 |
| 数据控制 | 删除、旧凭据屏障、失败回滚、回执恢复；本机清除与配额错误提示 | Supabase Admin 删除演练，不能删除 owner 主账号来冒充测试 |
| 更新与可靠性 | v2→v3 保留身份/原文/账本；SW 下载失败保留旧版本、成功激活后断网重启 | 目标浏览器/托管响应头与持续真实使用 |
| 首发资源 | `content/authored/web-starter.json` 八条原创文本；编译通过真实 material/package 合同，产物不入 Git | owner 内容评审；无音频，不宣称完整词书/音频库 |
| 费用与安全 | 现有每日用途限额、256 KiB 文本上下文上限、默认模型暂停开关、CSP、隐私请求日志 | 真实账单/告警接收与外部 YouGlish/词典可达性 |
| 发布与运维 | 固定 SHA 候选→摘要核验→迁移→API→已验收 Web 资产；监控默认关闭 | 目标资源、Secrets、受保护环境、真实 Actions 执行/回滚 |

已执行核心类型/构建/lint、Deno Edge 检查、删除数据库集成、包学习/备份/国际化及实际浏览器
备份/删除/升级回归。模型/邮件 HTTP 为替身；没有触发部署、上传或付费模型。不能将本地通过
标成线上收尾完成。当前进入“配置真实服务 → owner 真实使用 → 修复 → 批准部署”的交接点。

### 本地真实使用配置

不需要先取得正式 Web 域名。需要一个隔离 Supabase 测试项目、可用邮件、默认模型服务和数据库。
分别参考 `apps/api/.env.example` 与 `apps/web/.env.example`，把实际值放在未跟踪的 `.env` /
`.env.local`；管理员/模型 Key 只在 API。首发 `invited` 策略需为自己的 Auth subject 建立邀请，
不得使用旧 first-user 学习数据导入脚本来开通新 Web 账号。

在配置完成后启动 `npm run api:dev`（8080）和 `npm run web:dev`（3000）。学习包可用下列无模型
编译命令准备到本地 Web 静态目录，再把 `release-candidate/catalog.json` 压缩为单行填入 API
的 `SENSA_PACKAGE_CATALOG_JSON`。发布流水线会自动编译并配置对应 HTTPS 目录。

```sh
SENSA_WEB_ORIGIN=http://127.0.0.1:3000 SENSA_PACKAGE_OUTPUT=apps/web/public/learning-packages node --import tsx scripts/release/buildStarterPackage.mts
```

真实使用重点依次是：注册与再次打开、八条文本包下载学习、浏览器插件采集、慢轨澄清和快轨接纳、
生成/审核失败后的重试、刷新和断网续学、备份与恢复。账号删除只用独立测试账号。记录问题时
保留页面路径、步骤、时间和 X-Request-ID；不发送 API Key、验证码或私人原文日志。

### 实际部署与回滚

- `web-candidate`：只生成制品。公开变量见本页前文；包含已编译包目录、catalog 摘要与文件摘要。
- `web-production`：手动填写已成功候选 run ID、完整 SHA、owner 已验收确认；应开启 GitHub
  environment required reviewers。拒绝目标或摘要不一致。该工作流未执行，当前无部署授权。
- Secrets：独立 `MIGRATION_DATABASE_URL` 与受限 `SENSA_RUNTIME_DATABASE_URL`、
  `SUPABASE_ACCESS_TOKEN`、`DEEPSEEK_API_KEY`、`SENSA_PROVIDER_VAULT_KEY`、
  `CLOUDFLARE_API_TOKEN`。公开项目变量另含 Supabase ref、Cloudflare account/project。数据库
  连接必须匹配项目并要求 TLS；运行角色不允许超级用户/创建角色权限。Supabase 自带 service-role
  环境用于账号删除，不进入 Web。真实 Auth SMTP 与 bucket 策略在项目中配置并验证。
- 当前资源只有公共文本包，直接随已验收 Web 资产发布；后续私有/音频媒体继续按 Storage 授权合同
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
