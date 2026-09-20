# Sensa Web 工程说明

本文是当前 Web 工程、验证和发布的唯一长期说明。产品行为见 [Web 产品说明](product-requirements-v1.md)，领域规则见[领域文档索引](README.md)。代码、迁移和 CI 配置始终是实现细节的最终来源。

## 活跃代码边界

| 路径 | 职责 |
| --- | --- |
| `apps/web` | 生产 React 界面、本机 SQLite WASM 学习库、账号与云同步 |
| `apps/browser-extension` | 网页/字幕阅读、采集、解释与 Web 交接 |
| `apps/api` | Hono 可选在线服务实现及本地开发入口；不执行学习协议 |
| `supabase/functions/sensa-api` | 生产 Edge Function 入口 |
| `packages/contracts` | Web、扩展与 API 共享协议 |
| `packages/learning-kernel` | 学习与调度纯规则 |
| `packages/content-validator` | 学习资源发布校验 |
| `packages/model-runtime` | 服务端与 Edge 的模型执行适配（Genkit flow、队列、提供方重试） |
| `db/migrations` | 生产数据库的前向迁移 |
| `content` | 内容 schema、prompt、制作与校验工具 |

`apps/sensa_native` 和 `crates` 只保留现有代码，不参与当前产品开发、验收或发布规划。除非 owner 明确恢复该范围，不在这些目录继续迁移或新增能力。

Web Shell 只挂载首页、当前 URL sheet 栈和已打开的覆盖层；退出栈的页面必须卸载其 effect。非首页页面、
账号云同步、远程 Intake 与扩展接收器按需加载，不能重新并入同步启动图。`WebShell` 只观察 viewport
直属 screen root 的增删和 active 变化，不观察整棵页面子树。生产构建后的 JavaScript gzip 上限
由 `scripts/sensaWebBundleBudgetSmoke.mts` 按静态 ESM 依赖闭包固定，并纳入 `test:fast`；它分别约束入口、
App Shell、轻量首页、完整学习工作区和 Learning Runtime 的增量闭包，不能只统计入口与命名 chunk 而漏掉同步共享依赖。
首页只读取队列所需的 Target、Run、Study Plan 和 Package 事实；Package/Personal 完整控制器在相关 URL sheet 打开后加载。正式 Learning Runtime 的呈现和
composition validation 在进入 Run 时按需加载；首页学习队列与内容准备只在真实表变化、到期时间点或页面
恢复焦点时刷新，不使用固定频率轮询。

TanStack Router 拥有合法路径、search 校验、公开 `/welcome` 和 not-found 恢复；动态 Sheet Stack 仍以一个
受校验的 splat route 表达，因为相同 sheet 可以从多个父页面压栈并必须返回原父页面。所有 sheet 的渲染
host、URL 参数归属和 screen-memory identity 只在 `experience/router/screenRegistry.ts` 声明一次；路径解析、
参数裁剪与 App/Learning Workspace 的声明式 renderer map 都受这份 registry 的类型约束，不再维护并行 switch
和 allowlist。pathname 与 search 是导航唯一权威，刷新、分享链接及浏览器前进/后退不得依赖丢失的组件状态。

安装态 PWA 在 coarse pointer 设备上为非空 Sheet Stack 提供左边缘滑动返回：10px 后才锁定横向意图，
释放时结合距离与速度投影决定返回，并在设备支持 Web Vibration 时只于越过提交阈值轻触一次。普通浏览器
保留系统返回手势；学习 Runtime、弹层和首页不接管边缘滑动，学习评分也绝不绑定 swipe。手势视觉只修改
compositor transform，支持中断和 reduced-motion；所有页面仍保留显式返回控件。viewport 允许软键盘调整
布局，粗指针输入控件不得小于 16px 字号，hover 样式只对可悬停的精细指针生效。触感、safe area 与软键盘
最终手感必须在真实 iOS/Android 安装态验证，桌面设备模拟不构成交付结论。

## 数据与同步

