# Sensa 生产领域架构

> 状态：Canonical domain model  
> 更新日期：2026-08-28

本文是 Sensa 领域对象、聚合边界和全局不变量的主入口。术语定义以
[`../../CONTEXT.md`](../../CONTEXT.md) 为准；资源细节和运行行为分别由
[`sense-learning-resource-model.md`](sense-learning-resource-model.md) 与
[`learning-runtime-model.md`](learning-runtime-model.md) 裁决。

## 1. 产品组成

Sensa 由三个职责独立的层组成：

- **Product Shell**：用户看到的信息架构、Curriculum lifecycle、Session intent、Lexical Reference、
  Settings Surface、个人语义投影、自由练习、学习节奏和反馈；
- **Learning Kernel**：Sense 内容能力、Acquisition Cycle、Semantic Policy、Evidence、
  Gate progress 与 5D State；
- **Production Base**：身份、Postgres、离线副本、Sensa Sync、媒体授权和 FSRS。

Product Shell 不定义学习证据或毕业条件。Learning Kernel 不拥有账号、网络同步或媒体字节。
Production Base 不决定一个 Sense 应当如何被理解或当前应当使用哪种学习干预。

## 2. 核心领域关系

```text
Lexeme ──contains──▶ Sense ──versioned as──▶ Sense Version
   │                                      │
   └── Lexeme Version                     ├── Sense Learning Package
                                          └── Sense Relation ──▶ Semantic Field Version
                                                   │
Book ──versioned as──▶ Book Version ──pins─────────┘
                              │
                              ▼
                       Book Enrollment ──────┐
                                            │
Saved Sense ──Add-to-Learning Intent──▶ Supplemental Curriculum
                                            │
Learner ──configures──▶ Study Plan ─────────┤
                                            ▼
                                  Study Scope Revision
                                            │
                                            ▼
                                  Learner Sense Progress
                    ├── Learning Phase
                    ├── Acquisition Cycle ──▶ Acquisition Gates
                    ├── 5D State
                    ├── Declared Mastery
                    └── FSRS Memory State (only after graduation)
                              │
                              ▼
Learning Session ──contains──▶ Sense Encounter
                                  │
                                  ├── Action ──▶ Attempt ──▶ Evidence
                                  │                         ├── Gate projection
                                  │                         └── 5D projection
                                  └── Encounter Outcome
                                      ├── Acquisition Step Outcome
                                      └── Memory Outcome ──▶ FSRS
```

正式学习以外的个人内容、语义探索与自由练习通过另一条链连接，但不反向改写正式进度：

```text
Published Senses + Relations + Semantic Fields
                     +
Learner Sense Progress + Saved Senses/Examples + Sense Notes/Anchors/Collections
                     +
              Practice Activity
                     │
                     ▼
        Learner Semantic Projection

Practice Scope ──▶ Free Practice Session ──▶ Practice Task
                                                │
                                                └── Practice Attempt ──▶ Practice Result
                                                                          ╳ Gate / 5D / FSRS
```

`Lexeme` 是共享词形聚合；`Sense` 是内容、课程、学习状态、声明和调度身份。同一 Lexeme
的 sibling Senses 可以在产品中聚合呈现，但不能共享 Acquisition、Evidence 或 FSRS 状态。

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

- Lexeme/Sense 的稳定身份与不可变版本分离；
- Sense Learning Package 固定同一 release 的 Sense Version、Lexeme Version、Profile 与资源；
- Acquisition Profile 诊断该 Sense 的能力需求，并推导 Required Capability Set；
- Required Asset Manifest 与 Executable Capability Inventory 证明发布内容能端到端支持这些能力；
- Sense Relation 是同一 release 中经过审核的两个 Sense 之间的语义事实；
- Semantic Field Version 用有限、可审核的 Senses 与 Relations 表达局部意义邻域，不决定课程顺序；
- Content Release、Package 与 Book Version 发布后不原位修改。

### Curriculum

- Book Version 是经过筛选、排序的不可变 Sense 课程，不是词典全义项转储；
- Study Plan 是 learner 的正式学习安排，组合 Book Enrollment、Supplemental Curriculum 与每日新
  Sense 上限；它不再等同于一个 Book Version；
- Book Enrollment 固定一个不可变 Book Version 与一个已解析 Book Range，mode 为
  `active | maintenance | paused`；同一 learner 最多有一个可以引入新 Sense 的 active Enrollment；
