# Sensa Web 工程说明

本文是当前 Web 工程、验证和发布的唯一长期说明。产品行为见 [Web 产品说明](product-requirements-v1.md)，领域规则见[领域文档索引](README.md)。代码、迁移和 CI 配置始终是实现细节的最终来源。
生产支持与数据恢复按[支持与恢复手册](support-recovery.md)执行；其中没有把未经验证的基础设施备份写成已有能力。

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

[ADR 0006](../adr/0006-three-product-systems.md) 的 Personal Semantic World、Learning System 与 Content
Supply System 是产品领域划分，不与上述目录一一对应。当前 Web 的 Product Shell 位于 `experience`。
学习应用层只通过 `apps/web/src/learning/system/learningSystem.ts` 的 deep Module interface 提交 command、
读取 `home | workspace | personal_enrollment_index | semantic_memory` projection 并订阅对应查询失效；页面
不知道 Learning 的逻辑表、事务准入、Curriculum membership、Policy registry、协议选择、重放、readiness
或队列/调度原语。`workspace` 一次返回 Target presentation、状态集合、下一候选、历史和一个可辨识的
Runtime presentation union；Renderer 只展示该 union 并回交 learner action。`apps/web/src/learning/runtime`、
`engine` 与 `review` 是该系统内部的协议、评价和执行实现，`experience/learningRuntime` 只保留对公开
presentation type 的纯呈现装配，`apps/web/src/data/library/learning*.ts` 是本机事务与 authority 实现，
都不是页面 API。
内容发现、导入、下载、digest admission、安装与公共缓存恢复统一通过
`apps/web/src/contentSupply/system/contentSupplySystem.ts`；页面不直接处理目录 HTTP、账号 session、ETag、
目录缓存或 Package 存储。该 interface 同时拥有 learner-private provisioning task 的准备、停止、修订和
provider capability projection；`apps/web/src/contentSupply/provisioning` 统一组装并校验 Published、On-demand
与 Hybrid 的 immutable Learning Materialization。Content Supply 的 task、attempt 与 installation 写入在本机
事务提交前通过独立 authority admission；最终 materialization 与 Curriculum membership 的交接同时通过
Content Supply 和 Learning 两个 authority，不能把候选内容直接写成 ready Learning state。Learning 保留
显式 Add-to-Learning / enrollment intent，只接收 provisioning receipt 或已准入 materialization；Learning
Learning projection 不夹带 Content Supply catalog、安装缓存或 Bundle 字节；需要跨域展示或显式交接时只携带
已解析的稳定 presentation 与 typed identity。恢复与 Cloud Sync 也只调用 Content Supply interface。
Saved references、Sense Note、Sense Context Note 与 Personal Learning Scene 统一通过
`apps/web/src/personalContent/system/personalContentSystem.ts` 的 command/query/subscribe interface；页面不再
读取 `annotations` 表或维护另一份 annotation service。Personal Content 写入在同一 Library transaction
提交前经过增量 authority admission，其 Replica Module 单独拥有 `annotations`；`media` 由 Personal
Semantic World/Media 边界拥有。`apps/web/src/learnerSemanticProjection/system` 只有 read/subscribe，
通过 Personal Content、Personal Semantic World、Learning 和 published-content 接口生成可重建读取模型，
没有 command，也不直接取得其他领域存储表的所有权。
`packages/learning-kernel` 只显式导出可复用的确定性纯规则和值类型，不导出 Web 持久化、Curriculum、
协议 registry 或 UI composition。公共内容合同、校验与制作分别位于 `packages/contracts`、
`packages/content-validator` 与 `content`。目录位置不转移领域事实所有权；页面、SQLite record、HTTP route
与 Sync row 都不能成为第二 authority。

`apps/sensa_native` 和 `crates` 只保留现有代码，不参与当前产品开发、验收或发布规划。除非 owner 明确恢复该范围，不在这些目录继续迁移或新增能力。

