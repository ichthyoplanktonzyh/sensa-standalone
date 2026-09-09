# Sensa 当前阶段与交付边界

> 状态日期：2026-09-09\
> 当前阶段：领域与行为原型验证后期，生产应用建设前期\
> 下一里程碑：Flutter 原生单设备本地学习库；旧 Web/API/浏览器插件作为迁移与回归基础\
> 当前执行位置：本地底座 LF-0 蓝图与 LF-1a 共用结算已完成，LF-1b 的 Flutter → Rust → SQLite 首学技术纵切已在 macOS/Android 验证，完整 LF-1b 继续实施；以下为旧架构证据：M0 设计已验收；M1-A/B/C/D/E 本地纵切已验证；托管验收待执行，M2-A/B 采集/直接语义接受本地切片已验证，M2-C 文本内容入学纵切已验证，Web 澄清/可恢复移除已验证，M2-D 原账号/版本及原生权限恢复已验证，原文授权与撤销本地纵切已验证，静态音频生成/解析与失败回退本地已验证，Chrome 151/152、实际进程恢复及有限真实质量抽查已有本地证据；M1/M2 已确认 Web 界面接入与简化页面删除完成本地验证，等待 owner 体验；云端/商店按 owner 要求暂缓\
> 执行路线图：[production-migration-plan.md](production-migration-plan.md)

本文是项目阶段、证据级别和近期交付范围的唯一事实来源。[文档索引](README.md)列出的七份
领域文档裁决身份、所有权和不变量；[PRD](product-requirements-v1.md) 裁决产品 IA 与用户语言；
路线图负责工作顺序、依赖和验收门。阶段变化不重定义领域对象，原型能力不自动成为生产承诺。
具体协作方式遵守 [开发工作约定](development-workflow.md)：全局结构先规划，每条用例先与
owner 确认前端体验，再细化合同并纵向实现；该方式可根据实际开发反馈调整。

## 1. 当前判断

2026-09-09 最新确认：[三端本地与共同事实模型](../adr/0003-three-client-local-facts.md) 已接受，替代下文历史记录中 Web 终局未定的范围。先建立事实模型并开始分层校验，继续原生迁移，再改造 React/TS Web 本地执行，最后完成真实三端/E2EE 验收；不会等 Web 完工才开始模型校验。本轮有界 G0 模型实验已通过乱序/重复、因果缺失、语义冲突及共同 Handoff 下的并发 Review 分类，见 [范围与证据](personal-library-fact-model.md)。尚非生产同步、完整调度收敛或 M3 完成；下一原生用例仍是 Anchor Use。

LF-1b 后续增量已接入有界轻量文本包导入、逐目标显式入学、选择/暂停恢复与每日新学上限。完整发布包/媒体仍未完成；导入平台证据见 [本轮记录](native-pack-import-handoff.md)。

2026-09-08 本轮范围修订：四阶段只作内核扩展性验证，正式材料/UI 暂停，不作为当前迁移完成前置。
改为优先高保证；fresh/repair Step 选择与通用账本组合已推进，见 [高保证迁移记录](native-assurance-orchestration-handoff.md)。首学队列、辅助回想规则、撤销及快照恢复的纯内核迁移已完成，见 [生命周期记录](native-assurance-lifecycle-handoff.md)；复习/重学纯生命周期及 effect 对照也已完成，见 [复习队列记录](native-assurance-review-handoff.md)；正式材料/评价/SQLite 事务/Flutter 已接入，并完成 Profile 到执行器的真实连接验收，见 [完整纵切记录](native-assurance-integration-handoff.md)。

2026-09-08 历史确认（Web 终局已由上文 ADR 0003 更新）：原生 PC/移动是主产品；Web 保留已有成果、暂停新增建设，是否开放以后决定。原生迁移必须完整承接现有 Web 功能、状态及学习内核扩展机制，不能把首发或技术验收范围当成最终范围。同步优先原生设备并保留 E2EE，Web WASM/互通不是当前前置条件。