生产 Web 的个人学习库是 SQLite WASM 数据库 `sensa-local-library-v4.sqlite3`，持久化在浏览器
Origin Private File System。SQLite 在专用 Worker 中运行，使用不要求页面启用跨源隔离的
`opfs-sahpool` VFS。Web Lock 选出唯一数据库 owner；其他同源 Sensa 标签页通过 BroadcastChannel
复用 owner 的记录接口，owner 关闭后由剩余页面重新选举，绝不打开竞争连接。跨页共享/排他事务锁覆盖
完整 `LibraryTransaction`，因此多次读取到一次 commit 的 read/modify/write 序列不会在标签页之间交错。
浏览器内不再叠加全局 Promise 队列：只读事务持有 shared Web Lock 并可并发，写事务持有 exclusive Web Lock；
无 Web Locks 的测试 Adapter 才使用串行 fallback。
UI 只通过本机事务修改数据，不直接执行 SQL，也不写派生学习结果。Node 测试使用相同事务接口的内存
Adapter；浏览器交付必须另验真实 OPFS 以及 follower 标签页的读写。当前版本不读取或迁移旧 IndexedDB 数据。
SAH Pool 由 leader Worker 独占，所以数据库打开后的第一条 SQLite 指令固定为
`locking_mode=EXCLUSIVE`，随后使用 `journal_mode=WAL` 与 `synchronous=FULL`。这遵循 SQLite Wasm
无 shared-memory 环境的 WAL 前置条件，并保留 FULL 的提交同步；不得为了基准数字降为 NORMAL。
真实 Chromium 对照可用 `npm run benchmark:sqlite-opfs` 复测，`test:browser` 同时验证 Worker 重启后的
记录数、`quick_check` 和生产运行时实际采用的 WAL/FULL/EXCLUSIVE profile。
学习事实仍以逻辑 record 为写入 authority；SQLite 在同一事务内维护可重建的 Target 查询投影和
Route–Target 关系索引。首页只读取当前 Route 的 Target、该 Route 今日已占用的新词额度以及实际引用的
Package key，不遍历或解析其他 Route 的 Target。只需要数量的恢复/清理查询使用 SQLite `COUNT(*)`，不把
整表 JSON 传回页面。物理 schema v4 使用新的 OPFS 文件；因当前无用户库数据，不迁移或读取 v3 文件。

Web 应用层的逻辑表与 Personal Semantic World Journey 共用这一物理事务 authority。Journey 的
意义聚合、注册表事实、Inbox、澄清草稿和 operation receipt 分别保存在 `semanticMeanings`、
`semanticRegistry`、`semanticInbox`、`semanticDrafts` 与 `semanticReceipts` 等规范化逻辑表；媒体字节
单独保存在 `media` 表。一次领域保存仍由同一个 `LibraryTransaction` 原子提交，但普通语义修改不再
重写整个世界或图片载荷。当前没有生产用户数据，因此 v2 直接使用新数据库与 Checkpoint v3，不读取、
迁移或兼容 v1 单聚合格式。账号副本、界面偏好和其他 `localStorage` 状态不能充当个人学习库的第二权威。

学习运行时只在 Web 本机执行：目标选择、Protocol/Policy、步骤、评价、Completion、Memory Outcome 与
FSRS 都由本地领域事务结算。Hono/Edge 不创建或推进学习 Run，也不重新计算从云同步取回的学习事实。

普通账号云同步以本机已提交的 Personal Library Facts 为输入。云端保存版本化清单和按内容寻址的数据块；
下载按响应字节预算分页，客户端消费服务端返回的 deferred 列表。`operations` 是 Device Operation Ledger，
只用于同一设备上的命令幂等，不进入同步清单；Learning Event 直接以自身 Action、Materialization、
Evaluation 与 Transition 数据完成不可改写验证和重放。Remote Intake 重投可从 Draft 保存的 canonical
Intake 重建本地结果，不需要同步完整命令输入或返回值。同一份 base64 媒体按内容边界切块，使重复引用
复用摘要块。
新 Checkpoint 成功提交后，服务端只回收旧清单曾引用且新清单不再引用的块；另一设备尚未提交的上传
不在这次回收范围内。

