# Sensa 生产领域架构

> 以 [ADR 0001](../adr/0001-local-library-optional-encrypted-sync.md) 的“本地优先＋普通账号云同步”为准。当前交付 Web，原生与多客户端开发暂停；E2EE、恢复码和设备批准不属于当前交付要求。

当前 Web 在本机执行学习，事实与投影分离，保留固定评价、结算历史与合并裁决；普通账号同步允许服务端读取业务数据，但不重新执行学习协议或结算结果。[ADR 0003](../adr/0003-three-client-local-facts.md) 已暂停，仅保留未来多客户端方向，不构成当前开发或验收要求。

> 状态：Canonical domain model

本文是 Sensa 领域对象、聚合边界和全局不变量的主入口。术语定义以
[`../../CONTEXT.md`](../../CONTEXT.md) 为准；资源细节和运行行为分别由
[`sense-learning-resource-model.md`](sense-learning-resource-model.md) 与
[`learning-runtime-model.md`](learning-runtime-model.md) 裁决；Personal Meaning、LLM Sense
Construction 与确认门由
[`personal-semantic-world-model.md`](personal-semantic-world-model.md) 裁决；学习入口、Target、Policy／Plan 与内容供给交接由
[`learning-connection-model.md`](learning-connection-model.md) 裁决。

## 跨入口体验职责