Web Shell 只挂载首页、当前 URL sheet 栈和已打开的覆盖层；退出栈的页面必须卸载其 effect。非首页页面、
账号云同步、远程 Intake 与扩展接收器按需加载，不能重新并入同步启动图。`WebShell` 只观察 viewport
直属 screen root 的增删和 active 变化，不观察整棵页面子树。生产构建后的 JavaScript gzip 上限
由 `scripts/sensaWebBundleBudgetSmoke.mts` 按静态 ESM 依赖闭包固定，并纳入 `test:fast`；它分别约束入口、
App Shell、轻量首页、完整学习工作区和 Learning Runtime 的增量闭包，不能只统计入口与命名 chunk 而漏掉同步共享依赖。
首页只读取 Learning System 已解析的 compact Home projection，不取得 Target、Run、Curriculum 或 Package
事实；Package/Personal 完整控制器在相关 URL sheet 打开后加载。正式 Learning Runtime renderer 在进入 Run
时按需加载，Runtime/Protocol/Policy 选择已经由 Learning System 封装在 presentation union 中；首页学习队列与内容准备只在真实表变化、到期时间点或页面
恢复焦点时刷新，不使用固定频率轮询。
`test:browser` 使用生产构建和真实 Chromium 记录匿名 Landing、已登录 App Shell/首次本机库打开，并在 4x CPU throttle 下记录 Personal Meaning、学习入口和 Reference 覆盖层的 cold/warm 交互时间；静态闭包测试同时保证这些重模块不回流到匿名入口或首页。这里的 CI 时长是回归预算，不冒充真实设备的 LCP、INP 或 CLS。

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

生产 Web 的个人学习库是 SQLite WASM 数据库 `sensa-local-library-v10.sqlite3`，持久化在浏览器
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
学习事实仍以逻辑 record 为写入 authority；SQLite 在同一事务内维护可重建的 Target、Run–Target 和
Content Attempt 查询投影。首页只读取当前 Route 的 Target、该 Route 今日已占用的新词额度以及实际引用的
Package key；运行恢复、策略锁定和生成频控通过领域索引查询，不遍历或解析无关 JSON。数据库打开及有写入
的长连接周期内使用 `PRAGMA optimize` 维护查询规划统计。Book 版本替换和媒体引用完整性检查同样通过事务内
关系投影完成。承载大 JSON 的逻辑 record 与 Target 投影使用普通 rowid 表，紧凑关系投影使用
`WITHOUT ROWID`；物理 schema v10 使用新的 OPFS 文件，并在内容事务中维护记录级 revision 与删除 tombstone，供账号同步只读取上次收敛后变化的记录。云端确认的逐记录基线和 block refs 保存在内部 `sensa_sync_base` 表；未变化记录不再重新编码、分块或下载。`packageInstallations` 保存可跨设备复制的精确 artifact identity、语言方向、长度和 digest；完整 Published Bundle 与内嵌公共媒体只进入设备本地 `packageCache`，缓存写入不增加个人内容 revision。恢复后由 Content Supply 使用本机目录解析并校验精确 digest；解析或下载失败时 Learning Target 保留但 readiness 为 blocked。状态只保存小型幂等 commit receipt，不重复保存整库或待发布记录。`npm run benchmark:cloud-sync` 在真实 Chromium OPFS 上执行 1k/10k 完整同步路径，并固定单记录变化只上传记录块与受影响的 manifest 分片。因当前无用户库数据，不迁移或读取 v9 文件。
v10 同时是首个真实用户基线：打开版本低于 v10 或高于当前版本的文件会停止并保留原库，不创建空库冒充
首次访问；后续 schema 只能按顺序增加事务迁移与固定旧版夹具。跨标签页协调协议独立版本化，版本不一致
时旧/新页面不交换记录，并要求用户关闭其他标签页。Service Worker 安装新 shell 后等待用户确认再接管，
接管时保留上一发布版本的静态资源窗口，使仍在运行的旧页面能够完成或安全退出。