同步记账和业务内容使用不同事件：只有真实业务写入广播内容变化，单纯更新同步状态不能再次触发
内容同步。本机写入立即完成并形成新的内容版本；存在待同步版本时，停止操作两分钟、连续使用五分钟、
完成学习会话、页面隐藏、恢复联网或手动操作触发 Checkpoint。页面回到前台只在最近云端检查超过
五分钟时拉取。账号接通后在后台执行首次拉取；无待同步版本且检查未过期时没有整库请求。
Remote Intake Delivery 在账号库身份稳定后独立拉取，不主动启动整库同步。服务用量和其他在线状态
按需读取。

下载内容在应用前验证摘要、引用和运行时可重放性，并在提交事务时重新检查账号、库和本机版本。冲突不得覆盖同步期间出现的新修改；无法自动合并时保留失败状态和明确重试入口。

协议和保护上限以以下源码为准：

- `packages/contracts/src/sensa/librarySync.ts`
- `apps/api/src/sensa/library/sync.ts`
- `apps/web/src/data/library/cloudSync.ts`
- `apps/web/src/data/library/store.ts`

Intake 的语义 payload 只声明一次：`packages/contracts/src/sensa/intake.ts`。它不携带运输目的地，
接收端仅按 Context、Expression、Sense 和 acceptance 的存在性走快/慢轨，不用模型评审
调用方已经提供的 Context 是否充足。表达的 canonical form 与 Context 中的 exact occurrence 分开，
例如可以保存 `back out` 并定位原文中的 `backed out`。当前 Web 本地 authority 在
`apps/web/src/experience/personalMeaningJourney/gateway.ts` 中幂等提交，相同 operation id 若改变载荷则报冲突。

外部 Agent 使用账号范围、可撤销且仅允许 Intake 的连接。连接合同在
`packages/contracts/src/sensa/agentConnection.ts`。Web 只接收约十分钟有效、一次性消费的 setup code；
长期 token 由本机安装器直接兑换并写入 `0600` 私有配置，既不进入 Web 状态，也不进入复制命令或进程参数；
服务端只保存 token digest。替换 setup 在成功兑换时才原子撤销前一连接。
`packages/mcp-server` 同时提供 stdio MCP 和 stdin CLI adapter，`integrations/codex/sensa-intake/SKILL.md`
只说明 Sensa 需要的 Context–Expression–Sense 格式、来源和 queued/applied 语义。Skill 不负责在运行时判定
事实完整性，也不把 Web 澄清实现搬进外部 Agent。安装资产由 Web release 的 `/integrations/` 提供；安装器
支持 Codex、Cursor、Claude Desktop、Windsurf 与通用 CLI：Codex 安装 managed skill 并通过
`codex mcp add` 登记，其他桌面客户端保留现有 JSON 配置并只管理 `mcpServers.sensa`。MCP 还暴露
`sensa_intake` prompt，使没有 Codex Skill 机制的客户端也能获得相同领域说明。安装可重试；卸载只移除
与当前 Sensa executable/config 精确匹配的登记和 managed 文件，不覆盖同名用户配置。

Agent 提交合同在 `packages/contracts/src/sensa/agentIntake.ts`，有意不接受调用方提供的 `acceptance`、
`client identity` 或 `libraryId`。`apps/api/src/sensa/access/agent.ts` 从已认证连接派生 client identity；
`apps/api/src/sensa/library/intakeDelivery.ts` 把一次 save 调用记录为 one-shot delegated acceptance，并使用
该账号唯一启用的 library channel 决定目的地。浏览器扩展不参与 Agent 安装、鉴权或交付，也不需要
`nativeMessaging` 权限。adapter 只持久提交 mailbox item 并返回 `queued`；
`apps/web/src/experience/account/RemoteIntakeDelivery.tsx` 在账号恢复完成后登记当前库，在初始加载、
恢复联网或窗口获得焦点时拉取，由本地 gateway 提交后回传 `applied` 及具体快轨/Inbox
结果。空闲页面不轮询；Web 未打开时只能如实保持 queued。数据库的账号/库隔离、唯一启用 channel、
mailbox 和 Agent credential 存储由 `db/migrations/0028_sensa_encrypted_intake.sql`、
`db/migrations/0032_sensa_intake_delivery.sql`、`db/migrations/0035_sensa_agent_connections.sql` 与
`db/migrations/0036_sensa_agent_connection_setup.sql` 提供。连接列表保留状态、到期和 last-used；独立事件表只
审计 setup、激活、替换与撤销，不记录 CES 内容。每个连接默认每小时允许 120 个新 operation，幂等重试不计重。