2026-09-09 在线语义协作增量：原生在线解析/可选 Focus 澄清、候选本地恢复和新 Sense 明确接受已接入，见 [交付记录](native-semantic-resolution-handoff.md)。个人意义显式入学、按需文本任务、独立校验/本地材料冻结与现有 Profile 学习已在 [后续交付](native-provisioning-handoff.md) 验证；候选本身仍不能直接标为可学习。下一项为原文 Anchor Use 授权/撤销及材料替换。完整迁移与 M3 仍未完成。

2026-09-09 个人语义世界增量：本机文本捕获/收件箱、已有 Sense 的直接接受、可选 Focus、移除恢复与显式入学已接入，见 [本轮记录](native-personal-world-handoff.md)。在线澄清/新 Sense 构造已在后续纵切接入；多模态、图谱、采集 transport 等继续保留；完整迁移与 LF-1b 未完成。Policy Migration 经源盘点确认为未来蓝图能力，区别于已有 TS 待迁移项。

本轮已将三种轻量 purpose 的纯推进/结算、可配置 FSRS 与历史重建迁入 Rust，并接回现有本地首学事务；见 [内核迁移记录](native-kernel-migration-handoff.md)和[完整性清单](native-migration-checklist.md)。轻量复习/重学的本地事务及 Flutter 等待/恢复已接入，见 [复习迁移记录](native-retention-handoff.md)；通用策略注册/Progression Kernel 的纯接口与组合校验已迁移，见 [进度内核记录](native-progression-handoff.md)；Policy Assignment、purpose plan/readiness 与首次 Run 固定已接入本地，见 [策略迁移记录](native-policy-handoff.md)；通用 Observation/Decision/Checkpoint 账本已接入原生 consumer，见 [账本迁移记录](native-progress-journal-handoff.md)；四阶段编排纯内核及快照恢复已迁移，见 [四阶段记录](native-four-stage-orchestration-handoff.md)；高保证的结构化材料、评价/事务适配和 Flutter UI 已贯通，Profile 执行连接已验证；正式 Activity/Mixed、每日 Introduction、签到和近期记录/去重汇总已贯通，见 [活动交付记录](native-activity-integration-handoff.md)；完整 Curriculum/范围选择仍待迁移；Policy Migration 保留为未来蓝图；四阶段正式材料/UI 按本轮 Owner 指示暂停；完整 LF-1b 未完成。

2026-09-08 Owner 已确认转向[完整本地学习库＋可选端到端加密同步](../adr/0001-local-library-optional-encrypted-sync.md)，
允许服务器保存密文副本，并提供可下载资源和按需在线服务。状态是“迁移已启动，共用结算提取与回归已通过；整库/客户端尚未切换”。
下述 Postgres 权威、本地只存意图/投影、服务器专属结算及账号前置等描述属于现有实现和旧交付基线；
后续实施前需按新方向修订，不能把当前本地缓存视为独立学习库或端到端加密同步已经完成。
浏览器体验优化本轮已结束，后续清单继续保留；当前按 [本地学习库迁移蓝图](local-library-migration-blueprint.md)推进 LF-0/LF-1a：明确数据归属与迁移用例，并将既有 API 结算规则迁入平台无关 Kernel。[LF-1a 交付与验证记录](local-settlement-handoff.md)已完成。当前实施 LF-1b 单设备学习库的首个原生技术纵切，语言和职责按 [ADR 0002](../adr/0002-flutter-rust-local-core.md)。Flutter 界面以正式 Web 已确认的页面与行为为参考，针对桌面/移动重新实现。首学 SQLite 事务、macOS 独立进程恢复及 Android 飞行模式下首学/独立进程恢复均已验证，见 [原生纵切记录](native-local-learning-handoff.md)。一般资源导入、完整复习/重学、备份恢复和加密同步均尚未验收，不能将这个合成材料验收壳视为完整 LF-1b 或产品 UI 已交付。

2026-09-08 owner 体验发现：此前 M1/M2 简化页面没有完整沿用已确认 UI，历史功能验证
不能替代界面验收。本轮已将已实现链路接回既有首页、学习/账号/目录及 Runtime 组件，
并删除简化页面，见 [界面接入记录](m1-m2-ui-integration-handoff.md)。最终体验由 owner
继续走查。云端部署与商店发布已明确暂缓，不作为继续本地开发的阻塞项。

