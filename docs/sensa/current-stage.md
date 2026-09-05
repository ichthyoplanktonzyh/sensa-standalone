# Sensa 当前阶段与交付边界

> 状态日期：2026-09-05
> 当前里程碑：Sensa V1 Production Launch

本文是阶段、证据级别和交付边界的唯一事实来源。

## 当前结论

Sensa 已从 flashcard 仓库抽出为独立 monorepo，并完成了 pre-redesign 本地 first-user
vertical slice：独立 Postgres baseline、真实内容 Release/Book/Study Plan、Catalog、Planning、
Encounter、5D/FSRS 交接、Sync v2、React Web 外壳、Sensa IndexedDB/outbox 和本地受保护媒体
读取均已接通。

2026-08-27 已接受 Structured Acquisition 的 canonical theory：它要求新 Sense 完成跨 Encounter 的
Acquisition Cycle（Recognition、Recall、Transfer 与条件性 Boundary），Graduation 后通过 Scheduling
Handoff 初始化 FSRS；统一 Planner 支持 `mixed | review_only`，Review 失败产生一次 Memory Outcome
后进入 Relearning。2026-08-31 的 Learning Connection 决策进一步确认它是高保证协议，而不是所有
学习的唯一入口；Relearning 也不必然创建 Acquisition Cycle，只有 Structured Relearning 才创建。
同日通过 Anki/FSRS 覆盖测试进一步确认：长期记忆身份是 learner × Sense × target expression
的 Retention Target，不是 Card 或笼统的 Sense；能力证据默认分开、FSRS 调度默认共享。Relearning
不得改写原 Review，但协议声明的独立重学评价可以产生新的、可审计 Memory Outcome。
当前 production Runtime/DB/Sync contracts 尚未实现该模型，因此已有 vertical slice 是
迁移基础，不再等同于最终 V1 核心闭环。`web-next` 已新增一个不连接 production backend 的 MVP
runtime：它只消费由 Draft V2 authoring Bundle 编译并验证得到的版本化学习包 JSON，通过 Learning
Catalog 向 Learn、Review 与 Practice 投影资源；该原型用于验证学习包边界、跨 Sense 穿插、一次
Review 一次 Outcome，以及失败 Review 后由 Package 声明资源驱动的 repair、间隔重测与
Relearning Completion；它不代表 production persistence、sync 或 planner 已完成。该原型完全
为移动端形态设计：其 UI 不承诺向任何正式客户端迁移，跨端资产是领域文档、实现层 seam
形状与 smoke 规格，正式客户端以各自平台特点另行设计。

同日接受的完整产品领域边界还包括 Curriculum lifecycle、Lexical Reference、Settings/Account、
published Semantic Field、Learner Semantic Projection、Personal Content 与 Free Practice。Curriculum lifecycle 将 Study Plan 与
单一 Book 解耦，以 `active | maintenance | paused` Book Enrollment、稳定 Book Range、Supplemental
Curriculum 和不可变 Study Scope Revision 处理换词书、学习范围与收藏显式加入学习；换范围不删除
Retention Target 进度，同一 target 的多个来源必须去重。Personal Content 明确包含 Saved
Sense/Example、每个 Sense 一份 current Note、零到多个 Personal Semantic Anchors、Personal
Collection/typed Membership 与显式 Add-to-Learning Intent；这些操作彼此独立。听、说、读、写只
组织 Practice Area，具体 Activity Definition 固定 primary Area、stimulus/response channels、typed
target、资源、支架、交互、反馈与 session policy。
Lexical Reference 使用独立 Reference Release/Reference Sense，并通过 reviewed Sense Alignment 与
精选的 Sensa Sense 连接；Example 点词固定 exact Lexical Occurrence span，目标词沿 authored binding
确定 Sensa Sense，并仅在存在 Alignment 时强调 Reference Sense；其他词只在 reviewed/model-confident
时强调上下文义项。词根词缀、词源、词族和明确标记的
记忆辅助属于可选 Lexical Enrichment；查词不产生学习进度，assessment-only asset 不可暴露，产品
明确不建设“真题”。

Settings/Account 模型将 Account 与 Learner 分离，V1 保持一对一；Settings Surface 只是组合 Account、
typed Learner Preference、Device Preference、Study Plan link、Sync Health 与 Data Control 的页面，不
拥有通用 settings aggregate。口音和例句译文默认状态随 Learner 同步，autoplay/theme/playback 属于
Device；每日新学数仍属于 Study Plan。sign-out、Local Data Clearance、learning reset 与 Account
deletion 是不同意图；V1 不提供全量学习历史 reset，删除账号必须阻止旧离线 Replica 复活数据。