- `active` 提供新 Sense 并继续既有学习，`maintenance` 不再引入新 Sense，但继续已开始的
  Acquisition/Relearning 与 due Review，`paused` 完全退出 Planning 但不删除任何进度；
- 切换词书默认把旧 Enrollment 转为 `maintenance`、把目标 Enrollment 转为 `active`。以后切回时
  复用 learner × Sense 的原进度，不重开已完成 Cycle，也不重新初始化 FSRS；
- Book Range 只控制未来 Introduction；缩小范围不能删除已经发生的学习事实，已经通过该
  Enrollment 开始的 Sense 由 Enrollment mode 决定是否继续；
- Supplemental Curriculum 是 learner-owned、ordered、Sense-only 的补充课程，不是 Book、Saved
  list 或 Personal Collection；同一 Sense 可以有多个来源，但只进入一次有效 Study Scope；
- 每次换词书、调整 Range、切换 Enrollment mode、接纳或移除 Supplemental Membership，都产生
  新的不可变 Study Scope Revision；正在进行的 Session 固定旧 revision，不被静默改队；
- 默认课程策略可以错开同一 Lexeme 的多个新 Sense；只有明确的边界教学才应主动并置；
- UI 可以展示 Lexeme 数与 Sense 数，但不能把 sibling Senses 合成一个课程成员；
- Add-to-Learning Intent 是进入 Curriculum 的显式 learner request；Curriculum 决定如何接纳或拒绝，
  但不能修改已发布 Book Version，也不能把收藏本身解释成该 request。Intent 目标已在有效范围时
  必须幂等返回 `already_in_scope`；缺少可执行 published Package 或存在 active Declared Mastery 时
  必须诚实拒绝或要求独立恢复操作，不能制造幽灵 Membership 或静默撤销声明。

### Lexical Reference

- Reference Release 固定来源、版本、locale、license、Reference Lexical Units、Reference Senses 与
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

- Learner Sense Progress 是 learner × Sense 的权威进度聚合；
- Learning Phase 为 `new | acquiring | retaining | relearning`，Declared Mastery 与之正交；
- Acquisition Cycle 固定 cycle reason、policy version、Required Gate Set 与 Gate progress；
- Gate progress 决定短期习得是否完成，5D State 提供长期诊断，两者不互相替代；
- FSRS Memory State 只在 initial Acquisition Graduation 后存在，并保持 Sense 隔离；
  Relearning Completion 不重新初始化它。

### Learning Runtime

- Learning Session 是一次有边界的活动容器，并固定 `mixed | review_only` intent；
- Sense Encounter 是一次对一个 Sense、一个主要学习目的的计划接触；
- 同一 Acquisition Cycle 可以跨多个 Encounter 和 Session，多个 Sense 的 Encounter 可以穿插；
- Action 是系统选择的干预，Attempt 是 learner 提交的追加事实；
- Evidence、Gate progress 与 5D State 都由服务端固定规则派生；
- Acquisition Encounter 产生 Acquisition Step Outcome，不直接评价 FSRS；
- due Review Encounter 最多产生一个 Memory Outcome，并最多调用一次 FSRS。

### Personal Content

- Saved Sense 指向稳定 Sense identity 并保留保存时 Sense Version provenance；Saved Example 指向
  exact immutable Example，不能在内容更新后静默替换；
- 每个 learner × Sense 最多存在一份 current Sense Note；Note 具有独立 revision，与 Saved Sense
  生命周期解耦；
- 一个 Sense 可以拥有零到多个 Personal Semantic Anchors；每个 Anchor 是 learner 自己的经验或
  场景，只有 learner 明确允许时才能作为 optional scaffold 使用；
- Personal Collection 是 learner 命名、排序的组织对象；typed Membership 直接引用 stable Sense 或
  exact Example，不依赖 Saved record、不复制目标内容，也不创造语义关系；
- 收藏、写笔记、创建 Anchor、加入/移出 Collection、开始 Free Practice 与提交 Add-to-Learning
  Intent 是不同意图，任何一个都不能暗中触发另一个；
- unsave 不删除 Note/Anchor/Collection Membership；删除 Note/Anchor 不 unsave；删除 Collection
  只删除 Membership；从 Collection 移除也不 unsave；
- 最近学习、全部已学、需要巩固和已会是事实投影，不是可被手工维护的“单词本”。

### Learner Semantic Projection