Sensa 已具备开始生产化的领域、行为和工程基础。当前最主要的工作，是让最新领域模型、正式
客户端、服务端持久化与同步成为同一条真实闭环。正式 UI 需要按平台设计，消费契约、数据库
映射、服务端业务执行及运行保障仍需建立或迁移。

2026-09-07 原工作树的 apps/web 桌面/手机 UI 重构已存入本地 checkpoint `5fee636e`，
具体范围与代码观察见 [M0-2 基线说明](m0-2-first-learning-state-spec.md)。下述旧纵切仍是工程基础，
新 UI 的 previewStorage/checkpoint 不能冒充生产 API/Sync 接入。

当前仓库存在进度不同的实现：

- apps/sensa_native + crates/sensa-core/sensa-library：新架构下的 Flutter/Rust/SQLite 首学技术验收壳；范围与验证见 [原生纵切记录](native-local-learning-handoff.md)，不能等同完整学习产品。

- apps/web + apps/api：保留较早 first-user 纵切；正式 production 入口已完成 M1-A–E 的
  consumer-v1/Sync v3、Postgres、账号独立 IndexedDB/outbox、目标准备、首学、复习、
  重学与签到本地闭环。旧 preview 和 Sync v2 路径不能代替该入口的验收；真实托管仍待验证。
- apps/web-next：移动端形态的 React 行为原型，更贴近当前领域模型，已实现两条核心旅程及
  多种学习策略、内容供给和 Runtime 行为。主要学习与个人语义状态仍由本地原型存储维护，
  尚未接通正式 API/Postgres/Sync。其 UI 不承诺迁入任何正式客户端。

不能按页面数量估计上线完成度，也不能将两套实现的功能简单相加。当前尚未进入真实用户
测试版的稳定性收尾阶段；接下来需要完成首条生产闭环，再验证持续使用与恢复能力。

## 2. 已有资产及证据边界

| 层面 | 已有资产 | 当前证据边界 |
| --- | --- | --- |
| 领域模型 | 七份领域文档定义语义身份、学习连接、内容资源、Runtime、Account 与数据控制 | 核心模型基本稳定；不代表所有生产用例合同和事务边界已落实 |
| IA 与旅程 | PRD 已定义导航、页面职责和状态要求；web-next/journeys 冻结两条主旅程 | 原型叙事可复用；正式 Web 布局、组件、失败与恢复体验仍须设计和验收 |
| 行为原型 | Personal Semantic World/Intake、独立学习、轻量与高保证路径、Review/Relearning、学习记录及练习入口 | 证明原型行为与确定性场景；不证明生产状态、真实练习服务或学习效果 |
| 共享合同与内核 | Learning Connection v2、Content Demand/Task/Attempt/Bundle、Protocol、Completion/Handoff、Progression Kernel 与扩展 seam | 已有可执行 schema 和 smoke；生产 API、DB 与 Sync 需要逐项对齐 |
| 数据库 | baseline、0008–0010 领域结构及 0011–0015 consumer 账号/目标/Runtime/签到迁移 | 0001–0015 已在全新隔离 Postgres 应用并完成 A–E 事务验证；托管数据库待验收 |
| API 与同步 | M1 consumer API、私有材料、正式 React Web 账号独立 IndexedDB/outbox 与 Sync v3，旧路径并存 | A–E 本地浏览器与 Node/Deno 闭环通过；M2/M3 全部事实及真实托管尚未验收 |
| 内容与 LLM | 内容编译/校验工具、版本化原型学习包、Semantic Agent 开发代理、Content Agent 与模型适配 seam | 开发接入和无成本校验已存在；持久任务、独立校验及有预算的恢复已有本地证据；授权资源与生产质量验收仍待完成 |
| 运行环境 | Supabase Postgres/Auth/Storage 为主，Cloudflare 前端托管和 Resend 邮件的已确认选型；Edge 入口与本地 CI 检查已提供 | 真实云端配置、部署、邮件和 Storage 验收仍缺证据；本地合成认证不等于托管认证通过 |

需要特别处理的实现差异：