2026-08-28 接受的 Package 资源模型把 modality-independent Experience Sketch 与 text/image/
animation/interaction Experience Render 分离，并把 Learning Example 与其 text/static-audio/
synced-media Render 分离。Recall 的 V1 默认结果是正确 Lexeme identity：合法屈折不抹除 retrieval
成功，派生词不自动接受，句法要求的精确 form 单独反馈。standard Package 的下一版 Structured
Acquisition delivery profile 候选以至少 5 条、目标 6 条 protected novel-Transfer contexts 支持首次检验、失败后新语境重测
和长期 revalidation；MVP 已用独立 runtime JSON validator 验证这条发布投影，但 production
validator/runtime contract 仍未落地。

2026-09-05 接受的 Free Practice 模型把它确定为独立语言使用空间，而不是宽松版 Learning Protocol。
听、说、读、写是四个 Practice Area，Activity Definition 才是扩展单元；Practice Turn 可以形成
Observation、Feedback 与 optional Artifact，但 Free Practice 永不产生 Learning Evidence 或改变正式
进度/调度。Initial Free Practice Profile 仍属于 P0 之后的 Later delivery，不新增当前 launch blocker；
首期每个 Area 只开放一个 Activity：真实语流泛化、情境口语排演、语境推义和情境书面表达。Practice
Profile、Package/provider resource availability 与 Runtime/client capability 的交集决定可见入口，缺少
自由练习资源不阻止正式 Package 发布。

2026-08-31 接受的 Personal Semantic World 模型把 learner 明确创建的 Personal Meaning 确认为
personal-first 语义建构链的建模起点，而不是 Formal Learning 的全局入口。Personal Meaning 由
Meaning Focus、Personal Semantic Anchors 与 Personal Expression
Anchors 外化；LLM 通过中文语义访谈按需生成 Sense Proposal，而不是要求先从穷尽式公共 Sense 库
命中已有条目。只有 learner 明确确认才创建 stable senseId、Sense Version 与 Personal Meaning
Alignment；确认 Sense、准备学习内容、Add-to-Learning 和实际产生 Evidence 保持为不同步骤。
首版固定中文 familiar language（L1）与英语 target language（L2），长期模型保留任意 L1/L2 及一对多、
多对多表达关系。该能力现在进入 V1 P0 产品边界。

2026-09-01 完成的 Learning Connection/Policy 修订把七个问题正式分开：学习目标、learner 选择的
Learning Policy、内容来源、purpose-specific Protocol、plan readiness、Retention Target identity 与
长期 Scheduling Handoff。Learning Policy Profile、Assignment、Effective Policy 与 Resolved Learning
Plan 都是显式版本化事实；内容、Protocol、Evidence Policy 与 Scheduling Policy 保持正交。所有来源
在使用前都必须冻结为不可变 Learning Materialization。Protocol Step 负责材料角色、交互、结果资格
与转移，Card Presentation 只负责当前呈现，不是 identity、进度或 Deck。每个成功 Initial Learning
Completion 必须且只能通过记录 basis/evidence level 的 Scheduling Handoff 初始化 FSRS；每个 Retention
Target 默认最多一份 FSRS State。Review 只通过当次唯一 Memory Outcome 更新一次；Relearning 不
重新初始化、不改写原 Review，只有协议声明的独立评价可另产生 Memory Outcome。

MVP 提供两个 Learning Policy Profile：内部可描述为 Anki-like 的 `lightweight`，以及 Sensa 自有的
`high_assurance`。前者组合 Lightweight Initial Learning、learner-rated/simple Retention Review、
Lightweight Relearning 与 FSRS；后者组合 Structured Acquisition、evidence-oriented Retention Review、
targeted/Structured Relearning 与 FSRS。Study Completion 不能冒充 Gate、5D、Learning Evidence 或
mastery；Acquisition Graduation 也不表示永久掌握。Semantic LLM、Learning Content LLM 与未来
Grading LLM 仍是不同角色。

MVP 同时固定 target-level Policy 的提交边界：Add-to-Learning 后、第一次正式 Protocol Run 创建前，
learner 可以为每个 target 独立修改学习方式并重新解析 readiness；首次 Run 创建时形成 Committed
Learning Policy，此后目标页面只读展示该方式。MVP 不提供 Learning Policy Migration，也不能通过
修改默认方式、新增来源、删除后重加或新增内容静默改变已经进入 Runtime 的 target；未来迁移必须
显式建立新 Assignment/Commitment/Plan revisions 并保留所有历史 Runtime 与 FSRS 事实。