云端备份当前只有 `packages/contracts/src/sensa/accountBackup.ts` 的架构端口。它固定 immutable Recovery
Point manifest、摘要、大小、library/learner/schema identity 与 `account_assisted | zero_knowledge`
模式；仓库目前没有 backup route、store、scheduler 或 restore workflow。现有 account sync 仍是收敛服务，
不得在代码或 UI 中当作已实现备份。

Web 页面与扩展之间的桥也只声明一次：`packages/contracts/src/sensa/consumer/extension.ts` 同时声明握手（授权、交换、凭据）、页面请求/应答和不含内容的 Intake-ready 通知。Web 应用按它构造请求并校验应答，`apps/browser-extension/src/background.ts` 在分发前解析每条桥消息——未声明的 kind 或字段一律拒绝，不再静默丢弃；页面侧的 `webBridge.ts` 是每个 Sensa 页面都会加载的内容脚本，因此不带 schema，它的频道名、id 上限与 kind 白名单由 `apps/browser-extension/build.mjs` 在构建时从同一份声明注入。扩展完成持久化后主动通知已打开的 Web 页面，页面再通过完整 pull/ack 合同取数据；空闲页不轮询扩展，恢复焦点和可见性作为丢失通知的兜底。授权这一轮同样共用：API 路由与 Web 前置校验读同一组 schema。Web 页面在后台自动续接普通连接；插件中的显式登录则使用 Chrome Identity Web Auth Flow 打开带 PKCE challenge 的短时入口。已有 Web Session 自动签发一次性 code；没有 Session 才显示登录，登录完成后继续原请求。verifier 和最终扩展 credential 始终只在扩展后台，另一账号或资料库的队列不会随连接迁移。`scripts/sensaBridgeContractSmoke.mts` 在快速测试里把真实 forwarder 与真实 background 装进同一台假浏览器，逐 kind 走一遍。

## 模型与内容边界

所有模型需求都经过同一个模型管理边界：每个用途（澄清 `teacher`、材料 `content`、审核 `review`、词义判定 `reference`、网页阅读 `reading`）都要声明用途与执行位置，再交给该位置的执行器。执行器只有两个，一个进程一个：设备侧 `apps/web/src/data/library/transport.ts` 与 `modelExecution.ts`，服务侧 `packages/model-runtime` 的 Genkit flow。这两处之外，任何代码都不得命名模型端点或引入提供方 SDK；`scripts/sensaModelManagementSmoke.mts` 在快速测试中做静态检查。

Sensa 原生澄清由 `apps/web/src/experience/personalMeaningJourney/realSemanticAgent.ts` 在设备侧编排有界
教师 loop。每个用户回合可多次经过同一个 `teacher` 模型执行边界；模型最终输出同时包含面向用户的自然
回复和隐藏的 Context–Sense–Expression 清晰度/候选结构。候选是最终输出，不冒充工具调用。`teacher`
purpose 唯一允许的工具是读取本机已有意义，用于必要的复用判断；澄清不调用在线词汇参考。loop 只保存
真实工具活动摘要和候选，不保存隐藏推理，也不能调用 Personal Meaning commit 或学习事务。Sensa
托管连接的每次模型执行仍由服务侧 Genkit flow 完成；用户设备连接仍按既有规则在本页直接执行。
教师回复通过同一模型执行边界流式返回：托管连接使用 `/sensa/model/turn/stream` 的有界 NDJSON，
设备连接读取 OpenAI-compatible SSE。传输层只交付原始文本增量；澄清模块只从顶层 `reply` JSON 字符串
释放可见前缀，完整响应仍必须通过最终 schema 校验才会写入会话。工具参数、清晰度和候选不会作为流式 UI 暴露。

