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

### 2026-09-10：Web 个人资源默认仅代码校验

完整 Web 的个人内容准备默认只调用生成模型，再执行代码 validator。额外模型审核仅在
个人页高级设置显式开启后执行；旧库没有开关值时视为关闭，已存在的审核连接分配不代表开启。
代码校验始终检查资源结构、摘要、固定表达/含义、必需角色和目标表达泄漏等；
它不等同于对语义质量或原文忠实度的模型判断。记录中未调用审核时保存 null，不伪造审核通过。
关闭审核后可复用尚未被拒绝的已保存候选，备份支持仅代码校验及旧的模型审核记录。
开关变更会阻止旧配置的未完成准备继续提交，用户可显式重试。

首位用户的隔离真实服务可先采用本机 Web/API + 独立 Supabase 测试项目 + 模型 API，
无需先部署网站。准备项目 URL/ref、公开浏览器 key、测试登录邮箱；服务角色密钥、
数据库连接和模型密钥只配置到忽略的环境文件或 CI Secrets。邀请授权、数据库迁移、
邮件模板及回调地址仍需接通验证。正式域名/托管和监控告警渠道在云端验收前配置。

### 2026-09-10：Supabase 插件连接与隔离配置实查

插件已可调用，owner 确认 `kwwmukqzlxxsnviyhwmr` 为 Sensa 隔离测试项目。
项目位于 `ca-central-1`、Free 计划、状态 `ACTIVE_HEALTHY`。公开 URL 与启用的
publishable key 已读取，真实 `/auth/v1/settings` 返回 200：Email 开启、允许注册、
邮箱自动确认关闭。只读 SQL 确认 `sensa` schema、`backend_app` 角色和 Sensa 迁移
账本均不存在；public 表和 Supabase 迁移列表为空。未执行远程写入、发邮件或部署。
插件未提供读取数据库密码、service-role key 或 Auth SMTP/模板配置的工具。

本机实际已有旧 API 本地认证配置和根目录 DeepSeek key。保留旧环境，新增忽略文件
`apps/api/.env.real-service`（0600）与 `apps/web/.env.real-service.local`，使用 8081/3001
隔离现有 3000 本地库。公开连接已填入；API 私下复用模型 key、生成 vault key、保持受邀策略。
八条原创文本包已编译并通过材料/包合同校验，目录写入该 API 配置；没有模型调用。
数据库连接与服务角色 key 仍为空，不能把公开 Auth 连接成功视为真实服务验收。

配置齐备后，从仓库根目录分别运行（不叠加旧 API `.env`）：

```sh
NODE_EXTRA_CA_CERTS="$PWD/infra/certs/supabase-prod-ca-2021.crt" node --env-file=apps/api/.env.real-service --import tsx/esm apps/api/src/server.ts
npm run dev -w @sensa/web -- --mode real-service --host 127.0.0.1 --port 3001 --strictPort
```

剩余依赖：受限运行数据库连接、独立迁移凭据与授权 CI 初始化、真实邮件、首次登录后的
Sensa 邀请授权，以及独立账号删除验收所需服务角色 key。现有生产部署工作流同时发布
API/Web，不应为本机试用直接触发；隔离项目初始化需独立可审阅的 CI 方案。

