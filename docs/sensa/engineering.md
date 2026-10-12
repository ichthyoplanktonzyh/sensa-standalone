# Sensa Web 工程说明

本文是当前 Web 工程、验证和发布的唯一长期说明。产品行为见 [Web 产品说明](product-requirements-v1.md)，领域规则见[领域文档索引](README.md)。代码、迁移和 CI 配置始终是实现细节的最终来源。
通用基础能力先对照成熟模式：学习状态、队列、限制与历史参考 Anki，本地事实与可重建索引参考 Obsidian；
只为 Web 平台和 Sensa 的真实语义差异增加机制。领域设计与测试结构可以协调修订，用户价值、数据正确性和安全保障是判断标准。
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
读取 `home | workspace | runtime | management | preferences | personal_enrollment_index | semantic_memory` 等显式 projection 并订阅对应查询失效；页面
不知道 Learning 的逻辑表、事务准入、Curriculum membership、Policy registry、协议选择、重放、readiness
或队列/调度原语。`workspace` 一次返回 Target presentation、状态集合、下一候选、历史和一个可辨识的
Runtime presentation union；Renderer 只展示该 union 并回交 learner action。`apps/web/src/learning/runtime`、
`engine` 与 `review` 是该系统内部的协议、评价和执行实现，`experience/learningRuntime` 只保留对公开
presentation type 的纯呈现装配，`apps/web/src/data/library/learning*.ts` 是本机事务与 authority 实现，
都不是页面 API。

`workspace` 用于完整目标与详情；Study/Stats 的 `management` 在同一 Library 读锁下读取紧凑队列与历史摘要，
不加载完整历史 Run、Target 材料或 Content Supply inventory。Profile 的 `preferences` 只读取每日数量与策略选项。
历史摘要是设备侧可重建索引，从正式完成的 Run 与固定呈现材料生成；它不创造 Completion 或 Memory Outcome，
与源事实同一 SQLite 事务维护，并在所有源 rows 写入后更新，不能依赖云恢复的表顺序。读取失败时不显示虚假空状态。
紧凑历史当前仍返回全部可用摘要，不等于无限历史的有界读取或容量通过。执行中的 `runtime` 只精确读取当前 Run 和参与目标，在 Run 边界才
计算后续候选，不随每个步骤重新读取课程集合或历史源记录。本轮已完成计数通过历史索引按 Session 的精确 Run ID 聚合；当前待处理与最近复习时间通过路线／语言对的候选索引汇总，不冻结总任务或读取整库材料。学习包目录界面在对应页面进入时加载，不进入
恢复学习的同步模块闭包。Runtime 进入、恢复和重新获得焦点不执行整库资源恢复或完整内容库存读取；
个人场景保存需要的来源摘要只按当前固定内容的 Package key 读取，不向页面运输其他内容或执行、媒体结构。
Learning 操作回执只保存有界的 Run identity、原始 revision 与时间/语言元数据，
不重复保存材料和协议状态；重放返回原收据，并核对其创建、Action 或 resume witness。续学绑定已完成的前序 Run、
时间顺序、原 Session intent 与语言方向；无 device operation ledger 的云恢复也从 Run/lifecycle facts 验证这些关系。
操作未收到回执时只重读已保存事实，不以重提交来探测是否成功；读取失败
暂时关闭操作入口并提供重读出口。

揭示卡的学习问答通过 Learning System 内的独立只读服务固定 Run、目标、步骤与材料版本，使用
当前绑定资源和前一步实际采用的经验。请求前后复验作用域，关闭或切换步骤取消请求；Content Attempt
的原接收方授权不沿用给问答。默认不发送个人 Context 派生材料或额外场景，用户可为明确显示的当前
teacher 单独授权文字，接收配置变化拒绝发送，不发送其媒体。回答仅在当前对话展示并标明未审核，
没有 Semantic Acceptance、资源 admission 或学习 settlement 权限。
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
Semantic World/Media 边界拥有。
Sense Note 编辑通过 Personal Content 的精确读取取得 edit base；写入在同一事务中检查 revision 和原正文，
防止 Cloud 明确选择另一同 revision 分支后，旧编辑器仍可覆盖。
清空保留空正文及递增 revision，默认笔记投影排除空正文，避免 clear/recreate 的 ABA 覆盖。确切 operation
重试复用原输入及 receipt，不重新覆盖中间更新；已确认提交后的投影读取失败与写入失败分开报告。
Personal Content 的 snapshot/sense 读取区分 loading、ready 与 error；重新读取失败不成为空库成功。
界面只在 ready 时使用收藏、笔记和例句状态，精确笔记编辑仍独立读取其 edit base。场景／Context 编辑器
也精确读取原内容，失败时禁用编辑和保存并允许重读或退出，不以未加载的空缓存覆盖已有场景。
Personal Learning Scene 的写入以实际读到的 revision 与正文／图片 digest 为基线，在同一事务中拒绝陈旧
编辑；精确重试复用原操作，失败保留草稿。Runtime 单独读取当前 Target×Route 场景，不因无关 annotation
列表失败而隐藏已有场景；本条读取失败时暂停依赖它的动作并允许重读。
Scene→World 接受使用独立 command frame，按可重建的 Scene→Meaning 索引与固定发布 Registry 闭包读取，
不继承全库浏览／练习 snapshot。写锁内复查场景 owner（包括确切不存在）、已占用身份与发布事实；已回收
Meaning 与退役 Anchor 的归属仍保留。新 Scene 的首次 Meaning identity 按 Scene 固定，跨设备不同 revision
不会生成第二身份；已保存的 owner identity 优先，不做数据迁移。独立替换个人 Context 后再接受场景，保留
其当前整理并引入新的活动场景 Anchor，不改写旧 tombstone 或学习历史。
`apps/web/src/learnerSemanticProjection/system` 只有 read/subscribe，
通过 Personal Content、Personal Semantic World、Learning 和 published-content 接口生成可重建读取模型，
没有 command，也不直接取得其他领域存储表的所有权。
跨来源列表采用 Practice、Personal Meaning 或 Learning Target 的可辨识 reference，不伪造 Word/Example。
`semantic_memory` 的全局列表只返回表达、释义/场景预览、实际 Memory 与 declaration；精确 targetId
读取返回该目标的完整展示，不加载其他 Target、Run、包或媒体。SQLite 只持有同事务维护、可从 Target
重建的紧凑本机投影，不形成第二事实源；缺行或无效来源为读取失败，初始化重建不改写原事实。
学习连接按 Target 身份保留，Sense 级收藏和笔记才按 Sense 解析回看入口；列表复用虚拟化控件。
`packages/learning-kernel` 只显式导出可复用的确定性纯规则和值类型，不导出 Web 持久化、Curriculum、
协议 registry 或 UI composition。公共内容合同、校验与制作分别位于 `packages/contracts`、
`packages/content-validator` 与 `content`。目录位置不转移领域事实所有权；页面、SQLite record、HTTP route
与 Sync row 都不能成为第二 authority。

`apps/sensa_native` 和 `crates` 只保留现有代码，不参与当前产品开发、验收或发布规划。除非 owner 明确恢复该范围，不在这些目录继续迁移或新增能力。

Web Shell 只挂载首页、当前 URL sheet 栈和已打开的覆盖层；退出栈的页面必须卸载其 effect。非首页页面、
账号云同步、远程 Intake 与扩展接收器按需加载，不能重新并入同步启动图。`WebShell` 只观察 viewport
直属 screen root 的增删和 active 变化，不观察整棵页面子树。生产构建后的 JavaScript gzip 上限
由 `tests/web/quality/web-bundle-budget.test.mts` 按静态 ESM 依赖闭包固定，并纳入 `test:fast`；它分别约束入口、
App Shell、轻量首页、完整学习工作区和 Learning Runtime 的增量闭包，不能只统计入口与命名 chunk 而漏掉同步共享依赖。
首页只读取 Learning System 已解析的 compact Home projection，不取得 Target、Run、Curriculum 或 Package
事实；Package/Personal 完整控制器在相关 URL sheet 打开后加载。正式 Learning Runtime renderer 在进入 Run
时按需加载，Runtime/Protocol/Policy 选择已经由 Learning System 封装在 presentation union 中；首页学习队列与内容准备只在真实表变化、到期时间点或页面
恢复焦点时刷新，不使用固定频率轮询。
viewport 级弹层挂到 document body，避免 App Shell 的 transform／裁剪改变其固定定位；container 与
specimen 弹层仍在原宿主内。主题和方向仍来自 html，保持相同关闭、焦点与返回语义。
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