Web 应用层的逻辑表与 Personal Semantic World Journey 共用这一物理事务 authority。Journey 的
意义聚合、注册表事实、Inbox、澄清草稿和 operation receipt 分别保存在 `semanticMeanings`、
`semanticRegistry`、`semanticInbox`、`semanticDrafts` 与 `semanticReceipts` 等规范化逻辑表；媒体字节
单独保存在 `media` 表。一次领域保存仍由同一个 `LibraryTransaction` 原子提交，但普通语义修改不再
重写整个世界或图片载荷。当前没有生产用户数据，因此规范化语义格式与内容供给边界直接使用新数据库与 Checkpoint v5，
不读取、迁移或兼容 v1 单聚合格式。账号副本、界面偏好和其他 `localStorage`
状态不能充当个人学习库的第二权威。

学习历史不进入普通记录冲突选择器：两个设备从同一基线为同一 Target 完成互不重叠的 Run 时，
`learningReconciliations` 保存 ADR 0005 的确定性裁决，原始 Run/Event 均保留，只有选中分支参与当前
Target/Memory/Schedule 投影重放。API 对 Learning Event 与裁决记录都执行 append-only 保护。

学习运行时只在 Web 本机执行：目标选择、Protocol/Policy、步骤、评价、Completion、Memory Outcome 与
FSRS 都由本地领域事务结算。Hono/Edge 不创建或推进学习 Run，也不重新计算从云同步取回的学习事实。

普通账号云同步以本机已提交的 Personal Library Facts 为输入。云端保存版本化清单和按内容寻址的数据块；
下载按响应字节预算分页，客户端消费服务端返回的 deferred 列表。`operations` 是 Device Operation Ledger，
只用于同一设备上的命令幂等，不进入同步清单；Learning Event 直接以自身 Action、Materialization、
Evaluation 与 Transition 数据完成不可改写验证和重放。Remote Intake 重投可从 Draft 保存的 canonical
Intake 重建本地结果，不需要同步完整命令输入或返回值。同一份 base64 媒体按内容边界切块，使重复引用
复用摘要块。
Published Bundle 与公共媒体字节不属于 Personal Library Fact：Checkpoint v5 和加密手动快照 v6 只记录
`packageInstallations` 的精确可恢复引用，不承载 `packageCache`。learner-private / On-demand Materialization、
Personal Anchor media 与 Practice Artifact 仍按各自 learner-owned 表进入同步和备份，不能被误判为公共缓存。
Checkpoint 的 block/manifest 传输、CAS commit、重试和 baseline 由 Cloud Sync Coordinator 负责；记录的
跨设备归一化、三方收敛、完整性验证、历史 replay 与删除许可由领域 Replica Module 负责。Personal
Semantic World、Personal Content、Learning System、Content Supply 和 Preference 各声明唯一记录所有权，
中央同步器不再按领域表名实施策略。Learning Replica 对 Run/Event/Reconciliation history 只追加并拒绝
通用物理删除；同步和手动备份通过同一领域验证入口核对历史与派生投影。冲突闭包同样只采用各领域
Replica Module 显式声明的记录依赖；learner prose 和其他任意字符串保持 opaque，不能通过 UUID 猜测
扩大冲突范围。Personal Semantic World 使用专用三方 merge：不可变 facts 按稳定 identity 合并，
同一 revision 槽分叉和 delete-vs-edit 停为冲突；其 v3 facts / v5 Journey store 用单调 lifecycle revision、
删除 operation 与时间保存 tombstone，稳定语义记录不允许以缺行表达删除。手动备份恢复也通过同一
Replica Module 的 normalize/restore seam，不另写领域状态修复分支。本地 Journey Repository 在计算
任何逻辑行变更前，通过同一个 Personal Semantic World authority 校验发生变化的 facts、内部引用以及
before→after transition；未变化聚合按对象 identity 跳过，加载、同步和备份重建才执行完整状态校验。
因此 Gateway 提议的非法 revision 改写、tombstone 复活或物理删除不会进入 SQLite，也不会让普通命令
退化成随整个语义世界增长的全库扫描。具体规则见
[ADR 0007](../adr/0007-personal-semantic-world-revision-merge.md)。
Learning System 使用相同的单一准入模式：逻辑事务在 SQLite commit 前把已暂存记录的 `before/after`
交给 Learning authority；authority 只读取改变的 Target、Run、Event、active Run / Study Plan 及直接依赖，
重放新 Event 并核对 Target、Run、Evidence、Completion 与 Memory/Schedule 投影。Run/Event history 的
物理删除、旧 Event 改写、无 Event 的派生进度以及本地伪造 Reconciliation 都在提交前拒绝。Cloud Sync
与手动备份继续通过同一个 authority 的完整状态入口 replay 全部历史；日常学习动作不扫描所有 Run 或
Event。具体规则见 [ADR 0005](../adr/0005-concurrent-learning-history-reconciliation.md)。
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