Formal Learning 同时确认为独立产品链：Book membership、Catalog/search/direct stable-Sense selection、
reviewed Alignment 后的 Contextual Lookup，以及 confirmed Personal Meaning Alignment 都可以提供入口，
并在 Learning Target 处汇合。用户无需先创建 Personal Semantic World；direct/Book learning 不创建
Personal Meaning，personal-first 也只有显式 Add-to-Learning 才进入 Curriculum。入口来源只保存
Learning Entry Provenance，不改变 Retention Target identity 或 Learning Policy。

MVP 的 personal-first/开放长尾路径默认使用 `lightweight`：以中文 L1、英语 L2 和按需 AI 生成的紧凑
内容快速形成可执行 Materialization，因为它需要的资源最少。该默认不是永久领域绑定；只有当前
target 已具备 Structured required assessment、protected novelty、grader 与 runtime capabilities 时，
`high_assurance` 才可显示为 ready。否则必须 unavailable/blocked，不得静默降级。Published Package
与资源完备的 Book/direct target 可以同时支持两个 Profile。

当前 MVP availability baseline：

| Learning Entry | `lightweight` | `high_assurance` | 主要内容路径 |
| --- | --- | --- | --- |
| Published Book/Package | compact roles 可执行时 ready | Structured inventory 完整时 ready | Published 或 Hybrid |
| Direct existing stable Sense | Published/On-demand 可满足时 ready | 仅完整 Structured capability ready | Published、On-demand 或 Hybrid |
| Confirmed Personal Meaning Alignment | 默认选择；按需生成后 ready | 默认不提供；只有完整 Structured capability 才 ready | On-demand AI 优先，可 Hybrid |
| 未对齐 Reference Sense / 裸表达 | 不是合法 Learning Target | 不是合法 Learning Target | 必须先解析 stable Sensa Sense + binding |

其余上述扩展已经完成 canonical modeling，但尚未改变当前 V1 P0 launch scope。

当前独立本地 Book 选择了 **438 个 Sense、249 个 Lexeme**。pre-redesign Executable Learning
Capability Resolver 实测其中 **424 个 Package 可执行**；另有 14 个仅持有 V1
Manifest 的 legacy Package 声明了 `boundary_formation`，却没有 required boundary target
或可判分的 Contrast/Counterexample，因此按当前门禁不可执行。这些数据是迁移和首位用户
验证库存，不是首版 Personal Semantic World → On-demand Lightweight Study 的内容门槛；若作为
Structured Acquisition 内容发布，仍须由下一版 validator 证明 Recognition、Recall、novel Transfer
与 required Boundary 的完整 Gate capability coverage。

## 证据级别

- 已有真实本地 first-user vertical slice 与真实 Postgres/浏览器 smoke；
- 自动化检查只证明契约和实现可以运行；
- 尚无足够的真实用户、多 session、留存或学习效果证据；
- 不把历史实验中的比例、时长和阈值当作实证结果。

## V1 必须保留

中文 L1/英语 L2 的 Personal Semantic World、显式 Personal Meaning 创建、LLM Sense Construction、
learner confirmation、stable Sense/Version 与 Personal Meaning Alignment；Learning Target/Retention Target、Published/
On-demand/Hybrid Content Provisioning、不可变 Learning Materialization、独立 Learning Content LLM
角色；不依赖 Personal Semantic World 的 Book/Catalog/search/aligned-lookup direct learning entry、显式
personal-first bridge 与 Learning Entry Provenance；`lightweight | high_assurance` 两个 MVP Learning Policy
Profiles、Assignment/Effective Policy/Resolved Learning Plan 与 purpose-specific readiness；三种 Protocol
Purpose、Protocol Step/transition、Card Presentation renderer、Lightweight Initial Learning、Structured
Acquisition、Initial Learning Completion/Study Completion/Acquisition Graduation、原子 Scheduling Handoff
与 basis/evidence-level provenance、轻量/高保证 Retention Review、Lightweight/Structured Relearning 与
Relearning Completion；真实
认证、持久化、Books/Study Plans、Learner Sense Progress roll-up、Mixed 与 Review-only Session、
protocol-aware Unified Planning、due Review 的 one-outcome/one-FSRS-update 与可审计 Relearning Outcome、真实
Account/Account Session、typed Learner/Device Preferences、Sync Health、
Data Export/Account Deletion、离线 resurrection barrier、Sync、媒体、部署、监控和可解释错误。