生产 Web 的个人学习库是 SQLite WASM 数据库 `sensa-local-library-v12.sqlite3`，持久化在浏览器
Origin Private File System。SQLite 在专用 Worker 中运行，使用不要求页面启用跨源隔离的
`opfs-sahpool` VFS。页面 Web Lock 选出逻辑 owner，持有 OPFS 句柄的 Worker 另持物理 pool 锁；其他同源 Sensa 标签页通过 BroadcastChannel
复用 owner 的记录接口，owner 关闭后由剩余页面重新选举，绝不打开竞争连接。跨页共享/排他事务锁覆盖
完整 `LibraryTransaction`，因此多次读取到一次 commit 的 read/modify/write 序列不会在标签页之间交错。
关闭时先排空 Worker 请求、关闭数据库、暂停 VFS 并确认原生句柄可再次打开，再释放所有权；无法确认时停止而不创建空库。
接入页等待 owner 时继续尝试同一规范锁，不依赖已经关闭页面再次广播。确认 owner 更换后，立即结束发往
旧 owner 的挂起请求；只读请求可向新 owner 重读，提交结果不确定时不自动重放底层写入，仍由原命令回执恢复。
SDK 初始化失败不得删除 pool 数据，构建中的版本和源片段检查必须阻止未审核依赖绕过保护。真实句柄冲突与 Worker 突然终止另由隔离 Chromium 回归验证。
pool 关联头的摘要或读取长度异常、无路径却仍含数据时，初始化拒绝打开并保留原文件，不能通过截断槽位
创建新空库。合法临时文件只在完整关联头通过校验后按 SDK 语义回收。隔离 OPFS 回归通过单字节故障注入、
失败前后完整文件摘要对比和还原后的原记录读取验证此保护；建库回执缺失也不会覆盖现有资料库身份。
`openLibrary` 在同一事务中核对当前身份，不用孤立的建库回执冒充身份仍存在。先前打开线索、回执、账号 owner
或其他 learner-owned 记录存在而身份缺失时，拒绝自动创建新身份。浏览器线索只用于保守阻止首次建库，不是内容
权威；仅剩元数据或非初始化操作也属于先前使用线索。账号已确认删除后的本机重置由设备私有 witness 标记，
不凭缺失身份猜测清空意图，该标记不导出或同步。
独立恢复入口复用加密备份检查与原子恢复，禁止导出假空库；身份缺失的空目的地不先创建
占位 learner。账号备份在此路径额外核验当前登录及同一时刻缓存的 subject，恢复的 owner 来自已校验备份，
不会授予在线服务权限。解密、预览后写锁内仍重查目的地占用；原身份和领域事实保留，设备身份更新，成功后再重开。
提交开始前同步重查账号缓存，期间切换账号不能接受旧授权的恢复。原账号登录页可返回恢复入口。
用户明确“重新开始”时，退出本机登录，排空旧库逻辑事务，选择 UUID 命名的独立 OPFS pool；旧 pool 和原引用
不删除、不复用。默认 pool 路径保持不变；每个新 pool 的 Worker 初始化绑定、物理/逻辑锁、协调频道与内容通知
都按 namespace 隔离。页面实例固定绑定一个 namespace，设备选择变化时旧标签页停止读写并提示重开；不自动重载
丢弃输入。库相关 UI 草稿、澄清会话（包括 tab fallback）、练习选择和签到同样隔离，外观与界面语言仍设备共用。
新 pool 初次初始化失败也进入恢复页，不依赖已成功打开的 hint；重试同一选择，不伪造成功或删除旧文件。
损坏的设备选择指针不回退 primary pool；明确新建前后检查源选择未变化，并保留原始不可读指针。选择写入
由独立设备锁串行化，原物理目录始终不删除。
新增槽位在首次写头前中断留下的 0 字节文件可以初始化；任何非空短头仍拒绝并保留。
隔离 OPFS 回归验证空槽恢复后原记录及原数据库文件摘要不变。
本机 `libraryId` 与 `learnerId` 在无账号时即建立；`service-owner` 只绑定在线账号，不是本机学习事务的
准入条件。账号连接前读取云端 head：双方都有内容时保持本机库未绑定并停止自动同步；云端为空时连接
已有本机库，空本机库则允许后台恢复原账号资料。加密手动快照的新 payload 可表示无账号库，并继续
读取已有账号快照；恢复仍只允许在空库中进行，账号快照仍校验原账号。
空库账号预检失败保持 initial restoration failed，不将未核验远端视为确定零；可用事实复用 replica ownership
判定并按有界批次在首条事实处返回，不维护漏掉 annotations 等类别的第二套表清单。初次非 authoritative
状态在 Shell 内显示恢复/重试出口，不挂载事实页面及规划器；设置可访问，退出运行时到设置使用一次原子
导航。存在性从同一读取事务按有界 key 页查询覆盖索引，不读取或解码完整事实、共享材料和媒体正文。
预检重试复用账号连接流程，不重复发送邮件；已准入的同步失败重试则实际重跑手动同步，不依赖
online 布尔值变化才能重启，也不伪装成功恢复。
账号删除复用 Supabase SDK 的 PKCE／OTP 验证，而不从 URL 或缓存会话制造新鲜验证。服务端在签名验证后读取 AMR 中的 `otp` 或 PKCE `magiclink` 时间，仍检查五分钟窗口与未来时间；JWT 签发／刷新、OAuth、注册或邀请不能代替邮件重新验证，参见[Supabase AMR 说明](https://supabase.com/docs/guides/auth/auth-mfa)。删除收据在发送邮件前保存原账号、本机身份／incarnation 与退出 epoch；验证回调与明确删除提交分离，提交阶段在跨标签 Web Lock 内单向推进，取消不能撤回或复活已提交请求。
服务器删除身份使用仅后端的 `SUPABASE_SECRET_KEY`（现代 Secret Key 走 `apikey`，不能当 JWT 使用）；仍可配置旧 `SUPABASE_SERVICE_ROLE_KEY`。不得将两者传入 `VITE_*`、浏览器产物、日志或 Git。
发布前须核对邮件投递及容量：Supabase 内置邮件供应商默认每项目每小时 2 封；正式登录和敏感操作重新验证应配置并验收自定义 SMTP 或 Send Email Hook，不能降低删除验证标准或以管理员生成链接替代实际邮件旅程。参见[官方限流说明](https://supabase.com/docs/guides/auth/rate-limits)。
浏览器内不再叠加全局 Promise 队列：只读事务持有 shared Web Lock 并可并发，写事务持有 exclusive Web Lock；
无 Web Locks 的测试 Adapter 才使用串行 fallback。
UI 只通过本机事务修改数据，不直接执行 SQL，也不写派生学习结果。Node 测试使用相同事务接口的内存
Adapter；浏览器交付必须另验真实 OPFS 以及 follower 标签页的读写。当前版本不读取或迁移旧 IndexedDB 数据。
SAH Pool 由 leader Worker 独占，所以数据库打开后的第一条 SQLite 指令固定为
`locking_mode=EXCLUSIVE`，随后使用 `journal_mode=WAL` 与 `synchronous=FULL`。这遵循 SQLite Wasm
无 shared-memory 环境的 WAL 前置条件，并保留 FULL 的提交同步；不得为了基准数字降为 NORMAL。
真实 Chromium 对照可用 `npm run benchmark:sqlite-opfs` 复测，`test:browser` 同时验证 Worker 重启后的
记录数、`quick_check` 和生产运行时实际采用的 WAL/FULL/EXCLUSIVE profile。
同一物理连接只初始化一次。普通打开验证版本、读写能力和持久化配置；建库、结构变更及用户主动导出的支持诊断执行完整 `quick_check`。
完整检查是随全库规模增长的健康扫描，不能成为每次页面刷新与标签页接入的前置步骤（[SQLite 检查语义](https://sqlite.org/pragma.html#pragma_quick_check)）。容量旅程在学习动作和恢复断言后独立执行完整检查。
学习事实仍以逻辑 record 为写入 authority；SQLite 在同一事务内维护可重建的 Target、Run–Target 和
Content Attempt 查询投影。首页只读取当前 Route 的 Target、该 Route 今日已占用的新词额度以及实际引用的
Package key；运行恢复、策略锁定和生成频控通过领域索引查询，不遍历或解析无关 JSON。数据库打开及有写入
的长连接周期内使用 `PRAGMA optimize` 维护查询规划统计。结构变化才考虑全部表；大批量写入在该事务内维护统计，
在 durable commit 之后通过 SQLite checkpoint 缩短遗留 WAL 的冷重开成本；仍保持 WAL/FULL/EXCLUSIVE。
维护触发考虑实际 SQL 行变更和大段已编码值／媒体，不只统计逻辑 `puts`；同步基线替换和启动时派生索引
重建也包括在内。它是维护策略，不是 WAL 字节数的硬上限；普通未变结构的重开不执行 checkpoint。
提交后的维护失败仅进入独立诊断，不撤销既有收据或把已保存事实误报为未保存（[SQLite WAL](https://sqlite.org/wal.html)）。
其中物理 I/O、数据库损坏或文件不是数据库（NOTADB）的错误会隔离当前连接，在下一条排队请求执行前停止后续 SQL；约束、忙碌与普通命令失败不按损坏处理。提交后的维护故障仍保留原成功回执，显式关闭不再追加优化查询。
普通命令或诊断修复失败后的回滚错误保留在 cause 链中，不能因原错误不致命而掩盖回滚的 I/O／损坏错误。包装器构造成功前也持有原生数据库引用，构造失败须先关闭原生句柄，再暂停池、验证并释放租约；未确认清理成功时保留引用和锁供重试，不创建新库。
普通重开复用已有结构与统计，不重放 DDL、重写版本或制造缺失的空源表。Book 版本替换和媒体引用完整性检查同样通过事务内
关系投影完成。承载大 JSON 的逻辑 record 与 Target 投影使用普通 rowid 表，紧凑关系投影使用
`WITHOUT ROWID`；内容事务维护记录级 revision 与删除 tombstone，供账号同步只读取上次收敛后变化的记录。云端确认的逐记录基线和 block refs 保存在内部 `sensa_sync_base` 表；未变化记录不再重新编码、分块或下载。`packageInstallations` 保存可跨设备复制的精确 `.sensa` identity、语言方向、长度、digest 与来源 Book archive digest；完整 Portable artifact 与编译后的设备 Runtime content 只进入本地 `packageCache`，缓存写入不增加个人内容 revision。恢复后由 Content Supply 使用 Registry 中的 `.sensa-book` 位置一次重新取得，验证外层摘要及全部成员，再只恢复已有安装事实对应的缓存；解析或下载失败时 Learning Target 保留但 readiness 为 blocked。状态只保存小型幂等 commit receipt，不重复保存整库或待发布记录。`npm run benchmark:cloud-sync` 使用受控传输在真实 Chromium/OPFS 上执行 1k/10k 合成 Draft 的同步，检查单记录变化只上传记录块与引用 patch；它不是成熟学习历史、真实 API/网络或账号容量验收。
内容摘要、key/digest 和语言方向数量使用同事务维护的设备侧投影；它们不进入备份或账号同步，可以从真实缓存重建。
整库三方合并共用一个可分步执行的领域合并实现：普通同步调用与云同步协作调度不维护两套规则。
个人意义分支校验按 Meaning 解码相关操作回执，分组只保留记录引用；可重复的按需正文读取若失败，
原错误必须穿透领域冲突处理，不能误报为用户可裁决的冲突。合并校验失败后的冲突状态写入也在
写事务内核对捕获的本机内容版本；期间新增内容时保留原事实与基线，回到待同步，不发布旧冲突快照。
协作调度不等于整体资源有界：
双方变化或冲突等完整回退仍持有整库 wire 正文，排序、单个 Meaning 与 Learning reconciliation 也仍有同步工作段。
已完整恢复的内容缓存复用一次一致的安装／来源快照；下载或缓存修复后重新读取当前快照，避免把期间新增但未恢复的来源误报为就绪。
学习状态变化只刷新学习投影，语言选择只读取当前语言方向；通知按记录 key 过滤，当前页面不重复处理自己发出的跨页通知。
数据结构调整不要求保留历史格式兼容层；当前源事实和可重建索引分开处理，不通过清空用户库恢复初始化错误。
物理 schema 19 沿用共享摘要存储材料内容、协议绑定和步骤定义，并将 learner-owned Context 头、不可变版本和父链保存为独立 `semanticContexts` 源事实；Meaning 和冲突历史只持准确版本引用。Worker RPC 60 与 Cloud manifest 8 共同验证这些引用、接受回执依赖和正文一致性。记录仍独立保存身份、版本、时间、provenance
及结算事实。`sharedRecordContent.ts` 只改变无损存储表示；普通 record 接口读取还原后的原值，页面和协议
不解析存储引用。共享 body 与 record／sync baseline 的直接 owner 关系同事务写入；只回收本次事务解除引用
后确实无 owner 的 body，不在日常评分时扫描全部 body。同一无损压缩 envelope 也用于普通记录与基线，
所有逻辑读取先还原精确字节；Registry scalar UDF、identity 冷重建／诊断及 supplemental 冷重建同样解包。
可用时用标准 Uint8Array Base64 字节方法代替逐字节字符串转换；缺少方法的平台仍使用既有 btoa／atob 路径，
不改变 envelope、压缩、长度预算或摘要校验，参见
[原生字节转换规范](https://tc39.es/ecma262/multipage/indexed-collections.html#sec-uint8array.frombase64)。
当前实现只接受 schema 19 或完整的新空库，不猜测迁移历史格式。发现不支持版本时显式拒绝，保留原数据库、基线、媒体与恢复文件；失败连接关闭也不得回收旧候选。既有 v12 OPFS 文件池名称继续用于定位原数据，不代表 schema 12 可被接受。基线以普通 rowid 表保存较大正文，保留两列 NOT NULL 与复合唯一主键。
大正文与紧凑关系表分别实测布局，不一律使用 `WITHOUT ROWID`，参见
[SQLite 适用条件](https://sqlite.org/withoutrowid.html)。暂存候选的正文同样使用 rowid；冷连接只在私有候选事务内
清理旧代及重建正文表，manifest／proof 随父记录级联清除，不触及本机事实。
这些 body 是源事实表示的一部分，不是可猜测重建的缓存；缺失或损坏必须失败，不从当前包、模型或材料新版替代。
13→14 的共享表示不改写已有逻辑事实；15 为 `studyScopes` 与 `learningSessions` 扩展
record、tombstone 与 sync baseline 的表名允许项，在同一事务内逐字节复制原编码行，
保留 rowid、索引及共享内容所有权；中途失败全部回滚，不重编译或改变用户内容。
Study Scope 是实际选入 Run 的不可变来源／策略快照，不是整个库的候选副本。Session 独立保存起点 Scope、
固定语言方向、数量、意图和活动生命周期；后继 Run 各自保存当前选择的 Scope，候选继续查询当前来源索引。
词书安排通过 Learning System 的 `book_plans` projection 与 `change_book_plan` command 维护，
按 Enrollment revision 拒绝过时保存。同一 Route 至多一个 active Book；激活其他词书时原词书转为
maintenance。模式变更复用原 Range 且不依赖包缓存；新序号／意义选择从固定 Book Version 解析。
这些变更更新下一条未开始 Run 的队列资格，不改写当前 Run、已提交策略或进度；跨记录的双 active Book 合并进入显式冲突处理。
未完成活动通过 `end_session` 使用已查看的 Run revision 明确结束：同一事务保存 Session 终点、
Run 的可配对暂停见证并清除两个 active pointers，不写 Action、Target 或调度事实。再次开始创建
新的 Scope/Session，并用配对恢复见证保留原 Run/pins。按 Run 索引的已接受 Action 时间查询及
完整恢复校验都拒绝早于既有作答的结束；提交后重读失败单独报告已保存状态，不自动重提交。
Run 来源验证通过同事务维护的 Scope–Target 成员投影读取精确历史引用。新选择只读取实际 Target 的来源，
不枚举完整 Target／Enrollment／移除决定表，也不保存全库三用途计划。当前 Run 恢复不重新核定未来队列资格。
Scope 中重复成员和 Range 复用共享摘要；源码中的捕获见证与恢复验证保护新建和既有快照。
实际选择 Scope 的每个来源共用一次身份、材料及 Profile capability 校验（含失败结果），各 purpose 的协议资源
仍独立检查 detached 输入；返回的 binding 也独立于 Registry。普通单目的探测使用同一 Module，不削弱守卫。
实际选中来源仍校验 Target、材料、Profile 和 purpose 的准入条件；其正文缺失或损坏时失败，不从新版或缓存猜测修复。
运行时候选先读索引前缀并按 intent 与穿插规则选下一条，随后只检查该候选当前来源的 purpose readiness；
协议拒绝的候选被排除并补取前缀，无关类别与确定排除的当前 participants 不做资源探测；
不消耗新学额度，也不把候选索引当作学习准入。Session 起点必须绑定首个实际选择／恢复的 Run 与操作见证；
后继 Run 使用自己的 Scope，不受起点库存限制。
恢复时可由该 Target 的另一个当前合法来源提供覆盖，但不会替换旧 Run 的执行来源和材料；
Session 起点证明实际目标、策略版本和 purpose 资格，不另建逐次恢复选源的审计历史。
首页复用调度索引汇总待新学／到期数量，并精确读取当前 Run 和下一条候选；不为显示计数解码全部 Target。
同方向活动仍使用已固定的每日上限；偏好修改不重设本轮额度。

Personal Meaning 回收站复用原 Meaning revisions：每次明确删除／恢复追加带 lifecycle stamp 的
不可变修订，同事务更新 Meaning head 与幂等回执；不引入第二套历史表或对 Learning 做级联修改。
删除项拒绝普通内容命令；冷启动治理命令和材料追加只读取该 Meaning 的精确依赖，不枚举 World。
本次写入校验新 lifecycle stamp 与同事务新增的精确 `ChangeMeaningLifecycle` 回执；完整载入、备份准入及
复制分支校验保留的每个 stamp 与其原回执。单条 World 只读不重载整库回执，也不能授权恢复。
同步先检查保留的生命周期修订与凭据，再合并 head；没有 restore stamp 或精确回执的 active 副本不能复活 tombstone，
同一后继修订槽的并发意图进入冲突。World 读取索引记录 active/deleted，回收站沿用有界检索／分页，
不通过全库网关构造已删除清单。索引格式更新只重建派生数据，不改写 Source、原始接受或 Learning facts。
个人意思与表达的纠正也是精确单条命令：先展示该 Meaning 当前完整 Context 组合，保存时复查所有 Context
revision pins 和来源见证，同事务追加新 Meaning revision、接受、Expression／Binding 与 Alignment，
再通过 Alignment event 撤回被替换的连接并写入 `CorrectPersonalMeaning` 回执。原接受及 Alignment snapshot
保持不变；当前列表／候选按事件状态读取，已准备或已学习内容按原固定 ordinal 验证历史连接，不要求其仍为当前连接。
纠正不级联修改 Target、Run、Content Attempt 或 Memory。收藏／笔记仍属于原 Sense；World 私有索引携带
已接受解释的轻量引用，旧解释从 Markers 打开固定 Meaning／Alignment 详情，不借新意思显示旧笔记，
也不制造学习目标。该索引及查询只含表达／意思摘要，不传输 Context 或媒体。
Context 组合读取沿 Meaning revision 顺序、按已记录的来源引用取得 Anchor 首次引入次序，然后解析 active
Anchor 的当前 revision。替换使用新 ID，追加只引入新 ID，后续纠正／Binding／生命周期引用不移动已有材料。
详情、纠正和学习来源共用这一读取；同步的 fact-array 归一化排序不作为用户段落或图片顺序，历史准备仍
按自身固定的 Context revision 列表读取。不引入并行排序缓存，也不为显示顺序改写原始事实。
个人 Meaning 的乐观来源见证对顶层事实集合使用完整事实的确定性排列，只忽略复制器的数组编码次序；
Meaning head、每个事实的所有字段、重复项、嵌套材料／来源引用顺序及库 incarnation 仍进入校验。
该排列只用于计算见证，不写回 owner 数据；真正的 Context、接受或生命周期修改仍使旧审阅失效。
例句收藏入口沿实际 owner 注释数量判断，不以当前可解析的资料数覆盖存量计数；确认空库后才收起默认入口。
读取中／失败仍保留未知状态。缺失来源的收藏保留原 ID 并显示读取风险，其他可读条目仍可打开；回看和重试
只读，不补造 Example、Meaning 或学习记录，也不为尚未交付的轻量新增入口扩大默认操作。
全库存 Scope admission cache 已移除；初始化只删除该退役派生表，保留现有 Scope、Target、共享正文和 owner 事实。
历史／候选索引重建通过同一逻辑解码入口读取源记录。
不支持的物理版本会停止并保留原库，不创建空库冒充首次访问。跨标签页协调协议独立版本化，版本不一致
时旧/新页面不交换记录，并要求用户关闭其他标签页。Service Worker 安装新 shell 后等待用户确认再接管，
安装会先缓存应用 JS/CSS/Wasm，避免首个页面在接管前加载的代码遗漏；品牌与媒体仍按需缓存，
API 响应和学习包不进入 shell cache。代码缓存未完成或失败时不报告离线就绪。
接管时保留上一发布版本的静态资源窗口，使仍在运行的旧页面能够完成或安全退出。

Web 应用层的逻辑表与 Personal Semantic World Journey 共用这一物理事务 authority。Journey 的
意义聚合、注册表事实、Inbox、澄清草稿和 operation receipt 分别保存在 `semanticMeanings`、
`semanticRegistry`、`semanticInbox`、`semanticDrafts` 与 `semanticReceipts` 等规范化逻辑表；媒体字节
单独保存在 `media` 表。一次领域保存仍由同一个 `LibraryTransaction` 原子提交，但普通语义修改不再
重写整个世界或图片载荷。规范化语义格式与内容供给边界使用当前数据库与 Checkpoint v6，
不读取、迁移或兼容 v1 单聚合格式。账号副本、界面偏好和其他 `localStorage`
状态不能充当个人学习库的第二权威。

Personal Semantic World 的私有浏览读取接口与 Agent 的公共候选检索分开：浏览索引可以检索本人的
Context 与捕获来源文本，但分页只返回列表需要的摘要，单条详情只读取该 Meaning 及其显式语义依赖。
普通列表通过有界窗口读取；详情、待处理草稿与该 Meaning 的学习来源共用同一读取快照，不订阅完整命令网关。
刷新中的已有详情保留上一份一致快照并阻止新操作，场景编辑固定其开始编辑时的版本；外部更新不能替换未保存输入
或被旧编辑静默覆盖。已退出当前 Context 的捕获来源仍来自原始事实，详情展示与私有检索不因 Anchor 退休而丢失来源。
批量选择复用同一私有查询条件，从同事务维护的派生 choice 索引读取精确 Alignment/Binding pins 与标题，不携带完整 Context、媒体或生成材料。列表窗口有界；明确全选按分页收集完整过滤结果，跨 revision/incarnation 或被取消时不提交部分选择。已选项跨搜索保留、按语言路线隔离；明确确认之后才逐项解析完整 source。批量执行先保存意图，再按固定并发准备材料，任务读取按精确 ID；停止只取消运行项，核实持久停止结果，保留尚待执行的意图。进度通知合并，不能用每条意图触发全量父树刷新。重试使用原批次的 Context 授权，不能把旧批次静默转移到另一语言路线。
Inbox 使用独立的同事务快照读取待处理材料与未完成条目的摘要，不订阅完整命令网关；未完成条目的筛选、计数和下一项使用专用部分索引。原材料继续保留候选、来源与媒体引用，进入对话时按 ID 读取详情。抽屉独立呈现加载、失败重试与已核实的空状态；外部更新时重新核实快照。该读取成本随待处理条目数量增长，不随已确认世界的数量增长。
图谱复用同事务 World 浏览索引中的独立窄投影：全图读取完整 Expression identity、当前展示解释与 Sense／Personal Meaning 关系凭据，私有检索和语言／收藏／笔记条件仍由同一 SQLite 查询选择。图页不初始化完整命令网关、不传输整库 Context、提案、历史或媒体；选点后按 Meaning ID 读取 Context 与来源，配对同一 revision／incarnation，不装载学习来源图片。窄投影可重建且与源事实同事务更新；无效源仍是读取失败，重试不写学习事实。Cytoscape 保留原 breadthfirst／grid 布局、绘制与手势，按 identity／成员索引查找并批量更新样式；普通列表或全图读取通过均不证明首次写命令、全量批次执行或所有图形规模已满足性能要求。
表达语言筛选读取当前已接受 Binding 对应的 Expression identity/语言摘要，不给 Meaning 或 Context 指定单一语言；同一私有查询同时约束普通列表与批量 choice。收藏和笔记条件使用已保存的当前 Sense 引用，不把历史笔记改挂到新解释。点图按稳定 Expression identity 合并其多个当前已接受解释，同形不同 identity 保持分离；稀疏连线的凭据是共同 Sense/Personal Meaning，坐标不表达语义距离。
澄清提案同时保存生成时的本机材料见证（Library incarnation、来源 identity 与摘要），不发送给模型。
模型发起前，材料和见证从同一读取快照取得；普通的读取修订与其他条目变更不会替换它。
确认必须携带该见证：网关检查当前源事实，并在保存事务内再次比较所依赖的 Meaning 或 Inbox／草稿行。
材料或 Library 被替换后，旧提案不能借用新材料的 identity 直接确认；用户保留对话并明确继续核对。
成功操作的精确重试仍先返回原始收据，不因确认本身改变源材料而重复创建事实。
这些私有派生索引均为设备内可重建数据，不进入备份或账号同步；它们与源事实同事务更新，索引的存储读取或写入失败
必须回滚提交，源事实缺失或损坏不得被展示为正常空库。索引接口通过不代表页面已接入该读取路径或性能验收通过，
仍须由真实页面的长旅程证据核实实际读取与交互成本。

学习历史不进入普通记录冲突选择器：两个设备从同一基线为同一 Target 完成互不重叠的 Run 时，
`learningReconciliations` 保存 ADR 0005 的确定性裁决，原始 Run/Event 均保留，只有选中分支参与当前
Target/Memory/Schedule 投影重放。API 对 Learning Event 与裁决记录都执行 append-only 保护。

学习运行时只在 Web 本机执行：目标选择、Protocol/Policy、步骤、评价、Completion、Memory Outcome 与
FSRS 都由本地领域事务结算。Hono/Edge 不创建或推进学习 Run，也不重新计算从云同步取回的学习事实。

普通账号云同步以本机已提交的 Personal Library Facts 为输入。云端以账号锁下的 revision 作为唯一提交 cursor，保存当前 `(table,key) → ordered refs` 索引、不可变引用差分日志、固定 cursor 的索引快照和按内容寻址的数据块。首次发布的 v8 完整 manifest 只用于建立索引；日常 commit 提交变化行的引用 patch，不再重建或传输全目录。索引页同时限制 512 行、4096 次引用与 4 MiB UTF-8，pull 绑定 head 的 read lease 和固定上界，连续分页只进入私有候选。越过 floor 或租约过期明确要求完整快照恢复；完整领域准入、历史保护和首次跨设备信任合同继续保留。
正文下载按响应字节预算分页，客户端消费服务端返回的 deferred 列表。`operations` 是 Device Operation Ledger，
只用于同一设备上的命令幂等，不进入同步清单；Learning Event 直接以自身 Action、Materialization、
Evaluation 与 Transition 数据完成不可改写验证和重放。Remote Intake 重投可从 Draft 保存的 canonical
Intake 重建本地结果，不需要同步完整命令输入或返回值。同一份 base64 媒体按内容边界切块，使重复引用
复用摘要块。
Published artifact 与公共媒体字节不属于 Personal Library Fact：Checkpoint v6 和加密手动快照 v6 只记录
`packageInstallations` 的精确可恢复引用，不承载 `packageCache`。learner-private / On-demand Materialization、
Personal Anchor media 与 Practice Artifact 仍按各自 learner-owned 表进入同步和备份，不能被误判为公共缓存。
`librarySyncBlocks.ts` 提供 Web 与 API 共用的无损块编码：相同材料、步骤定义与协议内容按精确文本边界
复用块，块可确定性 gzip 压缩；拼接解码后仍是原始 tagged wire。API 在接收时验证压缩块，Event／裁决
不可改写保护比较解码后的完整文本，不比较压缩表示。客户端限制同时保留的传输块为 96 MiB，并分窗口
消费、在最后引用后释放；解码行上限 90 MiB、累计新增解码事实上限保持 64 MiB 是不同保护，不是 JS heap
承诺或已通过的大规模云端性能结论。账号存储边界仍为 256 MiB。不兼容 checkpoint 停止同步并保留原副本，
不会为编码升级自动覆盖旧 head。当前初次 capture／prepare 的 64 MiB 展开保护仍保留；索引协议不代表首发大库已解决。服务端每累计 128 次提交或 4 MiB tail 建立冻结索引快照，旧 snapshot／log owners 和幂等回执继续保留；历史剪枝仅提供隔离验证入口，尚未启用在线删除，旧版本仍占账号容量。
已由当前 replica validation version 完整校验并确认的 v6 基线，在相同远端 revision 下复用本机 owner 事务准入：
无变化只读取轻量身份、同步游标并核对 head；本机增量只读取变化事实和对应基线正文，保留其余 block refs，
确认带原 operation ID／请求 digest 的 CAS 回执后，在同一 SQLite 事务中 patch 受影响基线与同步状态。远端 tail 从已验证 baseline 建立 Worker overlay，完整验证后在一次本地事务提交事实、baseline 和 cursor；冲突的混合 baseline 仍走完整三方收敛。后续本机写入保留 pending，不能把游标
推进到未上传版本；丢失或无法确认 ACK 仍用原 operation 重试。服务端明确在提交前拒绝的历史／身份错误
才清除该 pending receipt，保留本机事实与原基线，避免反复重放必败请求。普通物理删除继续交由领域 Replica
的许可规则裁决。
`validationVersion` 是设备内完整性合同版本，不是 wire version；该版本缺失/过期、首次发布、双方变化、
pending commit 恢复或冲突均保留完整 capture／merge／领域验证。验证合同变更时须更新其版本；泛型 store 写口
是内部接口，生产事实仍必须经各 owner 准入或已完整校验的恢复入口，不把同步当作语义/学习事实创建者。
PSW 完整副本验证复用 `SemanticWorldRecordReader` 的逐行规则与精确键查询，不再为校验重建完整 JourneyState；
Registry head/parent、Meaning 内部历史、全局 scene owner，以及 lifecycle/correction 的正反向凭据检查均保留。
非空 PSW 缺失 root 必须拒绝，不能当成空世界；校验合同版本已相应推进，旧设备 stamp 要重新完整验证。
完整 Library 校验共用 `LibraryRecordReader` 的 get／键存在性 has／可重复 entries；云端 reader 只索引原 encoded
Entry 引用，按需解码，不再构造额外的完整 BackupRows 或在应用时再建一份全库 decoded Map。手动备份仍接收
已经解码的完整行集合，同一协调器把语义、内容、学习与偏好交给各自 authority。重复物理 key 不能被 Map 覆盖。
Learning 重放长期只保留六字段 retention 投影、Run 排序头和 Action key；每次只读当前 Run／participants，
该 Run 的 Action 校验与重放逐条读取正文，仅保存 key／revision／时间头，不保留全部 Action 正文；校验在
participant、Action 和 lifecycle 之间让出。相同排序时间／revision／purpose 用 key 确定顺序。
reconciliation 只索引 Event 的 id／run／target／时间，按 run-target 分组校验事件闭包，不逐裁决扫描全部正文。
Book 校验逐 installation 让出并只保留匹配成员，默认 all range 不加载缓存，精细范围只读取本书成员缓存。
active-book 唯一约束以迭代方式检查，普通命令与完整校验共用规则。每个 Book 仍扫描 installations，单个
大型 reconciliation 的集合派生／排序仍有同步段；这些未消除的工作不能被表述为严格增量或任意分布的响应性保证。
应用只精确读取已校验的变化事实，候选缺行时拒绝，不写入 undefined 冒充该事实；记录内合法 undefined 仍保留。
Registry 引用只在当前记录内复用，不建长期缓存。已有资料的三方收敛仍在 capture、merge 和下载中持有完整 encoded Entry 集合，
已有资料的三方云同步完整校验使用与同步入口同一组 generator 规则，在事实、Run 与 Action 之间按执行时间让出；它仍读取
完整 encoded Entry 集合，不证明整个进程内存或大容量恢复达标。每个 wire（包括未被领域读取的偏好）仍须
严格解码，验证合同版本相应推进。Provider 校验只依赖纯 metadata schema，不初始化模型、账号或 TTS。
`replicaCandidate` Worker RPC 的 begin／prove／append／validate／discard 管理私有、版本化暂存表，不修改 source
schema version 或既有事实。只保留一个候选代，同 fence／预期 head 的 begin 重试返回同一 ID，失败代可重新
开始；源身份只取 revision／manifest，storage 用量变动不替换同一候选。begin 接收真实 v6 Manifest 原始块，
用共用 codec、传输 SHA 和严格 Manifest schema 验证后固定完整的 key／有序 refs 集合，不接受自报记录数。
append 的 raw block 经相同校验后只保留解码文本 SHA／字符数，逐片验证 row JSON 与有序 refs 的完整覆盖，
不长期保留另一份已解码媒体；缺片、错序、正文／摘要／key 不符均拒绝。proof 元数据与事实批次同事务回滚。
候选行显式标记本机 packed 表示与不透明外部 wire；未知 wire 原文不解包存储压缩 envelope，
不能借 `sensa-record-gzip-v1` 或共享引用保留 tag 绕过逐行完整解码。
Manifest 原始及解码 UTF-8 均受 64 MiB 上限保护；单块先检查字符长度，批级累计解压在保留文本前检查。
append 只接收本批 rows 引用的 proof，原始 proof 批次受 4 MiB 保护，累计解压不能超过已预检的 row 字节量。
单行的正文、proof 数量或传输量超出 append 批次时，prove 只接受该 Manifest row 的 refs，分批限制原始与累计
解压各 4 MiB；已证实片段随后由完整 row 的有序文本摘要检查复用，不将半行写入 live facts 或封存。
已确认 proof 可复用而不重复解压；单个异常块最多触及 v6 codec 的固定输出界限。回执带所验证的 head，
仅证明给定 head／manifest／候选正文自洽，不证明它来自认证服务、仍为最新版本或已被应用。
begin／append 在写事务内重验 owner fence，避免预检与暂存写入之间的账号变化窗口。
不同请求不能抢占正在校验的候选。普通完整性校验失败立即级联移除该副本；清理失败单独报错并保留
原始校验与 SQL 原因，重试 begin 不复用已经停止校验的 sealed 代。fatal 时不再尝试 SQL 清理，
留待健康重开清除。换代以事务移除旧私有副本，连接重开清除遗留候选，正式事实不变。
批次精确重试不重复计数，不同正文的同 key 拒绝；部分候选不能封存，完整候选
先封存再通过同一完整 authority 校验。
候选保留完整 packed 行供校验读取，不在每次重放时逐摘要查询另一套私有正文。首次空库激活中，
共享基线按既有 writer 外化并检查一次；仅对全表 Replica Module 无 restore 转换的共享记录，
再在同一事务将该基线的 compact bytes 和 sync owners 复制到 source／record owners，避免再次外化。
identity 等转换和派生投影仍走完整值路径；事实／基线／owner／索引／候选清理一并回滚。校验期间本机 revision／身份／owner 或 incarnation 改变即拒绝；
封存校验期间按 16 MiB UTF-8 文本／256 条 LRU 复用不可变正文；每次读仍独立 JSON 解析和 wire 解码，缓存命中也重查取消与连接健康，分页保留原 fence。此预算不等于 JS heap；大行不缓存。候选正文和基线一直不可见，取消只移除对应私有副本。owner／identity／incarnation／signed-out 变化及清库
在同一源事务清除私有副本，成功后停止在途校验；事务失败不清正式资料或已存副本。Worker 关闭先取消并等待
校验结束再关闭 native handles，fatal quarantine 同时停止在途读；失效连接不能继续写失败或已校验状态。
完整协调器保留 reader 的原始失败，不把取消、并发 fence 变化或存储故障误报成领域资料损坏。
Worker 的候选校验不占据普通请求队列，按记录让出，
允许本机读取继续；校验仍绑定同一不可变候选。SQL keyset 页同时限制 64 行与 1 MiB 已存编码，允许单个
超页记录单独处理；单记录原始正文保护仍为 90 MiB。多行批次在任何解析／压缩前预检原始 4 MiB 字节预算，
随后逐行编码写入，不同时保留整批压缩／解码对象。单代逻辑正文保护为 512 MiB、已存编码预算为 256 MiB；
它们不是账号容量、实际 OPFS 占用或峰值内存证明，单个巨型事实仍需单独验证响应性。
Worker 按 ES module 分块构建，完整 validator 延迟加载；离线 shell 预缓存所有构建的 JS／Wasm 代码块。
正常 synchronizer 的新设备恢复已使用该内核：只在无 baseline、无 pending／冲突，且本机 replicated facts
仅有 identity 时准入；同库 identity 分叉及不改变内容的 identity-only head 保留原 merge／确认路径。
正文分批由正常 HTTP block fetch 进入私有候选，每次预取最多请求 512 个不同 hash，但只接收一页、最多
4 MiB 的块正文；超额响应拒绝，deferred 留待后续消费，不先追完全部 hash 或加载任意大小的一批行。
预取块保留到最后一次引用；96 MiB 传输工作集遇到压力时只驱逐当前行保护集之外的块，换 head 重试清缓存。多行 append 限制 512 条／4 MiB，
同时累计最多 4096 次 block 引用（包括重复引用）；引用密集的合法资料分批，不去重或截断原有有序 refs。
生产者与 Worker 共用批次计数合同，在解析正文或写入前核对。较大有界事务摊薄提交开销，仍保留 FULL，
参见 [SQLite 事务批量写入说明](https://sqlite.org/faq.html#q19)；它不是容量或恢复时长已达标的证明。
单行保留既有 90 MiB 例外，因此不能称每条 RPC／单行峰值始终只有 4 MiB。
长时 candidate 校验不持有 live Library Web Lock，本机保存可以使其 fence 失效而不是等待完整校验。
新设备应用在 source SQLite commit 内重验 owner、identity、revision、空 facts 和空 baseline，惰性读取单行
正文并复用既有 restore／索引／媒体引用管线。没有 owner restore transform、也不涉及共享正文的表，
可在同一事务以 INSERT SELECT 直接复制候选已校验的存储字节到 facts 与对应 baseline，不再逐行解压／对象化／
重编码。一个表内任一 key 需要转换则整表保留原值路径。共享学习表先通过既有编码器生成基线、逐字节核对
正文碰撞，再在同一源事务复制该基线的准确编码与完整 owner 集合；身份继续执行 owner restore。
全量基线已统一解除 sync owners，不逐行重复解除；共享正文 lookup、缺失正文与 owner 插入使用最多 128 项
的既有批次，仍受原单记录保护约束。新设备激活仅在该同步事务内保留不可变文本 memo，输入＋结果 UTF-8
合计最多 16 MiB／256 项，所有 miss 保留原摘要及精确正文检查，成功与回滚均清除。
已完整校验并复制的 Run 索引只读生成存储帧的 completedAt／targetIds，后续历史投影仍完整解码准确 Run
材料。Target 完整投影读取后暂存语言字段，标识＋语言 UTF-8 合计最多 8 MiB；未命中时保留完整源读取。
这些文本预算不是 JS heap／峰值内存或恢复时长证明，其他写入与冷重建仍保留原读取路径。
派生索引与媒体引用继续从已应用的精确事实更新，与同步状态、deviceId、本机建库回执和候选清理同事务。
未确认基线的本机 deletion witness 命中 incoming key 时，暂存应用与常规收敛均拒绝自动复活，保留原资料与
墓碑并报告 history conflict；重试不能绕过。明确全库 reset 在同一事务清除旧 baseline／共享 owner 和墓碑，
新 incarnation 不继承旧同步副本或负状态；它不是普通同步的隐式清库出口。
明确清除本机库写入 device-only `local-reset=local-clear`，保留账号在线能力但暂停普通同步。
启动与自动 Checkpoint 不发请求或制造成功状态；现有手动同步入口携带 `restoreAfterLocalClear`。
手动意图在排队前捕获账号与 incarnation，取得跨标签同步锁后核对；同步 header 继续使用本机页面
incarnation fence，清除后的旧点击不能变成新授权。普通尝试失败不吞掉同库的已排队显式重试。
清除通知使已暂停的空库成为本机 authoritative，不请求云端或继续阻挡资料页；准入失败后的手动重连
只重试准入，真正成功后才允许同步。
暂存应用、完整回退应用或空账号确认在同一源事务内解除暂停；失败不消费，新的本机资料仍须走身份冲突。
新设备候选应用只额外允许删除这一确切的现存 marker，不开放其他 metadata 或删除操作；当前协调协议为 60。
同事务 restoreOperationId 回执确认协调器丢失 ACK／候选重放后的实际提交，确认后才发送资料变化通知；
无法读取该回执时不能冒充成功。候选、live、baseline 和 WAL 可同时占磁盘；256 MiB 暂存估计不是峰值磁盘证明。
已有当前版本验证的 checkpoint 且本机 revision 未变化时，远端新 head 也进入同一私有候选。每批最多 512 key
在 Worker 内比对当前 baseline 与 manifest 的完整 refs，逐条复用已确认正文，避免未变内容重新下载或跨 RPC。
共享正文引用在本地还原；候选完整校验后，Worker 仍以 baseline／baseline／remote 执行领域三方合并，不能
只凭本机未修改而略过不可变历史、删除和冲突规则。仅无冲突且合并结果等于 remote 时生成私有增量应用计划；
否则保留原完整合并／裁决路径。准备合并让出时普通请求仍可执行，每次惰性读取与最终提交都受原 source fence 保护。
应用在同一源事务内复核当前验证 stamp、基线版本、内容 revision 与私有计划，按需读取变化正文，原子更新
facts、baseline patch、派生索引与状态。仅 transport refs 改变时不制造内容 revision；丢 ACK 仍检查同事务回执。
HTTP head 期间更换并退休旧块时，新设备与增量接收共用最多三次重读／重试。该路径避免整库正文跨页面消息，
但仍复制未变基线到私有候选并执行全域检查，工作量并非完全只随变化量增长，亦不证明全进程峰值内存或性能达标。
异步存储 RPC 不能冒充同步 get；受控 5k Draft HTTP／OPFS 恢复也不能代替 10k Meaning、账号 UI、
全进程峰值内存或完整账号容量验收。
`node --import tsx scripts/benchmarkSemanticReplicaValidation.mts` 在 Node 的 SQLite/Wasm 候选库上度量完整 PSW
规则校验；准备数据不计入耗时，采样的 V8 heap 不包括 SQLite/Wasm 内存。加 `--storage-profile` 可只重现逻辑
正文的体积分解，分别输出普通 JSON、tagged 编码、表／Registry 类型，以及字符串字段的 UTF-8 字节计数。
该合成集为每个 Meaning 创建六条独有 Registry 初版，不含媒体、学习历史或意义纠正；它不是实际用户均值。
字段名、UUID、时间和合同版本是正文内的重叠计数，不可再加到编码总量上；逻辑正文也不是 SQLite 文件、
压缩传输或运行时内存大小。存储设计须区分真实 Context／接受事实／不可变历史、可重建投影与序列化元数据，
不能用增加容量、删除来源或丢弃旧学习引用替代这一审查。
`SENSA_TEST_MEMORY_LIBRARY=true node --import tsx scripts/benchmarkMeaningRestore.mts --meanings=1000`
可剖析正常 synchronizer 在 Node SQLite/Wasm 内存库上的暂存、校验、应用、各派生索引及 SQL 耗时；
`--base64=legacy` 只在这个隔离 Node 进程内禁用原生方法以作同代码对照，默认 platform 仅报告实际可用能力。
模式不进入产品设置或协议；CPU 采样、Node 时长不能代替未修改 Worker 的浏览器延迟。
它不证明 OPFS、真实账号 UI、峰值内存或容量。`SENSA_RESTORE_SQL_PROFILE=true` 启用
`replica-candidate-worker` 中的可选 Meaning Chromium/OPFS 诊断；包装仅存在于测试 Worker，
与未修改生产 Worker 的 10k 恢复验收分开。`SENSA_RESTORE_PROFILE_MEANINGS` 仅允许 1000（默认）或 5000；
`SENSA_RESTORE_PROFILE_CACHE_KIB` 可选 16384／40960，仅影响隔离诊断连接，不改变生产默认缓存。
诊断在每次 append 等待期间通过正式本机读取接口读取已提交的 Meaning 计数，要求候选不可见且每次读取
不超过 1.5 秒；输出 cache hit/miss/write/spill、阶段边界采样 cache bytes 和按表／page type 的 dbstat。
测试 Worker 另按阶段统计实际 SAH read/write/flush 调用数、返回字节、同步调用耗时及失败数，以区分
SQL／解码工作、重复页 I/O 与持久化 flush 的成本。包装默认使用生产 WAL/FULL；显式
`SENSA_RESTORE_PROFILE_JOURNAL=delete` 仅在该隔离样本中对照 SQLite rollback journal，要求 EXTRA（3）以
对齐 WAL/FULL 的 SQLite 持久化配置要求，不使用降低同步保证的比较。
正常恢复用例（含未修改 Worker 的 10k 用例）和诊断用例默认使用独立临时持久化 Chrome profile，完成后关闭
并删除这个测试 profile；不访问用户浏览器资料。`SENSA_RESTORE_PERSISTENT=false` 仅用于显式 ephemeral 对照。
报告必须区分两种 profile，不能把 ephemeral 的 I/O 行为等同正常会话。这些诊断不是生产配置、持久化保证
或模式迁移验收，不因基准结果自动更改正式库。
调用耗时含浏览器实现但不等同底层物理磁盘时间，诊断开销不进入未修改 Worker 的性能结论。
rowid 的主键自动索引也必须计入布局空间；采样 cache bytes 不是全进程峰值内存，诊断计时包含测量开销，
也不是完整 App 或已有大库的响应保证。
`node --import tsx scripts/benchmarkReplicaTableLayout.mts` 以相同真实 packed 值、有序 refs 和唯一键比较基线／
候选正文的两种表布局；逐列核对值并报告含自动索引的 page type／payload／unused。
该专用 Node SQLite/Wasm 内存诊断只证明页几何与原值保留，不证明 OPFS 时长、物理故障或峰值资源。
搜索使用 SQLite FTS5 trigram；不足三个 Unicode 字符的查询通过 `instr` 匹配精简派生文本，不维护另一套
逐字／双字 posting 表，也不解码 Meaning／Registry 聚合。短查询是随派生文本规模增长的 SQL 扫描，不能
宣称常数复杂度；浏览器规模验收同时覆盖常见词与无匹配词，避免 LIMIT 提前退出掩盖最坏路径。
旧 posting 表只作为可重建缓存随投影版本更新移除；源事实不变。UUID reservation 使用 SQLite 集合写入；
同一事务的 Meaning／Registry 更改只重建一次对应练习材料。
检索投影的 decoded Registry 引用只在一次同步 replace 内复用，LRU 同时限制 128 条与来源字符串的
256 Ki 个 UTF-16 code units（含 key）；过大的单行不缓存。逐出／阴性缓存不改变已接受版本、依赖重建或来源事实，
不保留整批 Registry 对象。该来源字符预算不是 decoded heap 或单个大事实的内存保证。
v6 发布仍组装整份 key/block-ref manifest 元数据；它不再解码所有未变正文，但不能宣称整条路径严格 O(变化数)。
首次 checkpoint 之前，待同步预览只分页读取符合复制所有权的记录键，排除 bootstrap identity，不为计数或
清除前提醒解码整库正文。已确认 checkpoint 的预览仍对比变更行与其基线，签出状态不隐去未同步资料。
完整恢复／收敛在同一 SQLite commit 应用已校验候选、对应基线和同步状态；基线或事实写入失败都回滚身份、
资料及建库回执，不留下半恢复。应用前以捕获的本机 revision、identity、owner/incarnation 重查，提交后在写锁内
核对应用 revision；下载中及提交后的新写入不被覆盖或标为已同步。无事实变化只写同步账本，不制造本机内容
revision。完整路径只在首次捕获及 pending 重放改变基线后读取正文，不为应用／最终确认再次 capture 整库。
生产同步统一经 `syncAccountLibrary` 的单飞与跨标签页 Web Lock；底层注入传输接口不承担并发同步任务调度。
同步完成后的公共内容恢复使用独立超时信号，不继承已经被下载／本机校验耗尽的同步 deadline；公共内容
不可用仍独立呈现，不把已完成的个人资料同步改成失败。
上述已有资料 fallback 仍读取完整事实与基线，64 MiB 解码保护与 256 MiB 账号容量尚有差距；增量优化或分块压缩不证明
大规模跨设备恢复的内存或容量达标。
Checkpoint 的 block/manifest 传输、CAS commit、重试和 baseline 由 Cloud Sync Coordinator 负责；记录的
跨设备归一化、三方收敛、完整性验证、历史 replay 与删除许可由领域 Replica Module 负责。Personal
Semantic World、Personal Content、Learning System、Content Supply 和 Preference 各声明唯一记录所有权，
中央同步器不再按领域表名实施策略。Learning Replica 对 Run/Event/Reconciliation history 只追加并拒绝
通用物理删除；同步和手动备份通过同一领域验证入口核对历史与派生投影。冲突闭包同样只采用各领域
Replica Module 显式声明的记录依赖；learner prose 和其他任意字符串保持 opaque，不能通过 UUID 猜测
扩大冲突范围。Personal Semantic World 使用专用三方 merge：不可变 facts 按稳定 identity 合并，
同一 revision 槽分叉和 delete-vs-edit 停为冲突；其 v3 facts / v5 Journey store 用单调 lifecycle revision、
删除 operation 与时间保存 tombstone，稳定语义记录不允许以缺行表达删除。手动备份恢复也通过同一
Replica Module 的 normalize/restore seam，不另写领域状态修复分支。
Scene 首次接受的离线分叉明确选择内容后，Personal Semantic World 保留双方未冲突的 immutable command
receipt，而非物理删除原操作。重放先核对选中 Meaning 中实际存在的 Anchor revision witness；非选中
分支的旧收据不能返回虚假接受成功，也不能覆盖当前内容。该保留策略由领域 Replica Module 在明确选择后
实施，不提前发布挂起分叉的收据来制造新的 head 或自动选择内容。
共享注册表依赖导致 Scene Meaning 被另一条笔记冲突连带扣留时，选择笔记分支仍保留该 Meaning 的
未冲突普通合并结果（首次接受或后续更新），仅补齐缺失且未冲突的新依赖；不把相关选择扩大为撤销
无关的场景接受。直接冲突的 Meaning 与所选同 key 注册表值不被该保留策略替换。
冲突展示由 `cloudSyncComparison` 从各分支自己的事实构建，只读复用 Personal Meaning 的详情投影，
不以当前本机 Registry 替代云端依赖，不参与领域合并。当前提供 Meaning 和文本 Draft 等内容对照；
不完整或尚无产品投影的冲突不可盲选。用户选择绑定所展示的本机内容 revision 与远端 head；选择事务和
随后的合并均复验，期间的新写入要求重新确认。发布未冲突内容推进 head 时，冲突的版本标记与确认基线
在同一事务保存；最终状态确认失败不退回旧标记。
Personal Meaning 的明确裁决在用户选择时生成稳定操作身份，并在同一受版本保护的同步提交中记录平坦
`conflictHistory`：去重的父分支、精确共同基线、所选分支与此前决议。当前线性事实不拼接分叉 revision；
完整 authority 同时校验归档、不可变身份、因果引用、共同祖先、操作收据和依赖。Registry／媒体的同 key
正文不相容时不能生成决议，不以“保留某端”绕过保护。未修改的已审阅分支可自动采用账号结果，后续编辑或
相反并发决议仍显式处理；新的明确选择也必须保留已知的全部历史。普通 owner command 不能改写归档。
历史 Learning pin、媒体引用、Scene owner 和身份预留包括归档，当前浏览、检索与新增学习仅取当前分支；
旧分支操作重放不能恢复它的当前地位。Meaning 裁决不丢弃 Learning／Content Supply 已正常合并的独立事实；
已接纳任务的来源读取和重试沿固定历史 pin，新加入学习仍只允许当前连接。历史连接在已有历史呈现中可见，
不混入当前学习选择。Replica 完整校验版本为 5，身份预留索引为可重建的 v3，World 索引为 v16。
正式 Runtime 为每次明确保存意图生成操作身份，未确认结果的重试保留原身份；新的意图不永久绑定 scene
revision。重开后确认同一版场景时，网关核对当前活动 Anchor 的实际内容并只写确认收据，不重复追加材料。
确认收据引用原接受操作，在写锁内复验 Meaning；被明确弃用的旧分支不能因重放伪称成功。
本地 Journey Repository 在计算
任何逻辑行变更前，通过同一个 Personal Semantic World authority 校验发生变化的 facts、内部引用以及
before→after transition；未变化聚合按对象 identity 跳过，加载、同步和备份重建才执行完整状态校验。
因此 Gateway 提议的非法 revision 改写、tombstone 复活或物理删除不会进入 SQLite；记录级提交本身
不会扫描未变化聚合的完整 facts。普通详情的首次 Context 保存使用独立单 Meaning 命令快照，沿用原领域命令，
只读该聚合、固定注册表依赖、当前 operation receipt 及该聚合历史生命周期引用的精确收据；其 delta
不得修改注册表、Inbox 或其他收据。依赖、
版本与 Library incarnation 在写锁内再次检查。首次 Inbox 最终确认也沿用原领域命令，只读这条材料、
会话提示和所需注册表闭包；不初始化已有 Meaning 聚合。Sense key、历史 Expression Version 的 normalized form、
Binding relation／精确版本 pins 与追加 ordinal 由源记录上的 SQLite expression index 查询，字段读取函数使用
本机实际的 tagged codec、只返回确定性的原始参数字段，不引入第二份注册表权威。缺失索引可重建，不改动源事实。
追加 ordinal 沿 kind／ordinal 索引降序只取末条；空类别从零开始，不对全部编码正文求最大值。
选中候选与空结果、固定依赖、材料见证及新 ID 都在写锁内复查；Meaning、注册表 delta、原 Inbox／提示删除与收据
一次提交。全量网关视图与其他命令仍有完整初始化路径，不能用这些命令的结果证明所有写入已满足规模性能要求。
完整 Intake 的首次保存（包括 Web 手动创建）使用同样的有界注册表查询与提交前校验，只追加本次 Meaning、
注册表 delta 和回执，不读取历史 Meaning。手动表单只构建 learner-authored Intake，Context 中的 exact occurrence
与可选 canonical form 分离；用户明确保存后才附上 learner_direct 接受。按本机 library 分隔的编辑草稿保留
原 operation ID 用于失败重试，编辑内容变化产生新 ID。它不调用模型，也不跨到 Learning System 写入。
Inbox 的直接接受与丢弃同样使用单材料命令快照：只读取该材料、提示、操作回执及接受所需的注册表依赖；
命令必须携带用户所见 item 的 digest，防止旧页面操作被替换的材料。丢弃不准修改 Meaning、注册表或其他 Inbox；
接受则原子移除原项并生成一个完整 Meaning。UI 对同一事实的失败重试保留 operation ID，丢弃先要求明确确认。
Inbox 图片按展开条目的 media ID 精确读取，并响应这些媒体或资料库身份的变更；媒体缺失／损坏有显式失败与重试状态。
World 订阅不把无关的 meta 写入当成语义变化，但资料库 identity／incarnation 变化仍强制重新读取。
Inbox 手动补全通过原 Resolve 命令显式提供 Context／Expression，媒体引用取原捕获与本次内容的并集。
Intake engine 把原 payload 留在捕获 provenance 中，确认 tuple 使用本次内容；Context、Expression、Sense 的
来源分别处理。独立媒体使用可投影的 Anchor；Published Learning Scene 继续由其专用 inline-media Anchor 承载，
不能同时制造一套无版本历史的媒体 Anchor。原文读取优先采用明确的捕获文本字段，包括“没有原文”的 null。
本机意思选择使用有界查询，不初始化完整 World；查询失败可用新的只读命令重试。选择的 Sense ID、版本 ID 与
完整 Semantic Spec 随本次确认固定，版本推进不能改换用户所选内容，缺失或内容不符不能自动变成新 Sense。
手动编辑草稿按 Library／Inbox ID 隔离并记录来源 digest；过期填写保留，但必须重新核对后显式开始最新版本。
Journey Gateway 保留命令串行化、幂等、来源见证和原子提交；Context 材料、澄清事实、表达绑定、
已发布学习场景及 Meaning revision 的构建分别由内部事实模块负责，不拥有独立存储或提交能力。

个人来源在加入学习、准备开始、保存生成进度与显式更新时，均在同一事务读取选中的 Meaning 与其精确
Registry 依赖，重新构造已接受的来源。调用者携带相同 ID 但不同语义、表达或私人 Context 不能调用 Provider
或改写准备意图；该校验不枚举完整 World，也不会仅为验证来源初始化 Journey Gateway。
普通加入与生成进度保存共用精确 Target／Route 的 coverage 检查：其他来源已有可用 membership 时，任务记录
`coveredByMembershipId`，既不重新生成，也不追加会改变材料选择的 membership。单项和批量入口使用原目标；
显式资源更新只更新该来源自己已有的材料，不借 `replacing` 绕过其他来源的覆盖。学习列表按实际可用 Target
去重，准备意图不能遮住另一来源提供的同目标。覆盖引用在本机写入与恢复时均校验真实 membership 和固定身份。
保存的 coverage 结果可作为历史保留；准备查询仍重新检查当前 active membership，并订阅 Target 变化。
Book 更新移除覆盖时，查询显示 waiting 而不在读取中改写事实；用户再次明确加入时才持久化新的待准备状态。
Target 身份由 learner、稳定 Sense 和 Expression ID 共同确定；Sense、Expression 与 Binding 的版本不进入
长期记忆身份。membership、materialization、Scope source 与 Scene revision 各自固定六个来源 ID，旧 Run
继续使用实际呈现的 membership 和材料；公共包升级或普通描述修订不能重置进度或把旧记录解释成最新版本。
私人 Sense 的自然语言说明足以保存，prototype 可空，relation／coverage 可空；空值不声明全球同义或精确覆盖。
新建与复用由明确意图区分，描述摘要只验证内容。普通编辑默认保留 Sense／Expression／Binding 身份，
无变化保存不追加事实；实质改义需明确操作。私人版本以不可变 UUID 和 parent 引用保留离线分支，revision
是分支深度；同深度不是同一版本，较深的旁支不能自动覆盖另一分支，显式冲突选择保留所有原版本及来源引用。
个人准备任务与每次尝试分别保存 `contextPin`，固定该次选中的 Anchor Revision ID 列表；它不改变 Alignment、
Sense 或 Binding 引用。新的来源预览读取当前 active Context，普通等待、重试和在途进度按任务 pins 重构输入。
明确更新才选择新 pins 与 plan revision，失败继续保留原材料；恢复校验允许历史 pins 引用已退役 Anchor。
独立 Context 图片按精确媒体引用加载，进入已授权输入和经验资源。已有其他来源材料时不显示生成授权选项；
自己的材料可继续使用，Context 或授权变更另由显式更新提交。
每次 attempt 另冻结 `fixedInput`（来源、Route、plan revision 与 consent）。本机 transition 与恢复都会独立核对
实际 request 的固定语义、表达和 Origin；即使是 failed/stopped checkpoint，也必须按自身历史 Context pin
核对 grant digest 与接收者。未授权的尝试不能带 personal anchor，重试不得复用另一授权范围的请求。
历史尝试不会随任务更新而改写；批量更新提交失败不能以仍可用的旧材料冒充本次准备成功。

Learning System 的 `direct_source` 查询从确切 Registry 版本或已准入发布包解析学习来源，不借用 Personal Meaning。
规范包摘要与归档摘要分别校验，发布包具体 spoken form 与 accepted forms 取其 `targetExpression`；未对齐 Reference、被拒绝或
非 exact/realizes Binding 不可冒充学习来源。`enroll_direct` 在同一事务复查来源摘要和 Route，保存含不可变来源
快照的 `stable_sense` Curriculum Enrollment；没有可用材料时只表示等待内容。同连接／路线意图幂等，已有有效
membership 返回 already-in-scope，不替换进度或材料。`prepare_direct` 的已发布路径只准入选中的连接，与 Book
复用 publication materialization，但保存独立 direct membership；无匹配发布内容时返回 needs-generation，不能
显示 ready。Content Supply 的 `prepare_direct_materialization` 优先复用已发布材料，否则从已接受来源启动共享
按需准备引擎；请求只含固定 Expression／Sense／通用原型，不构造 Personal Meaning 或私人 Context 授权。
生成中出现其他入口提供的同连接／路线材料时，任务记录 covered，不覆盖现有材料；失败、停止和审核重试保留
实际候选与尝试关系。所有来源的 Ready 按需材料在本机准入与恢复时必须提供请求、候选并重新通过同一
无网络校验，不只信任保存的通过标记；请求与候选声明的生成策略身份和版本必须一致。
按需内容生成策略 v4 要求桥接资源保存独立的 `meaningRendering`（固定辅助语言标签和准确含义呈现）；
原始 `sense_confirmation` 仍逐字绑定已确认语义，不能由模型覆盖。学习卡片、详情、记录与 Portable 导出
共用呈现读取规则，membership 准入同时核对呈现语言。旧策略的未完成候选不能沿用到 v4 准备；历史已保存
物料保持自己的内容快照，不在显示时翻译或重写。
Web 的“添加内容 → 按表达查找”通过 `direct_choices` 查询本机 Registry 当前 Binding 和已保存发布包，
按目标语言、表达前缀与有限分页检索。SQLite 对源字段／轻量包摘要维护表达索引，不读取全部私人意义或包媒体；
选中后解析确切版本，确认时再次核验。候选发现的 current-head 默认不改变已经选定版本的固定语义。
确认保存的 intent 以 enrollment URL 恢复，并在学习列表中作为待准备条目参与搜索和计数；它不是 Ready Target。
未对齐的词典 Reference 仍只读，不通过字符串匹配冒充此入口。备份和同步保留来源快照及固定依赖；公共包缓存缺失
不抹去已接受意图，也不证明资源仍可执行。

首次新建澄清草稿或接收不完整 Intake 同样使用独立追加快照，只能创建本次
Inbox、适用的会话提示与收据，媒体继续同事务准入，不读取已有 Meaning／注册表。新 ID 的保留索引与源事实同事务维护；分配时排除本次
operation 和尚未入库的 media 引用，提交时再检查占用。普通读取不全扫；显式完整诊断按源行核对并修复
身份缓存的逐行漂移，诊断输出区分 `ok` 与 `rebuilt`，不改动源数据或同步 revision。发现漂移后先独立
持久化失效版本，再事务重建；重建失败不能回滚掉失效标记。标记本身写失败时当前连接拒绝身份读取和语义
写入并报告存储错误，不承诺无法持久化任何标记时仍能跨进程记住诊断结果。具体规则见
[ADR 0007](../adr/0007-personal-semantic-world-revision-merge.md)。
Learning System 使用相同的单一准入模式：逻辑事务在 SQLite commit 前把已暂存记录的 `before/after`
交给 Learning authority；authority 只读取改变的 Target、Run、Event、active Run / Study Plan 及直接依赖，
重放新 Event 并核对 Target、Run、Evidence、Completion 与 Memory/Schedule 投影。Run/Event history 的
物理删除、旧 Event 改写、无 Event 的派生进度以及本地伪造 Reconciliation 都在提交前拒绝。Cloud Sync
与手动备份的恢复准入以已保存 Target / Memory State 为运行权威，校验格式、字段值域、身份、材料精确 pins、引用和修订闭合、Session 与合法冲突分支，保留哈希、fence、CAS、ACK 和原子提交；普通恢复不重新执行全部历史 Protocol/reducer/scheduler。完整历史重算保留为显式审计入口，用于修复、算法升级或专项审计，不证明每次恢复时历史与当前算法一致；该类矛盾可能延后发现。现有冲突分支连续性证明仍依赖完整 Memory 输出，因此仅对冲突涉及 Target 及其 cohort 闭合谱系保留重算。缓存缺失的 Structured Run 保留受限材料准入，待精确资源恢复后完成 runtime 校验，不自动收敛这类未经完整重放的分叉。设备收据 `restoreValidationVersion` 只证明恢复保真准入，不证明历史算法审计通过；旧收据不得复用。日常学习动作不扫描所有 Run 或
Event。具体规则见 [ADR 0005](../adr/0005-concurrent-learning-history-reconciliation.md)。
新 Checkpoint 成功提交后，服务端只回收旧清单曾引用且新清单不再引用的块；另一设备尚未提交的上传
不在这次回收范围内。

同步记账和业务内容使用不同事件：只有真实业务写入广播内容变化，单纯更新同步状态不能再次触发
内容同步。本机写入立即完成并形成新的内容版本；一个协调器在停止修改三十秒、持续修改最多一分钟、
完成学习会话或页面隐藏时触发 Checkpoint。可见页面每分钟核对轻量 head；启动、focus／恢复可见、
联网恢复与手动操作也进入同一协调器。跨标签同步锁内重读当前账号、incarnation、内容版本和已校验
checkpoint；近期确认且无修改时自动请求可复用确认，手动请求仍检查 head。状态广播只提示重读，
不能作为收敛凭据。冲突／终端失败不自动重试，暂时失败服从持久退避；恢复事件只可对同一未成功
checkpoint 链提前尝试一次，锁后产生的新失败不能被旧事件绕过。隐藏且无修改时不定期检查。
无变化自动验证只提交一次本机状态；发现远端变化后先记录 syncing，再恢复／合并。公共资源恢复
可复用同账号、incarnation 与本机 artifact generation 下已全部成功的结果；缓存、安装事实、catalog
与候选恢复在 SQLite 提交内递增 generation，异步广播不决定新鲜度。这些本机记账不进入同步或备份。
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

本机手动恢复文件使用 AES-GCM／PBKDF2 的 `sensa-web-library-backup-v2` envelope，认证 gzip 传输；
内部 snapshot-v3 以独立 NDJSON frame 保存 header、共享 body、逻辑 records 和结束标记。`backupArchive.ts`
逐帧验证摘要、完整引用集合、表计数与重复 key，不拼接整个解压快照，也不同时保留另一份全库 tagged graph。
内容按摘要共享，保留原 Date、undefined 与用户保留键；还原后的事实继续执行完整领域 replay，再进入既有
账号、空目标库与 incarnation 恢复检查。压缩明文上限仍为 64 MiB，文件上限仍为 90 MiB，record 上限仍为
200k；解压总量和单帧另有 512 MiB／96 MiB 的防护边界，不能把这些字节上限当作实际 JS heap 承诺。
本机压缩表示与手动恢复格式不自动改变 Cloud Checkpoint 的分块协议或证明其容量通过。
`sqlitePortableSnapshot.ts` 提供本机 DB snapshot 生产与隔离准入原语：在固定 source revision 和身份边界下，
从现有 replica allowlist 写入全新可信 schema，排除设备凭据、providers、operations、pending、公共缓存和同步基线，
通过 `VACUUM INTO` 生成包含查询投影的独立一致文件。接收端用官方 SAHPool chunk import 写入未打开的新 namespace，
先禁用不可信 schema、triggers 和 views 并比对完整 schema allowlist，再执行 integrity、FK、共享正文摘要／所有权和领域引用／pins 校验。
接收准入把每条事实及共享正文完整解码一次，并让学习投影复用已解码对象；投影在同一 generation 内用正式写入器重建并比对原投影值，不再建事实候选库或复制一遍事实。
快照投影的 DDL、基础写入、全部 cache 初始化、前后值核对、FK 与结构检查在同一 `BEGIN IMMEDIATE` 事务中完成。
WAL／FULL、连接级 PRAGMA 与 FK 开关在事务外配置；checkpoint 在 commit 后执行并计入投影耗时。失败回滚并隔离该 wrapper，不能凭回滚后的旧 cache version 继续开放目标库。
文件上限 90 MiB、实际展开总量 512 MiB、单压缩正文 96 MiB、事实与共享正文各 200k；gzip 按实际输出累计限额，不能信任 ISIZE。
`openIsolatedLocalSnapshot` 与 `openIsolatedLocalGeneration` 只操作已准入的独立 generation，持续拒绝 active／preserved owner namespace；
重开缺失文件时拒绝而不创建空库。它们不切换 active pointer，不写 cloud cursor／checkpoint，不改变媒体协议，也不进入当前账号恢复 UI。
`local-portable-snapshot` 与 `local-portable-snapshot-browser` 分别验证真实 schema 准入和 Chromium Worker／OPFS 往返；
`node --import tsx scripts/assessment/measureLocalSnapshot.mts --fixture=.tmp/retention-capacity-facts-<冻结目录> --label=<新名称>`
专门测量当前合同有效的 1000 Targets／2001 Runs／4000 Events 基线，准备、生产、导入、准入、投影与原值核对单列。
专项测量以 1 秒间隔采样本任务的浏览器及测量进程树 RSS，共享页可能重复计数，观测最大值不是分配峰值。
上述测量不证明远端传输、owner 切换崩溃顺序或移动端资源预算，首次空设备的云快照接口与 cursor 绑定仍须另行实现和验证。
备份目的地占用检查与事务内恢复共用同一规则：结果严格为空数组的无事实 `learning.materialize` 回执不算资料，其他非启动操作与领域记录仍受保护。
没有可准备课程时首页不提交空准备回执。备份页检查文件时先读取目的地状态，非空库可看摘要但不提供确认；实际恢复再次原子核对。
恢复后的新 incarnation 保持旧页面写入保护；零学习包不加载资源重取模块，需要公共资源的恢复可在重新打开后继续取得，已提交事实不随重取失败回滚。
Web 退出通过 `service.signout` 原子保存 `signed-out` 与本机 `service-signout-epoch`，不更换数据库 incarnation。
本机清除保留这两项权限事实；删除内容不能撤销退出或复活首次退出前捕获的在线回复。
清除预览区分待同步、实际失败与已退出不可同步；后者不执行网络请求，仍要求明确丢弃。刷新同步后预览的UI同时退休旧确认，提交仍原子核对原库/incarnation/内容revision和操作数。
`accountSessionBoundary.ts` 以现有owner及退出epoch核对服务请求前后；此本机权限边界不进入同步或备份，不表示服务端所有JWT立即撤销。
新的PKCE callback在首次交换时绑定模块级epoch，OTP在验证开始前绑定；后续组件重挂/回复不能重标旧证明。
重新连接与准入写入在事务内核对同一epoch，跨标签退出退休未完成的恢复；已结束会话的本机数据入口保持可用。
已有可用事实或明确退出的库先开放本机入口；过期SDK凭据刷新不能阻塞它。不同账号的缓存身份仍停止展示原owner内容，实际在线准入继续等待SDK和API确认。

Web 页面与扩展之间的桥也只声明一次：`packages/contracts/src/sensa/consumer/extension.ts` 同时声明握手（授权、交换、凭据）、页面请求/应答和不含内容的 Intake-ready 通知。Web 应用按它构造请求并校验应答，`apps/browser-extension/src/background.ts` 在分发前解析每条桥消息——未声明的 kind 或字段一律拒绝，不再静默丢弃；页面侧的 `webBridge.ts` 是每个 Sensa 页面都会加载的内容脚本，因此不带 schema，它的频道名、id 上限与 kind 白名单由 `apps/browser-extension/build.mjs` 在构建时从同一份声明注入。扩展完成持久化后主动通知已打开的 Web 页面，页面再通过完整 pull/ack 合同取数据；空闲页不轮询扩展，恢复焦点和可见性作为丢失通知的兜底。游客采集由 `localIntake.ts` 独立保存并绑定本机 Web library，账号采集继续由 `webDestination.ts` 保管；两者不自动迁移。授权这一轮同样共用：API 路由与 Web 前置校验读同一组 schema。Web 页面在后台自动续接普通连接；插件中的显式登录则使用 Chrome Identity Web Auth Flow 打开带 PKCE challenge 的短时入口。已有 Web Session 自动签发一次性 code；没有 Session 才显示登录，登录完成后继续原请求。verifier 和最终扩展 credential 始终只在扩展后台，另一账号或资料库的队列不会随连接迁移。`tests/web/contracts/bridge-contract.test.mts` 在快速测试里把真实 forwarder 与真实 background 装进同一台假浏览器，逐 kind 走一遍。

## 模型与内容边界

所有模型需求都经过明确的模型执行边界：每个用途（澄清 `teacher`、材料 `content`、审核 `review`、词义判定 `reference`、网页阅读 `reading`）都要声明用途与执行位置。Web 设备侧由 `apps/web/src/data/library/transport.ts` 与 `modelExecution.ts` 执行，服务侧由 `packages/model-runtime` 的 Genkit flow 执行，扩展自带模型由 `apps/browser-extension/src/localModels.ts` 在受信任后台直接请求用户授权的兼容服务。扩展把提供方密钥留在受信任本机存储中，页面和设置响应都不接收密钥。这些执行边界之外不得命名模型端点或引入提供方 SDK；`tests/web/quality/model-management.test.mts` 在快速测试中做静态检查。

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

提供方只有两种：Sensa 服务与用户自填的连接。用户连接按保存位置决定执行位置。存在本机库 `providers` 表的连接在本页执行，密钥只保留在页面内存，不进个人库同步，请求由这台设备直接发出。存在账号侧的连接由部署密钥加密保管、在服务端执行；账号级连接登记处是 `db/migrations/0021_sensa_browser_reading.sql` 的 `reading_settings` 表，扩展与 Web 共用同一份，因此一个密钥只需配置一次。两种位置只差两点：本机连接可使用任意 HTTPS 地址与本机 HTTP 服务，但需要对方允许跨域，且不计入服务端用量；账号连接受部署白名单限制（`SENSA_READING_ALLOWED_ORIGINS`），并计入服务端用量。用途指派每次只属于一个登记处，切换用途即清除另一处。阅读的用途内部再按功能指派（划词、网页、字幕、阅读动作、句中意义、输入翻译）：每个功能一个指派键，`tests/web/integration/reading-language.test.mts` 在快速测试里保证功能清单与指派表、与阅读路由接受的请求枚举三者一致。

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

每组表达／语言／口音拥有独立 Widget 生命周期，退役后忽略其全部事件并关闭媒体。结果非零与 `onPlayerReady` 同时成立才开放控制，速度使用 `onSpeedChange` 确认值；载入失败或超时退役该 Widget，不接受晚到成功。字幕适配器保留高亮标记，并分别处理实际观察到的旧式字节编码及 UTF-8。嵌入 DOM 按供应商高度参与正常布局，仅约束最大宽度，不以 `height:100% !important` 覆盖供应商像素高度。
控件可接收命令不代表媒体已载入：未开始／缓冲仍显示加载，播放状态确认后才撤下加载层；初次媒体等待、换片段与请求重播等操作使用有界的媒体等待期限，重复供应商状态不延长同一次等待。超时关闭旧媒体并开放显式重试，不依赖供应商一定发出 `onError`。键盘跳转可绕过第三方 iframe 的推荐链接直接到达自有播放控制。
启动读取的取消或材料切换退役旧读取，晚到结果不能开启播放器或保留忙碌状态。结束反馈在当前挂载中按不同表达去重，直接在有效 Widget 的实际播放事件中记录，避免快速返回先于 React 效果而丢失确认；未收到确认时不显示播放成果。此反馈不持久化为练习历史，不写正式 Learning、Evidence、Completion 或 FSRS。
练习由独立 `PracticeWorkspace` 承载，不挂载 Learning workspace、Planner 或材料准备。私有表达索引从当前个人 Expression Anchor 的明确表达引用与已下载 Package 的公开表达字段增量维护，不遍历 Sense 依赖；界面读取只包含表达、语言与代表来源引用，不携带 Context、媒体或学习状态。相同语言与形式合并为表达材料，原始来源事实完整保留。入口只读少量预览与计数，浏览使用已有有界窗口与分页列表；整个来源保存为来源选择，自选子集保存不含原文的稳定 UUID。带排除项的全选按页枚举身份，不读取表达正文；播放前只重新核验预览中的一个表达，不传递完整选择集合。选择与当前表达的设备偏好不成为学习事实；失败保留原选择，不静默换来源。当前播放保持表达文本与语言，重开及下一次选词重新核验来源，不复制整库或完整 Scope。此模块复用身份引用与按需行读取的成熟模式，参见 [Anki 浏览表实现](https://github.com/ankitects/anki/blob/main/qt/aqt/browser/table/model.py)。派生索引可以重建，不改写原意义、接受、学习或媒体事实。
YouGlish 商业使用须在发布前取得并核对供应商明确许可；本地非发布验收不代表已取得许可。参见[官方开发者政策](https://youglish.com/api/doc/js-api)。

资源 schema、生成指导和基础展示字段集中在 `packages/contracts/src/sensa/learningResourceDefinitions.ts`；
轻量 Demand 与两阶段用途组合由 `lightweightLearningContent.ts` 声明。生成循环消费请求中的资源合同，
只生成允许的 model roles；权威表达、意义与来源事实由系统装配。词源和录音不能由模型生成 URL 或
自称来源。`spokenResource.ts` 在个人准备期间只调用 provider-neutral 的浏览器语音接口；生产组合根默认
注册 Edge TTS 客户端 adapter。adapter 返回可保存的音频字节，系统冻结与表达、语言严格一致的 TTS
材料，缺失时阻止发布。业务生成循环不识别 Edge 协议，替换 provider 不改学习流程或资源合同。发布构建器只
接收已经制作好的核心资源，不补造音频或场景绑定；纯文字 source 不再满足当前轻量合同。
新增可选资源应局限在资源定义、需求配置及必要的资料获取／专用展示能力，不修改协议状态机。

模型输出只是候选。语义接受、学习资源校验、加入学习和运行时结算仍由对应应用与领域模块完成。常规测试使用替身，不调用付费模型或 TTS。

Reference 的公共查询接口接受显式 pinned languages；正式 Runtime host 从实际 Target 绑定该语对，例句页复用同一查询回调，详情 overlay 与后续手动搜索保留其来源语言。快速查询的 `missing` 与 `error` 分开，不把确认未命中改报服务故障。例句 viewer 只暂停字典，不重置查询词；assessment 提交前无题面 Reference 动作，golden resource 的实际 React 渲染回归保护此边界，不代表公开 Structured 旅程或学习结算验收。
Reference 来源定义使用 `definition: {text, languageTag}`，不默认与词条语言相同；英语版Wiktionary的西语词条仍保留英语定义，归属及例句缺省来源也标注实际词典版本，而非词条语言组。`referenceSenseText`统一选择独立Support-Language gloss或原定义，Quick投影携带实际文本语言，四个面据此渲染；closed-set模型输入也声明每个candidate的`definitionLanguage`。学习内容合同中的目标语言定义不受这项Reference修正影响。
Reference 发音通过同一 `AudioService.playReferencePronunciation` 接收原文语言与可选源录音；不读取当前Route来替代来源语言。源录音失败准确不可用，不静默换声；无源录音时只用匹配来源标签的本机声音，明确变体不猜另一地区。首次本机voice列表为空时最多等待一秒的`voiceschanged`，关闭／停止立即取消等待并阻止迟到播放；打开例句停止录音，返回词典不保留播放中状态。缺声音、合成失败与停止分别按实际终态处理，录音／设备声音与发音标签使用同一来源。
词典适配器仅从来源标签或明确录音命名识别发音地区；无地区声明的英语音标保留`en`，不默认标为美式。
Target 来源页复用已保存的 `publicationArchiveSha256` 与 exact Package key，`projectPackageSource` 从已安装 publication metadata 投影原版本和 memberIndex；不使用 Catalog 最新版或第一册共享成员替代来源。该 URL 参数仅归属来源页，返回原 Target 时移除。来源页隐藏安装／加入／更新操作；正常 Library listKey 入口保持管理行为。
轻量 Runtime 揭示后的来源 sheet 复用同一投影与当前已读 Package summary，并固定打开时的 Target／来源数据；不进入当前 Route 的学习库、不请求全库或执行学习命令。只展示当前材料的来源元数据，关闭或 Escape 回焦点到原学习控件；原 URL、Run／Step 和 Route 不变。

阅读请求由扩展的 background 在一个地方补齐学习者状态（语对与术语表），流式端口与普通消息共用这一步；模型连接测试与模型列表只带各自的问题。服务端的阅读、测试与列表三个入口只接受合同里声明的那三种请求体，`tests/web/integration/reading-glossary.test.mts` 在快速测试里逐个核对扩展实际发出的 body。
整页阅读复用一次按块语言观察来决定跳过与请求的 source language；不把第三语言段落重标为页面语言。
扩展语言识别直接使用 Chrome 本机 CLD，不再附带自建统计语言表。可靠观察保留来源代码和浏览器报告的文字占比；未知、不可靠或接口不可用时保留未知，不按当前 Route 猜语言。短文本块和明确标注语言的选区使用其来源声明；较长段落检测不确定时不得继承整页语言而跳过翻译，`und` 声明也保持未知。
翻译缓存与在途合并按正文、相邻 Context、实际输入语言隔离。恢复原文或销毁阅读面会断开端口并取消请求，
异步语言观察结束后仍复查当前 generation 与原节点，不能在已恢复的网页插入新占位或启动模型。
Route、术语表、模型或阅读偏好的实际 storage 变化通过已有阅读面 lifecycle 重建正在开启的标签页，
清除旧语言结果与缓存；不向页面传递私有 glossary，也不新增独立缓存版本协议。原网页标题／相邻文字变化
同样淘汰旧 Context 的请求与结果。
写作预览固定当前输入；继续编辑会取消旧预览，替换时再核对可写性与原文，不覆盖更新后的用户草稿。

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

Vite 开发服务直接解析 contracts、learning-kernel 和 content-validator 的已声明导出到对应 `src`，
不依赖构建时会被删除、重建的 `dist`；执行全量检查不应因此触发验收页面的缺模块重载。
生产构建仍使用这些包的正式 `dist` 导出，开发源码映射不会改变发布边界。
入口自身热替换按 Vite dispose 卸载原 React root 并移除原可靠性监听，迟到的 Skin Lab 导入不再渲染已卸载 root。
隔离浏览器回归在同一文档内验证连续入口替换与 OPFS 事实保留；它不证明任意依赖热替换，亦不解释旧存储事故根因。
开发服务不注册发布版离线壳，离线导航与冷重开须使用 production preview 验收。离线壳准备就绪前缓存应用代码
与小型公共品牌资源；学习媒体、Book 和私有 API 响应不因此加入启动缓存。

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

需要用与线上相同的内容检查 Web 时，可显式设置 `SENSA_LOCAL_PUBLIC_CATALOG_URL` 为已发布的公开
`/sensa/packages` HTTPS 地址，再启动 `dev:sensa` 或 `preview:sensa`。启动器只读取得目录，校验合同与
revision 摘要后，把该快照交给本地 API；学习包仍按快照中的不可变 URL 和 digest 下载。此模式跳过
本地预览书重打包，不复制线上账号、学习数据或私有配置，Auth、Intake、同步与模型请求仍走本地服务。
目录读取或验证失败会明确停止启动，不用另一份预览内容冒充该发布版本。

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
`SENSA_PUBLISHER_SUBJECTS` 是逗号分隔的 Supabase subject UUID allowlist；API 只在已认证的
`/sensa/web/access/session` 响应中为这些 subject 返回 `publishLearningContent` capability。它控制
`/publisher` 的可见性，但不替代 release workflow 的存储凭据、不可变对象校验或 Registry 提升门禁。
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

`npm run check` 中的快速测试由统一目录运行。Foundation 已按两个正交维度明确分类：
`unit | contract | integration | quality` 表示验证机制，`local-correctness | durability | convergence | scale`
表示产品风险。旧检查已迁入按边界组织的测试目录，保留原有断言与运行隔离；所有目录项均带风险标签，关键的大文件再逐步拆为具名场景。可以单独列出或按维度运行：

```sh
npm run test:web:foundation -- --list
npm run test:web:foundation -- --kind=contract
npm run test:web:foundation -- --risk=convergence
npm run test:web:foundation -- --environment=built-web-artifact
npm run test:fast -- --list
npm run test:fast -- --suite=fast --id=learning-registry
SENSA_TEST_DATABASE_URL=postgresql://... npm run test:web:db
```

`built-web-artifact` 选择器读取生产构建产物，单独运行前先执行 `npm run build`；`npm run check` 已按此顺序执行。
`browser-postgres` 使用真实 Chromium、OPFS、本地 Hono 路由和一次性 PostgreSQL，只在显式选择或 `npm run test:db`
时运行，不进入无数据库依赖的默认结构化基线。

`tests/web/catalog.mts` 是唯一的 Web 测试执行目录：`fast`、`browser`、`database`、`manual` 和
`foundation` 各按所需环境独立运行，单项可用 `--suite=... --id=...` 选择。旧的 `scripts/sensa*Smoke.*`
入口和导入包装层已删除；原有断言现在直接属于 `tests/web` 下对应边界。较长的高风险检查已拆成具名场景，后续新增场景仍应维持既有验证语义。
目录中的 `runner` 只有两种正式平台：不需要真实浏览器的测试用 Vitest，需要真实 Chromium、OPFS 或浏览器生命周期的测试用 Playwright Test；浏览器加数据库场景也用 Playwright Test。不得新增 `node:test` 或第三套通用测试运行器。`npm run test:vitest` 运行快速层，`npm run test:playwright` 运行浏览器层；单项和风险筛选仍通过目录入口执行。独立负载生成器和性能脚本仍是专项工具，不作为通用运行器。

规模夹具生成、生产构建和用户交互须分别计时。Playwright 的 `beforeAll` 使用独立的 hook 看门限，不能仅靠文件级 `test.setTimeout` 为准备阶段配置时间；CI 整组资源看门限也不代表用户响应预算。依赖标准隔离 `page` 的大规模准备可通过 `test.extend` 的独立 fixture `timeout` 分离，保留默认 context、失败追踪与测试正文预算。调整准备或整组执行窗口时，保留具名用例的行为断言、毫秒交互预算与测量条件。

Personal Meaning 与 Package Center 重旅程的单次受控 UI 耗时区分产品目标和发布硬上限：原目标、实测值与条件继续记录；超过目标即输出明确 `PERFORMANCE_WARNING`，不认领该样本已达到目标。发布容差为 `max(100ms, 目标 × 20%)`，避免用很窄的百分比边界阻挡亚秒交互；超过目标加容差的样本以及无效测量仍失败。这是显式工程发布约定，不是实测噪声置信区间，也不代替持续性能基线。功能、权限、数据保存、原子性、完整性、无全库读取与有界 DOM 的断言保持严格；不得通过容差隐藏持续退化或大规模架构问题。

浏览器 CI 通过 `--shard=1/3`、`2/3`、`3/3` 按目录文件无重叠分组；每个文件保持独立服务器、浏览器状态、逐例执行与交互预算。全部分组成功才通过同名 Chromium 汇总门禁。目录入口继续执行剩余文件并汇总非零结果，不因第一处失败遗漏后续证据；本机不带 shard 时仍执行完整目录。

`--suite=browser --depth=quick` 是 PR 的日常反馈层：不选择目录中 `browserDepth:full` 的成熟历史／大 Book 文件，并由原生 Playwright 排除具名 `@capacity` 大规模用例。普通规模的真实保存、并发、失败恢复、持久化和生命周期回归仍运行。主分支 CI 必须使用 `--depth=full`，发布资格仍依赖包括容量检查在内的全部分片；本机默认也是 full。快速报告明确记录 depth 和排除 tag，不是完整旅程或容量验收证据，不把历史绿色结果代入本次运行。

长旅程是产品收敛与验收 checkpoint 的基本单位。`user-journeys.md` 定义目标和合法出口；
`tests/web/journeyMapping.mts` 保存稳定的 Journey → Phase → Scenario → Test Evidence 关联及共享风险检查。
旧审计结论只作为历史输入，关联到测试不表示场景通过，更不表示整条旅程完成。
历史审计未包含的当前产品场景使用同一文件的 `currentJourneyScenarios` 补充，明确旅程、阶段、分支、验收条件与最小证据层；不改写历史 verdict，也不把需求定义当作执行结果。
学习者、支撑和运营旅程均需显式选择已登记的测试。具名证据必须指向实际可执行的断言；能力交叉表本身不扩大执行范围。Provider 的受控回归、候选的本机校验与 workflow 静态检查不能代替真实服务、生产发布或公网验收。
旅程的关闭需要同时核对用户价值与页面衔接、必要异常和恢复分支、真实持久状态、相关性能和容量风险，
以及独立使用验收。单个真实用户顺利走完不能替代其他证据；缺口仍在时不关闭 checkpoint。
测试继续按现有 CI 环境执行，共享底层 Module 不按旅程复制。可在已构建产物的前提下集中列出或运行证据：

```sh
node --import tsx tests/web/run.mts --journey=LJ-01 --list
node --import tsx tests/web/run.mts --journey=LJ-01 --suite=fast
node --import tsx tests/web/run.mts --journey=LJ-01 --suite=browser
node --import tsx tests/web/run.mts --journey=SJ-01 --list
node --import tsx tests/web/run.mts --journey=OJ-04 --suite=fast
```

### 证据保存与任务接续

旅程定义、能力／场景关联和执行结果分开保存。`journeyMapping.mts` 说明一个断言证明什么与剩余边界，
`catalog.mts` 选择执行环境；checkpoint 的 Git 提交、CI run／attempt、发布 manifest 和实际使用报告记录
发生过的结果。历史矩阵的 verdict、报告中的旧失败以及独立验收结论均按原版本保留，不改写为当前通过。
检查覆盖不能仅由文件存在、提交标题、当前绿色 CI 或一次真实用户顺利使用推导。

新任务先按旅程列出证据，再按改动风险与执行环境选跑。快速回归不需要浏览器或费用；OPFS、离线、
生命周期和真实扩展行为使用 Chromium；账号数据／RLS 使用隔离 PostgreSQL；真实 Provider、TTS、邮件、
安装权限和生产发布另行授权、执行与留证。独立使用验收给予用户目标与必要边界，不预先提供操作答案，
不让审查者修改生产实现。不同旅程使用新的独立审查视角，发现的问题由主智能体核实和固化回归。

复用规模夹具时保存生成器、输入规模、实际产生的事实种类与完整性检查；性能记录注明正文与媒体、
硬件／浏览器、网络、冷暖状态、测量起止及原预算。准备耗时、传输、校验、提交和可交互时间不混为一个数字。
失败样本与告警保留原结果；告警不等于性能达标，供应商接收邮件不等于用户收件箱验收。

原始证据可在本机建立不可覆盖的归档。归档工具只复制文件并核验字节与 SHA-256，不解释报告、判定通过、
执行所复制脚本或调用网络。自动发现用于仓库内的 `LJ-*` 报告、历史审计、选定规模日志与发布证据；可用
JSON 路径数组明确选择其他证据。自动发现不是“全部证据齐全”的证明，归档前应核对来源列表。

```sh
node --import tsx scripts/archiveJourneyEvidence.mts --discover \
  --output=output/playwright/evidence-archives/<new-name>
node --import tsx scripts/archiveJourneyEvidence.mts --sources=<paths.json> \
  --output=output/playwright/evidence-archives/<new-name>
node --import tsx scripts/archiveJourneyEvidence.mts \
  --verify=output/playwright/evidence-archives/<name>/manifest.json
```

归档原文不做内容脱敏，目录与文件使用本机私有权限并保持 Git ignored；完整 profile、凭据文件和
填充的环境文件不纳入归档。`manifest.json` 记录原路径、字节数与摘要；`inventoryGitCommit` 是整理时的
源码版本，不自动成为报告的被测版本；路径中的 Journey hint 也不是验收结论。只有所有复制完成后才写
manifest，重复命名或摘要不一致直接失败，不覆盖原文件或旧归档。归档应随本机工作资料另行备份；Git
只保存工具和操作规则，不保存原始报告、生成内容、媒体或私有状态。

重要 CI 证据在其配置的保留期到期前下载并核验；期限以相应 workflow 为准。任务交接只引用源码入口、
checkpoint 提交、运行记录、归档 manifest 与 issue，不维护第二份手工通过表。保留事项区分已知缺陷、
未验证的发布准备与明确范围外能力；把它们登记到 issue tracking，不在资料整理阶段自动扩展实施范围。

旅程性能证据必须注明规模、设备/CPU、网络条件、预算和测量范围。构建大小、SQLite/OPFS 查询预算、
慢账号恢复期间的 Shell 响应以及受控浏览器交互是不同证据，不互相冒充，也不据此宣称真实设备 CWV 达标。

成熟学习容量夹具由 `scripts/generateRetentionCapacity.mts --targets=N` 专项工具生成，需要显式设置
`SENSA_TEST_MEMORY_LIBRARY=true`。它使用正式 Learning commands 和 SQLite/Wasm，在受控时钟下产生初学、
到期复习及历史，完整 replay validation 后才保存到忽略的 `.tmp/retention-capacity-facts-*`，不直接填造完成或调度字段。
`retention-review-capacity` Playwright 用例可通过 `SENSA_RETENTION_CAPACITY_FIXTURE` 复用该目录，未提供时生成 1k 样本。
实现变化后复用缓存前，可用 `SENSA_TEST_MEMORY_LIBRARY=true node --import tsx scripts/verifyRetentionCapacity.mts --fixture=目录`
重新核对全部 digest、数量和当前完整领域 replay；它不改写夹具，也不补造缺少的 Scope 或 Session。
测试只在空的隔离 guest 中按 digest 分批复制这些已验证的原始事实；复制是测试准备，不是产品备份恢复或其原子性证据。
通过目标详情实际开始复习后核实实际选择的 Scope 与 Session，确认库内 Target 数量保持完整，再测评分和下一条；
后继 Run 固定自己的当前选择，Session 起点与数量仍不变。首次活动建立不能混入普通续学耗时。
生成、复制、逻辑记录体积与 UI 交互分别报告；万条规模需显式选择，不能从 1k 或零历史的合成调度行外推通过。

`sqlite-runtime-failure` 的无故障 idle 对照默认等待 2 秒，专项长空闲验证可设置 `SENSA_OPFS_IDLE_MS`
（最多 30 分钟）。它并行检查隔离上下文和持久资料夹的文件名、原始字节及重开完整性，报告实际等待时长；
短等待通过不能认领长空闲可靠性，原始存储对照也不能替代完整页面验收。

Learning continuation 的 Worker 查询返回有界候选前缀和实际 retry 候选，不传输整条 Route 的 Target 摘要。
本机候选索引只保存可重建的调度标量，与 Target 的正式写入同事务更新；额度仍计入已被 supersede 的当日 introduction，
材料、冻结语言方向、policy/cache readiness 与重试顺序不能因查询优化而放宽。索引写入失败需回滚正式事实及 receipt，
丢失索引只能从既有事实重建，正常重开不重写来源数据；相应 parity、rollback 与 rebuild 检查属于 LJ‑08 的共享保护。

Study 的计划摘要与学习历史分开查询；Stats 不重建内容/准备工作区。历史列表按 epoch 与 record ID 的游标分页，
汇总和按日/语言分组针对整个选中范围计算，不由已加载前缀推算。分页链固定首次读取的时钟；Library revision、
incarnation 或设备时区变化时重新读取前缀，筛选/路线/页面切换后的晚响应不能回写新视图。历史缓存只是同事务更新的
本机可重建投影，重建按小批次读已有 Run，不修改正式事实；统计排除晚于读取时钟的记录，跨语言不混成同一每日计数。
Stats 的年度日历和趋势只消费整范围标量汇总；年度渲染至多 366 日，长期趋势合并成至多 24 个相邻月份区间。到期预测复用 Runtime candidate 的来源、暂停、声明已会、语言方向和策略资格条件，SQLite 按 Target 去重后返回最多 30 个按日汇总和一页 20 个身份，只有这一页读取目标展示。两种读模型均不修改排程或正式学习事实。

历史到 Target 详情只读取指定 Target、当前 Run 与每日设置，不重新准备队列、恢复内容或读取全库历史。
详情仍使用正式 membership/readiness 与同一展示投影，按当前冻结语言方向选择；页面、路线、目标的读取版本隔离
迟到响应和重试去重。读取失败先撤下旧材料与行动，再由显式重试恢复。页面代码模块加载失败则使用重新加载恢复，
不能仅 reset 路由后再次展示已被模块加载器缓存的同一失败；该恢复不改动本机学习事实。

Run 的材料目录保存不可变 body、Step 引用和 participant 首次绑定顺序。Action 明确保存其 before Run
revision 及后继 presentation（完成则为显式 null）；lifecycle fact 引用同一修订流。恢复从计划基线及保存的展示／刷新见证
核对连续、唯一的每 Run revision、材料目录、映射与顺序；完整 Protocol 行为与最终 Run 的算法重算另属历史审计。不能把最终映射直接当作
历史输入。当前格式不猜测或补写旧 Run 缺失的顺序与因果字段；旧来源事实不迁移、不清除，格式验收使用隔离新库。

Content Supply 保存独立的来源准入时点 `provenance.sourceReadyAt`；个人准备的 `ContentAttempt.readyAt`
只在审核与确定性校验接纳的同一事务中赋值，之后不可更改。Run 重建快照创建时间时仍保留来源时点；
补充资源另存自己的 Ready 时点。开始、刷新与恢复校验来源时点、Membership 生命周期及确切 Attempt，
不能用 Run/Action 时间代替 Ready，早于材料可用时间的请求须整体拒绝。历史测试通过受控准入时钟构造顺序，
不在测试中改写已提交来源事实来补齐时间。

性能验收以 Anki 的长期学习与 Obsidian 的本机内容使用体验为参照，不复制其数据模型，也不把它们
没有公布的时延承诺当作 Sensa 已验证的基准。候选体验目标与既有 CI 回归预算分开记录：交互的首个
可见反馈以 200ms 为目标，频繁的本机读取、评分、下一条与运行恢复以 500ms 为目标；端到端命令完成、
Event Timing、最长任务和页面加载指标分别测量，不能互相替代。未在同机、同规模和同类操作下实际比较时，
只称为 Sensa 的测量，不宣称与参照产品等效。

容量证据分别声明新导入的 Book 成员数、已有库的目标/历史规模、媒体字节与后台活动。先固定媒体负载
验证 5,000 / 10,000 Sense，再固定成员数验证媒体增长；100 个成员的样本或 Manifest schema 接受更大
数量都不构成这两个规模的浏览器交付证明。完整导入允许随输入增长的校验与原子写入，但必须及时反馈、
保持 UI 响应，并验证取消、失败和重试的真实持久结果。安装后的普通操作应围绕当前对象、路线与学习
窗口读取，不重复处理整个分发归档；新增规模不能以放宽 CI 预算替代体验修正。深度容量测量按独立目录项
顺序运行，记录失败阶段和已完成测量；未测到的后续阶段不填写成功或估算耗时。每条旅程只纳入相关风险，
不要求穷举所有规模与全部产品系统的笛卡尔组合。

`npm run test:coverage` 只生成当前 Vitest 用例所触及
Web 学习投影的覆盖率报告，不设置全局覆盖率门槛；Playwright Test 失败时按测试项隔离保留 trace 和截图在被 Git 忽略的
`.tmp/playwright-results/<suite>-<shard>-<invocation>-<group>` 中，CI 失败时上传这些诊断产物，不重试。Playwright Test 用例必须只使用合成、非敏感数据。
平台用例仍通过目录进入既有 CI 分层，不额外执行一遍。
风险标签是筛选维度，不是独立的 CI job：`foundation`/`fast` 的 Vitest 与构建产物检查进入主 CI 的 `npm test`；
Chromium 的 Playwright Test 检查进入 `npm run test:browser`；PostgreSQL 的 Vitest 和 Chromium+PostgreSQL 的 Playwright Test 检查进入 `npm run test:db`。
运行器会拒绝把自动化测试登记到错误的 CI 环境边界。`manual` 的实际 Book 检查依赖另行生成的
`release-candidate/portable-catalog.json`，不在普通 CI 中；普通 CI 的 `package-learning` 等测试覆盖同一安装、结算和复习代码路径，但不替代实际发布包验收。

目录运行器按 runner、环境和精确环境变量分组调用原生测试引擎，不再为每个文件启动独立进程。
Vitest 保持文件隔离与单 worker；Playwright 保持每个 spec 的 fixture 边界，不增加 worker 或拆散共享生命周期中的用例。
原 package-center 大型 spec 已按词书、账号恢复、表达练习、学习运行和学习安排拆为独立文件，
共享 fixture 只复用实现，各文件的可变状态与输出目录独立；相同配置的只读构建按下述规则复用。
Browser shard 按已观察的文件耗时估计确定性分配；未采样文件使用保守默认权重，不将估计当作 SLO 或实际提速结果。

相同 worker 调用内，Package Center 各文件复用 `webTestBuild.ts` 生成的只读产物。它按完整公开构建配置区分，固定本次调用中首次分配的临时 Web/API 端口；每个文件关闭旧服务器后才建立自己的新 handler，浏览器 context、OPFS、账号和可变夹具不共享。不同配置仍构建新产物，失败构建不会成为成功缓存；缓存不跨 invocation，也不是生产候选。开发态 Skin Lab 显式使用 `NODE_ENV=development`，不继承前一文件的 Vite 构建模式。

完整 CI 中，`prepareRetentionCapacity.mts` 使用原生 GitHub Actions cache 保存纯合成成熟历史数据。key 固定生成／校验的源码依赖、workspace package source、lockfile、Node 版本、平台和输入规模，没有跨版本 restore-key。命中后仍执行当前 digest、数量和完整领域 replay 校验；不一致、非数据文件、symlink 或不完整准备直接失败，不静默覆盖、清空或重建旧缓存。每个浏览器用例仍复制到自己的空隔离 OPFS，复制耗时与交互耗时分开报告。缓存减少正式历史的重复生成，不能省略浏览器写入、恢复或性能测量。

每次调用在 `.tmp/test-results/<selection>/shard-<shard>/<invocation>/` 保存原生 JSON／blob 报告与目录选择回执，
同时记录 GitHub attempt。成功要求原生引擎退出成功且报告包含全部、仅包含本次选择的测试文件；
不存在的报告、遗漏文件或其他调用留下的旧产物不能代替执行结果。CI 在成功与失败时都上传原生报告，
并用 Playwright 自带的合并器生成同一 CI run（含局部重跑 attempt）的浏览器 HTML 报告。
聚合报告不放宽各 shard 的成功门禁；失败 trace 与重跑前的失败报告保留，诊断产物保留七天。

`tests/web/support/libraryConvergenceWorld.mts` 通过一个小型测试 Interface 封装每台设备的 confirmed base、当前
本地快照、云端发布、领域 Replica Module 合并与冲突分区。场景只提交领域有效快照、指定同步顺序，并可在确定时点
注入 offline 或 lost-ack；它用于快速证明重试、幂等、显式冲突和最终收敛语义。该 Node Module 不证明网络传输、
SQLite/OPFS、Service Worker 或 PostgreSQL 实现，这些仍由真实 Chromium 与隔离数据库测试负责。
`tests/web/support/realLibraryConvergenceWorld.mts` 是后一类测试的浏览器驱动；它只通过真实保存、同步、冲突解决
和可观察快照 Interface 操作系统，不直接修改 OPFS 或云端记录。

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
node --import tsx tests/web/run.mts --suite=browser --id=browser-port
node --import tsx tests/web/run.mts --suite=browser --id=extension-popup
node --import tsx tests/web/run.mts --suite=browser --id=extension-reading-surface
node --import tsx tests/web/run.mts --suite=browser --id=extension-subtitle-surface
```

上述受控 browser 用例默认单独构建当前扩展到临时目录，不读取或覆盖已安装的 `dist`；显式设置
`SENSA_EXTENSION_TEST_DIR` 时只读核对该候选。它们注入 content script 或 popup 并使用受控 transport／voice，
不代表真实安装权限或真实声音。脚本成功只能证明它覆盖的边界；真实账号、真实 Provider、浏览器商店和生产环境需要各自的验收证据。

获得真实模型与 TTS 验收授权后，可为人工或 Agent 浏览器使用启动一次性隔离环境：

```sh
SENSA_LIVE_ACCEPTANCE=1 node scripts/live/runLanguageMatrix.mjs --interactive --slot=7
```

该模式沿用同一 runner 的临时 PostgreSQL、API 和 Web 隔离规则，端口已占用时直接拒绝，不接管现有进程。
它不自动执行语言矩阵或调用模型；费用由实际用户操作触发。使用新的浏览器上下文，不复用 owner profile。
`ready` 仅表示环境就绪，不是产品验收通过；实际结果、模型/TTS 调用和下载产物需另行留证。
Ctrl-C 关闭该次运行的服务并删除其临时数据库，诊断产物保留在被 Git 忽略的运行目录；不清理 owner 数据。
主动停止记录为 `stopped`，不因清理中的子进程退出改写为 `failed`，也不代表验收通过；未主动停止时的服务意外退出仍为失败。
`--dry-run --interactive` 只检查参数并说明计划，既不启动服务，也不调用模型或 TTS。

## CI 与生产发布

服务端请求日志关联 request ID、release 和公开错误类别。未预期错误仍只向客户端返回
`temporarily_unavailable`；服务日志可增加 `failureKind` 与固定允许列表内的 `failureCode`，不输出异常消息、
SQL、正文、邮箱、token、堆栈或嵌套 cause。连接池连接／idle／rollback 日志共用同一脱敏分类，回滚失败
仍销毁连接并保留原异常给 caller；日志 sink 失败不得替换原异常或泄漏已借出的连接。
分类器不执行异常属性 getter；未知值归为 `unexpected`，不能把未知原因
视为已定位故障。实际故障须用固定 release 与 request ID 关联线上事件，测试中的受控异常不是线上根因证据。

共享 API 的 Node 内建依赖须显式导入，例如同步 UTF-8 容量计算使用 `node:buffer`，不依赖 Node 开发进程
提供的隐式全局。受控回归仅在应用工作范围移除全局 Buffer，保留 Node HTTP 自身依赖，验证上传、容量拒绝
及相同块重试；Edge 编译和真实托管运行另行验证，不用 Node 回归冒充 Deno 运行证据。

`.github/workflows/sensa-consumer-check.yml` 在 pull request 和 `main` push 时运行 `Sensa CI`。它执行静态检查、构建、Web 快速测试、浏览器检查以及 PostgreSQL/API 集成。Pull request 只生成验证构建；`main` 的静态／快速 job 使用 `web-candidate` 公共配置构建一次生产候选，在同一 job 内固定完整 SHA、GitHub Actions provenance、公开目标、migration 集合和每个交付文件摘要，完成 artifact 检查与 Cloudflare dry-run 后才上传 `sensa-production-<SHA>-attempt-<BUILD_ATTEMPT>`。其余 CI job 共同决定该候选是否具备发布资格；失败 run 中即使存在 artifact 也不能被发布器接受。

候选的构建 attempt 与全套检查通过的验证 attempt 分开记录。只重跑失败测试时，候选仍属于原构建；完整重跑会上传新的独立候选，不覆盖旧产物。`candidateSource.mjs` 只读核验精确仓库、绿色 main/push run、验证 attempt、未过期 artifact ID/digest，以及生成它的成功构建 job 和时间边界。部署按 artifact ID 下载，并继续校验原构建 provenance、目标和全部文件摘要，不把测试重跑当作重新构建。

Workflow 是执行规则，不是平台级合并保护。只有在 GitHub 分支保护／ruleset 实际启用并核验 required checks 后，才能认领强制合并门禁；Environment 的审批规则也需要独立核验。私有仓库的计划限制不能通过脚本或一个 `owner_accepted` 参数宣称已经解决，不默认更改仓库可见性或购买计划。

整个生产系统只有一个发布编排器：`.github/workflows/sensa-release.yml`。正常路径由成功的同仓库
`Sensa CI` main run 通过 `workflow_run` 自动触发，不需要人员或 Agent 再点击发布按钮。编排器先核对
触发 run 的仓库、事件、分支、完整 SHA、结论、run id 与 attempt，再生成
`sensa-system-release-plan-v2`，根据上一份成功的系统清单与目标 revision 之间的差异决定发布范围：
应用变化只发布应用，authoring/content 变化只发布学习内容，公共 contracts、validator 或 learning kernel
变化必须联动发布。没有生产变化的 revision 生成 `no-op` 系统清单并沿用两项组件身份，使后续差异基线
仍然连续。显式 scope 可以要求重新发布某个组件，但不能省略 Planner 判定为必要的组件。

自动路径受版本化的 `sensa-automatic-release-policy-v1` 约束，只批准已经具备绿色、不可变 CI 候选的普通
application-only 变化。数据库迁移、`infra/`、Supabase/Cloudflare 生产配置、服务环境合同、学习内容与共享
内容合同、Supabase Edge 入口以及 API authentication/access authority 都代表新的数据、权限、基础设施或内容发布授权，自动路径会停止并要求 owner 对精确 revision 使用
备用 dispatch 显式授权。政策等待输出 `requires-approval`／`awaiting-approval`，不部署组件，不生成成功系统清单，也不冒充已上线；它与执行故障分别报告。当前没有真实用户不会放宽这些边界；该策略就是后续存在真实用户时继续使用的
默认保护。手动入口只用于上述策略例外、完整 bootstrap、明确重发和灾难恢复，不是日常发布步骤。

统一发布流程：

1. 正常路径接收已完成的绿色 `Sensa CI` main run；备用路径接收 owner 明确授权的完整 main SHA；
2. 固定绿色验证的 CI run id / attempt，再独立核验候选 artifact ID 与构建 attempt；不替换触发它的 run；
3. 读取上一份 `sensa-system-release-manifest-v1|v2`，按路径影响生成最小安全 Release Plan；新成功记录写为带授权证据的 v2；
4. 如需发布内容，先构建、验证、上传不可变 Book/Registry 并提升 Registry；
5. 如需发布应用，从该成功 CI run 下载已经测试和固定的 Web、扩展与 API 候选，重新核对来源、目标和全部摘要，不再重新构建；
6. 完整应用发布才应用前向数据库迁移、对齐 Supabase Auth／服务配置并部署 Supabase Edge Function；
7. 上传 Cloudflare Worker 版本，先核验预览文件，再提升到生产；完整发布才用 `wrangler triggers deploy` 应用域名路由；
8. 执行公网非模型 smoke，并核验 API 构建身份、生产 Web 文件摘要和 Cloudflare 实际 100% 流量版本；
9. 生成同时固定 Application、公开配置目标、前向 migration 集合与 Learning Content 身份的系统清单；
10. 独立 archive job 将已核验的候选 ZIP 与系统清单保存到 GitHub 原生 Release，核验回读摘要后发布归档。

仅 `scope=auto` 且生产变化全部位于 `apps/web/`，并已有真实核验的应用基线时，Planner 才选择
`web-only`。它保留原 API、数据库迁移集和生产配置，跳过 Supabase 写入与域名路由更新；执行前仍须
核对候选与基线的公开目标、迁移摘要、原 API 身份及原 Web 实际流量。基线缺少证明、显式重发、
API／扩展／共享／配置或未知路径变化均保持完整发布。目标漂移直接拒绝，不能把 Web-only 自动升级为更大写入权限。

`releaseCandidate.mjs` 在密封前将完整源码 SHA 写入编译后的 API identity module；本地源码默认返回 null，
运行时环境变量不能覆盖这个身份。公开 `/sensa/release` 只返回构建身份，不认证、不访问资料或调用模型。
`liveVerification.mjs` 回读预览／生产的 index、Service Worker 与 assets/integrations 中的 JS、CSS、WASM、HTML
实际解码字节，按候选校验大小和 SHA-256，并查询 Cloudflare 最新部署的精确版本及 100% 流量。
最终系统记录必须带匹配的 live verification；Web 与 API 可以来自不同的已核验源码版本。

联动发布按 Content → Application 排序；共享合同必须在旧应用/新内容和新应用/新内容的滚动窗口中保持
兼容。任一组件未成功时不会生成成功的系统清单。首次使用统一入口，或上一份系统清单已经不可用时，
Planner 会要求 `scope=all` 的完整 bootstrap，而不是猜测线上组件状态。

应用交付遵循 `build once → verify → promote`：生产 workflow 没有应用 build job，不接受其他仓库／SHA／run 的候选，也不拿验证 attempt 冒充构建 attempt。它仍会 checkout 同一 SHA 读取 forward-only migration 和发布脚本，在生产边界重新校验候选及目标，再执行 Supabase/Cloudflare 提升。候选保留 14 天；过期后发布应失败并重新取得当前 SHA 的绿色 CI 证据，不能在生产 job 中临时重建。备用入口只接受已完成的绿色 CI；未完成时立即给出可操作状态，不在发布 job 内等待一个短于实际 CI 时长的固定窗口。

发布计划、组件回执和完整系统清单使用独立产物身份；重跑组件后，记录器接收该成功执行返回的 artifact ID，不按同名文件猜测最新结果。`releaseStatus.mjs` 在失败后记录有限允许列表内的步骤 outcome，并区分 `not-deployed`、`partial-or-unverified` 与完成状态。迁移／配置命令失败也可能留下部分变更，不能认领“生产未变化”或“已自动回滚”。统一报告分别展示等待授权、no-op、完整记录与 incomplete；实际应用已核验但归档失败时显示 `verified-but-unarchived`，重跑 archive job，不重跑部署。命令 outcome、线上构建证明和用户旅程验收是不同证据。

`releaseArchive.mjs` 使用原生 GitHub Releases，不增加备份数据库。候选归档 tag 为
`sensa-application-<FULL_SHA>-<BUILD_RUN>-<BUILD_ATTEMPT>`，保留 Actions ZIP 的精确原字节、摘要和密封 manifest；
系统归档沿用 `sensa-system-<SHA_PREFIX>-<RUN>-<PLAN_ATTEMPT>`，保存完整清单与独立 checksum。
草稿上传并回读校验后才发布；同名不同字节拒绝覆盖，部分重试保留第一份精确回执。
GitHub token 只发送到固定 API／上传域名，签名存储下载不转发 token。
归档 receipt 如实记录平台 `immutable` 属性，不将脚本“不覆盖”策略冒称已启用平台不可变保护。

规划优先读取可核验的长期系统归档，并检查较近 Actions run 的完整记录；整体 workflow 因 archive 失败而红，
不代表已经核验的生产状态消失，不能静默退回更旧清单。原生发现有界，较旧记录可指定精确 system tag。
Actions candidate 过期后不允许临时构建未测代码来发布；已保存的原字节仍可用于受控恢复及配置迁移。
恢复只读取 manifest 明确列出的成员并逐文件核验，不执行归档脚本、不按 ZIP 路径解压或创建 symlink，
目标目录已存在时拒绝覆盖。Web-only 清单保留原 API 的独立候选归档引用，不能把新 Web ZIP 中未部署的 API 当作线上 API。
旧组件没有归档时 receipt 明确保留缺口，不伪造恢复点；归档不会回滚数据库或替代实际恢复演练。

普通 application-only 变化不需要运行发布命令。策略例外、明确重发或恢复时才使用备用入口：

```sh
gh workflow run sensa-release.yml \
  -f release_sha=<FULL_MAIN_SHA> \
  -f scope=auto \
  -f owner_accepted=true
```

第一次启用统一发布或系统清单丢失时使用完整 bootstrap，并提供已经密封的媒体输入：

```sh
gh workflow run sensa-release.yml \
  -f release_sha=<FULL_MAIN_SHA> \
  -f scope=all \
  -f media_release_tag=sensa-learning-media-<DIGEST_PREFIX> \
  -f media_pack_sha256=<FULL_MEDIA_PACK_SHA256> \
  -f owner_accepted=true
```

`.github/workflows/sensa-web-candidate.yml` 是可选的深度验证，不是日常发布前置。`.github/workflows/sensa-web-monitor.yml` 负责已启用环境的定时公网和聚合阈值检查。

监测与保留期维护沿用 `web-production` 的正式目标，但各自使用独立的数据库登录身份。由
`.github/workflows/sensa-operations-setup.yml` 的 owner 明确授权入口配置权限；管理员连接只在这次配置中使用，
定时任务从受保护的独立密码与无凭据的 `SENSA_OPERATIONS_DATABASE_TARGET` 连接目标派生连接，不取得应用或管理员连接密码。监测只可读取指定元数据列，数据库
默认只读；锁等待由私有函数仅返回计数，不开放全量活动查询文本。维护不能写入账号、学习事实或活动 head；
RLS 删除条件另外限制已过期快照／回执、退役引用和无保护引用的过期块。`SENSA_MONITOR_ENABLED` 与
`SENSA_RETENTION_ENABLED` 分别在 repository variables 启用。首次启用必须检查聚合清理预检、真实 job 结果与
一次 incident 创建／健康复测关闭；任务日志不包含正文、身份或连接凭据。备份记录的只读清单不是恢复演练，
没有经核验的恢复点时仍按支持手册报告缺口，不恢复或覆盖生产库来做演练。

4× CPU 的 Book 规模基准在 browser shard 2 的独立进程中先执行，再运行常规长旅程；后者只排除这一个
已单独执行的 tag，不省略其他行为检查。独立基准的预算不变，但共享 runner 的单次降速测量是非阻塞
告警，不作为应用修复发布资格；失败仍保留为失败样本，输出 workflow warning，独立上传 trace、CPU profile
与可用测量证据，不能认领性能达标。其输出目录与常规旅程分离，避免后续 Playwright 清理覆盖证据。
全部常规功能分组、权限、持久化和其他既有风险断言仍为必要门禁。它避免同一测试进程此前的大库 fixture
留存影响新空库安装样本，不将共享 runner 结果冒充生产设备 SLO；持续退化仍须单独诊断，先前的失败和本机
样本不能代替当前 CI 的独立复测。

仅迁移已上线版本的网址时，使用 `.github/workflows/sensa-web-domain.yml` 的配置入口，不发布新的应用
候选。它要求 owner 明确选择一份成功的统一发布记录，并核验其中的绿色 main CI 和 Cloudflare 当前
100% 版本；切换前后版本必须不变。工作流只更新 API 的 `ALLOWED_ORIGINS`、Supabase Auth 回跳与
Worker triggers，不上传 Web、部署 API、迁移数据或发布 Registry；扩展仅从与绿色基线相同的源码
重新固定目标网址。限定配置测试、真实公网边界 smoke 与单独的真实邮件登录验收是该变更的检查边界；
不能把这类配置操作冒称为未通过 CI 的新应用发布，也不能据此认领未解决的旅程回归。

学习内容拥有独立于应用版本的生命周期，但 `.github/workflows/sensa-learning-content-publish.yml` 只是由
统一 Release Planner 调用的内部执行器，不接受人工 dispatch。它从 `content/authored/*.json`
与仓库固定的路线基础输入重建正式 Book source，再构建每个 Sense 的不可变 `.sensa` 并原样封装成 `.sensa-book`，执行无网络 Registry smoke，按 Book archive →
Registry 上传到 Supabase Storage 的 content-addressed 路径并逐一校验公网 bytes。只有以上步骤全部
成功后，工作流才把 API 的 `SENSA_PACKAGE_REGISTRY_URL` 提升到新 Revision。它不重新部署 Web、
不覆盖既有对象，也不把下载解释为 learner 已应用更新。音频与图片不进入 Git：operator 先用
`scripts/release/buildAuthoredMediaPack.mts` 生成精确媒体包并以
`sensa-learning-media-<digest-prefix>` 的唯一 tag 上传为 GitHub Release asset；owner 在发布时同时固定
tag 与完整 SHA-256。工作流先校验整个媒体包，构建器再校验并消费其中每个对象，遗漏、多余、MIME
不符或摘要不符都会终止发布。

每个 Published Lightweight member 都是可独立验证的 `.sensa`；`.sensa-book` 只提供完整 Book 的单次
分发与原子安装。官方 producer 由 `buildPortableBookRegistry.mts` 实现：每个 authored member 产生一个
Portable v2 Package，内嵌 Manifest 固定顺序和 identity/version，Book archive digest 固定所有成员的精确
bytes，Registry v3 直接发布该 archive；`publishPortableLearningRegistry.mjs` 按 Book archive → Registry
的顺序上传并验证公开 bytes，受保护 workflow 只提升这条链产生的 Registry v3。

```sh
gh workflow run sensa-release.yml \
  -f release_sha=<FULL_MAIN_SHA> \
  -f scope=content \
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
发布包含的全部当前 Book release source；`SENSA_BOOK_RELEASE_SOURCE_DIRECTORY` 可改为读取一个派生
source 目录，二者不能同时设置。分批构建时，`SENSA_PACKAGE_EXISTING_CATALOG` 指向已经校验的 Registry
候选，构建器逐字保留其中的 Manifest descriptor，并只合并本批新 Book；同一个 Book version 再次出现
会失败，不能靠后写覆盖前写。同一 Registry 不允许同一 Book 与精确语言方向出现两个版本。

当前全路线基础的作者内容和媒体摘要固定在
`content/authored/route-foundation-v1/prepared.json`。发布工作流确定性展开全部 18 × 18 条路线，并把
直接 authored Book 一同放进一次 Registry 构建；二进制媒体仍只来自 owner 固定摘要的密封媒体包。

所有生产部署都从 CI/CD 执行，不从本地 shell 调用 Provider 部署命令。迁移保持前向兼容；回滚 Web 版本时不能假设数据库也会回滚。

## 配置与安全

- 正式 Web 入口为 `https://learnsensa.com`。`wrangler.jsonc` 固定 Worker Custom Domain，禁用
  `workers.dev` 生产入口；独立版本预览继续用于发布核验。Cloudflare 负责该 Custom Domain 的 DNS 与
  HTTPS 证书，版本提升后必须另行应用 triggers，不能只上传或提升版本而遗漏域名。
- `web-candidate`、`web-production` 与 `learning-content-production` 的 `SENSA_WEB_ORIGIN` 必须
  指向同一正式入口；若启用 `web-monitor`，其检查目标也须一致。应用发布同步对齐 API CORS、
  Supabase Site URL / redirect allow list 和浏览器扩展目标，不变更 SMTP 或账号准入。浏览器本机资料
  按 origin 隔离，网址迁移不复制或清除旧 origin 的 OPFS、登录会话或其他本机数据。
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

本地包源为 `content/preview/lightweight-resources-v8.json`。它修正轻量学习的流程说明，使用新 Book Version
及新 Package Version，不覆盖原发布摘要或改写用户已采用的材料。首次执行
`npm run content:prepare-local -- --allow-tts` 明确允许生成媒体；随后
`npm run content:prepare-local` 仅复用经过校验的缓存。生成文件位于被 Git 忽略的
`.sensa-local/` 和 `content/data/media/audio/speech-cache/`。
普通 `dev:sensa` 启动只构建已准备好的包，不产生外部 TTS 调用。
`npm run dev:sensa -- --no-browser --models` 启动供人工验收的本地服务：
`--no-browser` 禁止自动打开或操控浏览器，`--models` 允许用户操作调用已配置模型。登录使用本地验证码
`123456`。个人学习声音仍由浏览器当前选择的客户端 provider 生成；省略 `--models` 时托管模型暂停。
可通过 `SENSA_TTS_PYTHON` 指定装有 `content/requirements.txt` 依赖的 Python。

Portable Lightweight Package 由 Content Supply System 的单一 interface 提供预览、安装和导出。UI 不读取
ZIP 路径、不解析媒体，也不直接构造 Runtime content；内部 adapter 校验 `.sensa`、规范化归档、编译到
现有 Lightweight material roles，并在一个 `package.install` transaction 中保存 installation fact 与本机
cache。预览只读，导入不自动 enrollment。导出从保留的公开 manifest 与已冻结媒体重建确定性归档，并
核对安装时的 package/archive digest。本地 Portable update 不制造 Book superseded membership；Catalog 中
显式选择的 Book Version 才产生对应 membership。两条路径都在稳定 identity 时保留 Target 进度并选择最新
已应用材料，identity 改变则新增 Target 且不自动删除旧 Target。当前未操作 Step 通过受 Learning authority 校验的 material refresh lifecycle event 切到新版；
已操作 Step 的 material fact 不改写。完整边界由
`tests/web/integration/portable-package-loop.test.mts` 覆盖。

`ContentSupplySystem` 的 Catalog 读取 Registry v3，对一个 Book 只下载一个 `.sensa-book`，先校验外层
digest 和内嵌 Manifest，再校验全部 `.sensa` 成员并用一个 transaction 原子安装；Catalog 与文件导入共用
Portable 准入、编译、安装和导出 authority。区别只在信任来源：Catalog 路径可依据 Registry 对 Book
archive 的精确 digest 采用官方 semantic declaration，本地文件只能形成 Package-local
identity。UI 不解析 ZIP、Manifest 或媒体，也不能绕过 Content Supply 直接构造 Runtime content。
Registry 描述符可携带固定 URL、byteLength 与 SHA-256 的只读 `preview` 文本制品（最多 8 MiB）。构建器从通过验证的 Book 生成完整表达目录及最多三个真实场景、意思和例句；发布器再次与原 Book 比较后先上传制品，最后发布 Registry。`book_preview` query 校验制品字节与精确版本身份，不访问学习库。旧描述符仍有效：无预览制品且原 archive 不超过 8 MiB 时，在内存中读取、完整校验并提取同一文本投影；较大的旧包明确显示预览不可用。页面离开、版本切换或超时终止读取与 Worker，不写安装、媒体或学习事实。

浏览器中的 Book 准入、下载前内容预览、独立 `.sensa` 导入预览和安装准备共用单任务 Worker，把 ZIP、摘要与内容编译移出
UI 主线程；预览只返回已校验的 Manifest 和媒体统计，不把解码媒体传回界面。确认安装仍校验原归档摘要，
Worker 不访问学习库；安装事实只由主流程的统一事务提交。无 Worker 的 Node 验证使用同一纯计算实现。

迁移不能只把旧 Bundle 改扩展名。Portable v2 固定一个 Sense/Route，并以可选 `semanticDeclaration`
携带官方 Book entry 所需的稳定 Sense/Binding semantic snapshot，用于跨 Book/Route 复用 identity 和从
“我的场景”建立 Personal Meaning。只有 Registry 对精确 artifact digest 的 attestation 才能赋予声明
Sensa Official 权威；本地文件导入继续使用 Package-local identity，不能凭相同 ID 冒充官方事实。Book
排序与 membership 继续留在 Book 内嵌 Manifest，不塞回单 Sense Package。当前没有用户或已发布 Portable 制品，
因此 v2 直接取代 v1，validator 不保留双格式读取分支。

官方分发与 Catalog 已完成同一边界的闭环：`.sensa` 是唯一成员制品，`.sensa-book` 原样封装有序
membership，Registry v3 直接发布并证明整本 archive；安装事实仅同步精确 artifact identity 与来源 Book
digest，完整制品仍是可重新获取的本机缓存。旧多请求 Manifest/member 分发、consumer contract 与
对应测试夹具已经删除；设备 Runtime content 只能由通过 Portable validator 的 `.sensa` 编译产生，不能作为
第二种外部包格式直接导入。

`python3 content/tools/smoke_spoken_resource.py` 验证 provider 替换、缓存隔离、损坏检测与外部调用门控；
`tests/web/integration/speech-provider.test.mts` 验证 provider 替换、默认 Edge wire adapter、输入身份和已保存音频
合同；以上不调用真实服务。
完成本地构建后，`node --import tsx tests/web/run.mts --suite=manual --id=local-book` 在隔离内存库中验证实际包的
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

`tests/web/integration/reveal-resources.test.mts` 验证类型矩阵、来源准备、范围约束和材料计划校验；
`tests/web/integration/reveal-render.test.mts` 在 Node 中渲染真实卡片，验证有资料才显示对应区域；
`tests/web/integration/known-continuation.test.mts` 验证备份与声明已会后继续队列。它们不操控浏览器、
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

`tests/web/integration/content-agent.test.mts` 默认只使用假模型／工具，覆盖并发、修复、恢复和原图保留，纳入 `npm run check`。
人工授权后可显式设置 `SENSA_TEST_LIVE_DEEPSEEK=true` 运行 `npm run test:fast -- --id=content-agent`，
通过本地托管服务调用配置模型。该模式使用测试场景和既有缓存声音，不改用户学习数据；
结果写入被 Git 忽略的 `.sensa-local/agent-live-smoke.json`。真实模式不进入常规验证。