架构中的 Intake Layer 不对应一个部署目录。所有本机 Surface/adapter 最终调用
`apps/web/src/experience/intake/semanticIntakeModule.ts` 声明的同一 deep Module interface；`submit`
接收唯一 payload，`resolve`/`dismiss` 管理该 Module 拥有的 Inbox 生命周期。它与 Personal Meaning
Journey interface 共用同一原子本地实现，但 caller 不再获得后者的语义编辑能力。`intakeEngine.ts` 是
fast-track/Inbox 完整性排序的唯一实现，依次返回
`pending_context | pending_expression | pending_sense | pending_acceptance`，或在四项事实完整时原子提交
`fast_track`。合同没有 `deferred` 或模型拒绝状态：主动延后通过尚未 acceptance 表达，格式/引用矛盾是
错误而不是 Inbox route。Remote Intake Delivery 只是调用同一 interface 的异步 mailbox adapter，不能
复制分流规则或直接写 `semanticMeanings`/`semanticInbox`。

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
服务侧队列的 provider 并发 lane 按连接身份隔离：Sensa 托管连接共享固定 lane，账号 BYOK 连接使用不对外记录的账号 + 连接 id；同一 origin 上互不相关的账号 key 不再互相占用单 provider 槽。总并发和队列上限仍是单实例保护，不能当作跨 Edge 实例的全局容量。
教师回复通过同一模型执行边界流式返回：托管连接使用 `/sensa/model/turn/stream` 的有界 NDJSON，
设备连接读取 OpenAI-compatible SSE。传输层只交付原始文本增量；澄清模块只从顶层 `reply` JSON 字符串
释放可见前缀，完整响应仍必须通过最终 schema 校验才会写入会话。工具参数、清晰度和候选不会作为流式 UI 暴露。
阅读与语义流在开始和最终提交时仍执行完整账号事务；流中撤权探测使用无账号行锁的轻量查询，并以两秒门控合并高频文本增量，避免每约 100 ms 对账号行执行 `FOR UPDATE`。撤销会终止后续输出，门控间隔由无网络 smoke 固定。

提供方只有两种：Sensa 服务与用户自填的连接。用户连接按保存位置决定执行位置。存在本机库 `providers` 表的连接在本页执行，密钥只保留在页面内存，不进个人库同步，请求由这台设备直接发出。存在账号侧的连接由部署密钥加密保管、在服务端执行；账号级连接登记处是 `db/migrations/0021_sensa_browser_reading.sql` 的 `reading_settings` 表，扩展与 Web 共用同一份，因此一个密钥只需配置一次。两种位置只差两点：本机连接可使用任意 HTTPS 地址与本机 HTTP 服务，但需要对方允许跨域，且不计入服务端用量；账号连接受部署白名单限制（`SENSA_READING_ALLOWED_ORIGINS`），并计入服务端用量。用途指派每次只属于一个登记处，切换用途即清除另一处。阅读的用途内部再按功能指派（划词、网页、字幕、阅读动作、句中意义、输入翻译）：每个功能一个指派键，`scripts/sensaReadingLanguageSmoke.mts` 在快速测试里保证功能清单与指派表、与阅读路由接受的请求枚举三者一致。