邮件前提发生变化：[官方 2026-06-03 公告](https://supabase.com/changelog/46599-changes-to-email-template-customisation-on-free-tier)
规定新 Free 项目使用默认邮件服务时不能修改 Auth 模板。当前 Web 输入数字 OTP，且关闭
URL 自动会话检测；[官方 OTP 文档](https://supabase.com/docs/guides/auth/auth-email-passwordless)
要求邮件模板包含 `{{ .Token }}`，不能将默认 Magic Link 邮件当成已兼容。
需核实项目模板并配置自定义 SMTP 后落实验证码邮件。
[默认 SMTP](https://supabase.com/docs/guides/auth/auth-smtp)仍仅发给团队邮箱、当前每小时两封。
仅有团队邮箱并不足以证明当前 OTP 体验可用；尚未发送邮件或验证登录。

本轮配置检查覆盖 Vite real-service 模式加载、Web/API 项目一致、端口和 origin、密钥存在性
（不打印值）、API 文件权限、目录可解析与缺失凭据保持空值。根级 typecheck/build/lint、
Git diff 空白检查通过；没有运行真实登录/付费模型或云端迁移。工作树仅提交本节实查记录，
本机环境、编译包与密钥保持忽略。

### 2026-09-10：默认邮件链接登录

Owner 确认单人试用先使用 Supabase 默认邮件，无需先配置自定义 SMTP。完整 Web 的默认
动作改为发送登录邮件；同一浏览器打开链接后，显式调用 SDK 的 PKCE code exchange，
再执行既有 Sensa 受邀授权和本机账号隔离。保留当前页面与插件交接参数；回调 code、令牌
及供应商错误字段从地址栏清除，不展示原始错误。页面内共享一次 exchange，避免初始化
与认证通知重复消耗一次性 code。过期、重放或缺失原浏览器 verifier 时提示重新发送。

原标签页可通过认证通知恢复，新标签页及刷新后可继续。发送后提示同一浏览器打开最新
链接，并提供一分钟重发等待、更换邮箱、重新检查登录与自定义模板的验证码入口。
此处不修改 Supabase 的发送限额；默认邮件的团队邮箱/每小时两封约束继续存在。
上节“必须先自定义 SMTP”的结论仅适用于坚持数字验证码模板，不再阻塞本轮链接登录。
账号删除仍使用独立 OTP 再认证，其真实演练尚未完成，不能据此标记删除流程已兼容默认邮件。

新增 `sensa:email-link-browser-smoke` 并加入无成本 CI：隔离 Chrome、完整生产 Web、真实
Supabase JS 的 PKCE challenge/verifier，与合成邮件跳转/Auth/API 一起验证新标签页登录、
原标签页恢复、刷新、重放、错误浏览器、过期、中英文错误反馈、插件目标保留与异账号拒绝。
离线冷启动/进程恢复回归、根级 typecheck/build/lint 与 local-i18n 检查通过。
没有向真实邮箱发送邮件、调用模型或部署；云端登录/受邀授权仍待实测。

真实回调配置交由 owner 完成：测试项目 Authentication → URL Configuration 的 Site URL
设为 `http://127.0.0.1:3001`，Redirect URLs 添加 `http://127.0.0.1:3001/**`，保留原条目。
使用配置中的 `127.0.0.1` origin 发起和完成登录，不能与 localhost 或 3000 混用。
本轮浏览器控制台检查停在登录页，未修改设置；owner 要求后续外部平台步骤无法由插件
完成时直接请求协助，不再自行通过浏览器接管。此配置当前等待 owner 确认。

随后 owner 已确认保存回调配置。公开 Auth verify 接口用无效测试 token 检查到默认跳转
`http://127.0.0.1:3001/`、指定页面跳转 `/profile`；未发送邮件或验证登录。插件仍不能列出
完整 redirect 白名单，不把这项行为检查当作白名单逐条审计。

### 2026-09-10：隔离数据库初始化交付准备

Owner 指示继续推进，并明确选择新建私有 `ichthyoplanktonzyh/sensa-standalone` 仓库。
仓库已创建、私有属性已核实，原工作树配置该 origin；尚未推送或运行远程工作流。
原 `ichthyoplanktonzyh/sensa` 为公开仓库，本轮不使用或修改它。

新增 `.github/workflows/sensa-trial-database.yml`，固定测试项目
`kwwmukqzlxxsnviyhwmr`，使用 `sensa-trial` environment 和完整已审阅 SHA。
显式选择 initialize 或 invite；不包含应用部署、默认模型调用、内容发布或旧资料导入。

- initialize：校验管理员/运行连接的项目、相同主机/数据库及 TLS；拒绝未登记的 Sensa
  schema。按现有 27 个迁移逐个事务应用，并使用 session advisory lock 排除并发初始化。
  内部迁移账本启用 RLS 并移除公共客户端权限。创建专用运行登录，仅继承 backend_app；
  已有运行角色不重设密码，拒绝提权/意外成员关系/对象所有权，真实登录验证权限。
- invite：仅为指定且已验证邮箱、未禁用、非匿名的 Auth UUID 建立受邀记录。
  不创建 Auth 用户，不恢复已撤销邀请或已删除账号，不写学习事实。
- 重跑保留已应用迁移和运行密码；迁移失败保留既有成功步骤并中止，不删库回滚。
  真正云端执行仍需 owner 对具体 SHA、推送和操作范围的交付授权。

凭据输入文件为忽略且 0600 的 `apps/api/.env.trial-ci`；owner 在其中填写管理员
`MIGRATION_DATABASE_URL`。`node scripts/release/prepareTrialEnvironment.mjs` 只在本机
校验配置并生成/复用专用运行密码，将 `SENSA_RUNTIME_DATABASE_URL` 写入该文件、
相同连接写入 API `.env.real-service` 的 DATABASE_URL。此脚本不连接数据库或上传秘密，
其“已填写”不表示远程角色已创建。`sensa-trial` 的 Secrets 只需要这两条数据库连接。
Supabase service-role key 不属于本次启动学习的前置，留待账号删除真实验收。

`sensa:trial-database-smoke` 已用一次性本地 Postgres 库验过 27 个迁移、幂等重跑、
受限角色实际登录、内部账本拒读、权限提升/错误密码拒绝、目标/TLS 校验、已验证身份
开通和撤销不恢复；Auth 表为合成记录。已加入 no-cost CI。本机 owner 数据库未迁移，
测试库及专用测试角色已清理。根级 typecheck/build/lint 已通过；凭据准备脚本另用临时
目录和合成连接串验证 CI/API 值一致、0600 权限、输出不含密码及重复运行不轮换密码。

2026-09-10 连接诊断：已在忽略文件内修正连接串特殊字符编码。Supabase 官方公共 CA
存于 `infra/certs/`，CI 和上述本机启动命令通过 `NODE_EXTRA_CA_CERTS` 加载；准备脚本
统一使用 `sslmode=verify-full`，保留既有运行密码。只读连接探测已通过 TLS 验证，
但管理员登录返回 `28P01`（密码认证失败），仍需 owner 更正项目数据库密码。
尚未执行远程迁移、创建运行角色或推送代码。证书配置后的 typecheck/build/lint、
一次性数据库 smoke 和配置幂等/权限检查均通过。

2026-09-10 后续：owner 完成云端密码重置后连接成功，并明确授权推送、CI Secrets
及初始化。代码已推送至私有 `ichthyoplanktonzyh/sensa-standalone`；两条数据库 URL
通过 stdin 配置到 `sensa-trial` environment。首次初始化失败且未建表，补充仅输出阶段和
错误码的诊断后，[CI 初始化](https://github.com/ichthyoplanktonzyh/sensa-standalone/actions/runs/34475932554)
成功完成 27 个迁移和专用角色。随后本机通过 `BEGIN READ ONLY` 实查迁移数量为 27，
`sensa_trial_runtime` 可读服务表，账号/邀请均为 0；尚无真实登录身份。
Web 3001 和 API 8081 已启动，health 与页面返回 200，未登录服务请求返回 401。
常规 CI 另外发现 web-next 缺少 learning-kernel 的 lock 条目，已补齐；干净安装及根级
typecheck/build/lint 通过。云端首次干净构建进一步暴露 contracts/content-validator 的
TypeScript project references 缺失，已补上实际包依赖顺序；清除构建输出后的
typecheck/build/lint 也通过，云端完整检查继续运行。真实邮箱登录与邀请开通待 owner 完成登录。

Owner 已完成首个真实邮箱验证；[CI 开通](https://github.com/ichthyoplanktonzyh/sensa-standalone/actions/runs/34476564285)
成功，本机受限连接确认 1 个有效邀请、1 个服务账号，真实登录已创建服务资料。
云端回归又发现离线 smoke 将构建模式置空，误依赖未入库的预览音频；改为 production，
使用隔离 Chrome 验过完整离线冷启动/恢复/账号隔离，根级检查也通过。

### 2026-09-10：首次真实走查——场景进入澄清

Owner 报告澄清页空白等待，并确认从场景主动进入时直接启动第一轮。入口现在生成
仅在内存中的启动请求；本机对话只在尚无请求/消息的 idle 状态执行首轮。刷新无启动请求，
已有对话重开也不自动重试。页面直接显示原场景和等待文案，继续保留停止、错误提示与显式确认。
隔离浏览器验证进入触发一次、等待状态可见、刷新不重复、补充后继续以及含义确认。

默认服务切换为 DeepSeek V4.1 Flash。根据
[官方 2026-09-10 更新](https://api-docs.deepseek.com/updates/)，API 名称是 `deepseek-flash`；
实际只读 models 接口也返回该名称。服务默认值、示例及忽略的本机配置已更新，API 已重启。
受限角色/真实鉴权的本地数据库测试拦截模型请求并验证该默认名称；验证过程未调用付费模型。

### 2026-09-10：表达优先的图文对话

Owner 随后确认以“找个表达”直接进入对话，取消先填表的前置步骤。首次发送才保存
草稿并请求模型；原“记录场景”仍作为添加内容菜单的可选记录方式。信息充分时直接
提出表达，必要时才追问。保存前同时展示表达、抽象意思和忠于原文的场景摘要，用户
可继续对话修正；确认后单独选择加入学习，不自动生成或开始学习。原始材料继续保留。

输入原生支持文字、图片及混合消息，允许上传或粘贴 JPEG/PNG/WebP。每段对话最多
4 张，每张原文件不超过 10 MiB；本机缩放至最长边 1280 并压缩后保存，发送时转换为
模型的 image_url 内容片段。图片随本机对话保存及备份，刷新不重复调用。新增产品文案
均提供中英文，模型解释跟随当前界面语言。

一次有界合成 DeepSeek 请求确认真实响应的工具调用包含额外 index 字段；前端原先
严格拒绝该字段，导致 HTTP 200 仍显示失败。现接收并剥离供应商元数据，后续请求只
保留工具调用协议字段。该诊断单独使用已授权的 API 试用；浏览器回归均拦截模型 HTTP，
未调用付费服务。图文/纯图片、失败重试、刷新不重复、语言切换、确认后三项持久化、
既有 Intake 到学习运行时及离线恢复、加密备份回归均已通过；根级 typecheck/build/lint
及国际化扫描通过。


### 2026-09-10：确认后内容详情与一键学习准备

根据 Owner 本轮确认，已保存条目标题使用表达，默认打开 Context/Sense/Expression
详情，澄清记录折叠为历史。学习操作移入详情；加入后直接准备固定轻量学习资源，
保留原有私有场景使用选项、停止和恢复，不在刷新时重新生成。精简生成器、校验器等
内部说明文案，新增中英文详情、状态与学习方式文案。

本机生成器现最多执行三轮模型生成，按现有需求校验后反馈并修正；共享尝试时限不
增加，逐轮结果记录在 ContentAttempt，最终材料记录实际 modelTurns。独立模型审核
仍沿用原可选设置，审核拒绝保留重试入口。学习身份、资源角色及进度规则不变。

合成回归覆盖连续三轮拒绝不发布、反馈后修正成功、审核中断恢复复用候选、停止与
事务回滚、备份恢复，以及正式浏览器确认详情到加入学习、运行时与离线恢复。


### 2026-09-10：图文 Context 到离线互动经验

确认内容增加 Context 修订及图片快照；编辑不触发模型请求，显式资源更新才固定
新 Context 生成。资源替换与任务 ready 同事务提交，旧版本保存在尝试及 Run 快照，
保持原有 target 身份、记忆状态和时间。旧 Run 在首次资源替换时固定原材料；备份
验证支持新旧记录，并检查 Context 版本及 Run 材料归属。

轻量 experience_recall_cue 兼容原有 scene/senseFocus，扩展可选 images/html；图片
为本机规范化 JPEG，生成器仅提交提供过的 imageIds，系统验证归属并组装。HTML
为声明式标记：button 的 data-action=toggle/increment、data-target 指向元素 id，
draggable=true 元素可拖入 data-dropzone。允许基本文字和布局标签，不接纳作者脚本、
事件处理器、外链或嵌入资源。呈现时重建允许的 DOM/样式，在无 same-origin 权限的
iframe 内运行应用提供的交互脚本；CSP 禁止网络、嵌套框架与表单。资源无法操作
父页面或学习结果。资源详情和正式经验回想共用此 renderer。

合成测试覆盖图文澄清接纳、Context 编辑不生成、图片原生模型输入、无效 HTML
反馈修正、资源详情点击/拖动、正式回忆图文与 HTML、更新失败旧资源可用、成功
保留 Run 材料/进度、学习包同格式导入、旧文字兼容及备份恢复。常规验证不调用
付费模型；真实模型的图文与互动材料教学质量仍由 Owner 继续走查。
