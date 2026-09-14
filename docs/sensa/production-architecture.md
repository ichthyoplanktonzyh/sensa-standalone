# Sensa 生产领域架构

> 以 [ADR 0001](../adr/0001-local-library-optional-encrypted-sync.md) 的“本地优先＋普通账号云同步”为准。当前只交付 Web；原生及三端验证不阻塞首发，E2EE、恢复码和设备批准不再是首发要求。

[ADR 0003](../adr/0003-three-client-local-facts.md) 确认主应用均在本地执行学习，共享领域事实、版本与合并规则。事实与当前投影分离，保留固定评价/结算历史；学习历史保持可追溯；普通账号同步允许服务端读取业务数据，但服务端不重新执行学习协议或结算学习结果。

> 状态：Canonical domain model  
> 更新日期：2026-09-13

本文是 Sensa 领域对象、聚合边界和全局不变量的主入口。术语定义以
[`../../CONTEXT.md`](../../CONTEXT.md) 为准；资源细节和运行行为分别由
[`sense-learning-resource-model.md`](sense-learning-resource-model.md) 与
[`learning-runtime-model.md`](learning-runtime-model.md) 裁决；Personal Meaning、LLM Sense
Construction 与确认门由
[`personal-semantic-world-model.md`](personal-semantic-world-model.md) 裁决；内容供给、Learning
Protocol、学习结果与 FSRS 交接由
[`learning-connection-model.md`](learning-connection-model.md) 裁决。

## 跨入口体验职责