提供方只有两种：Sensa 服务与用户自填的连接。用户连接按保存位置决定执行位置。存在本机库 `providers` 表的连接在本页执行，密钥只保留在页面内存，不进个人库同步，请求由这台设备直接发出。存在账号侧的连接由部署密钥加密保管、在服务端执行；账号级连接登记处是 `db/migrations/0021_sensa_browser_reading.sql` 的 `reading_settings` 表，扩展与 Web 共用同一份，因此一个密钥只需配置一次。两种位置只差两点：本机连接可使用任意 HTTPS 地址与本机 HTTP 服务，但需要对方允许跨域，且不计入服务端用量；账号连接受部署白名单限制（`SENSA_READING_ALLOWED_ORIGINS`），并计入服务端用量。用途指派每次只属于一个登记处，切换用途即清除另一处。阅读的用途内部再按功能指派（划词、网页、字幕、阅读动作、句中意义、输入翻译）：每个功能一个指派键，`scripts/sensaReadingLanguageSmoke.mts` 在快速测试里保证功能清单与指派表、与阅读路由接受的请求枚举三者一致。

`reference` 用途默认由 Sensa 服务承担，并带独立预算池：`sensa_consumer.reference_usage`，上限 `SENSA_REFERENCE_DAILY_LIMIT`（默认 300）。`teacher` 使用 `sensa_consumer.native_semantic_usage`，`content`/`review` 使用 `sensa_consumer.native_content_usage`；后三者的默认上限均由 `modelDailyLimit=30` 控制。参考词典数据源（`api.wiktapi.dev`、`api.dictionaryapi.dev`）与浏览器设备语音不是模型提供方，不在本边界内。

模型输出只是候选。语义接受、学习资源校验、加入学习和运行时结算仍由对应应用与领域模块完成。常规测试使用替身，不调用付费模型或 TTS。

阅读请求由扩展的 background 在一个地方补齐学习者状态（语对与术语表），流式端口与普通消息共用这一步；模型连接测试与模型列表只带各自的问题。服务端的阅读、测试与列表三个入口只接受合同里声明的那三种请求体，`scripts/sensaReadingGlossarySmoke.mts` 在快速测试里逐个核对扩展实际发出的 body。

内容制作的命令、安全边界和无成本检查由 [`content/README.md`](../../content/README.md) 维护。生成数据、发布 JSON 和运行媒体不提交 Git。

## 本地开发

需要 Node.js 24 或更新版本。

```sh
npm install
npm run dev:sensa
```

`dev:sensa` 是日常人工验收入口。它在固定的 `http://127.0.0.1:3000` 启动完整 Web，提供热更新，
并管理以下本机边界：

- `sensa-local-postgres` PostgreSQL 17 容器，只绑定 `127.0.0.1:55434`；
- `http://127.0.0.1:4319` 的本地 Auth、API、账号云同步与远程 Intake 服务；
- `.sensa-local/browser-dev` 中的专用浏览器资料，不读取日常浏览器或生产站点的存储；
- 指向本地 Web/API 的开发扩展，自动加载到验收浏览器；
- 一个自动登录的 `local@sensa.invalid` 测试身份。退出后如需重新检查登录界面，验证码固定为
  `123456`，不会发送邮件。

启动器会先移除继承环境中的 `VITE_*`、Supabase、Provider、Cloudflare 和生产数据库变量，
Vite 的 `sensa-local` mode 也从独立空目录读取环境文件，并拒绝非 loopback 的 Auth/API URL。
普通 `dev:sensa` / `preview:sensa` 始终暂停托管模型，不读取模型密钥，也不会产生模型费用。

需要人工验收真实生成时，使用明确的模型 opt-in：