首次本机使用不要求登录；在线连接默认提供 Sensa 服务，BYOK 是高级选项。Intake 负责现场获取与处理，Web 主应用负责整理、澄清与学习，在线服务提供可选支撑。
Intake 可以原位接受，主应用也可以直接采集，两者共用准入与交接回执；已有本机资料的使用不受在线会话失效阻断。
页面职责以 [Web 产品说明](product-requirements-v1.md#用户意图与产品交互层)为准，跨页面目标与恢复出口见[用户旅程](user-journeys.md)。

## 1. 产品组成

个人事实归属本地学习库，领域逻辑在本机执行；同步服务器保存账号隔离的持久副本，允许读取业务数据。公共资源分发、账号与按需在线服务分别保留。领域身份、准入、接受与学习分离、Outcome／FSRS 幂等由所属领域事务裁决。

### 顶层产品系统

[ADR 0006](../adr/0006-three-product-systems.md) 将 Sensa 的产品领域组织为三个职责不同的系统：

1. **Personal Semantic World**：拥有 learner 经有效 Semantic Acceptance 保留的 Personal Meaning、
   Personal Anchors 与 Alignments，并容纳生命周期独立的 Saved references、Notes、Collections、
   Personal Learning Scenes 等 Personal Content，回答“什么对我有意义、我选择保留什么”；
2. **Learning System**：拥有 Curriculum、Learning Target、Policy、Planning、正式 Runtime、Progress、
   Evidence、Outcome 与 Scheduling，回答“我选择学什么、已经发生了什么学习、下一步做什么”；
3. **Content Supply System**：通过 Published、On-demand 或 Hybrid 路径生产、验证、发布、发现、安装并
   物化学习与参考内容，回答“哪些合格内容可供本次学习使用”。

三个系统共同引用 **Semantic Foundation** 中的 Sense、Sense Version、Sense Expression Binding、Lexeme
与 Language identity，但不因此取得这些共享语义身份的所有权。三个系统的 learner-facing state 与运行
位于 **Local-first Platform** 上；authoring、publication、registry 与在线 provider 可以位于服务侧，
但本地事务、同步、备份、账号、媒体与在线适配器都不裁决 Personal Meaning、Learning Outcome 或
Content admission。

```text
Intake Surfaces / adapters ──▶ Intake Layer ──▶ Personal Semantic World ── explicit bridge ──┐
                                                                                              │
Book / Catalog / direct stable Sense ─────────────────────────────────────────────────────────┼─▶ Learning System
                                                                                              │   Curriculum → Target
Published / On-demand / Hybrid ──▶ Content Supply System ─────────────────────────────────────┘   → Policy / Plan
                                                                                                  → Runtime / Progress / FSRS

                   all reference the Semantic Foundation
                   learner-facing state executes on the Local-first Platform
```

Personal Semantic World 不是 stable Sense 数据库，也不是正式学习的待办箱。正式学习不要求先创建
Personal Meaning；Book、direct stable-Sense 与 personal-first entry 在 Curriculum 接纳后汇入同一
Learning System。Content Supply 不等于文件下载：distribution 只是 Published 路径的一部分，按需生产、
独立校验与 Learning Materialization 同样属于内容供给。Learning Policy、Protocol execution、learner
progress 与 FSRS 不能由 Package 或内容提供方拥有。

三个系统的数据权威语义分别是：

| 产品系统 | 权威事实 | 可重建或可替换部分 | 主要变化机制 |
| --- | --- | --- | --- |
| Personal Semantic World | accepted、versioned personal semantic facts | 页面读取模型、跨域 Projection | object revision、tombstone、领域合并 |
| Learning System | settled Run/Action/Observation/Evidence/Transition/Outcome 与 Reconciliation Decision | 当前 progress、Memory、due 与其他投影/checkpoint | append-only history、确定性结算与投影 |
| Content Supply System | immutable release/version/digest、provenance 与 admission result | discovery cache、下载缓存、可重新取得的 published bytes | publish、validate、install、pin、materialize |

“Object is truth / Event is truth / Package version is truth”只能作为速记，不能替代上述精确定义。学习
系统不是只保存一个裸事件流；可重放还需要固定的 Policy、Protocol、Materialization、Evaluation、
Transition 与跨设备合并裁决。

跨设备同步和恢复进一步按事实类别决定，而不是按“都在 SQLite”决定：

| 数据类别 | 领域 owner | Cloud Checkpoint | Account Backup | 冲突/恢复语义 |
| --- | --- | --- | --- | --- |
| Personal Meaning、Personal Semantic Anchor、Alignment | Personal Semantic World Module | 是 | 是 | version/revision、tombstone、领域三方合并 |
| Saved Sense/Example、Sense Note、Sense Context Note、Collection、Personal Learning Scene | Personal Content Module | 是 | 是 | typed identity、revision 与领域合并；不升级为 Personal Meaning |
| Curriculum intent、Enrollment、Policy Assignment | Learning System / Curriculum | 是 | 是 | versioned command/fact 与确定性 precedence |
| Run、Action、Observation、Evidence、Outcome、Decision | Learning System | 是 | 是 | append-only、完整性验证、learning reconciliation |
| 当前 progress、Memory、due projection/checkpoint | Learning System | 可随事实传输但必须验证 | 可随恢复点保存 | 不得覆盖历史；可从固定事实与算法版本重建/核对 |
| learner-private / On-demand Materialization | Content Supply System | 是 | 是 | immutable digest、admission 与 source/derivation provenance |
| Personal Anchor media、Practice Artifact 与其他 learner-owned media | 对应 learner-owned Module / Media | 是 | 是 | content-addressed bytes、引用完整性与明确删除语义 |
| Published `.sensa`、`.sensa-book` 与公共媒体字节 | Content Supply System | 否，只同步精确安装/应用 identity | 记录可恢复引用，不为每个账号复制公共字节 | 从保留的 immutable Book archive 重新取得并校验 digest |
| Learner Preference | Preference Module | 是 | 是 | typed version 与显式 precedence |
| Device Preference、Device Operation Ledger、纯读取缓存 | device/platform | 否 | 否 | 本机重建或丢弃 |

Cloud Checkpoint 可以在一个 manifest 中承载多类 learner facts，但必须把各类 validate/merge/replay/delete
策略交还给对应领域 Module。统一传输格式不意味着统一冲突算法；Sync Module 只拥有内容寻址、清单、
幂等提交、重试和收敛，不应通过不断增加 table-specific 分支取得领域所有权。

### Intake Layer（入口层，不是第四个事实系统）

Intake Layer 解决“用户在现场遇到、想到或委托整理的材料，如何以同一种语义进入 Sensa”。它横跨
外部 Surface/adapter、Semantic family 与可选的 Platform delivery，但没有独立的稳定终态聚合：完整
结果由 Personal Semantic World 拥有，未闭合事实由 Intake Inbox 暂存，远程邮箱只拥有传输状态。

| Intake 部分 | 职责 | 明确不拥有 |
| --- | --- | --- |
| Intake Surface / adapter | 获取当前可得的 Context、Expression、Language Observation、Sense、acceptance 与 source provenance，转换为 port-neutral payload | Personal Meaning、快慢轨规则、Curriculum、进度 |
| Semantic Intake Module | 校验结构/大小/occurrence 关系，执行 operation-id 幂等，判定下一项缺失事实，并原子路由到 fast track 或 Inbox | Context 质量评分、模型自由判断、Learning Target、Evidence |
| Sense Resolution / Sense Construction | 在 `pending_sense` 时解析已有 stable Sense，或产生供后续 Semantic Acceptance 的 Sense Proposal | 自动 Semantic Acceptance、Personal Meaning membership |
| Remote Intake Delivery | 以账号和已登记 library 解析目的地，持久保存 canonical mailbox item，返回并推进 `queued | applied` receipt | 语义完整性、快慢轨裁决、本地 commit、设备间 Sync |
| Personal Semantic World authority | 接收完整且获有效授权的 Context–Expression–Sense tuple，原子创建 Personal Meaning、Anchors 与 Alignment | Intake transport、Add-to-Learning、Learning Outcome |

所有 Intake Surface 共用同一条领域路由：

```text
Web / Extension / Agent / other Intake Surface
                         │
                         ▼
               port-neutral Intake Payload
                         │
                         ▼
                  Semantic Intake
       structure + occurrence + idempotency validation
                         │
          ┌──────────────┴────────────────┐
          │ malformed / contradictory     │ valid
          ▼                              ▼
 error; no domain result          evaluate next missing fact
                                  │
                  ┌───────────────┼───────────────────────────┐
                  ▼               ▼                           ▼
          pending_context  pending_expression  pending_sense / pending_acceptance
                  └───────────────┴───────────────┬───────────┘
                                                  ▼
                                          Intake Inbox Item
                                                  │ resolve / accept
                                                  └──────────────┐
                                                                 ▼
all Context + located Expression + teaching-sufficient Sense + valid Semantic Acceptance
                                                                 │
                                                                 ▼ fast_track
                                                    Personal Semantic World commit
```

`pending_*` 只命名下一项缺失领域事实，不是入口类型或四套工作流。Semantic routing 没有“内容被模型
拒绝”的结果：合同错误直接失败；合法但未闭合的材料进入 Inbox；learner 可以显式 dismiss。所谓主动
延后必须表现为尚未完成 acceptance，从而得到 `pending_acceptance`，不能另造未注册的 `deferred` 状态。

Intake 的 deep Module interface 必须对所有 caller 保持一致：提交一个 payload，返回 `fast_track` 的
Personal Meaning identity，或返回 `inbox` 的 Intake identity 与下一缺失状态。Surface、Agent、Remote
Delivery 和页面不能复制完整性排序、直接写语义逻辑表，或绕过同一 commit authority。Sense resolution、
clarification UI、模型和 transport 是该 Module 使用或连接的 adapter/协作者，不扩大它的外部 interface。

跨域交接必须继续显式：Semantic Acceptance 允许 Personal Semantic World commit，但不包含
Add-to-Learning；后者由 Curriculum 接纳后才进入 Learning System。反向地，Learning Runtime 形成的
Personal Learning Scene 只有经过新的显式 Semantic Acceptance 才能经 Intake/commit 进入 Personal
Semantic World，不能由学习历史自动推断。

### 当前交付与在线服务边界

当前交付 Web 主应用、浏览器扩展、API 与 Agent Intake。原生客户端暂停；未来入口不定义当前 Web 的实现或验收范围。

本机库保存个人内容、材料、学习历史与调度，已有合格资料的管理、学习、复习和结算不依赖账号或在线服务。主应用可以离线启动和恢复；在线模型的新生成仍需要网络或另行提供的本地模型。参考 Obsidian／Anki 的本机使用模式不代表采用 Markdown 或通用 Card／Deck 模型。

服务端提供可选的账号／用量、同步、远程 Intake 投递、公共内容目录及在线模型能力，不拥有本机学习结算。Intake、Book 和 direct stable-Sense 是独立入口；Semantic Acceptance、安装、应用更新与 Add-to-Learning 各自表达不同意图，具体页面由 [Web 产品说明](product-requirements-v1.md)定义。

Cloud Checkpoint 传输本机已提交事实，不传输 Device Operation Ledger，也不重新结算 Learning Event。同步与恢复按各领域规则验证和合并，学习历史遵循 [ADR 0005](../adr/0005-concurrent-learning-history-reconciliation.md)，不能由普通内容选择器覆盖。

Account Backup 是独立的未来恢复能力，必须以完整、不可变且验证过的 Recovery Point 为单位。当前仅有端口／合同；Sync 成功不是历史备份，不能由此宣称已有备份服务。

### 软件职责层次（与产品系统正交）

Product Shell、Learning Kernel 与 Production Base 描述软件职责如何分层，不是另一组产品领域，也不
分别对应上述三个产品系统。一个产品系统可以跨越三个软件层；同一个软件层也可以承载多个产品系统
的 interface 或 adapter。

- **Product Shell**：呈现信息架构、Session intent、Lexical Reference、Settings Surface、作为读取/
  治理/交接控制面的 Personal Semantic World Surface、个人语义投影、自由练习、学习节奏和反馈，并
  向领域 Module 提交显式 command；它不拥有 Curriculum lifecycle 或其他领域事实；
- **Learning Kernel**：实现 Learning Target/Capability Objective、内容物化约束、Learning Protocol Purpose、
  Protocol Step/Checkpoint、Attempt→Observation→Evidence→Transition、协议特定进度、Initial Learning
  Completion、graded Memory Outcome、Scheduling Decision 与 Scheduling Handoff；
- **Production Base**：本地库持久化与恢复、设备/可选账号身份、Sensa Sync、公共资源交付和在线服务适配。
  浏览器存储与宿主约束按迁移用例验收。Postgres 只保留账号、云同步、资源目录与按需在线服务数据。

Curriculum Module，而不是 Product Shell，拥有 Enrollment、Policy Assignment 与 Study Scope lifecycle。
Content Supply 是产品领域，不因部分发布、存储与下载能力落在 Production Base 就退化为基础设施。
Product Shell 不定义学习证据或毕业条件；Learning Kernel 不拥有账号、网络同步或媒体字节；Production
Base 不决定一个 Sense 应当如何被理解、哪些内容通过 admission 或当前应当使用哪种学习干预。

### Semantic Design Contract 与 Sensa Skin

Sensa Skin 是 Product Shell 内部可替换的呈现实现。它可以改变空间布局、视觉风格与动效，但不能增删能力、改变 route／Action／内容披露、逻辑阅读与焦点顺序，或改写任何 learner fact。颜色之外仍需表达状态，系统级无障碍设置优先。

Skin 由 Sensa 审核并随产品 release 交付；外部作者身份不授予运行时安装、执行第三方代码或替换产品 renderer 的权限。切换时保留导航、输入、其他外观偏好与 Runtime 状态；所选 Skin 不可用时回退默认呈现，不改写数据。

视觉角色、组件／布局／资产／动效合同由 [DESIGN.md](../../DESIGN.md)维护。组件名称、token、开发路由与测试矩阵属于呈现实现，不在领域架构中重复定义。

Personal Semantic World Surface 只组合权威 facts、读取投影和显式操作；同名 Module 才拥有语义事实，领域写入不依赖打开该页面。

## 2. 核心领域关系

```text
Lexeme ──versioned as──▶ Lexeme Version
                              ▲
                              │ target form
Sense ──Sense Expression Binding
  │
  ├──versioned as──▶ Sense Version
  ├──Sense Relation──▶ another Sense
  └──member of──▶ Semantic Field Version
                         ▲
Book ──versioned as──▶ Book Version ──pins──▶ Sense
                              │
                              ▼
                       Book Enrollment ──────┐
                                            │
Direct stable Sense selection ─┐            │
Saved Sense / Contextual Lookup├─Add-to-Learning──▶ Supplemental Curriculum
Confirmed Personal Alignment ──┘            │
                                            │
Learner ──owns──▶ Language Learning Route[]
                         ├── Target Language + default Support Language
                         └── route-scoped Study Plan ────────────────┤
                                      └── Learning Policy Assignment─┤
                                            ▼
                                  Study Scope Revision
                                            ├──▶ Resolved Learning Plan[]
                                            │    (preparing | ready | blocked)
                                            │
                                            └──▶ Learner Sense Progress (roll-up)
                                                     │
                                                     └── Retention Target[]
                                                ├── target Sense Expression Binding
                                                ├── Learning Phase
                                                ├── active Learning Protocol Run
                                                │       ├── fixed Protocol Purpose
                                                │       ├── Protocol Step Instance
                                                │       └── optional Structured Acquisition Cycle
                                                │                   ├── Acquisition Gates
                                                │                   └── 5D State
                                                ├── Declared Mastery
                                                └── FSRS Memory State (after valid Handoff)
                              │
                              ▼
Learning Session ──contains──▶ Sense Encounter
                                  │
                                  ├── realizes ──▶ Protocol Step Instance
                                  ├── renders ───▶ Card Presentation (transient)
                                  ├── Action ──▶ Attempt ──▶ Evidence
                                  │                         └── protocol projections
                                  └── Encounter Outcome
                                      ├── Acquisition Step Outcome
                                      ├── Lightweight Study Outcome
                                      └── Memory Outcome ──▶ update FSRS once

Learning Target ──resolves durable identity──▶ Retention Target
        │
        ├── applicable Language Learning Route revision
        ├── Effective Learning Policy
        │
        └── content/runtime capabilities
                    │
                    ▼
           Resolved Learning Plan
      (purpose Protocol + provisioning + readiness)
                    │ ready
                    ▼
           Content Provisioning
       Published / On-demand / Hybrid
                    │
                    ├── On-demand: Content Provisioning Task
                    │       └── Content Agent Attempt + approved tools
                    │               └── Material Candidate Bundle
                    │                       └── independent validation/admission
                    │
                    ▼
          Learning Materialization
                    ×
       pinned Learning Protocol + purpose
                              │
                              ▼
                     Learning Protocol Run
                              │
                              └── Protocol Step Instances
                                      ├── Initial Learning Completion
                                      │       └── Scheduling Handoff ──▶ initialize FSRS
                                      ├── Memory Outcome ─────────────▶ update FSRS once
                                      └── Relearning Completion ──────▶ retain existing FSRS
```

正式学习以外的个人内容、语义探索与自由练习通过另一条链连接，但不反向改写正式进度：

```text
Browser / Mobile / Desktop / authorized Agent Intake Ports
                              │
        本机适配器直达 │ 远程账号邮箱（queued ≠ applied）
                              │
                              ▼
                       Semantic Intake
                              │
          ┌── missing facts / unresolved / pending acceptance ──▶ Intake Inbox
          │                                           │ resolve
          └── complete Context + Expression + Sense ◀─┘
                              │
               direct or delegated Semantic Acceptance
                              │
                              ▼
                       Personal Meaning
                          ├── Personal Semantic Anchor (Context)
                          ├── Personal Expression Anchor (located Expression)
                          ├── optional Meaning Focus
                          └── Personal Meaning Alignment
                                      │
                         stable Sense Version + Sense Expression Binding
                                      │
                        explicit Add-to-Learning (optional bridge)
                                      │
                                      ▼
                              Learning Target
                                      │
                                      ▼
                            Content Provisioning

Sense + Alignment + Binding ─────────▶ Learner Semantic Projection

Learner Sense Progress + Saved Senses/Examples + Personal Semantic World + Practice history
                                             │
                                             ▼
                                Learner Semantic Projection

Practice Brief + Scope ──▶ Free Practice Session ──▶ Activity Definition
                                                         │
                                                         ▼
                                                    Practice Turn
                                                         ├──▶ Observation / Feedback
                                                         └──▶ optional Artifact
                                                               ╳ Evidence / Gate / 5D / FSRS
```

`Lexeme` 是共享词形聚合；`Sense` 是稳定、可寻址的共同体意义区别，并通过 Sense Expression
Binding 连接一个或多个 typed expressions。正式内容与课程固定 Learning Target；learner-specific
学习状态和调度则解析到 Retention Target。同一 Sense 的不同 target expressions、以及同一 Lexeme 的
sibling Senses 都不能共享 Learning Protocol Run、Evidence 或 FSRS 状态。

词典查询通过一条独立的 Reference 链与正式学习内容相接：

```text
Reference Release ──contains──▶ Reference Lexical Unit ──contains──▶ Reference Sense
                                                              │
                                             reviewed Sense Alignment
                                                              │
                                                              ▼
                                                        Sensa Sense

Immutable Example ──contains──▶ Lexical Occurrence
                                      │
                                      └── Contextual Sense Resolution
                                                   │
                                                   ▼
                                            Contextual Lookup
                                                   ╳ Progress / Gate / FSRS
```

Reference Sense 表达特定词典版本中的意义区分；Sensa Sense 表达经过筛选、可以成为学习身份的
意义区分。两者只能通过显式、版本化的 Sense Alignment 连接，不能因释义文本相似而合并身份。

账号、设置、设备与数据控制通过支持链包围学习领域，但不拥有学习事实：

```text
Account ──1:1 in V1──▶ Learner
   │                      ├── Learner Preference
   │                      ├── Study Plan / Progress / Personal Content
   │                      └── learner-owned export/delete scope
   ├── Account Session
   └── Data Control Request

Device Installation ──▶ Device Preference
          │             Local Content / Media
          └──────────── Replica ──▶ Sync Health

Settings Surface = composed read/write entry, not an aggregate
```

Account 回答“谁可以访问以及账号是否存在”；Learner 回答“谁拥有学习事实”。V1 的一对一关系不允许
把账号状态、认证 Session 或设备偏好存入 Learner Sense Progress，也不允许用 Workspace 代替 Learner。

## 3. 聚合与所有权

本节确定谁拥有事实。身份、生命周期与合法转换由对应专项模型裁决，不在总架构复述完整规格。

### Content

Semantic Foundation 拥有稳定 Sense／Lexeme 身份及不可变版本。Content Supply 拥有发布物、来源、准入与材料物化；Published、On-demand、Hybrid 与学习方法正交。模型候选或 Semantic Acceptance 不自动成为合格学习材料，内容提供方不拥有 learner progress。资源与发布语义见[资源模型](sense-learning-resource-model.md)。

### Curriculum

Learning System 的 Curriculum 拥有 Route、Study Plan、Enrollment／Range、Supplemental Membership、Learning Entry Provenance 与 Policy Assignment。它接纳 Book、direct stable-Sense 与 personal-first bridge，不修改发布的 Book，不把收藏或保存意义解释为学习意图。目标、策略解析与准备交接见[学习连接模型](learning-connection-model.md)；计划资格、Scope／Session 与每日额度见[运行时模型](learning-runtime-model.md)。

### Lexical Reference

Reference 拥有版本化词典内容、来源与 contextual resolution，不拥有 Curriculum 或学习进度。Reference Sense 与 Sensa Sense 通过显式审核的 Alignment 连接；浏览、点词和播放不能形成学习事实。精确 occurrence、可见性及泄题边界见[资源模型](sense-learning-resource-model.md)与[运行时模型](learning-runtime-model.md)。

### Learner Sense Progress

Retention Target 是 learner × Sense × target expression 的长期学习身份；同一 Sense 的不同表达分别保留结果与调度。Learner Sense Progress 是这些连接的 roll-up，不另持一份 FSRS State。能力、题型、Card 和来源变化不自行扩展调度身份；细则见[学习连接模型](learning-connection-model.md)。

### Learning Runtime

Learning System 拥有 Protocol Run、Step、Action、Attempt、Observation、Evidence、Transition、Completion 与 Scheduling。Product Shell 消费已解析的 presentation 并提交 learner intent；内容、页面或同步不能代替正式评价和结算。执行与结果规则由[运行时模型](learning-runtime-model.md)维护。

### Personal Content

Personal Semantic World 拥有经 direct／delegated Semantic Acceptance 接纳的完整 Personal Meaning、Anchors 与 Alignment；未闭合事实留在 Intake Inbox。Personal Content Module 拥有收藏、笔记、Collection 与 Personal Learning Scene，它们不因保存而成为 Personal Meaning 或学习结果。

跨入口接受、修订、删除、冲突与授权规则见[个人语义世界模型](personal-semantic-world-model.md)；Personal Content 与正式学习的生命周期交接见[运行时模型](learning-runtime-model.md)。保存、整理、练习与 Add-to-Learning 是独立意图，删除一侧不能级联删除另一侧历史。

### Learner Semantic Projection

Projection 通过各领域接口生成可重建读取模型，没有 command 或来源事实所有权。它保留个人／发布来源及语言 provenance，不把布局、视觉距离或推断节点当作真实掌握度，也不据此创建学习资格。

### Free Practice

Free Practice 拥有独立活动及实际发生的 Turn／Observation／Feedback／Artifact，不经过正式 Planner 或学习结算。保存新的语义材料与加入学习必须另行提交显式操作。当前可用活动由 PRD 定义，活动领域规则见[运行时模型](learning-runtime-model.md)。

### Learner declaration

Declared Mastery 是 learner 对 Retention Target 的可逆声明，只改变计划资格，不伪造通过、Evidence 或 FSRS 结果。中断与恢复 active Run 的规则见[运行时模型](learning-runtime-model.md)。

### Account、Preferences 与 Data Control

Account 拥有在线认证与生命周期，Learner 独立拥有学习及个人事实；Settings Surface 只组合这些 owner 的操作。Learner Preference 跨设备收敛，Device Preference 只控制本机呈现，Study Plan／Policy Assignment 不属于普通偏好。退出、清除本机、学习历史 reset 与删除账号是不同意图；生命周期与数据边界见[运行时模型](learning-runtime-model.md)，当前 Web 恢复出口见[产品说明](product-requirements-v1.md)。

## 4. Protocol-driven connection 与长期保持

Learning Target 固定学什么；Learning Policy Profile 协调怎样学；Content Supply 提供合格材料；Runtime 执行并结算。Profile 只组合版本化合同，不拥有每日数量或第二份进度，也不把三种 purpose 合成跨月 Run。首次正式 Run 冻结 Committed Learning Policy，后续普通设置或来源变化不能改写它；迁移边界见[学习连接模型](learning-connection-model.md)。

### Initial Learning

成功的首次学习必须在同一权威事务形成 Completion 与唯一 Scheduling Handoff。Lightweight 的 Study Completion 与 Structured Acquisition 的 Graduation 保留不同保证级别，不能据此宣称永久掌握。

### Structured Initial Learning

Gate、独立行为要求、5D 与 repair 由[习得模型](semantic-acquisition-model.md)定义，执行和结算见[运行时模型](learning-runtime-model.md)。该协议不是每个新 Sense 的强制入口。

### Retention Review

FSRS 决定何时 due，Protocol 决定如何评价。同一 due Review 最多贡献一个 Memory Outcome 和一次调度更新；grade、basis 与 evidence level 分别保留。

### Relearning

重学恢复连接，不覆盖触发它的 Review Outcome、不创建第二次 Handoff，也不重新初始化 FSRS。协议允许的独立重学评价拥有自己的结果和幂等边界；Completion 本身不是调度输入。详细结果和调度合同统一见[运行时模型](learning-runtime-model.md)。

## 5. 模块边界

以下 Module 保留各自聚合与 interface，但不再作为 27 个没有上级关系的平级盒子理解。它们按产品系统
和共享支撑职责组成四个 bounded-context family：

- **Semantic family**：Lexical Reference、Semantic Intake、Personal Semantic World、Personal Content、
  Sense Construction、Learner Semantic Projection；它们引用 Language Context/Support 与公共 Semantic Foundation；
- **Learning family**：Curriculum、Free Practice、Learning Policy & Protocol、Executable Learning
  Capability Resolver、Learner Progress、Unified Planning、Semantic Policy、Encounter、Evaluation &
  Evidence、FsrsAdapter；Free Practice 明确与正式学习结算隔离；
- **Content Supply family**：Catalog、Content Provisioning 以及仓库外侧的 authoring/validation/publishing
  pipeline；Published distribution 与 On-demand production 在 Materialization 前汇合；
- **Platform family**：Account & Access、Preference、Data Control、Sensa Sync、Media、Remote Intake
  Delivery、Account Backup，以及为前三个 family 提供的持久化和在线 adapter。

这些分组决定所有权和允许的依赖方向，不要求数据库按 family 拆成多个文件或服务。物理共用
SQLite/Postgres、Cloud Checkpoint 或媒体存储不构成领域耦合；跨 family 只能通过明确的 identity、fact、
command 或 deep Module interface 协作，不能让页面状态、传输记录或数据库表成为第二领域 authority。

1. **Account & Access Module**：拥有 Account、Account Session、identity-provider binding 与 Account
   lifecycle；它授权 LearnerScope，但不拥有学习事实；
2. **Preference Module**：拥有 versioned Learner Preference；各客户端独立拥有包含 Interface Locale 与
   surface-scoped Active Route Selection 的 Device Preference，并按显式 precedence 解析系统设置、本机
   override 与 learner defaults；
3. **Data Control Module**：拥有 Data Export/Delete Request 的幂等、授权、状态与审计生命周期，并
   协调 Account、learner-owned stores 与 Replica invalidation；
4. **Catalog Module**：读取已发布、已固定的 Book、Sense Learning Package、Semantic Field、
   Reference Release、Reference Sense、Sense Alignment 与 Lexical Enrichment；其分发适配器读取
   immutable Learning Content Registry，验证一个 `.sensa-book` 并通过统一 Portable Package 入口
   原子安装其 `.sensa` 成员，但不拥有 Enrollment 或进度；
5. **Lexical Reference Module**：解析 Example + character span，读取 version-pinned Reference entry、
   Lexical Occurrence 与 Contextual Sense Resolution，并生成可重建搜索/详情读取模型；它不拥有
   learner progress，也不自由生成词典释义；
6. **Curriculum Module**：拥有 Language Learning Route、route-scoped Study Plan、Book Enrollment/Range、
   Supplemental Curriculum、
   Add-to-Learning Intent、Learning Entry Provenance、Learning Policy Assignment 与 Study Scope
   Revision；它接纳 Book、direct stable-Sense 与 personal-first bridge，保证 source provenance、去重、
   Policy scope/precedence、切换和范围变更不修改 published Book membership 或 learner progress；
7. **Semantic Intake Module**：接收浏览器、移动端、桌面端与 authorized Agent 的 port-neutral Intake
   payload，拥有 Language Observation、Intake Inbox、机械完整性分流、幂等 ingest 与 direct/delegated
   acceptance authority audit；
   它只把完整且获有效授权的 Context–Expression–Sense resolution 提交给 Personal Semantic World，
   不判断调用方给出的 Context 是否语义充足，不创建 Curriculum Membership、Learning Target 或 learner
   progress，也不依赖任何主应用页面状态；
8. **Personal Semantic World Module**：拥有 Personal Meaning、optional Meaning Focus、Personal Semantic
   Anchor、Personal Expression Anchor 与 Personal Meaning Alignment 的 learner-scoped 事实及同步生命周期；它可以提交
   bridge Intent，但不是 Curriculum/Learning Runtime 的依赖；同名 Product Surface 只能通过本模块与
   Semantic Intake 的正式 operations 读写，不能另存一份页面 state；
9. **Personal Content Module**：拥有 Saved Sense/Example、Sense Note、Sense Context Note、Personal
   Collection/typed Membership 与 Personal Learning Scene。它通过显式 commands 保存 learner references、
   annotations 与 runtime scaffold，保留独立 revision/sync 生命周期；它不能把任一记录升级为 Personal
   Meaning、Personal Semantic Anchor、Learning Evidence 或正式 progress；
10. **Sense Construction Module**：只在普通 Contextual Sense Resolution 不足时编排 learner–LLM 语义
   访谈、optional Meaning Focus、Sense Proposal 与 Semantic Acceptance；它可以按需
   请求创建 stable Sense/Version，但不能创建 Learning Evidence、Curriculum Membership 或绕过
   后续内容物化与协议选择；
11. **Learner Semantic Projection Module**：通过各领域 deep Module interface 组合 Personal Semantic
   World、已发布 Field、learner progress、Personal Content 与 Practice history，只生成可重建读取模型；
   它没有 command 接口，也不直接读取其他领域的存储表；
12. **Free Practice Module**：解析 Practice Brief、Scope、primary Area 与 Activity Definition，保存
   Practice Turn、Observation、Feedback 与 optional Artifact；它可以读取 Learning Target、Personal
   Semantic World 与获准资源，但不调用正式 Learning Kernel 的证据、结算或调度接口；
13. **Content Provisioning Module**：按 Resolved Learning Plan 将固定 Learning Target 与 Pinned Language
   Context 通过 published、
   on-demand 或 hybrid 路径解析为 capability/readiness result 和通过合同校验的不可变 Learning
   Materialization；它拥有 Provisioning Batch、Content Provisioning Task、Content Agent Attempt、
   Material Candidate Bundle、独立 validation/admission 与 assembly。Learning Content LLM 及其获准工具
   只在单 Task Attempt 内生产未受信候选，不能改写 Sense、Learning Policy、Protocol 或 learner progress，
   也不能批准自身输出；
14. **Learning Policy & Protocol Module**：拥有 versioned Learning Policy Profiles，结合 Curriculum
   Assignment 解析 Effective Learning Policy 与 Resolved Learning Plan，选择并执行 purpose-specific
   versioned Protocol，定义 Step/Checkpoint、material role binding、Evaluation/Progression/Completion
   Policy 与合法 Transition effects，创建 Protocol Run/Step Instance，接纳与 purpose 兼容的合法结果，
   并在成功 Initial Learning Completion 的同一权威边界创建必需的 Scheduling Handoff；
15. **Executable Learning Capability Resolver**：为 Structured Acquisition 求 Package、Required
   Capability Set、approved resources 与 Runtime 能力的版本化交集，不读取 learner state；
16. **Learner Progress Module**：拥有 Retention Target、其 Learning Phase、active protocol run、
   protocol-specific Checkpoint credit/progress epoch、Memory State 以及 Sense-level roll-up，并记录
   Initial Learning Completion、Study Completion、Acquisition Graduation 与 Relearning Completion；
17. **Unified Planning Module**：只从 purpose-ready Resolved Learning Plans 中，在 Study Plan、Session
   intent、Declared Mastery、cooldown、protocol readiness、Relearning readiness 与 due state 之间选择候选；
18. **Semantic Policy Module**：在 Structured Acquisition 内从 Step purpose、capability inventory、Gate progress、
   Evidence、5D 与历史中选择最小干预；
19. **Encounter Module**：按 Protocol Step Instance 固定 Materialization/Action，物化瞬时 Card Presentation，
   接受 Attempt，并用 pinned interaction/grader contract 形成 Observation；
20. **Evaluation & Evidence Module**：从 Observation 按固定 Evidence Rule 派生追加 Evidence，应用
   versioned Progression/Completion Policy 产生原子、幂等 Transition Decision，并重建 Checkpoint、Gate
   与 5D 投影；
21. **FsrsAdapter**：按 Retention Target 消费有效 Scheduling Handoff 与来自 Review 或合法
   Relearning evaluation 的 graded Memory Outcome，产生 Scheduling Decision，是 FSRS Memory State
   与 next due 初始化和更新的唯一接口；
22. **Sensa Sync Module**：传输本地已提交的版本化记录与内容寻址数据块，维护幂等、清单和收敛状态，但不解释或重新结算学习事实；
23. **Media Module**：验证不可变媒体引用并提供授权下载。
24. **Language Context Module**：从显式 operation roles、正式学习 Route 或当前 surface 的 Active Route
    Selection 解析并冻结 Pinned Language Context；pre-route semantic work 不因此创建 Curriculum Route，
    本模块也不从 Route 推断捕获内容语言或把 target/support role 写回 Expression；
25. **Language Support Resolver**：按 exact Language Tag 与 speech、reference、translation、content
    或 renderer capability 返回 exact support、显式 fallback 或 unavailable；它不改写任何语言事实。
26. **Remote Intake Delivery Module**：以认证账号解析唯一已登记的本地 library，持久保存 canonical Intake
    mailbox item，拥有 `queued | applied` 回执、拉取/确认和 operation-id 幂等；它不读取或裁决语义内容，
    也不把入队伪装成本地提交。
27. **Account Backup Port**：定义 immutable Recovery Point manifest、完整性摘要、library/learner/schema
    identity 与 `account_assisted | zero_knowledge` 恢复模式。当前只有端口和合同，没有生产 route、store、
    scheduler 或 restore workflow；未来实现不能复用 Sync cursor 冒充 Recovery Point。

## 6. 全局不变量

以下约束跨越多个 owner；各模型内部的身份字段、状态枚举、评价步骤与资源清单留在其所属文档。

- **身份不混同**：Sense 不是词头／译文，Account 不是 Learner，Reference Sense 不是学习身份，Card／页面不是 Retention Target。相同 Sense 的不同 target expressions 不共享一份结果或调度。
- **所有权明确**：Settings、产品 Surface、可重建 Projection、数据库表与传输格式都不能成为第二份领域权威；跨模块操作通过显式 identity、fact 或 command 交接。
- **语言事实不重标**：Language Tag／Observation 保留实际来源；Route、Interface Locale 与单次操作的 Input／Output roles 分开。长操作固定语言上下文，后续选择变化不改写已固定事实；能力只返回 exact、显式 fallback 或 unavailable。
- **学习入口独立**：Book、direct stable-Sense 与 personal-first bridge 在 Learning Target 汇合；保存、接受、安装、应用更新、练习和 Add-to-Learning 不互相暗含，也不要求先建立 Personal Meaning。
- **接受与候选分离**：只有有效 direct／delegated Semantic Acceptance 接纳完整 Personal Meaning。模型推断、推荐或 Sense Proposal 不自动获得接受效力；完整受委托请求不要求额外确认，provenance 仍须保留。
- **内容与学习分离**：Published 内容不可变，按需内容先独立准入并冻结。Content Agent 不能自批、改写 Sense／Policy 或提交学习结果；Step 已接受 Action 后不能替换当时题目、答案或评分依据。
- **保证级别诚实**：展示、播放、继续、自报和揭示后的立即重答不自动成为独立 Evidence；Study Completion、learner rating、独立验证与 learner declaration 不能互相冒充。能力未就绪不静默降级学习方式。
- **结算保留历史**：Attempt、Observation、Evidence、Transition 与 Outcome 保留不可变解释；reset、Policy Migration、内容修订、课程变更和重学不能改写已发生事实。Completion、Handoff、Memory Outcome 与 Scheduling transition 原子且幂等。
- **读取和练习不结算**：Reference 和 Free Practice 不产生正式 Evidence、due 清除或 FSRS 更新；assessment-only 资源不能通过查询、参考或练习泄露。
- **同步不扩大权威**：只运输、校验和合并已提交事实，各领域独立裁决冲突。学习历史不得由普通内容冲突选择覆盖，同一 Review 不重复贡献调度。
- **数据意图区分**：退出保留本机资料，清除本机不删除云端，删除账号不能被旧会话或副本复活；未同步资料不得静默丢弃。Recovery Point 必须完整存储并验证，Sync／queued／界面布尔值都不能冒充备份或本机已保存。
- **呈现不改事实**：Skin、设备偏好与导航只改变呈现，不改变资源资格、逻辑披露、输入、正式学习或同步结果。

## 7. 文档边界

本文不冻结 Gate 数量阈值、具体 Action/Practice Activity Definition 或 Turn payload、cooldown 间隔、Semantic Field
可视化布局、词典供应商、Contextual Sense Resolution 阈值、identity provider、Account deletion
恢复窗口、LLM provider/prompt、Sense Proposal 展示数量、相似 Sense 检索阈值、具体 Preference
字段、HTTP/SQL、Sync payload、例句数量或页面布局。它们属于版本化实现
合同、delivery/practice/reference profile 与 PRD，但必须服从本文的学习、参考、账号、设置与数据
控制边界和全局不变量。