2026-09-10 Owner 确认账号优先的首次使用和默认 Sensa 服务；BYOK 属于高级功能。
Intake 负责现场获取/处理，Web、桌面和移动主应用负责整理/澄清/学习，Hono 提供在线支撑。
这不是强制跳转边界：Intake 可以原位接受，主应用可以直接采集，统一准入和交接回执。
已初始化设备的断网学习不受在线会话失效阻断；本地事实仍由本地领域事务裁决。
完整用户旅程与失败状态以 [PRD 的统一体验](product-requirements-v1.md#统一用户体验2026-09-10-owner-确认) 为准。

## 1. 产品组成

2026-09-08 目标架构修订已确认：[本地优先与普通账号云同步](../adr/0001-local-library-optional-encrypted-sync.md)。
个人事实归属完整本地学习库，领域逻辑在本地执行；同步服务器保存账号隔离的持久副本，允许读取业务数据。公共资源分发、账号与按需在线服务分别保留。Web 已接入本地学习库与 TypeScript Learning Runtime；领域身份、校验、接受与学习分离、Outcome/FSRS 幂等等业务不变量由本地领域事务执行。

### 完整产品形态（不以首发范围裁剪）

2026-09-08 Owner 再次确认：Sensa 的 PC/移动主应用是 Flutter 编写的本地软件，承载完整个人学习库、
我的语义世界及学习/复习流程，产品形态参考 Obsidian/Anki 的本地使用与可选同步。
React Web 保持既有平台定位和迁移验证价值；不能把阶段性的 Web 先行理解为最终产品只有网站。
具体采集平台的接入顺序由路线图安排，不限制完整产品的多端入口。

```text
浏览器网页/YouTube、移动分享、桌面、Agent 及其他现实场景采集
                       ↓ 固定上下文与表达
            快轨原位确认 / 慢轨保存后澄清
                       ↓ 合法 Semantic Acceptance
             我的语义世界：Context–Sense–Expression
                       ↓ 显式加入学习
      Learning Target + 用户选择的 Learning Policy
                       ↓ 按需生成 / 复用 / 混合供给
              校验并冻结 Learning Materialization
                       ↓
          本地初学 → 本地复习/重学 → 本地记录与调度

Sensa 发布的学习包 → 下载到本地 → 显式加入学习 ──┘
```

Owner 明确将面向 Agent 的端口纳入完整采集蓝图。Agent 可以在用户授权范围内提交固定上下文、
Expression、来源及 Sense，经过同一快慢轨和库交接合同；用户在当前 Agent 会话中
明确要求保存可构成 delegated Semantic Acceptance，无需独立 grant id 或第二次 Sensa 确认。
采集本身不隐含加入学习。端口无关 payload、远程投递邮箱与 Web 本地消费器已建立；Codex skill 与
本机 CLI 已通过 Native Messaging 接入当前 Web 库，设置页提供按当前库与浏览器生成的一次性安装命令；
具体 Agent 产品的 OAuth 与 MCP 仍是后续接入面。

未确认 Sense 的材料保存在 Intake Inbox；完整 Personal Meaning 才进入语义世界的稳定意义集合。
Focus 可选；快慢轨都不降低 Context–Sense–Expression 的完整性要求。
语义世界不是必须清空的待学队列，保存意义不等于学习承诺。学习包是独立入口，不必伪造个人经历
或先建立 Personal Meaning。学习内容由 Published/On-demand/Hybrid 供给，不能规定每次都调用模型；
生成与独立校验完成后才能开始需要这些材料的正式 Protocol。

用户拥有本地资料、材料、学习记录及调度；已有合格资料的管理、学习、复习和结果结算不依赖
账号、同步订阅或 Sensa 后端。主应用必须能离线启动和恢复；具体格式不因参考 Obsidian 而承诺
全部使用 Markdown，也不引入通用 Card/Deck 模型。

服务端承担五类可选能力：普通账号云同步；远程 Intake 持久投递；公共学习资源目录与下载；
在线 LLM 澄清/解释/材料生成；支撑这些服务的账号、授权、订阅与用量。LLM 是主要在线智能能力，
不能成为本地学习的隐式前提。
调用云端模型仍需联网；离线新生成能力取决于另行提供的本地模型，不包含在“已有资料完全本地使用”
的承诺中。服务端允许读取同步内容；本地学习仍由既有领域执行层结算，同步不得重复结算。

技术职责上，主应用包含界面、本地应用/领域执行与本地持久化，并非仅渲染 Hono 返回的投影。Hono
只承载在线能力；本地学习不要求启动或连接 Hono。当前 Web 使用 TypeScript Learning Runtime 与
运行在专用 Worker、持久化到 OPFS 的 SQLite WASM；应用层通过 `LibraryTransaction` 提交，本机
数据库只允许一个页面生命周期 owner。本地原生实现已暂停；未来恢复时，各平台的实际构建、离线与恢复仍须分别验收，不能把
浏览器测试当作原生平台证据。

云端备份与 Sync 分开建模。Sync 解决多设备当前状态收敛，不保证能退回到某个未损坏的
历史时点。未来 Account Backup 以不可变、完整且可独立验证的 Recovery Point 为单位，
首先提供 account-assisted recovery，服务可读取备份并协助恢复；zero-knowledge 作为未来模式。
当前仅固定 backup manifest/recovery point 合同和模块边界，不实现备份路由、存储、调度、恢复 UI，
也不把现有 Sync 状态宣称为备份成功。

Sync 的产品单位是 Cloud Checkpoint：所有操作先提交本机事实，云端在静置、连续使用上限、学习会话
完成、页面进入后台、重新联网或用户主动要求时批量收敛。账号接通后的首次拉取在后台执行，不阻塞
应用外壳和已有本机资料；普通前台恢复只在云端检查过期时拉取。同步使用本机内容版本与已确认基线，
不能用一个布尔 dirty 标记吞掉同步期间的新提交。完整本机命令返回值不是云端历史；传输层保存紧凑
幂等回执，并让相同媒体内容复用同一组摘要块。Learning Event 与其原始 operation input 仍不可改写。

### 领域层职责

Sensa 由三个职责独立的层组成：

- **Product Shell**：用户看到的信息架构、Curriculum lifecycle、Session intent、Lexical Reference、
  Settings Surface、作为读取/治理/交接控制面的 Personal Semantic World Surface、个人语义投影、
  自由练习、学习节奏和反馈；
- **Learning Kernel**：Learning Target/Capability Objective、内容物化、Learning Protocol Purpose、
  Protocol Step/Checkpoint、Attempt→Observation→Evidence→Transition、协议特定进度、Initial Learning
  Completion、graded Memory Outcome、Scheduling Decision 与 Scheduling Handoff；
- **Production Base**：本地库持久化与恢复、设备/可选账号身份、Sensa Sync、公共资源交付和在线服务适配。
  浏览器存储与宿主约束按迁移用例验收。Postgres 只保留账号、云同步、资源目录与按需在线服务数据。

Product Shell 不定义学习证据或毕业条件。Learning Kernel 不拥有账号、网络同步或媒体字节。
Production Base 不决定一个 Sense 应当如何被理解或当前应当使用哪种学习干预。

Personal Semantic World Surface 不等于 Personal Semantic World Module。前者主要组合 Intake Inbox、
stable personal meanings、provenance、learning readiness/progress projections 与显式操作；后者才拥有
learner-scoped semantic facts。大多数 Intake 可以发生在浏览器、移动系统、桌面工具或 Agent 中，
领域写入不得依赖 learner 打开主应用页面。

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
          ┌── missing facts / unresolved / deferred ──▶ Intake Inbox
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

### Content

- Lexeme/Sense 的稳定身份与不可变版本分离，二者通过 versioned Sense Expression Binding 连接；
- Sense 可以由编辑流程预先生产，也可以由 learner–LLM Sense Construction 按需提出并在 learner
  确认后创建；“公共”表示语义契约可复现，不表示必须先存在穷尽式公共 Sense 库；
- Semantic Acceptance 只创建稳定 Sense identity 与初始 Sense Version。正式学习还需要独立的 Learning
  Target、Effective Learning Policy、Resolved Learning Plan、Content Provisioning decision、Learning
  Materialization 与 Learning Protocol；确认对话本身
  不能冒充学习内容；
- Published Learning Content 通过 Sense Learning Package 固定 release、Sense Version、target binding、
  referenced form/profile 与资源；On-demand Learning Content 则针对已固定的 target 与 protocol 生成；
- 无论来源是 published、on-demand 还是 hybrid，开始一次 protocol run 前都必须冻结为不可变的
  Learning Materialization，并记录生成器/发布版本、输入 provenance 与校验结果；
- 内容来源与 Learning Protocol 正交：同一 Published Package 可服务多个协议，同一协议也可消费
  Published 或 On-demand 内容，具体可执行性由版本化合同决定；
- Learning Policy Profile 是 Protocol、Content Requirements、Evaluation/Evidence、Progression/Completion、
  Repair、Scheduling 与 Claim Policy 的命名组合，但不把这些对象合并成一个聚合，也不拥有每日数量；
- Acquisition Profile、Required Capability Set、Required Asset Manifest 与 Executable Capability
  Inventory 属于 Structured Acquisition Protocol 的高保证内容合同，不是所有学习方式的前置条件；
- Sense Relation 是同一 release 中经过审核的两个 Sense 之间的语义事实；
- Semantic Field Version 用有限、可审核的 Senses 与 Relations 表达局部意义邻域，不决定课程顺序；
- Content Release、Package 与 Book Version 发布后不原位修改。

### Curriculum

- Book Version 是经过筛选、排序的不可变 Sense 课程，不是词典全义项转储；
- Formal Learning 是独立产品链，不以 Personal Semantic World membership 为入口条件。Book membership、
  direct stable-Sense selection 与 accepted complete Personal Meaning Alignment 都可以提供 Learning Entry
  Provenance，并在同一 Learning Target/Retention Target 处汇合；
- direct entry 仍必须固定 stable Sensa Sense/Version 与 target Sense Expression Binding；裸 Lexeme、
  未对齐 Reference Sense 或任意 target-language 字符串不能绕过 Sense-first target resolution；
- Language Learning Route 是 learner-owned 的方向性学习安排，固定一个 Target Language、一个可与其
  相同的 default Support Language 和一个 route-scoped Study Plan；同一 Learner 可以拥有多条 active、
  paused 或 archived Routes，领域不由此推导全局母语或 proficiency；
- pause/archive Route 只改变后续 Planning 与默认选择，不删除 Personal Content、Curriculum history、
  Learning Target、Retention Target、Protocol facts、Evidence 或 FSRS；恢复时沿既有身份继续；
- Study Plan 是一条 Route 内的正式学习安排，组合 Book Enrollment、Supplemental Curriculum、Learning
  Policy Assignments 与每日新 Sense 上限；它不再等同于一个 Book Version；
- Book Enrollment 固定一个不可变 Book Version 与一个已解析 Book Range，mode 为
  `active | maintenance | paused`；同一 Route 最多有一个可以引入新 Sense 的 active Enrollment，且其
  target-language scope 必须与 Route 兼容；
- `active` 提供新 Sense 并继续既有学习，`maintenance` 不再引入新 Sense，但继续已开始的
  Protocol Run/Relearning 与 due Review，`paused` 完全退出 Planning 但不删除任何进度；
- 切换词书默认把旧 Enrollment 转为 `maintenance`、把目标 Enrollment 转为 `active`。以后切回时
  复用各 Retention Target 的原进度，不重开已完成 Cycle，也不重新初始化 FSRS；
- Book Range 只控制未来 Introduction；缩小范围不能删除已经发生的学习事实，已经通过该
  Enrollment 开始的 Sense 由 Enrollment mode 决定是否继续；
- Supplemental Curriculum 是 learner-owned、ordered 的 Learning Target 补充课程，不是 Book、
  Saved list 或 Personal Collection；同一 Retention Target 可以有多个来源，但只进入一次有效
  Study Scope；同一 Sense 的不同 target expressions 是不同成员；
- 每个 Study Scope Revision 固定所属 Route revision；同一 Retention Target 即使出现在多个兼容 Route
  中也只保留一份正式进度和 FSRS Memory State，Route-specific content/plan 不得复制学习结果；
- Learning Policy Assignment 可以位于 learner default、Curriculum source 或 Retention Target override；
  Effective Learning Policy 按 `target > Curriculum > learner > system` 解析，并保存 Profile/version 与
  decision provenance；
- Resolved Learning Plan 把 target、Effective Learning Policy 与 content/runtime capabilities 解析为
  purpose-specific Protocol、provisioning requirements 和 `preparing | ready | blocked` readiness；它不
  预先固定未来 Encounter/Card 顺序或 FSRS due calendar；
- 每次换词书、调整 Range、切换 Enrollment mode、接纳或移除 Supplemental Membership，都产生
  新的不可变 Study Scope Revision；正在进行的 Session 固定旧 revision，不被静默改队；
- 默认课程策略可以错开同一 Lexeme 的多个新 Sense；只有明确的边界教学才应主动并置；
- UI 可以展示 Lexeme 数与 Sense 数，但不能把 sibling Senses 合成一个课程成员；
- Add-to-Learning Intent 是让 target 进入一条显式 Language Learning Route 的 Curriculum request；
  Curriculum 先校验 target Binding 与 Route Target Language 兼容，再决定如何接纳或拒绝，
  但不能修改已发布 Book Version，也不能把收藏本身解释成该 request。Intent 目标已在有效范围时
  必须幂等返回 `already_in_scope`；合法 target/policy 被接纳后立即创建 Supplemental Membership，
  内容准备随后推进 plan readiness。若当前 Policy 无法通过 published、on-demand 或 hybrid 路径
  解析出合法内容，Membership 保留而 plan 标记 `blocked(reason=content_unavailable)`；active Declared
  Mastery 则要求独立恢复操作，不能静默撤销声明或伪造可运行进度。
- Personal Semantic World 只通过显式 Add-to-Learning 提供可选 bridge；删除或修改 Personal Meaning、
  Focus/Anchor/Alignment 不删除 Curriculum Membership、Retention Target、Protocol/Evidence history 或
  FSRS，Learning/Review history 也不能反向创建 Personal Meaning；

### Lexical Reference

- Reference Release 固定来源、版本、entry/render Language Tags、license、Reference Lexical Units、Reference Senses 与
  可公开的 Lexical Enrichment；搜索索引只是可重建投影，不是权威内容；
- Reference Lexicon 的覆盖面可以大于 Learning Catalog。Reference-only meaning 可以被搜索和浏览，
  但不能拥有 Learner Sense Progress，也不能直接进入 Curriculum；
- Sense Alignment 是经过审核的版本化关系，允许 `equivalent`、`reference_broader`、
  `reference_narrower`、`overlaps`，也允许没有映射或一个 Sensa Sense 对应多个来源区分；
- Lexical Occurrence 固定 Example identity 与精确 character span，并支持 multi-token expression；
  Example 的 authored target 通过既有 Sense Version 精确定位 Sensa Sense，只有存在 reviewed Alignment
  时才进一步强调一个 Reference Sense；其他 occurrence 可以是 reviewed、model-confident、ambiguous
  或 unresolved；
- Contextual Lookup 返回完整 Reference entry，并仅在解析足够可靠时强调“本句中”的 Reference Sense；
  模糊时只能显示候选或不强调，不能用自由生成的释义掩盖不确定性；
- 词根词缀、词源、词族与记忆辅助属于 Lexical Enrichment。语言学事实必须有来源；面向学习者的
  词源故事或记忆法必须标记为经过审核的编辑性辅助，不能冒充历史事实；
- Reference 资源具有 `reference_visible | learning_only | assessment_only` 可见性。Contextual Lookup
  只读取 `reference_visible` 内容，不能暴露为 novel Transfer 保留的 assessment asset；
- 搜索、浏览、点词、播放和展开只产生产品读取或可选 telemetry，不创建收藏、课程成员、
  Learning Evidence、Gate、5D、Memory Outcome 或 FSRS 更新。

### Learner Sense Progress

- Learner Sense Progress 是 learner × Sense 的权威 roll-up，用于展示该 Sense 下多个表达连接，
  但不直接拥有 phase、Protocol Run 或 FSRS State；
- Retention Target 是 learner × Sense × target Sense Expression Binding 的权威长期学习身份；
- 每个 Retention Target 独立记录 `new | acquiring | retaining | relearning` phase、Declared
  Mastery、active Learning Protocol Run、固定 purpose、active Protocol Step Instance 与
  protocol-specific projection；Acquisition Cycle、Gate progress 与 5D State 只在 Structured
  Acquisition Protocol 下存在；
- Initial Learning Completion 统一承载成功的首次学习完成；Study Completion 只证明一次 Lightweight
  Study 按合同完成，Acquisition Graduation 才证明当前 Structured Gates 已解决，两者都不等于“掌握”；
- 每个 Retention Target 最多一份 FSRS Memory State，且只在有效 Scheduling Handoff 后存在；
  handoff 必须记录 protocol、basis 与 evidence level，Relearning Completion 不重新初始化既有状态；
- Recognition、Recall、Transfer、Listening 等 capability 默认作为同一 Retention Target 内的
  Evidence/Gate/diagnostic projection，不按 Card 或题型建立独立 schedule。只有显式且稳定的
  独立长期能力合同才能扩展 Retention Target scope。

### Learning Runtime

- Learning Session 是一次有边界的活动容器，并固定 `mixed | review_only` intent；
- Protocol Step 定义材料角色、交互/判分、结果资格与 transition；Step Instance 保存一次可重放执行；
- Learning Action Intent 以 `instruction | practice | assessment | feedback | repair` 区分当前实施目的，
  与 Run 的 Protocol Purpose 正交；
- Sense Encounter 是一次对一个 Sense、一个 Step purpose 的计划接触；Card Presentation 只是该 Step
  当前 prompt/support/response/reveal/feedback/detail 阶段的瞬时 renderer；
- 同一 Learning Protocol Run 可以跨多个 Encounter 和 Session；Structured Acquisition Cycle 仍可
  通过多个 Sense 的穿插完成干扰要求；
- Action 是系统选择的干预，Attempt 是 learner 提交的追加事实；固定 grader 先形成 Observation，
  Evidence Rule 再派生 Evidence，Progression Policy 最后产生 Transition Decision；
- Protocol Checkpoint 是可选的 protocol-local 评价里程碑，Acquisition Gate 是其中的高保证子类；
  Capability Objective、Checkpoint、Step 和 Card 不能互相替代；
- Study Completion 或 learner rating 不能被升级为 Learning Evidence；reset 只使显式 scope 内当前
  checkpoint credit 失效，不删除 Attempt、Observation、Evidence 或历史 Transition；
- 成功的 Initial Learning Protocol 必须产生 Initial Learning Completion 与且仅一个 Scheduling Handoff；
- due Retention Review Protocol 最多产生一个带规范 grade 的 Memory Outcome，并最多产生一次
  Scheduling Decision、调用一次 FSRS；
- Relearning Protocol 不创建 handoff、不重新初始化 FSRS、不改写或重复应用触发它的
  Review Outcome；只有 Protocol Version 声明为 scheduler-eligible 的独立重学评价才可产生
  自己的 Memory Outcome，Relearning Completion 本身不是 scheduler input。

### Personal Content

- “我的语义世界”页面是读取、治理与 Add-to-Learning 交接控制面，不是 Personal Semantic World 的
  第二个 store 或唯一 command source；应用内手动创建只是一个普通 Semantic Intake Port；
- Personal Semantic World membership 只来自 learner 的直接 Semantic Acceptance 或其明确授权的
  delegated acceptance；浏览、历史、无写入授权的 LLM 推断、收藏与推荐都不能静默创建成员；
- Semantic Intake 允许 Context、Expression、Sense 或 acceptance 缺失，缺失时留在 Intake Inbox。
  接收端只做合同结构与事实存在性校验，不重新判断调用方给出的 Context 是否充足；
  Inbox 是接收/处理状态，不是正式 Personal Semantic World membership；
- Personal Meaning 是 learner-owned 稳定 identity，并至少拥有一个 Context Anchor、一个在 Context
  中可定位的 Expression Anchor，以及一个指向 teaching-sufficient stable Sense Version 与兼容 Binding
  的 active Alignment；Meaning Focus 为零到多个的可选解析桥梁；
- Personal Semantic Anchor 可以承载受支持的文本、图片、音频、场景或其他个人经验。Personal
  Expression Anchor 必须保存 expression type、Language Tag、provenance 与 verification status；由
  Intake 产生时还必须保存字符 span、媒体区域或等价 occurrence locator。target/support/input/output
  role 只在 Route 或操作上下文中成立，不进入 Anchor identity；
- Semantic Intake 保存 declared、detected 或 learner-confirmed Language Observation；未知语言使相关
  Expression 事实留待补齐，暂不支持或不属于 Active Route 不是拒绝理由，也不得依据
  当前 Route 强制重标语言；
- Personal Meaning Alignment 可以直接由 Context + located Expression 的可靠解析支撑，只在必要时
  引用 Meaning Focus。不得从 Sense definition 合成 Focus，也不得为快轨伪造未发生的 Sense
  Construction、Proposal 或对话；
- Sense Proposal 属于可修改的 Sense Construction 过程，不是 Sense。只有有效 direct/delegated
  Semantic Acceptance 才可复用或创建 stable Sense + Sense Version + Personal Meaning Alignment，且
  不得覆盖原始 Context 与 acceptance provenance；
- Agent 在当前会话收到 learner 的明确保存请求，或持有持续授权时，调用正式 commit
  operation 可直接产生 delegated acceptance，无需第二次第一方确认；actor、basis、可选的
  authorization reference、resolver 与提交内容必须可审计。一次性明确请求不强制 grant id；
- Local Agent Intake 把固定 `libraryId` 的 CLI transport queue 经浏览器扩展 Native Messaging
  交给 Web；CLI 不直接访问 OPFS。只有 Web 的正式 commit 成功才回写 applied receipt，queued 不等于
  已进入 Personal Semantic World，并且该本机路径不要求账号；
- Remote Intake Delivery 使用账号范围和已登记本地 library 解析目的地，Agent 不在 payload
  中指定 library。云端只对合同、幂等与投递负责，不执行语义完整性判断或 Personal Meaning 写入；
- Saved Sense 指向稳定 Sense identity 并保留保存时 Sense Version provenance；Saved Example 指向
  exact immutable Example，不能在内容更新后静默替换；
- 每个 learner × Sense 最多存在一份 current Sense Note；Note 具有独立 revision，与 Saved Sense
  生命周期解耦；
- 一个 Personal Meaning 必须拥有至少一个 Personal Semantic Anchor；confirmed Alignment 允许这些
  Anchor 在 learner 明确授权时作为目标 Sense 的 optional scaffold 使用；
- Personal Collection 是 learner 命名、排序的组织对象；typed Membership 直接引用 stable Sense 或
  exact Example，不依赖 Saved record、不复制目标内容，也不创造语义关系；
- 收藏、写笔记、创建 Anchor、加入/移出 Collection、开始 Free Practice 与提交 Add-to-Learning
  Intent 是不同意图，任何一个都不能暗中触发另一个；
- unsave 不删除 Note/Anchor/Collection Membership；删除 Note/Anchor 不 unsave；删除 Collection
  只删除 Membership；从 Collection 移除也不 unsave；
- 最近学习、全部已学、需要巩固和已会是事实投影，不是可被手工维护的“单词本”。

### Learner Semantic Projection

- Learner Semantic Projection 是跨 Personal Semantic World、published Semantic Fields、Learner
  Sense Progress、其他 Personal Content 与 Practice history 的派生读取模型；
- 它可以表达有限区域中的“正在形成、已经建立、需要巩固、待探索”以及已审核 Sense Relations；
- 它可以把 Personal Meaning/Meaning Focus 作为 learner-owned 起点，把 Personal Semantic Anchor、
  Personal Expression Anchor、reviewed Experience、Sense specification、Support-Language Bridge 与 pinned
  target-language forms 作为 provenance 可区分的结构；
- Support-Language Bridge、Personal Anchor、target-language lemma 与视觉节点都不能取代 stable Sense
  identity；word、Usage Pattern 与完整 Example/utterance 必须保持各自 typed content identity，不能压成
  通用字符串；
- 它不拥有 progress，不把图布局或推断距离宣称为 learner 的真实语义结构；
- Projection 中选择的 Field、节点或集合可以成为 Practice Scope，但不能直接创建正式学习结果。
- Personal Semantic Region 与 Personal Meaning 属于 learner-owned source records，可以被 Projection
  展示，但不能自行修改 published Semantic Field、Sense Relation 或 progress；
- Personal Meaning Alignment 必须显式保留 resolution/acceptance provenance。模型输出本身不能
  静默升级为 acceptance；只有独立 direct operation 或基于明确用户请求/持续授权的 delegated
  commit 才能
  产生该事实。确认后的 Sense Expression Binding 也不能冒充 reviewed
  Learning Package resource；
- 未闭合到 stable Sense + target binding 的 Intake/Construction draft 或 Meaning Focus 不能成为
  Curriculum target。确认连接不得覆盖原始 Personal Meaning；独立的 Add-to-Learning Intent 可以先创建 Membership，但只有 Effective Learning
  Policy 与可执行的 Content Provisioning/Learning Protocol 解析为 `ready` Resolved Learning Plan 后，
  才能进入正式学习运行。

### Free Practice

- Free Practice 是独立的语言使用空间，不是宽松版 Learning Protocol 或第三种 Learning Session intent；
- 听、说、读、写是稳定的 learner-facing Practice Area，不是四个引擎、能力分数或毕业 Gate；跨通道
  Activity 仍只指定一个 primary Area，并如实声明 stimulus/response channels；
- Practice Brief 记录 learner 当前意图、交际目标、场景、optional Scope 与支架级别；它不是课程目标
  或 graduation standard；
- Free Practice Profile 定义一个交付版本允许的 Practice Activity Definitions 及其 target、channel、
  resource、interaction、feedback 与 session-policy requirements；
- Package Practice Manifest 与获准的 external provider availability 声明当前可用 practice resources；
  Runtime 只从 Profile、资源可用性与 client support 的交集发布 Executable Practice Capability Inventory；
- Free Practice Session 固定 Brief、Scope、primary Area、Activity Definition 与解析版本；Practice Turn
  可以产生 Practice Observation、Feedback 与 optional learner-owned Artifact；
- Free Practice 不经过 Unified Planner，不结算 Encounter Outcome，也不生成 Learning Evidence、
  Memory Outcome 或改写 Gate、5D、phase、daily plan 与 FSRS；这个边界不因 feedback 含判断或分数而改变；
- 从练习中另存新的 Context–Expression–Sense 必须提交独立 Semantic Intake；加入正式学习必须提交
  独立 Add-to-Learning Intent，两者都不能由 Practice completion 自动触发。

### Learner declaration

Declared Mastery（界面可显示为“熟”）是 learner 对一个 Retention Target 的可逆声明。它只改变计划
资格，不伪造 Gate pass、Acquisition Graduation、Attempt、Evidence、5D 或 FSRS 结果。Sense-level
界面操作必须明示其覆盖的目标表达集；首版每个 Sense 只有一个 primary target。

Web 本地运行时将该声明保存为 Library 中 Target 的结构化 `TargetPlanningOverride`。声明若命中 active
Run，同一 SQLite command 同时写入 Run interruption lifecycle fact 并清除 active pointer；撤销只
恢复 Target 的计划资格，下一次显式 start 才写入 matching resume fact。Protocol Queue 不保存第二份
Declared Mastery 状态，presentation plugin 只能请求 host 执行该 learner command，不能把它结算成
Protocol Outcome。

### Account、Preferences 与 Data Control

- Account 是认证访问与生命周期聚合，V1 恰好关联一个 Learner；Learner 独立拥有 Language Learning
  Routes、route-scoped Study Plans、
  Progress、Personal Content 与 Learner Preference；
- Account Session 是登录授权，不是 Learning Session。退出某个 Session 不删除 Account、Learner 或
  学习事实；认证凭据由 identity provider 管理，Sensa 不把密码当作领域数据；
- Account lifecycle 至少区分 `active | deletion_pending | deleted`。进入 deletion pending 后不得继续
  创建 learner operations，并必须使旧 Account Sessions 与 Replicas 失去写入资格；
- Learner Preference 是显式 typed fields + revision，不是任意 key-value bag。按 exact Language Tag
  作用域的发音口音、按 Input/Output Language Tags 作用域的 Language-Pair Glossary Entry 与例句译文
  默认状态属于 learner-scoped preference；它们跨设备同步并只影响未来呈现或 approved asset choice；
- Device Preference 属于具体 Device Installation。autoplay、theme、reduced-motion override、播放速度
  与音量、Interface Locale、surface-scoped Active Route Selection 等本机行为不进入 learner progress，
  也不要求跨设备一致；系统级无障碍设置优先；
- 每日新 Sense 上限、Book、Range、Enrollment mode 与 Learning Policy Assignment 属于 Study
  Plan/Curriculum；Settings Surface 可以导航过去，但不能把它们复制进普通 Preference；Notification
  Preference 是独立的 Later 能力；
- Sync Health 是 Replica/outbox、connectivity、installed content 与 convergence 的派生读取模型，
  不能由用户直接设置成“已同步”；
- Data Export Request 固定 request time、learner data scope 与处理状态，输出同一逻辑快照；Account
  Deletion Request 必须在线确认，并按策略撤销访问、阻止离线旧数据复活并完成删除或匿名化；
- sign-out、Local Data Clearance、学习数据 reset 与 Account deletion 是四种不同意图。V1 不提供
  全量 learning-history reset；清除本机数据不得制造服务端删除，删除 Account 也不能被建模成 Sync
  tombstone 的普通客户端偏好；
- Settings Surface 只是组合 Account、Preferences、Study Plan link、Sync Health 与 Data Control 的
  产品页面，不拥有第二份 account/profile/settings 状态。

## 4. Protocol-driven connection 与长期保持

Learning Protocol 定义一次“如何建立、检查、加强或恢复 Sense ↔ target-language 表达连接”的可复现
过程。每个 Protocol Run 固定 `initial_learning | retention_review | relearning` 中一个 purpose，并通过 Protocol
Steps 组织材料角色、交互、结果资格与 transition。领域模型至少接受 Lightweight 与 Structured 两种
协议 family；具体可用性由当前 stage/PRD 决定，领域模型不把任一 family 固定为唯一入口。协议和
内容来源分别选择，不能把某个 Package 结构、固定卡片数或页面顺序硬编码成唯一学习方式。

Learning Policy Profile 是 learner-facing 学习方式背后的版本化合同。一个 Profile 为三种 purpose
分别规定允许的 Protocol family，并组合 Content Requirements、Evaluation/Evidence、Progression/
Completion、Repair、Scheduling 与 claim boundary；
`lightweight` 和 `high_assurance` 是代表性 Profile，不是永久闭集。Learning Policy Assignment 是 Study
Plan/Curriculum 的显式操作而不是普通 Settings 值，Resolved Learning Plan 再以
`Learning Target × Effective Learning Policy × content/runtime capabilities` 解析当前是否可执行。

Policy Profile 只协调正交对象，不把三种 purpose 合成一个跨月 Run，也不把 FSRS 变成学习方法。
它不拥有每日新学数量，也不成为另一份 learner progress；Study Plan/Unified Planner 选出 Target，
Profile 只决定获选 Target 采用哪组实施与评价合同。
第一次正式 Protocol Run 创建时，Effective Learning Policy 冻结为 Retention Target 的 Committed
Learning Policy，并约束后续三个 purpose。普通 Profile/Assignment/default/source change 只可在该
Commitment 前重新规划；Commitment 后只能通过显式 Learning Policy Migration 在安全边界建立新
revision，active/historical Protocol、Outcome、Handoff 与 FSRS State 保持原版本。高保证 Profile
无法满足内容或 capability 要求时必须 blocked，不能静默降级。MVP 不提供该迁移入口。

### Initial Learning

```text
fixed Learning Target
        │
        ▼
Effective Learning Policy + ready plan
        │
        ▼
Learning Materialization × Initial Learning Protocol
        │
        ▼
compact teaching / optional retrieval
        │
        ▼
Study Completion
        │
        ▼
Scheduling Handoff ──▶ FSRS
```

Study Completion 是 `protocol_completion`、`non_evidentiary` 级别的 Initial Learning Completion；
成功时必须创建 Scheduling Handoff，但它不是 Learning Evidence、Acquisition Graduation 或 mastery
claim。Structured Initial Learning 则以 Acquisition Graduation 作为 `behavioral` completion。导入
完成若被系统接纳，也必须保留其独立 basis/evidence level，不能伪装成前两者。

Lightweight Initial Learning 可以没有评价性 Protocol Checkpoint：grounding/instruction、recall/practice、
reveal/feedback 与 learner rating/self-report 由 Completion Policy 结算为 Study Completion，不为接入
公共 Runtime 而伪造 Gate 或 behavioral Evidence。

### Structured Initial Learning

新 Sense 先进入分钟级或 Session 级的短期习得循环：

```text
introduction / binding
        │
        ▼
interference-spaced Acquisition Gates
        ├── contextual Sense recognition
        ├── Sense-to-form recall
        ├── novel-context transfer
        └── real Boundary target (conditional)
        │
        ▼
Acquisition Graduation
```

展示、自动播放、acknowledgement 或揭示后的即时答案不能解决 Gate。当前 Structured Profile 的
Progression Policy 在失败时只重新打开相应 Gate，必要时升级为完整 re-binding；这是该 Profile 的
选择，不是内核对所有 Protocol 的硬编码。其他 Protocol 可以重置声明的 Checkpoint 集合或整个 Run
的当前 credit，但任何 reset 都不删除历史 Attempt、Observation、Evidence 或 Transition。

### Retention Review

有效 Scheduling Handoff 初始化 FSRS；Structured Acquisition Graduation 只是其中证据等级最高的
一种 basis。之后 FSRS 只决定一个 retaining Retention Target 何时 due，Retention Review Protocol 或 Structured
Semantic Policy 决定 due 时如何复习和评价。一次 due Review 最多产生一个 Memory Outcome 和一次
FSRS 更新；reveal、detail 或即时重测不得形成第二个结果。Memory Outcome 必须分开保存规范
`again | hard | good | easy` grade、basis 与 evidence level；`correct` 只能作为 Observation/evaluator
输入，不能让 adapter 丢失“模糊/费力”后再猜测 grade。

### Relearning

失败或明显变弱的 Memory Outcome 落账后，Relearning Protocol 恢复连接。它可以是轻量 re-binding，
也可以是创建 Acquisition Cycle 的 Structured Relearning；后者只是子类型。Relearning Completion
不覆盖原 Memory Outcome、不创建 Scheduling Handoff，也不重新初始化 FSRS。协议可以声明
独立重学评价为 scheduler-eligible，但它必须产生一个 origin、evaluation identity 和幂等边界明确的
新 Memory Outcome；它不得冒充原 Review 的第二个结果。

Protocol Step 与 Card Presentation 的边界适用于以上三种 purpose：Step 是协议结构，Card 只是瞬时
呈现。一个 Step 可以用多个 Card 阶段，一个 Card renderer 也可以服务多个 Step；Card、Deck 或页面
不能成为学习 identity、进度聚合或 scheduler owner。

## 5. 模块边界

1. **Account & Access Module**：拥有 Account、Account Session、identity-provider binding 与 Account
   lifecycle；它授权 LearnerScope，但不拥有学习事实；
2. **Preference Module**：拥有 versioned Learner Preference；各客户端独立拥有包含 Interface Locale 与
   surface-scoped Active Route Selection 的 Device Preference，并按显式 precedence 解析系统设置、本机
   override 与 learner defaults；
3. **Data Control Module**：拥有 Data Export/Delete Request 的幂等、授权、状态与审计生命周期，并
   协调 Account、learner-owned stores 与 Replica invalidation；
4. **Catalog Module**：读取已发布、已固定的 Book、Sense Learning Package、Semantic Field、
   Reference Release、Reference Sense、Sense Alignment 与 Lexical Enrichment；
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
   Anchor、Personal Expression Anchor、Personal Meaning Alignment，以及 Saved Sense/Example、Sense
   Note、Personal Collection 与 typed Membership 的 learner-scoped 事实及同步生命周期；它可以提交
   bridge Intent，但不是 Curriculum/Learning Runtime 的依赖；同名 Product Surface 只能通过本模块与
   Semantic Intake 的正式 operations 读写，不能另存一份页面 state；
9. **Sense Construction Module**：只在普通 Contextual Sense Resolution 不足时编排 learner–LLM 语义
   访谈、optional Meaning Focus、Sense Proposal 与 Semantic Acceptance；它可以按需
   请求创建 stable Sense/Version，但不能创建 Learning Evidence、Curriculum Membership 或绕过
   后续内容物化与协议选择；
10. **Learner Semantic Projection Module**：组合 Personal Semantic World、已发布 Field、learner
   progress 与 personal content，只生成可重建读取模型；
11. **Free Practice Module**：解析 Practice Brief、Scope、primary Area 与 Activity Definition，保存
   Practice Turn、Observation、Feedback 与 optional Artifact；它可以读取 Learning Target、Personal
   Semantic World 与获准资源，但不调用正式 Learning Kernel 的证据、结算或调度接口；
12. **Content Provisioning Module**：按 Resolved Learning Plan 将固定 Learning Target 与 Pinned Language
   Context 通过 published、
   on-demand 或 hybrid 路径解析为 capability/readiness result 和通过合同校验的不可变 Learning
   Materialization；它拥有 Provisioning Batch、Content Provisioning Task、Content Agent Attempt、
   Material Candidate Bundle、独立 validation/admission 与 assembly。Learning Content LLM 及其获准工具
   只在单 Task Attempt 内生产未受信候选，不能改写 Sense、Learning Policy、Protocol 或 learner progress，
   也不能批准自身输出；
13. **Learning Policy & Protocol Module**：拥有 versioned Learning Policy Profiles，结合 Curriculum
   Assignment 解析 Effective Learning Policy 与 Resolved Learning Plan，选择并执行 purpose-specific
   versioned Protocol，定义 Step/Checkpoint、material role binding、Evaluation/Progression/Completion
   Policy 与合法 Transition effects，创建 Protocol Run/Step Instance，接纳与 purpose 兼容的合法结果，
   并在成功 Initial Learning Completion 的同一权威边界创建必需的 Scheduling Handoff；
14. **Executable Learning Capability Resolver**：为 Structured Acquisition 求 Package、Required
   Capability Set、approved resources 与 Runtime 能力的版本化交集，不读取 learner state；
15. **Learner Progress Module**：拥有 Retention Target、其 Learning Phase、active protocol run、
   protocol-specific Checkpoint credit/progress epoch、Memory State 以及 Sense-level roll-up，并记录
   Initial Learning Completion、Study Completion、Acquisition Graduation 与 Relearning Completion；
16. **Unified Planning Module**：只从 purpose-ready Resolved Learning Plans 中，在 Study Plan、Session
   intent、Declared Mastery、cooldown、protocol readiness、Relearning readiness 与 due state 之间选择候选；
17. **Semantic Policy Module**：在 Structured Acquisition 内从 Step purpose、capability inventory、Gate progress、
   Evidence、5D 与历史中选择最小干预；
18. **Encounter Module**：按 Protocol Step Instance 固定 Materialization/Action，物化瞬时 Card Presentation，
   接受 Attempt，并用 pinned interaction/grader contract 形成 Observation；
19. **Evaluation & Evidence Module**：从 Observation 按固定 Evidence Rule 派生追加 Evidence，应用
   versioned Progression/Completion Policy 产生原子、幂等 Transition Decision，并重建 Checkpoint、Gate
   与 5D 投影；
20. **FsrsAdapter**：按 Retention Target 消费有效 Scheduling Handoff 与来自 Review 或合法
   Relearning evaluation 的 graded Memory Outcome，产生 Scheduling Decision，是 FSRS Memory State
   与 next due 初始化和更新的唯一接口；
21. **Sensa Sync Module**：传输本地已提交的版本化记录与内容寻址数据块，维护幂等、清单和收敛状态，但不解释或重新结算学习事实；
22. **Media Module**：验证不可变媒体引用并提供授权下载。
23. **Language Context Module**：从显式 operation roles、正式学习 Route 或当前 surface 的 Active Route
    Selection 解析并冻结 Pinned Language Context；pre-route semantic work 不因此创建 Curriculum Route，
    本模块也不从 Route 推断捕获内容语言或把 target/support role 写回 Expression；
24. **Language Support Resolver**：按 exact Language Tag 与 speech、reference、translation、content
    或 renderer capability 返回 exact support、显式 fallback 或 unavailable；它不改写任何语言事实。
25. **Remote Intake Delivery Module**：以认证账号解析唯一已登记的本地 library，持久保存 canonical Intake
    mailbox item，拥有 `queued | applied` 回执、拉取/确认和 operation-id 幂等；它不读取或裁决语义内容，
    也不把入队伪装成本地提交。
26. **Account Backup Port**：定义 immutable Recovery Point manifest、完整性摘要、library/learner/schema
    identity 与 `account_assisted | zero_knowledge` 恢复模式。当前只有端口和合同，没有生产 route、store、
    scheduler 或 restore workflow；未来实现不能复用 Sync cursor 冒充 Recovery Point。

## 6. 全局不变量

- Sense identity 不能退化成词头下没有稳定身份的一行 support-language 释义，也不能只用一个
  target-language 字符串代替可复现的意义边界；
- Account 与 Learner 是不同身份；V1 一对一不允许把认证、Profile、Workspace 或登录 Session 混入
  Learner Sense Progress；
- Settings Surface 不是聚合；每项写操作必须到达 Account、Preference、Curriculum、Device 或 Data
  Control 的真实 owner，不能维护第二份通用 settings state；
- Language Learning Route 固定 Target Language、可与其相同的 default Support Language 和 route-scoped
  Study Plan；Learner 可以拥有多条 Route，但领域不据此建立全局母语、唯一 Familiar Language 或
  known-language/proficiency 事实；
- Active Route Selection、Interface Locale、Target/Support Language 与单次操作的 Input/Output Language
  是不同事实；选择变化只影响后续操作，不能重绑 active Session、Content Provisioning Task 或
  Sense Construction；
- Language Tag 与 Language Observation 必须保留 script/region variant 和 provenance；能力目录或
  Active Route 不能把未知、unsupported 或 route-external 内容重标成另一种语言；
- Learning Session、Sense Construction 和其他语言相关长操作必须固定 Pinned Language Context；正式
  Learning Session 必须固定 Route revision，pre-route semantic work 可以只固定显式 operation roles；
  同一 Retention Target 跨兼容 Route 仍只有一份正式进度和 FSRS Memory State；
- Learner Preference 必须 typed、versioned、跨设备收敛；Device Preference 只在本机生效。两者都
  不能回写 Action/Attempt/Evidence/Outcome、Gate、5D、FSRS 或历史资源引用；
- 每日新 Sense 上限、Book、Range、Enrollment mode 与 Learning Policy Assignment 不是普通 Preference；
  改变学习计划或学习方式必须产生真实 Curriculum operation/revision；
- sign-out、Local Data Clearance、learning-history reset 与 Account deletion 不能互相替代；有 pending
  outbox 时不得静默清除本机数据，旧 Replica 也不得在 Account deletion 后复活数据；
- Sync Health 只能从连接、待同步本地提交、content installation 与服务端 convergence 事实派生，不能由界面
  直接声明“已同步”；
- Reference Sense 与 Sensa Sense 是不同身份；词典覆盖不能自动扩张 Curriculum 或 learner progress；
- Contextual Lookup 必须固定 Example + exact span + Reference Release；没有可靠解析时不得假装知道
  “本句中”的唯一意思；
- Reference 浏览、搜索、点词与 Lexical Enrichment 阅读不产生 Learning Evidence，也不推进 Gate、
  5D、daily quota、Memory Outcome 或 FSRS；
- active assessment 在 response/feedback 前不得从产品内部打开 Reference Lookup 或其他答案泄露路径；
- assessment-only 与 learning-only 资源不得进入 Reference 详情；产品不建设“真题”内容或占位页；
- Book membership 固定 Sense 与 primary expression；Learning Protocol Run、Evidence、Declared Mastery
  和 FSRS 按 Retention Target 隔离；
- Study Plan 不等于 Book；Book Version 不因 learner 切换、范围选择或个人添加而被修改；
- 同一 Retention Target 来自多个 Curriculum source 时只拥有一个 active protocol run 和一个
  FSRS Memory State；同一 Sense 的不同 target expressions 不得合并；
- 换词书、缩小 Book Range、暂停 Enrollment 或移除 Supplemental Membership 都不能删除或重置
  Learner Sense Progress；它们只在新的 Study Scope Revision 中改变 Planning eligibility；
- Study Scope 变更不能静默改变 active Session；Session/Encounter 必须保留用于计划它们的 Scope
  revision 与 Curriculum provenance；
- Semantic Field 是有限、版本化的内容邻域，不是 Book、学习路径或通用人类 ontology；
- Personal Semantic World 只接纳具备真实 Context、located Expression、teaching-sufficient stable Sense/
  Binding 与有效 Semantic Acceptance 的完整 Personal Meaning；未闭合 Intake 留在 Inbox；
- 创建 Personal Meaning 不得依赖 learner 打开主应用或 Personal Semantic World Surface；第一方页面、
  浏览器/移动/桌面扩展与 authorized Agent 都通过同一幂等 Intake/commit authority 收敛；
- Personal Semantic World Surface 只能组合权威 facts 与可重建 projections，并发出显式 commands；它
  不是 aggregate、第二份 semantic store 或外部端口的必经网关；
- Semantic Acceptance 可以由 learner 直接执行，也可以由 Agent 基于当前明确请求或持续授权
  委托执行；二者 membership 效力相同而 provenance 不同，委托调用无需二次确认，
  一次性明确请求不强制独立 grant id；
- Intake 接收端以 Context、Expression、Sense 和 acceptance 的存在性分流；语义充足性由产生者
  负责，接收端不重新调用模型审查；
- 同一 Intake operation id 只能绑定同一份 canonical payload；完全相同的重试返回同一回执，
  不同内容必须报冲突；
- Remote Intake Delivery 的 `queued` 不等于本地 `applied`；Sync 收敛也不等于备份可恢复性。
  只有已完整存储并验证的 immutable Recovery Point 才能被称为备份；
- Meaning Focus 是可选的 Context→Sense 解析桥梁，不是 Personal Meaning、Alignment 或快轨不变量；
  不得从 Sense definition 合成伪 Focus，或为完整摄取伪造未发生的 Construction/Proposal 链；
- Formal Learning 不依赖 Personal Semantic World；Book、direct stable-Sense 与 personal-first entry 在
  Learning Target 汇合，Learning Entry Provenance 不改变 Target/Retention identity；
- direct learning 仍必须固定 stable Sense/Version 与 target binding；裸词或未对齐 Reference Sense 不能
  成为正式学习 identity；
- Personal Content 删除/组织与 Curriculum/Progress 生命周期独立；桥接后任一侧操作不得级联删除或
  伪造另一侧事实，Personal Anchor 只可作为显式授权的可选 scaffold；
- Learner Semantic Projection 只能从权威事实重建，不能成为第二份 progress 或“脑内掌握度”；
- Learner Semantic Projection 中的 support/target-language 呈现必须保留 reviewed、learner-authored 与
  form-level provenance；support-language 标签和 target-language lemma 都不能被写回为 Sense 或 progress identity；
- 创建或编辑 Personal Semantic Region、Personal Meaning、Meaning Focus、Personal Semantic Anchor
  与 Personal Expression Anchor 只改变 Personal Content；它们不产生 Evidence、5D、Acquisition
  Graduation 或 FSRS Memory State，也不能暗中提交 Add-to-Learning Intent；
- Sense Proposal 不是 Sense；只有有效 direct/delegated Semantic Acceptance 才能创建 stable
  Sense/Version 和 Personal Meaning Alignment。Acceptance 仍不代表内容已发布、表达已学会或已经
  加入 Curriculum；
- Sense Construction 不依赖穷尽式预建 Sense 库；已有 Sense 的相似检索、复用和关系发现是可选治理
  步骤，不得覆盖 learner 已确认边界或阻塞无匹配项的新 Sense 创建；
- Semantic LLM、Learning Content LLM 与未来 Grading LLM 是不同领域角色；它们分别受独立输入、
  输出、权限、校验、provenance 与 fallback 合同约束，不能因使用同一 provider 而合并所有权；
- 内容来源与 Learning Protocol 必须正交；Published Package 不是唯一合法来源，Structured
  Acquisition 也不是唯一合法协议；
- 每个 Content Provisioning Task 必须固定单一 Learning Target、purpose-specific Protocol 与 exact
  Content Demand；Content Agent Attempt 只能在该边界内调用 closed、typed、versioned tools，并在
  提交 Material Candidate Bundle 后终止；
- Agent output 与 Agent-side preflight 都不是 authority。只有 system-owned independent validation/
  admission 和 assembly 可以产生 Learning Materialization；Bundle 被拒绝后的重试必须创建新 Attempt；
- Provisioning Batch 只是独立 Task 的非原子调度/观测容器；不得共享 target context、传播单项失败、
  产生 Runtime progress 或定义 learner 每日新学数量；
- Learning Policy Profile 必须显式、版本化、可审计，并作为 Protocol、Content Requirements、Evaluation/
  Evidence、Progression/Completion、Repair、Scheduling 与 Claim Policy 的命名组合；它不合并这些对象、
  不拥有 progress 或每日数量。Assignment scope/precedence、Effective Policy 与 plan resolution
  provenance 必须可重放；
- Learning Entry Provenance 与 Learning Policy 保持正交；来源只可影响默认推荐和实际 readiness，
  不能永久决定方法或静默降级 learner 已选择的保证级别；
- Add-to-Learning 接纳可以先于内容物化；`preparing/blocked` Membership 保留 learner intent，但只有
  `ready` Resolved Learning Plan 可以进入正式 Planner inventory。内容/capability 不足不能伪造进度，
  高保证 Profile 也不能静默降级；
- 第一次正式 Protocol Run 创建时必须冻结 Committed Learning Policy；此后普通 Assignment、默认方式、
  新来源或新增内容不能改变该 target 的学习方式；未来切换必须走显式 Learning Policy Migration；
- Policy change/migration 不改变 Learning/Retention Target、不重置 FSRS、不改写 active 或 historical
  Protocol facts；已完成 Initial Learning 不因迁移而自动创建第二个 Handoff；
- 每个 Learning Protocol Run 必须且只能固定一个 Protocol Purpose；Initial Learning、Retention Review
  与 Relearning 的完成事实和 scheduler 权限不能互相冒充；
- Protocol Step 拥有材料组织、交互/判分、结果资格与 transition；Card Presentation 只渲染当前 Step
  阶段，不拥有 identity、curriculum membership、Evidence、progress 或 FSRS；
- Learning Capability Objective、Protocol Checkpoint、Step/Action 与 Card 必须保持不同 identity；
  Checkpoint 可选，Acquisition Gate 只是 Structured Acquisition 的高保证子类；
- Learning Action Intent 与 Protocol Purpose 正交；只有合法 `assessment` Action 能进入正式评价，
  instruction、practice、feedback、repair 或视觉位置不能自行产生 Evidence；
- Published 内容不可变，修订通过新 version/release 完成；On-demand 内容在一次 run 开始前必须
  冻结为 Learning Materialization，response 发生后不得重新生成并替换题目、答案或评分依据；
- Attempt、Observation 与 Evidence 是追加事实；正式评价沿 `Attempt → Observation → Evidence（若合格）
  → Transition Decision` 推进，Gate、Checkpoint credit、5D 与 FSRS 由本地 Learning Runtime 在同一权威事务中派生；
- Progression Policy 只能产生内核声明的受约束 effects；Progress Reset 只使显式 scope 内当前 credit
  失效，不删除 Attempt、Observation、Evidence 或历史 Transition；
- Completion 只能由版本化 Completion Policy 基于当前有效状态推导，不能由 Card、队列为空或客户端
  flow state 推导；
- Study Completion、learner rating 与 Learning Evidence 是不同事实；每个成功 Initial Learning
  Completion 必须且只能创建一个 Scheduling Handoff，但不得借此宣称通过未完成的 Gates、5D 能力
  或已经掌握；
- Retention Target 按 learner × Sense × target expression 隔离；Learner Sense Progress 只是
  roll-up，不能把同一 Sense 的不同表达折叠成一份 FSRS State；
- capability-specific Evidence/Projection 默认共享其 Retention Target 的调度；只有明确、
  稳定且值得独立调度的长期能力合同才能扩展 target scope，卡片、例句和页面不行；
- 被动展示、自动播放、继续按钮、自报理解和答案揭示后的立即重答不构成独立 Gate Evidence；
- Structured Baseline Acquisition 需要三次分别承担 contextual Recognition、Sense → Form Recall 与 novel
  Context Transfer 的独立成功；它们不能折叠成一次 Attempt；
- Boundary 只有在存在真实、重要且可执行的 confusion target 时才成为 required Gate；
- 一个 Gate 失败不抹除其他 Gate 的历史事实；针对性 repair 后必须经过干扰再独立重测；
- Initial Acquisition Graduation 表示 Structured Protocol 可以交接长期保持，不表示永久掌握；
- FSRS 只在有效 Scheduling Handoff 后拥有 due；handoff 必须记录 protocol、basis、evidence level
  与 initializer version；Retention Review 只能通过 Memory Outcome 更新既有状态，且只有 Scheduler/
  FsrsAdapter 可以产生新 Memory State 与 next due；Protocol、preset、Card 与客户端不能直接写入；
- Review 的第一次协议有效评价决定该次唯一 graded Memory Outcome 与唯一 Scheduling Decision；
  grade 使用 `again | hard | good | easy` 并与 basis/evidence level 分离，`correct` 不能替代它；后续 Relearning
  不覆盖或重复评价它，也不创建 handoff 或重新初始化 FSRS；
- Protocol Version 可以将独立 Relearning evaluation 声明为 scheduler-eligible；该评价只能产生
  自己的、可审计且幂等的 Memory Outcome，Relearning Completion 本身不是 scheduler input；
- `review_only` 不能引入新 Sense、推进 initial Learning Protocol 或消耗 daily-new quota；
- Free Practice 不满足 daily plan、不清除 due、不推进 Protocol Run/Relearning，也不生成 Learning
  Evidence、Encounter Outcome、Memory Outcome 或 FSRS update；即使保存 Practice Observation、
  Feedback、score 或 Artifact，该边界也不改变；
- 听说读写只组织 Practice Area；跨通道 Activity 必须固定一个 primary Area 并如实声明实际 target，
  不能仅凭表面动作宣称 Sense retrieval 或 transfer；
- 收藏、笔记与 Practice facts 不自动把 Sense 加入 Study Plan；只有被 Curriculum 接纳的
  Add-to-Learning Intent 才能创建 Supplemental Membership；
- Personal Content 的保存、注释、Anchor、Collection、Practice 和 Add-to-Learning operations 彼此
  独立；重复提交保持幂等，删除一个对象不能级联伪造其他 learner intent；
- Personal Semantic Anchor 只能作为 learner-controlled scaffold，不能成为发布事实、答案依据、
  assessment asset 或 Learning Evidence；
- Content Release 更新不能静默替换 Saved Example，也不能删除稳定 Sense 上的 Note/Anchor；
- 界面与同步适配器可以提交原始操作，但不能绕过本地 Learning Runtime 直接声明派生进度；
- Progression、Completion、Handoff、Memory Outcome 与 Scheduling transition 必须原子、幂等；
- Cards、Decks、generic flashcard sync、Workspace 产品入口和历史实验不属于 Sensa 领域。

## 7. 文档边界

本文不冻结 Gate 数量阈值、具体 Action/Practice Activity Definition 或 Turn payload、cooldown 间隔、Semantic Field
可视化布局、词典供应商、Contextual Sense Resolution 阈值、identity provider、Account deletion
恢复窗口、LLM provider/prompt、Sense Proposal 展示数量、相似 Sense 检索阈值、具体 Preference
字段、HTTP/SQL、Sync payload、例句数量或页面布局。它们属于版本化实现
合同、delivery/practice/reference profile 与 PRD，但必须服从本文的学习、参考、账号、设置与数据
控制边界和全局不变量。