```sh
npm run dev:sensa:models
# 或使用 production build
npm run preview:sensa:models
```

模型 opt-in 只从当前 shell、`apps/api/.env`、仓库 `.env` 读取服务端模型白名单变量，优先级依次降低；
不会把 `VITE_*`、Supabase、数据库、Cloudflare 或其他生产凭据交给本地服务。当前受管默认连接要求
`DEEPSEEK_API_KEY`，并只支持 `SENSA_SEMANTIC_PROVIDER=deepseek`；未配置时启动器直接退出。该入口会产生
真实 Provider 请求并可能产生费用。也可以继续在产品设置中显式配置设备侧 Provider。

发布前使用真正的 production build 做第二次人工验收：

```sh
npm run preview:sensa
```

它构建压缩后的 Web 和 Service Worker，再从 `http://127.0.0.1:4173` 提供服务。
开发和发布前预览使用不同 Origin、OPFS SQLite 与浏览器资料，因此不会相互覆盖，更不会读取
生产 Origin 的语义世界。两个入口都复用同一个本地账号数据库；关闭专用浏览器窗口或按
`Ctrl+C` 会停止 Web/API 子进程，数据库容器保留以加快下次启动。

需要清空所有本地验收数据时，先关闭上述入口，再运行：

```sh
npm run reset:sensa
```

该命令只重建固定名称的本地测试数据库并删除 `.sensa-local` 下的开发、预览浏览器资料。
它不访问生产环境。localhost 与线上环境使用不同的 Agent 连接；本地验收需要在本地设置页创建测试连接，
回到线上时使用线上设置页签发的一次性安装命令。连接 token 不得跨环境复制。

无界面的完整本地链路检查为：

```sh
npm run test:local-preview
```

它会启动同一组本地边界，在专用无头浏览器中验证自动登录、SQLite WASM + OPFS 持久化与
Web/API loopback 约束，然后自动退出；不调用模型或 TTS。

原始的 `api:dev`、`web:dev` 和 `web:preview` 只用于单模块调试，不构成安全、完整的产品验收环境。
Web 公共配置示例位于 `apps/web/.env.example`，API 私有配置示例位于 `apps/api/.env.example`；
它们用于显式的真实服务调试，不会被上述受管入口读取。远程数据库连接必须使用受限运行角色并要求 TLS；迁移凭据只用于迁移。

需要数据库的本地检查使用一次性 PostgreSQL 17 数据库，例如：

```sh
MIGRATION_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/sensa_m1a_test \
  node --import tsx scripts/db-migrate.ts

SENSA_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/sensa_m1a_test \
  npm run test:db
```

测试数据库名称和地址必须满足相应脚本的隔离检查，不能指向 owner 或生产数据库。

## 验证

先运行覆盖改动边界的检查，再运行交付基线：

```sh
npm run check
```

Web 启动、账号恢复和空闲网络预算：

```sh
npm run test:browser
```

只验证开发态 Skin Lab 的 Semantic/Component/Page/Overlay Layout、Asset 与 Motion contract，以及 Skin ×
color mode × text size × responsive width、reduced-motion 矩阵时，可以先运行无账号、无 provider 的聚焦检查：

```sh
npm run test:skin
```

本机库、API、PostgreSQL 和浏览器同步合同：

```sh
npm run test:db
```

扩展构建与无付费交互检查：生产扩展只在同时提供 `SENSA_EXTENSION_WEB_URL` 与
`SENSA_EXTENSION_API_URL` 时写入 `apps/browser-extension/dist`；没有目标的仓库构建把编译检查产物写入
`.tmp/browser-extension-build`。本机预览则使用 `apps/browser-extension/dist-local`，三者不能互相覆盖。

```sh
npm run build -w @sensa/browser-extension
node --import tsx scripts/sensaBrowserPortSmoke.mts
node --import tsx scripts/sensaExtensionPopupSmoke.mts
```

脚本成功只能证明它覆盖的边界；真实账号、真实 Provider、浏览器商店和生产环境需要各自的验收证据。

## CI 与生产发布