- [Learning Connection 合同](../../packages/contracts/src/sensa/learningConnection.ts)已为 v2，
  而 [0010 迁移](../../db/migrations/0010_sensa_learning_connection_v1.sql)仍是较早的 v1
  持久化形状。例如 Target 间的引用方向尚未对齐，必须在新用例合同下设计迁移，不能把已有
  SQL 当作最终 schema。
- M1 consumer 的 Retention Target、Protocol Run/Step、Completion/Handoff、Memory State/Outcome
  已形成独立权威持久化闭环；旧 Sense/Encounter API 仍是兼容基础，不参与正式新入口结算。
- web-next 的 localStorage、fixture target 和「毕业后立即到期」等走查安排必须在生产接入时
  明确替换。真实调度时间、Evidence、Outcome 和 FSRS 由服务端决定。

既有本地内容纵切曾记录 438 个 Sense、249 个 Lexeme，其中 424 个 Package 通过当时的
可执行性检查，14 个 legacy Package 未满足 boundary 能力要求。这是历史迁移库存记录，本次
未重新核对数量；不能据此宣称符合新高保证发布标准，也不作为个人语义轻量路径的上线配额。
可重建内容源与媒体继续按 [content/README.md](../../content/README.md) 管理，生成数据与运行
媒体保持在 Git 之外。

## 3. 下一里程碑的交付范围

2026-09-05 的生产化规划采用以下交付顺序：先以 React Web 和轻量学习完成受邀测试闭环，
随后依据稳定性与用户证据扩展。该顺序解决此前「V1 必须保留高保证」与 PRD Later 分类的冲突；
高保证仍属于产品与领域模型，当前受邀测试版不要求交付它。

同轮产品讨论明确将浏览器采集插件列为必交特色功能，其余已确认清单按当前建议推进。
完整产品清单、插件边界与状态矩阵见
[首轮产品基线](first-round-product-baseline.md)。浏览器支持及安装更新方式在详细设计中核实，
实施默认先以桌面 Chrome 为目标；其他系统采集端口继续后置。

### 必须交付

| 能力 | 受邀测试版要求 |
| --- | --- |
| 客户端与语言 | 正式 React Web，适配桌面与手机浏览器；中文 familiar language、英语 target language |
| 账号 | 真实 Supabase Auth 认证、Account ↔ Learner 1:1、当前 Account Session、受邀访问边界与安全退出 |
| 独立学习入口 | 从最小可用的已发布 Book/Catalog 选择 stable Sense 与 expression binding；不要求先创建 Personal Meaning |
| 个人语义入口 | 先保存 Intake/收件箱材料，按需澄清；完整 Context–Expression–Sense 经合法 Semantic Acceptance 后形成 Personal Meaning 与 Alignment，再显式加入学习 |
| 浏览器采集插件 | 用户主动选取网页文字与上下文，预览固定来源和 occurrence；可在原位解析/确认完整意义或存入收件箱，在同账号 Web 继续并显式加入学习 |
| 学习目标与策略 | Learning Target/Retention Target、入口 provenance、lightweight Policy Assignment/Effective Policy、readiness，以及首次 Run 的 Policy commitment |
| 内容供给 | 可用 Published 路径及个人语义所需 On-demand 路径；固定 Demand，校验后冻结 Materialization，保留来源、版本和 digest；Hybrid 按真实需求接入 |
| 正式学习 | Mixed/Review-only、每日新学额度、轻量 Initial Learning、Study Completion、原子 Scheduling Handoff、到期 Review 与 Lightweight Relearning |
| 学习事实 | 服务端权威进度与最小学习记录、下一次复习信息；primary Retention Target 的 Declared Mastery 与复习结果保持独立 |
| 媒体与设置 | 可用的发音/例句静态音频及授权读取；已开放的 Learner Preference 版本化同步，Device Preference 留在本机，缺少可选资源时诚实呈现 |
| 离线与恢复 | Sensa IndexedDB/outbox、新对象 Sync、Sync Health、刷新/重试/断网恢复及第二设备收敛 |
| 数据控制 | 幂等导出、账号删除、pending-safe 退出/本机清除、Session/Replica 撤销，以及阻止旧离线 outbox 复活已删除数据 |
| 上线保障 | CI/CD、云端授权配置、错误与使用漏斗监控、内容生成预算、备份恢复、回滚及受邀测试操作说明 |