- Learner Semantic Projection 是跨 published Semantic Fields、Learner Sense Progress、Personal
  Content 与 Practice Activity 的派生读取模型；
- 它可以表达有限区域中的“正在形成、已经建立、需要巩固、待探索”以及已审核 Sense Relations；
- 它不拥有 progress，不把图布局或推断距离宣称为 learner 的真实语义结构；
- Projection 中选择的 Field、节点或集合可以成为 Practice Scope，但不能直接创建正式学习结果。

### Free Practice

- Free Practice Session 由 learner 主动开启并固定 Practice Scope 与 learner-facing Practice Mode；
- Free Practice Profile 定义一个交付版本允许的 Task families 及其 resource/renderer/grader requirements；
- Package Practice Manifest 声明某个 Package 实际获准提供的 practice roles/resources；Runtime 只从
  Profile、Manifest 与当前 client support 的交集发布 Executable Practice Capability Inventory；
- 听、说、读、写是 receptive/productive × sound/written 的入口，不是四个毕业 Gate；
- 每个 Practice Task 明确 prompt channel、response channel、target capability 与 support level；
- 被动活动只记录 Practice Activity；可判分响应产生 Practice Attempt/Result；
- Free Practice 不经过 Unified Planner，不结算 Encounter Outcome，也不改写 Gate、5D、phase 或 FSRS。

### Learner declaration

Declared Mastery（界面可显示为“熟”）是 learner 对一个 Sense 的可逆声明。它只改变计划
资格，不伪造 Gate pass、Acquisition Graduation、Attempt、Evidence、5D 或 FSRS 结果。

### Account、Preferences 与 Data Control

- Account 是认证访问与生命周期聚合，V1 恰好关联一个 Learner；Learner 独立拥有 Study Plan、
  Progress、Personal Content 与 Learner Preference；
- Account Session 是登录授权，不是 Learning Session。退出某个 Session 不删除 Account、Learner 或
  学习事实；认证凭据由 identity provider 管理，Sensa 不把密码当作领域数据；
- Account lifecycle 至少区分 `active | deletion_pending | deleted`。进入 deletion pending 后不得继续
  创建 learner operations，并必须使旧 Account Sessions 与 Replicas 失去写入资格；
- Learner Preference 是显式 typed fields + revision，不是任意 key-value bag。发音口音与例句译文
  默认状态属于 learner-scoped preference；它们跨设备同步并只影响未来呈现或 approved asset choice；
- Device Preference 属于具体 Device Installation。autoplay、theme、reduced-motion override、播放速度
  与音量等本机行为不进入 learner progress，也不要求跨设备一致；系统级无障碍设置优先；
- 每日新 Sense 上限、Book、Range 与 Enrollment mode 属于 Study Plan/Curriculum；Settings Surface
  可以导航过去，但不能把它们复制进 Preference；Notification Preference 是独立的 Later 能力；
- Sync Health 是 Replica/outbox、connectivity、installed content 与 convergence 的派生读取模型，
  不能由用户直接设置成“已同步”；
- Data Export Request 固定 request time、learner data scope 与处理状态，输出同一逻辑快照；Account
  Deletion Request 必须在线确认，并按策略撤销访问、阻止离线旧数据复活并完成删除或匿名化；
- sign-out、Local Data Clearance、学习数据 reset 与 Account deletion 是四种不同意图。V1 不提供
  全量 learning-history reset；清除本机数据不得制造服务端删除，删除 Account 也不能被建模成 Sync
  tombstone 的普通客户端偏好；
- Settings Surface 只是组合 Account、Preferences、Study Plan link、Sync Health 与 Data Control 的
  产品页面，不拥有第二份 account/profile/settings 状态。

## 4. 两层学习循环

### Short-term Acquisition

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

展示、自动播放、acknowledgement 或揭示后的即时答案不能解决 Gate。失败只重新打开相应能力，
必要时升级为完整 re-binding；历史 Evidence 不删除，已经解决的无关 Gate 不机械归零。

### Long-term Retention

Initial Acquisition Graduation 初始化 FSRS。之后 FSRS 只决定一个 retaining Sense 何时 due，Semantic
Policy 决定 due 时检验哪种能力。独立 Review 失败产生一次失败 Memory Outcome，并打开
Relearning Cycle；修复和重学不得把一次遗忘重复计为多次 FSRS review，Relearning Completion
也不重新初始化 FSRS。

