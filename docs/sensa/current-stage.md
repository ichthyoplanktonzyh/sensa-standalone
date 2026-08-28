# Sensa 当前阶段与交付边界

> 状态日期：2026-08-28  
> 当前里程碑：Sensa V1 Production Launch

本文是阶段、证据级别和交付边界的唯一事实来源。

## 当前结论

Sensa 已从 flashcard 仓库抽出为独立 monorepo，并完成了 pre-redesign 本地 first-user
vertical slice：独立 Postgres baseline、真实内容 Release/Book/Study Plan、Catalog、Planning、
Encounter、5D/FSRS 交接、Sync v2、React Web 外壳、Sensa IndexedDB/outbox 和本地受保护媒体
读取均已接通。

2026-08-27 已接受新的 canonical learning model：新 Sense 必须先完成跨 Encounter 的
Acquisition Cycle（Recognition、Recall、Transfer 与条件性 Boundary），Graduation 后才初始化
FSRS；统一 Planner 支持 `mixed | review_only`，Review 失败产生一次 Memory Outcome 后进入
Relearning。当前 Runtime/DB/Sync contracts 尚未实现该模型，因此已有 vertical slice 是迁移
基础，不再等同于最终 V1 核心闭环。

同日接受的完整产品领域边界还包括 Curriculum lifecycle、Lexical Reference、Settings/Account、
published Semantic Field、Learner Semantic Projection、Personal Content 与 Free Practice。Curriculum lifecycle 将 Study Plan 与
单一 Book 解耦，以 `active | maintenance | paused` Book Enrollment、稳定 Book Range、Supplemental
Curriculum 和不可变 Study Scope Revision 处理换词书、学习范围与收藏显式加入学习；换范围不删除
learner × Sense 进度，同一 Sense 的多个来源必须去重。Personal Content 明确包含 Saved
Sense/Example、每个 Sense 一份 current Note、零到多个 Personal Semantic Anchors、Personal
Collection/typed Membership 与显式 Add-to-Learning Intent；这些操作彼此独立。听、说、读、写只
组织 Practice Mode，具体 Task 由提示通道、响应通道、target capability 与 support level 定义。
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
成功，派生词不自动接受，句法要求的精确 form 单独反馈。standard Package 的下一版 V1 delivery
profile 以至少 5 条、目标 6 条 protected novel-Transfer contexts 支持首次检验、失败后新语境重测
和长期 revalidation；这仍需新 validator/runtime contract 落地。

同日接受的 Initial Free Practice Profile 属于 P0 之后的 Later delivery，不新增当前 launch blocker。
它首次只承诺沉浸刷词、随身听、听写和随手拼写；支持 Reading/Listening/Writing，不提供 Speaking、
发音评分、开放造句、AI 对话、自动薄弱项处方、novel Transfer/Boundary assessment 或影视/YouTube
原声。Practice Profile、Package Practice Manifest 与 Runtime/client capability 的交集决定可见入口，
缺少自由练习资源不阻止正式 Package 发布。

这些扩展已经完成 canonical modeling，但尚未改变当前 V1 P0 launch scope。

当前独立本地 Book 选择了 **438 个 Sense、249 个 Lexeme**。pre-redesign Executable Learning
Capability Resolver 实测其中 **424 个 Package 可执行**；另有 14 个仅持有 V1
Manifest 的 legacy Package 声明了 `boundary_formation`，却没有 required boundary target
或可判分的 Contrast/Counterexample，因此按当前门禁不可执行。这些数据是迁移和首位用户
验证库存，不是公开内容门槛；即使 424 个通过 V3，仍须由下一版 validator 证明 Recognition、
Recall、novel Transfer 与 required Boundary 的完整 Gate capability coverage。

## 证据级别

- 已有真实本地 first-user vertical slice 与真实 Postgres/浏览器 smoke；
- 自动化检查只证明契约和实现可以运行；
- 尚无足够的真实用户、多 session、留存或学习效果证据；
- 不把历史实验中的比例、时长和阈值当作实证结果。

## V1 必须保留

真实认证、持久化、Books/Study Plans、Learner Sense Progress、Acquisition Cycle/Gates、
Mixed 与 Review-only Session、四类 Unified Planning inventory、interference pacing、
Graduation 后 FSRS initialization、due Review 的 one-outcome/one-FSRS-update、Relearning、
5D Evidence/State、真实 Account/Account Session、typed Learner/Device Preferences、Sync Health、
Data Export/Account Deletion、离线 resurrection barrier、Sync、媒体、部署、监控和可解释错误。

首发可以暂不提供动画、视频和生成视觉媒体。V1 明确不交付影视剧、电视或 YouTube 原声
Attested Usage、synced-media Example Render、词级媒体 timeline 及相应外部媒体消歧/授权生产链；
这些对象不进入 V1 Required Asset Manifest 或验收承诺。V1 同样不设置 Listening Gate，现有
pronunciation/example static audio 只作为呈现资源，不产生听觉毕业 Evidence。每个发布 Sense 除
兼容当前 V3 baseline 外，还必须满足下一版 Acquisition delivery profile。公开 Book 至少覆盖
1,000 个经过质检、真正可学的 Lexemes，每个入选 Sense 都必须有完整生产内容，不能用词头、
短释义或空 Sense 凑数。

## 当前不声称完成

新 Acquisition/Retention 模型尚未落地到 Runtime、Postgres、Sync 或新 validator；本地构建
也尚未等同公网部署。真实 Cognito、Neon、R2、Cloudflare、CI/CD、监控/telemetry 和公网
数据删除/恢复仍是上线工作；Flutter iOS/Android 在 Web/API 契约稳定后实施。Sensa 尚未有
真实效果证据。完整 Book Enrollment/Range、Supplemental Curriculum、Study Scope Revision、
Semantic Field、Personal Content（包括 Anchor、Collection 与 Add-to-Learning）、Learner Semantic
Projection 与 Free Practice 同样尚无 production persistence/API/Sync/validator 或真实体验证据，
Reference Release/Reference Sense、Sense Alignment、全句 Lexical Occurrence annotation、Contextual
Sense Resolution、Lexical Enrichment 与 Contextual Lookup API 同样尚未实现。当前内容生产使用的
冻结词典 evidence 只是筛选 Sensa Sense 的 authoring input；现有 Example 只保证 target span，不能从
不背复刻中的 token regex、静态词表或多 tab UI 推断为真实上下文词典。

Experience Render capability、protected Transfer pool 新门禁、Lexeme-identity Recall grading 与
对应 repair/retest contracts 同样尚未实现。影视/电视/YouTube Attested Usage、词级媒体 timeline
与 synced-media Example Render 属于 V1 之后的候选能力，不应出现在 launch blocker、V1 素材配额
或完成度声明中。

Initial Free Practice Profile 同样尚无 production Profile/Manifest/Inventory、Session/Task persistence、
API、Sync、renderer、grader 或真实体验证据；其四种 Task family 是已接受的未来首发范围，不是已
实现功能或当前 P0 验收项。

Settings/Account 的完整 production contract 同样尚未完成：当前 `/me` 仍混合 profile、
`selectedWorkspaceId` compatibility seam 与单一 `reviewReactionAnimationsEnabled`，没有 Account
lifecycle/Session management、typed Learner Preference revision、明确的 Device Preference、Sync
Health、Local Data Clearance、Data Control Request 或 deletion barrier。真实 Cognito 与数据导出/删除
仍是 launch work，不能用本地 auth、清空 IndexedDB 或一个 profile response 冒充完成。