个人语义确认、加入学习、内容准备和正式 Runtime 保持不同事实。快轨或受委托确认仍须满足
领域规定的明确授权；模型输出本身没有提交语义身份、Curriculum 或学习进度的权力。
Book/direct/personal 来源汇合到同一 Target 边界，同一学习连接不因重复提交或多来源建立重复调度。

2026-09-07 owner 明确：首发允许开放自由练习、词典、统计和签到；允许开放不等于已生产验收，
不自动扩展到全部 Activity、词典资源、复杂诊断或激励。保留现有笔记与场景编辑体验。
首轮只开放真实具备资源、服务端合同和客户端支持的能力。M0-1 已记录页面职责、操作清单及
基准状态，M0-2 已补齐体验规格，M0-3 已固定消费合同设计。首次使用不强制选词书；首次须明确确认每日新学数量后才能开始，目标就绪后回首页开始（9 月 7 日确认）；未交付主入口隐藏；签到沿用我的学习按钮/日历，手动或开始正式学习触发，按账号时区去重；首版无连续天数、奖励或补签，签到和练习不产生正式 Evidence、进度或调度；仅开放轻量学习时不显示无实际选择的 Policy 选择器。

### 后续交付，不阻塞当前受邀测试版

- high_assurance/Structured Acquisition、Gate/5D 诊断、完整 protected assessment inventory
  与高保证 validator；第三个架构验证 preset 不构成生产承诺。
- Free Practice 尚未具备执行条件的 Activity、provider、录音/ASR/反馈链扩展；练习资源缺失不阻止正式
  学习内容发布，练习不能写正式 Evidence、进度或调度。
- 词典已允许首发开放；宽覆盖资源、完整离线 Release、Sense Alignment、Lexical Enrichment、
  Semantic Field 与更完整的语义投影。
- 完整 Book Enrollment/Range/Scope lifecycle、个人 Collection、Bookmark/Note 管理及扩展历史
  体验；首轮仍须实现独立入口和 personal-first 加入学习所必需的最小 Curriculum 事实。
- Flutter iOS/Android/桌面单一客户端；在 Web/API 合同稳定后实施，不作为 Web 测试版前置条件。
- Learning Policy Migration、通知提醒、高级主题、设备会话列表，以及浏览器文字插件之外的
  图片/语音、移动分享、桌面全局采集和更多浏览器覆盖。

当前不建设 Cards/Decks、generic flashcard sync、Workspace 产品导航、通用 AI/MCP、社区、
commerce、admin 或考试「真题」。真实语流 YouGlish 保留在自由练习；正式学习的影视/电视/YouTube 原声例句生产链、词级媒体 timeline、动态生成
交互 UI、Listening Gate 和全量学习历史 reset 均不属于当前交付范围。

## 4. 架构与迁移约束

- Postgres 是服务器权威存储。客户端持久化用户意图与只读投影，local-first 写入经 outbox
  push → pull 收敛；客户端不权威写入 Evidence、5D、Outcome、进度或 FSRS。
- 保留 LearnerScope 作为授权与同步 seam。生产身份与数据隔离不得依赖原型 learner 或本地
  auth；Workspace 不成为用户功能。
- Semantic LLM 与 Learning Content LLM 分别固定输入、工具、policy、预算、输出和审计。
  Runtime 消费不可变 Materialization，不在作答后重新生成题目、答案或评分依据。
- 浏览器插件与 Web 共用账号和 Semantic Intake authority；采集队列绑定原账号，处理幂等、
  pending、重启恢复、撤销和删除屏障。插件不构建独立词义库存，也不持有模型密钥或学习调度权威。
- 每个 Retention Target 默认最多一份 FSRS State；Initial Completion/Handoff 原子且幂等，
  一个 due Review 最多一次 Memory Outcome/FSRS 更新。Relearning 不重新初始化或改写原 Review。
  协议声明的独立重学评价若进入实施范围，必须有独立、可审计、幂等的 Outcome。