`reference` 用途默认由 Sensa 服务承担并使用独立预算池，上限 `SENSA_REFERENCE_DAILY_LIMIT`（默认
300）；`teacher`、`content`/`review` 的默认上限为 30。托管模型请求统一记录在短期
`sensa_consumer.model_requests` 状态机：连接配置先验证，排队时只进入 `reserved`，运行队列真正放行后
才进入 `running` 并占额度。相同 ID 与摘要可恢复成功结果或明确终态，不同摘要冲突；确认未执行的失败释放
预留，已执行和执行结果未知的失败不自动退款或重跑。成功响应最多保留六小时，元数据保留二十六小时，
每账号最多 1024 条、响应缓存最多 8 MiB；账号删除和每小时 retention 都会覆盖。参考词典数据源
（`api.wiktapi.dev`、`api.dictionaryapi.dev`）与浏览器设备语音不是模型提供方，不在本边界内。

YouGlish 使用官方 Widget 直接嵌入真实语境聆听页面；提供方脚本只在用户明确打开该页面时按需加载，
不进入 App Shell 启动路径，也不需要独立播放器站点。Widget 按目标表达和目标语言检索公开片段，结果
不构成 Sense 判定或学习事实；提供方不可用时只影响该练习页面，不阻止个人库保存或其他学习流程。

资源 schema、生成指导和基础展示字段集中在 `packages/contracts/src/sensa/learningResourceDefinitions.ts`；
轻量 Demand 与两阶段用途组合由 `lightweightLearningContent.ts` 声明。生成循环消费请求中的资源合同，
只生成允许的 model roles；权威表达、意义与来源事实由系统装配。词源和录音不能由模型生成 URL 或
自称来源。`spokenResource.ts` 在个人准备期间只调用 provider-neutral 的浏览器语音接口；生产组合根默认
注册 Edge TTS 客户端 adapter。adapter 返回可保存的音频字节，系统冻结与表达、语言严格一致的 TTS
材料，缺失时阻止发布。业务生成循环不识别 Edge 协议，替换 provider 不改学习流程或资源合同。发布构建器只
接收已经制作好的核心资源，不补造音频或场景绑定；纯文字 source 不再满足当前轻量合同。
新增可选资源应局限在资源定义、需求配置及必要的资料获取／专用展示能力，不修改协议状态机。

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
API 数据库层显式限制每实例连接池、连接获取等待、SQL 执行、锁等待与事务闲置时间；生产发布配置为
4 个连接、3 秒获取、15 秒 statement、3 秒 lock、10 秒 idle-in-transaction，并定期轮换连接。
每次连接获取只记录等待毫秒数与池总量／空闲／排队数量，不记录查询或账号标识。事务失败必须回滚；
回滚本身失败时销毁该连接，不能把未知事务状态放回池。Pool 上限只是单个 Edge 实例的预算，不代表
所有实例的全局数据库连接上限，扩大生产并发前仍需结合 Supabase 连接池容量验证。

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
不覆盖既有对象，也不把下载解释为 learner 已应用更新。音频与图片不进入 Git：operator 先用
`scripts/release/buildAuthoredMediaPack.mts` 生成精确媒体包并以
`sensa-learning-media-<digest-prefix>` 的唯一 tag 上传为 GitHub Release asset；owner 在发布时同时固定
tag 与完整 SHA-256。工作流先校验整个媒体包，构建器再校验并消费其中每个对象，遗漏、多余、MIME
不符或摘要不符都会终止发布。