## 5. 模块边界

1. **Account & Access Module**：拥有 Account、Account Session、identity-provider binding 与 Account
   lifecycle；它授权 LearnerScope，但不拥有学习事实；
2. **Preference Module**：拥有 versioned Learner Preference；各客户端独立拥有 Device Preference，
   并按显式 precedence 解析系统设置、本机 override 与 learner defaults；
3. **Data Control Module**：拥有 Data Export/Delete Request 的幂等、授权、状态与审计生命周期，并
   协调 Account、learner-owned stores 与 Replica invalidation；
4. **Catalog Module**：读取已发布、已固定的 Book、Sense Learning Package、Semantic Field、
   Reference Release、Reference Sense、Sense Alignment 与 Lexical Enrichment；
5. **Lexical Reference Module**：解析 Example + character span，读取 version-pinned Reference entry、
   Lexical Occurrence 与 Contextual Sense Resolution，并生成可重建搜索/详情读取模型；它不拥有
   learner progress，也不自由生成词典释义；
6. **Curriculum Module**：拥有 Study Plan、Book Enrollment/Range、Supplemental Curriculum、
   Add-to-Learning Intent 与 Study Scope Revision；它保证 source provenance、去重、切换和范围
   变更不修改 published Book membership 或 learner progress；
7. **Personal Content Module**：拥有 Saved Sense、Saved Example、Sense Note、Personal Semantic
   Anchor、Personal Collection 与 typed Membership 的 learner-scoped 事实及同步生命周期；
8. **Learner Semantic Projection Module**：组合已发布 Field、learner progress 与 personal content，
   只生成可重建读取模型；
9. **Free Practice Module**：解析 Practice Scope，物化 mode-specific Task，保存 Practice Activity、
   Attempt 与 Result，不调用正式 Learning Kernel 的结算接口；
10. **Executable Learning Capability Resolver**：求 Package、Required Capability Set、approved
   resources 与 Runtime 能力的版本化交集，不读取 learner state；
11. **Learner Progress Module**：拥有 Learning Phase、Acquisition Cycle、Gate progress、
   Acquisition Graduation 与 Relearning Completion；
12. **Unified Planning Module**：在 Study Plan、Session intent、Declared Mastery、cooldown、
   Acquisition/Relearning readiness 与 due state 之间选择候选；
13. **Semantic Policy Module**：从 Encounter purpose、capability inventory、Gate progress、
   Evidence、5D 与历史中选择最小干预；
14. **Encounter Module**：物化 Policy Decision，固定资源，接受 Attempt，派生 Evidence 并结算
   Acquisition Step Outcome 或 Memory Outcome；
15. **Evidence Projection Module**：从追加 Evidence 重建 Gate 与 5D 投影；
16. **FsrsAdapter**：初始化毕业 Sense 的 Memory State，并且是 Memory Outcome 进入 FSRS 的唯一接口；
17. **Sensa Sync Module**：拥有 learner-scoped operation、幂等、change feed、cursor 和 bootstrap；
18. **Media Module**：验证不可变媒体引用并提供授权下载。

## 6. 全局不变量

- Sense identity 不能退化成词头下没有稳定身份的一行中文释义；
- Account 与 Learner 是不同身份；V1 一对一不允许把认证、Profile、Workspace 或登录 Session 混入
  Learner Sense Progress；
- Settings Surface 不是聚合；每项写操作必须到达 Account、Preference、Curriculum、Device 或 Data
  Control 的真实 owner，不能维护第二份通用 settings state；
- Learner Preference 必须 typed、versioned、跨设备收敛；Device Preference 只在本机生效。两者都
  不能回写 Action/Attempt/Evidence/Outcome、Gate、5D、FSRS 或历史资源引用；
- 每日新 Sense 上限、Book、Range 与 Enrollment mode 不是 Preference；改变学习计划必须产生真实
  Curriculum operation/revision；
- sign-out、Local Data Clearance、learning-history reset 与 Account deletion 不能互相替代；有 pending
  outbox 时不得静默清除本机数据，旧 Replica 也不得在 Account deletion 后复活数据；
- Sync Health 只能从连接、outbox、content installation 与服务端 convergence 事实派生，不能由客户端
  直接声明“已同步”；
- Reference Sense 与 Sensa Sense 是不同身份；词典覆盖不能自动扩张 Curriculum 或 learner progress；
- Contextual Lookup 必须固定 Example + exact span + Reference Release；没有可靠解析时不得假装知道
  “本句中”的唯一意思；