- 正式 Web 保持 React；Flutter 共享语言无关合同与场景规格，不复制服务端策略或调度权威。
  apps/web 作为现有正式 Web 工程起点，按用例改造；web-next 保留为行为参考与回归来源。
- 原型与 first-user 学习记录是可丢弃测试数据。迁移/重建须有明确方案，不静默重解释旧事实；
  受邀用户开始产生真实数据后，升级必须保护其历史与待同步操作。
- 所有服务商的资源与部署变更通过 CI/CD 交付，不从本地 shell 部署。

## 5. 验证记录与完成标准

2026-09-05 基于提交 af5522cd 的仓库评估实际通过：

- 根级 npm run typecheck、npm run build、npm run lint；其中 lint 当前复用类型检查。
- npm run sensa:web-next-smoke 的全部 23 个子任务，以及 sensa:runtime-learning-smoke。
- Personal Semantic World、Learning Extensibility、Learning Content、DeepSeek mock transport、
  Protocol Progression 和 Sync Protocol 的专项 smoke。
- Python 内容工具编译与无成本 pipeline smoke。

构建仍提示 web-next 主 JS chunk 较大；正式 Web 应有自身性能预算。上述验证没有执行数据库
迁移、真实多设备浏览器闭环、公网部署或付费 LLM/TTS 调用，不能将 schema/smoke 通过写成
生产集成完成。历史本地 Postgres/浏览器纵切证据也不替代新模型验收。

下一里程碑只有在以下结果均有证据时才算完成：真实受邀用户可创建或选择目标并完成学习；
浏览器插件可安装、采集并将同一意义或收件箱材料交接到 Web；
离开后再次登录、跨日或换设备可继续；记录与调度正确；内容、网络或同步失败可恢复；账号
退出、导出和删除有效；服务可观测、可回滚并完成备份恢复演练。完整门槛见路线图 M1–M4。

当前没有足够的真实用户、多 session、留存或学习效果证据。受邀测试首先验证可用性、可靠性、
内容质量与持续使用，不能把 Study Completion、签到、点击量或测试通过率解释为学习效果。

## 6. 阶段维护

M0-1 产品范围已记录；M0-2 [登录与首条轻量学习状态规格](m0-2-first-learning-state-spec.md)
及 [插件规格](m0-2-browser-capture-state-spec.md)已完成规格验收。当前没有待 owner 裁决的
产品范围问题；组件、异常、恢复和工程验收要求已落文档，真实浏览器/服务验证仍在后续阶段。
M0-3 [消费合同](m0-3-consumer-contract.md)、[迁移蓝图](m0-3-migration-blueprint.md)与
[施工验收](m0-3-delivery-plan.md)已完成设计审阅，M0 设计门已验收。M1-A 登录、数量与空首页已完成本地纵切，
SQL 迁移、数量 Sync v3、Node/Deno 与 Chromium 测试已有证据，详见
[交付记录](m1-a-account-handoff.md)。真实 Supabase 邮件登录、托管 Edge 与公网验证待执行，
M1-A 尚未完成生产验收；M1-B 目标加入/准备、私有材料与已会声明已完成本地纵切，
包括已授权的 DeepSeek/edge-tts 小样本，见 [M1-B 记录](m1-b-target-handoff.md)。
M1-B 的生产发布/Storage 仍待验收；M1-C 首学与结果确认本地纵切已完成，见
[首学交付记录](m1-c-initial-handoff.md)。M1-D 到期复习与重学已完成本地纵切，见[交付记录](m1-d-retention-handoff.md)。M1-E 签到与恢复验收也已完成本地纵切，见[交付记录](m1-e-checkin-handoff.md)。A–E 本地施工齐备，真实托管验收仍待执行，下一产品施工阶段为 M2。
每次里程碑验收后，同步更新本文的执行位置与证据，以及路线图状态。
具体任务、验收记录和未解决问题由路线图追踪；本文不再累积逐日原型功能日志。

2026-09-07 首条旅程离线范围确认：可继续已授权且材料已下载的学习，不离线新建学习；
本机回答与服务端确认结果分开呈现，具体授权/版本/恢复合同已在 M0-3 固定，实施待 M1。