`.github/workflows/sensa-consumer-check.yml` 在 pull request 和 `main` push 时运行 `Sensa CI`。它执行静态检查、构建、快速 smoke 以及 PostgreSQL/API 集成。

应用的日常生产发布只有一个入口：`.github/workflows/sensa-web-deploy.yml`。发布流程：

1. 接收一个完整的 `main` commit SHA，并要求当次 owner 授权；
2. 等待该 SHA 的 `Sensa CI` 成功；
3. 使用生产配置构建 Web、扩展和 API 一次；
4. 校验并传递同一份固定制品；
5. 应用前向数据库迁移并对齐 Supabase Auth 配置；
6. 部署 Supabase Edge Function；
7. 上传 Cloudflare Worker 版本，先验证预览，再提升到生产；
8. 执行公网非模型 smoke 并保存发布证据。

命令行触发方式：

```sh
gh workflow run sensa-web-deploy.yml \
  -f release_sha=<FULL_MAIN_SHA> \
  -f owner_accepted=true
```

`.github/workflows/sensa-web-candidate.yml` 是可选的深度验证，不是日常发布前置。`.github/workflows/sensa-web-monitor.yml` 负责已启用环境的定时公网和聚合阈值检查。

学习内容拥有独立于应用版本的发布入口 `.github/workflows/sensa-learning-content-publish.yml`。它接收
一个完整且已通过 `main` CI 的 commit SHA，并要求当次 owner 授权；随后从 `content/authored/*.json`
构建不可变 Book Release Bundle，执行无网络 Registry smoke，把 Bundle 上传到 Supabase Storage 的
content-addressed 路径并逐一校验公网 bytes，最后上传 immutable Registry Revision。只有以上步骤全部
成功后，工作流才把 API 的 `SENSA_PACKAGE_REGISTRY_URL` 提升到新 Revision。它不重新部署 Web、
不覆盖既有对象，也不把下载解释为 learner 已应用更新。

```sh
gh workflow run sensa-learning-content-publish.yml \
  -f release_sha=<FULL_MAIN_SHA> \
  -f owner_accepted=true
```

一个 authored Book release 必须显式给出 `bookKey`、正整数 `versionNumber`、`publishedAt`、
`changeSummary`，并为每个条目分别固定 `senseVersion` 与 `bindingVersion`。`content/authored/` 默认
为每个稳定 Book 与精确语言方向保留一个当前 source，历史版本由 Git revision 固定；构建器自动纳入
该目录的 JSON source。Book/Content Release 升级不自动抬升后两者；只有语义或表达 Binding 身份
真实变化时才增加对应版本。因此纯材料更新可以
保留 Learning Target 与 Retention state。`SENSA_BOOK_RELEASE_SOURCES` 可用逗号列出一次 Registry
发布包含的全部当前 Book release source；同一 Registry 不允许同一 Book 与精确语言方向出现两个版本。

所有生产部署都从 CI/CD 执行，不从本地 shell 调用 Provider 部署命令。迁移保持前向兼容；回滚 Web 版本时不能假设数据库也会回滚。

## 配置与安全

- 生产浏览器变量放在 GitHub environment variables；Provider token、数据库 URL 和 vault key 放在 environment secrets。
- `learning-content-production` environment 保存公开的 `SUPABASE_PROJECT_REF`、`VITE_SUPABASE_URL`、
  `SENSA_WEB_ORIGIN`，以及只供发布使用的 `SUPABASE_SECRET_KEY` 与 `SUPABASE_ACCESS_TOKEN`；前者不得
  进入浏览器构建或发布报告。Registry URL 是公开配置，但只能由受保护工作流提升。
- `.env`、密钥、owner 数据、生成媒体和测试报告不得提交。
- 本地和 CI 测试使用合成身份、隔离数据库和受控网络依赖。
- 任何会产生费用的真实 Provider 调用，以及任何生产 push/deploy，都需要当次明确授权。
- 长期文档不记录 SHA、Workflow run ID、一次性机器路径、某轮通过数量或临时故障过程。