- Reference 浏览、搜索、点词与 Lexical Enrichment 阅读不产生 Learning Evidence，也不推进 Gate、
  5D、daily quota、Memory Outcome 或 FSRS；
- active assessment 在 response/feedback 前不得从产品内部打开 Reference Lookup 或其他答案泄露路径；
- assessment-only 与 learning-only 资源不得进入 Reference 详情；产品不建设“真题”内容或占位页；
- Book membership、Acquisition、Evidence、Declared Mastery 和 FSRS 都按 Sense 隔离；
- Study Plan 不等于 Book；Book Version 不因 learner 切换、范围选择或个人添加而被修改；
- 同一 Sense 来自多个 Curriculum source 时只拥有一个 Learner Sense Progress、一个 active Cycle
  和一个 FSRS Memory State；
- 换词书、缩小 Book Range、暂停 Enrollment 或移除 Supplemental Membership 都不能删除或重置
  Learner Sense Progress；它们只在新的 Study Scope Revision 中改变 Planning eligibility；
- Study Scope 变更不能静默改变 active Session；Session/Encounter 必须保留用于计划它们的 Scope
  revision 与 Curriculum provenance；
- Semantic Field 是有限、版本化的内容邻域，不是 Book、学习路径或通用人类 ontology；
- Learner Semantic Projection 只能从权威事实重建，不能成为第二份 progress 或“脑内掌握度”；
- 发布内容不可变，修订通过新 version/release 完成；
- Attempt 与 Evidence 是追加事实，Gate、5D 与 FSRS 是服务端权威投影；
- 被动展示、自动播放、继续按钮、自报理解和答案揭示后的立即重答不构成独立 Gate Evidence；
- Baseline Acquisition 需要三次分别承担 contextual Recognition、Sense → Form Recall 与 novel
  Context Transfer 的独立成功；它们不能折叠成一次 Attempt；
- Boundary 只有在存在真实、重要且可执行的 confusion target 时才成为 required Gate；
- 一个 Gate 失败不抹除其他 Gate 的历史事实；针对性 repair 后必须经过干扰再独立重测；
- Initial Acquisition Graduation 表示可以进入长期保持，不表示永久掌握；
- FSRS 在 initial Graduation 前没有 due ownership；之后只负责 due time，Relearning 不重建它；
- Review 的第一次独立结果决定该次 Memory Outcome，后续 Relearning 不覆盖或重复评价它；
- `review_only` 不能引入新 Sense、推进 initial Acquisition 或消耗 daily-new quota；
- Free Practice 不满足 daily plan、不清除 due、不推进 Acquisition/Relearning，也不生成 Learning
  Evidence、Encounter Outcome 或 FSRS update；
- 听说读写只组织 Practice Mode；听写、跟读和朗读等跨通道任务必须如实声明其实际 target，
  不能仅凭表面动作宣称 Sense retrieval 或 transfer；
- 收藏、笔记与 Practice Result 不自动把 Sense 加入 Study Plan；只有被 Curriculum 接纳的
  Add-to-Learning Intent 才能创建 Supplemental Membership；
- Personal Content 的保存、注释、Anchor、Collection、Practice 和 Add-to-Learning operations 彼此
  独立；重复提交保持幂等，删除一个对象不能级联伪造其他 learner intent；
- Personal Semantic Anchor 只能作为 learner-controlled scaffold，不能成为发布事实、答案依据、
  assessment asset 或 Learning Evidence；
- Content Release 更新不能静默替换 Saved Example，也不能删除稳定 Sense 上的 Note/Anchor；
- 客户端可以离线先写原始操作，但不能把派生进度声明为服务端事实；
- Cards、Decks、generic flashcard sync、Workspace 产品入口和历史实验不属于 Sensa 领域。

## 7. 文档边界

本文不冻结 Gate 数量阈值、具体 Action/Practice Task payload、cooldown 间隔、Semantic Field
可视化布局、词典供应商、Contextual Sense Resolution 阈值、identity provider、Account deletion
恢复窗口、具体 Preference 字段、HTTP/SQL、Sync payload、例句数量或页面布局。它们属于版本化实现
合同、delivery/practice/reference profile 与 PRD，但必须服从本文的学习、参考、账号、设置与数据
控制边界和全局不变量。