首发可以暂不提供动画、视频和生成视觉媒体。V1 明确不交付影视剧、电视或 YouTube 原声
Attested Usage、synced-media Example Render、词级媒体 timeline 及相应外部媒体消歧/授权生产链；
这些对象不进入 V1 Required Asset Manifest 或验收承诺。V1 同样不设置 Listening Gate，现有
pronunciation/example static audio 只作为呈现资源，不产生听觉毕业 Evidence。Published Book 若进入
首发，仍必须使用真正可学、经过质检的 Sense 内容，不能用词头、短释义或空 Sense 凑数；但既有
Package 数量与 1,000 Lexeme 库存目标不再是 Personal Semantic World 首版闭环的前置门槛。

## 当前不声称完成

新的 Learning Connection/Retention 模型尚未落地到 production Runtime、Postgres 或 Sync；现有
`web-next` 简化 MVP runtime 主要模拟 Structured Package 流程，尚未实现正式 On-demand
Materialization、Protocol Purpose/Step、Lightweight Initial/Review/Relearning Protocol、Initial Learning
Completion、Scheduling Handoff 或基于 evidence level 的 FSRS 初始化与更新，也尚未实现两个 Learning
Policy Profiles、Assignment/Effective Policy、Resolved Learning Plan readiness、Learning Entry Provenance
或独立于 Personal Semantic World 的完整 direct-learning intake。
Structured Acquisition 模型也只落地到该 MVP runtime 与确定性 smoke，尚未落地到
production Runtime、Postgres 或 Sync；MVP validator 也不是 production release validator。本地构建
尚未等同公网部署。真实 Cognito、Neon、R2、Cloudflare、CI/CD、监控/telemetry 和公网
数据删除/恢复仍是上线工作；Flutter iOS/Android/桌面端在 Web/API 契约稳定后实施，
正式移动端与桌面端共用同一 Flutter client，正式 Web 端继续 React 并按 Web 平台
特点另行设计。Sensa 尚未有
真实效果证据。Personal Semantic World 的 Personal Meaning/Focus/Anchors、Sense Construction
Session/Proposal/confirmation、按需 Sense identity/version 与 Alignment 同样尚无 production
persistence/API/Sync/LLM policy/validator 或真实体验证据；`web-next` 当前页面只能视为交互原型。
完整 Book Enrollment/Range、Supplemental Curriculum、Study Scope Revision、Semantic Field、
Personal Collection、Add-to-Learning、Learner Semantic Projection enrichment 与 Free Practice 同样
尚无 production persistence/API/Sync/validator 或真实体验证据，
Reference Release/Reference Sense、Sense Alignment、全句 Lexical Occurrence annotation、Contextual
Sense Resolution、Lexical Enrichment 与 Contextual Lookup API 同样尚未实现。当前内容生产使用的
冻结词典 evidence 只是筛选 Sensa Sense 的 authoring input；现有 Example 只保证 target span，不能从
不背复刻中的 token regex、静态词表或多 tab UI 推断为真实上下文词典。

Experience Render capability、protected Transfer pool 新门禁、Lexeme-identity Recall grading 与
对应 repair/retest contracts 同样尚未实现。影视/电视/YouTube Attested Usage、词级媒体 timeline
与 synced-media Example Render 属于 V1 之后的候选能力，不应出现在 launch blocker、V1 素材配额
或完成度声明中。

动态 Interaction Render 的方向已经确定为 Sensa-owned、A2UI-inspired 的声明式合同：预先作者化
与未来实时 AI synthesis 共用同一 Contract、closed Interaction Catalog、Validator 和客户端
renderer，并按 provenance、review status 与 Evidence eligibility 分级。该动态交互方向目前只保留为
设计决策，不进入当前 V1 实施范围。V1 的 On-demand Learning Content 可以生成普通文本、静态场景
和紧凑练习，但不建设流式动态 UI、capability negotiation 或动态交互协议。未经审核的 runtime
Render 默认不能产生 Gate pass 或 Learning Evidence。

Initial Free Practice Profile 同样尚无 production Profile/Manifest/provider capability/Inventory、
Session/Activity persistence、API、Sync、YouGlish integration、voice capture、ASR、AI feedback、renderer
或真实体验证据；其四种 Activity Definition 是已接受的未来首发范围，不是已实现功能或当前 P0 验收项。

Settings/Account 的完整 production contract 同样尚未完成：当前 `/me` 仍混合 profile、
`selectedWorkspaceId` compatibility seam 与单一 `reviewReactionAnimationsEnabled`，没有 Account
lifecycle/Session management、typed Learner Preference revision、明确的 Device Preference、Sync
Health、Local Data Clearance、Data Control Request 或 deletion barrier。真实 Cognito 与数据导出/删除
仍是 launch work，不能用本地 auth、清空 IndexedDB 或一个 profile response 冒充完成。