```sh
gh workflow run sensa-learning-content-publish.yml \
  -f release_sha=<FULL_MAIN_SHA> \
  -f media_release_tag=sensa-learning-media-<DIGEST_PREFIX> \
  -f media_pack_sha256=<FULL_MEDIA_PACK_SHA256> \
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


### 固定声音制作与本地验收

`apps/web/src/data/library/speech/provider.ts` 是固定文本、语言到已保存声音的 provider-neutral 客户端接口；
`defaultProvider.ts` 是唯一选择默认实现的组合根，当前注册 `EdgeTtsClientProvider`。Edge adapter 在浏览器
内建立合成连接，只接收已固定的表达和语言标签，并返回可冻结、可同步的 MP3 data URL；协议 token、
音色映射、SSML 和帧解析不泄漏到学习代码。语言支持由 adapter 显式列出；未支持的语言不可静默改用英语。
consumer API 不再暴露虚假的 `/sensa/speech` 路由。切换客户端语音服务时注册另一个
`ClientSpeechProvider` 即可，不修改内容 Agent、材料 schema 或 UI。语音合成会把目标表达和语言标签发送给
当前选择的外部 provider；它不是设备离线朗读。

Python `content/tools/spoken_resource.py` 只属于离线 Book 制作管线。它的 Edge adapter 复用 edge-tts
合成器，保存 provider/model/voice/locale/rate、原文、摘要与时长；缓存按全部合成参数隔离，读取时检查
媒体摘要，provider 更换不会重写既有学习材料。该管线与 Web 客户端 provider 独立。

本地包源为 `content/preview/lightweight-resources-v7.json`。首次执行
`npm run content:prepare-local -- --allow-tts` 明确允许生成媒体；随后
`npm run content:prepare-local` 仅复用经过校验的缓存。生成文件位于被 Git 忽略的
`.sensa-local/` 和 `content/data/media/audio/speech-cache/`。
普通 `dev:sensa` 启动只构建已准备好的包，不产生外部 TTS 调用。
`npm run dev:sensa -- --no-browser --models` 启动供人工验收的本地服务：
`--no-browser` 禁止自动打开或操控浏览器，`--models` 允许用户操作调用已配置模型。登录使用本地验证码
`123456`。个人学习声音仍由浏览器当前选择的客户端 provider 生成；省略 `--models` 时托管模型暂停。
可通过 `SENSA_TTS_PYTHON` 指定装有 `content/requirements.txt` 依赖的 Python。

`python3 content/tools/smoke_spoken_resource.py` 验证 provider 替换、缓存隔离、损坏检测与外部调用门控；
`scripts/sensaSpeechProviderSmoke.mts` 验证 provider 替换、默认 Edge wire adapter、输入身份和已保存音频
合同；以上不调用真实服务。
完成本地构建后，`node --import tsx scripts/sensaLocalBookSmoke.mts` 在隔离内存库中验证实际包的
安装、学习结算与复习，完全禁用网络。真实浏览器存储、交互、声音听感由人工验收。


### 揭示资源目录与准备链路

产品定义以[揭示资源目录与适用矩阵](sense-learning-resource-model.md#111-揭示资源目录-v1)为准。
`packages/contracts/src/sensa/revealResources.ts` 是八类目录和类型矩阵的执行入口。
已固定的表达类型与来源事实解析适用范围；模型不能通过提交额外资源自行扩大范围。
新材料保存可重算校验的 `resourcePlan`，区分适用性、准备状态与已接纳资源。
没有资料不等于不适用，类型未确定也不默认当作单词。

学习包与个人目标共用准备、资源合同和准入校验。作者明确声明 expressionKind；
构式还要提供完整 spokenForm，声音对应完整实例，模板与槽位继续保存为表达结构。
个人来源从已确认的 Expression Version 读取结构；没有完整实例时明确阻止声音准备。
已认证的 `/sensa/resource-facts` 由准备工具取得来源事实。
当前 editorial adapter 覆盖 en → zh-CN/zh-Hans/en 的 fragile、sustain、borrow 词源，
根据所附 Merriam-Webster Word History 撰写；尚未接通通用词典或自动网页采集。
可选来源不可用时省略该资源；必需声音、场景绑定等仍受学习就绪校验约束。

第二张卡只展示材料中已通过校验的适用资源；缺少、失败、未准备与不适用区域不显示，
不显示空标题、占位或申请补充按钮。AI 学习问答仍是后续独立能力，本轮没有接入。
历史资源追加的 provenance 读取和备份校验保留，已有材料及学习记录不被重写。
新资源由新材料／学习包版本交付，本地 v7 包通过用户主动应用更新进入已有学习目标。

`sensaRevealResourcesSmoke.mts` 验证类型矩阵、来源准备、范围约束和材料计划校验；
`sensaRevealRenderSmoke.mts` 在 Node 中渲染真实卡片，验证有资料才显示对应区域；
`sensaKnownContinuationSmoke.mts` 验证备份与声明已会后继续队列。它们不操控浏览器、
不调用模型或 TTS。实际声音与浏览器交互仍由人工验收。

### Web 学习资源 Agent 与后台任务

`contentGenerationLoop.ts` 复用澄清 Agent 的设备侧 `complete()`、多模态消息和统一并发队列。
托管连接继续通过服务侧 Genkit；BYOK 连接继续由浏览器直连，不引入另一套 SDK 或密钥存储。
`contentAgent.ts` 的工具名称同时约束 Web、模型传输合同和服务端白名单。
工具提供固定表达的声音准备、参考资料查询、按角色提交草稿及整体校验。
独立来源请求可以并发；草稿写入和校验按顺序执行。范围由固定表达及可靠来源解析，
Agent 不得更换 Expression/Sense、制造来源或调用学习结算事务。
例句生成输入与最终材料合同分离：模型指出例句中实际使用的表达文字（允许自然词形变化），代码计算 UTF-16 高亮位置并填入经验关联键。
多处匹配时模型选择出现序号；匹配不到时返回角色错误。合同只校验结构、位置和关联，不以词形白名单代替语言与 Sense 忠实度判断。
同批提交按角色保存，一个角色失败不会丢弃其他草稿；最终仍须通过整体校验。

输入冻结完整已确认 Sense semanticSpec 和表达形式。只有用户勾选自己的场景，才带入原始图文；
第一张卡保留全部输入图片，不允许 Agent 挑选替换、遮挡或重绘。文字可忠实改写以避免泄露表达，
不得虚构细节；第二张卡的绑定说明和例句围绕同一经验。未授权的个人 Context 不进入请求。

`backgroundPreparation.ts` 承载显式发起的应用级任务，最多两个目标同时准备，同一目标合并执行，
页面卸载不取消任务。模型请求仍经过全局／provider 限流，澄清等交互用途保持队列优先级。
明确停止任务或清除登录凭据会取消对应工作；关闭 Web 不承诺继续执行。
准备请求、已取得的来源、分角色草稿、工具记录和校验反馈保存在 Content Attempt。
显式重试复用这些已保存结果，重建紧凑模型上下文并给予新 Attempt 预算，不自动产生模型费用。
过期执行仍受 task lease、账号、模型配置及来源版本校验约束，旧结果不能发布到新任务。
最终统一校验并发布材料快照，不把草稿或可选资源缺失写成学习成果。

`sensaContentAgentSmoke.mts` 默认只使用假模型／工具，覆盖并发、修复、恢复和原图保留，纳入 `npm run check`。
人工授权后可显式执行 `node --import tsx scripts/sensaContentAgentSmoke.mts --live-deepseek`，
通过本地托管服务调用配置模型。该模式使用测试场景和既有缓存声音，不改用户学习数据；
结果写入被 Git 忽略的 `.sensa-local/agent-live-smoke.json`。真实模式不进入常规验证。
