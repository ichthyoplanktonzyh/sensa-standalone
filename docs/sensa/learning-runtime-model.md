# Sensa Learning Runtime Model

> 状态：Canonical runtime domain model  
> 更新日期：2026-09-15

本文定义 Content Provisioning、Learning Protocol Run、Protocol Step Instance、Unified Planning、Session、
Encounter、Card Presentation、Observation/Evidence/Transition、Scheduling Handoff、FSRS、Lexical Reference、Preferences 与 Account/Data Control 的运行
关系。Structured Acquisition Cycle 是其中一种高保证协议，不是所有学习的唯一运行方式。具体
Gate 阈值、Action/Practice Activity Definition 或 Turn payload、context resolver 阈值、cooldown、HTTP、SQL 和 Sync wire
format 属于后续版本化实现合同。

## 1. 运行链

```text
Language Learning Route
        ├── Target Language + default Support Language
        └── route-scoped Study Plan
                    ├── Book Enrollment + Supplemental Curriculum
                    └── Study Scope Revision + Learner Sense Progress
                         │
Session intent ──────────┤
                         ▼
                  Unified Planning
          ┌──────────────┼────────────────┐
          ▼              ▼                ▼
  new protocol work  protocol ready  Review/Relearning ready
          │              │                │
          └──────────────┼────────────────┘
                         ▼
                fixed Learning Target
                         │
                         ▼
         Learning Capability Objectives
                         │
                         ▼
                   Retention Target
                         │
                         ▼
             Effective Learning Policy
                         │
                         ▼
        Resolved Learning Plan + readiness
            preparing / ready / blocked
                         │ ready
                         ▼
                 Content Provisioning
          Published / On-demand / Hybrid
                         │
                         ▼
              Learning Materialization
                         ×
        pinned Learning Protocol + purpose
                         │
                         ▼
              Protocol Step Instance
                         │
                         ▼
                  Sense Encounter
                         │
                         ├── Card Presentation (transient)
                         └── Encounter Outcome
                                  │ Protocol Run transition
                                  ├── Initial Learning Completion
                                  │      └── Scheduling Handoff ──▶ initialize FSRS
                                  ├── Memory Outcome ─────────────▶ update FSRS once
                                  └── Relearning Completion ──────▶ retain existing FSRS
```

Planning 只从 ready plan 中决定此刻处理哪个 Sense 与哪类工作；Effective Learning Policy 根据
learner/Curriculum assignment 协调三个 purpose 的方法、内容保证与 scheduler policy，Resolved Learning
Plan 再把 target、policy 和当前 capability 解析为 purpose-specific protocol/provisioning readiness。
Content Provisioning 将固定 target 解析为不可变 materialization；Run 固定计划解析时的材料基线，
每个 Protocol Step Instance 再固定其实际采用的兼容 materialization；Learning Protocol 固定
`initial_learning | retention_review | relearning` purpose，并由
Protocol Step 决定材料如何组织、当前 Encounter 允许做什么、产生何种结果以及下一步。成功的正式
Initial Learning 必须产生 Initial Learning Completion 与 Scheduling Handoff；Retention Review 只通过
当次唯一 Memory Outcome 更新既有 FSRS；Relearning 不重复评价该 Review，但协议声明的独立
relearning evaluation 可以产生自己的 Memory Outcome。Structured
Acquisition 内部再由 Semantic/Acquisition Policy 决定 Gate、repair、Graduation 与
Relearning Completion。FSRS 只在有效 handoff 后拥有长期 due time。

Free Practice 使用平行但隔离的运行链：

```text
Practice Brief + Scope + primary Area
                  │
                  ▼
         Free Practice Session
                  │
                  ▼
       Practice Activity Definition
                  │
                  ▼
             Practice Turn
                  ├──▶ Practice Observation / Feedback
                  └──▶ optional Practice Artifact
                         ╳ Learning Evidence / Encounter Outcome
                         ╳ Gate / 5D / Memory Outcome / FSRS
```

## 2. Retention Target 与 Learner Sense Progress

Retention Target 是 learner × stable Sense × target Sense Expression Binding 的权威运行聚合。
它是 Learning Target 解析出的持久连接身份，至少表达：

```text
phase: new | acquiring | retaining | relearning
activeProtocolRun: optional
activeProtocolPurpose: optional
activeStepInstance: optional
protocolProjection
activeAcquisitionCycle: optional structured projection
gateProgress: optional
5DState: optional
declaredMastery
fsrsMemoryState: optional
fsrsInitializationBasis: optional
```

Language Learning Route 与 Support Language 不进入该身份。同一个 target binding 即使从多条兼容 Route
进入，也只拥有一份 Retention Target、Protocol history 与 FSRS Memory State；Route-specific plan 或
materialization 可以不同，但不能复制学习结果。

这些状态职责不同：

- `phase` 决定该 Retention Target 属于哪类 Planning inventory；
- active Protocol Run 决定当前使用哪个版本化学习协议、固定 purpose、材料兼容边界与计划材料基线；
- active Protocol Step Instance 保存实际采用的 materialization、材料角色绑定、交互/判分合同、结果资格与 transition state；
- Gate progress 与 5D State 只属于 Structured Acquisition；前者决定当前 Cycle 是否满足毕业条件，
  后者是跨 Cycle、跨 Session 的诊断投影；
- Declared Mastery 是独立、可撤销的 learner 声明；
- FSRS Memory State 仅在有效 Scheduling Handoff 后存在，并保留 protocol、basis、evidence level 与
  initializer version。

每个 Retention Target 默认最多只有一份 FSRS Memory State。Recognition、Recall、Transfer、
Listening 等 capability 拥有独立 Evidence/Gate/5D 投影，但默认共享这一调度状态。Protocol
可以依据最弱或最久未检验的 capability 选择下一个 Step；它不会因提示方向、题型、
例句或 Card renderer 变化而创建新调度。只有具备显式 learner-valued 目标、稳定提示/响应合同、
可持续分离表现和独立调度价值的长期能力，才能作为显式 retention scope 扩展 target identity。

Learner Sense Progress 是从同一 Sense 的全部 Retention Targets 与 Sense-scoped learner facts 派生的
权威 roll-up。它可以回答“这个 Sense 有哪些表达正在学、哪些需要复习”，但不能把
不同 target expressions 的 phase、Protocol Run、Evidence 或 FSRS State 压成一份可写状态。

界面可以保存乐观预览，但不能绕过本地 Learning Runtime 直接声明这些权威投影。

## 3. Learning Protocol Run

每个正式学习过程固定一个 `protocolId + protocolVersion`、`purpose`、Learning Target、Effective
Learning Policy Profile/version、Resolved Learning Plan revision、材料兼容边界、计划材料基线、开始原因和允许的 Outcome。`purpose` 是封闭枚举：
`initial_learning | retention_review | relearning`。一个 run 只能有一个 purpose，不能用同一 run
同时表示首次学习、到期复习和失败后的再学习。内容来源不能隐式决定协议。相同 Curriculum
Membership、Learning Target、Route 与 Target/Support Language pair 下的新材料版本，可以供尚未接受
Action 的当前或未来 Step 重新解析；它不能更换 source、语言方向、协议或已操作 Step 的材料。
协议迁移必须创建新 run 并保留旧事实。

Learning Policy Profile 可以为三个 purpose 分别选择 Protocol family，但不创建跨多个 purpose 的单一
Run。第一次正式 Run 创建时同时建立 Retention Target 的 Committed Learning Policy；从该时刻开始，
普通 Policy Assignment、默认 Profile 或来源更新既不能影响 active Run，也不能让后续尚未开始的 Run
改用另一方法。后续 Run 继续引用该 Commitment；只有显式 Learning Policy Migration 可以在安全边界
建立新 Commitment revision。既有 Completion、Evidence、Memory Outcome、Scheduling Handoff 与
FSRS State 均不得被重解释。

Protocol 定义一个或多个 Protocol Steps 及其 transition rules。Step 可以按顺序、分支、循环、穿插
或 Policy 决策来组织；它固定 material roles、prompt/support/response/reveal/feedback contract、
interaction/grader、结果资格以及后继条件。Run 为实际执行创建 Protocol Step Instance，保存固定资源
绑定、当前状态、结果与重放依据。Step 数量、顺序和视觉形态属于具体协议版本，不是全局领域常量。

Learning Policy Profile/preset 是多个合同的命名组合，而不是另一种 Run 或进度状态。它为各 purpose
协调 Protocol、Content Requirements、Evaluation/Evidence、Progression/Completion、Repair、Scheduling
与 Claim Policy；Learning Target 和 Capability Objectives 决定学什么，Profile 决定采用哪组方法，
Unified Planner 决定哪些 Target 进入本次运行。

### Lightweight Initial Learning Protocol

Lightweight Study 允许使用紧凑教学内容、示例和可选 retrieval 建立或加强 Sense ↔ target-language
表达连接。
当首次学习合同步骤成功完成时产生 Study Completion 与 Lightweight Study Outcome，并在同一成功
边界显式创建 `basis=protocol_completion` 的 Scheduling Handoff。它不创建 Gate pass、5D projection 或
Acquisition Graduation，也不向 learner 宣称已经掌握。

Lightweight Run 可以完全没有评价性 Protocol Checkpoint。首版只有两个正式 Step：Experience Recall
把 grounding 与内部回想合成一个 `practice`，在同一张 Card Presentation 中展示经验/Sense cue、
隐藏 target expression 并等待 learner 请求揭晓；Expression Reveal 是 `instruction`，显示 expression
与 Sense binding，并在同一张 Card 上接受 learner rating。`again` 回到 Experience Recall，`hard | good`
允许 Completion Policy 产生 Study Completion。rating 是 self-report Observation，不是 behavioral
Evidence；完成状态不是第三个 Step。

### Structured Initial Learning / Relearning Protocol family

Structured family 提供 purpose 分离的 Initial Learning Protocol 与 Relearning Protocol；二者可以复用
同一套 Gate 理论，但每个 run 仍只固定一个 purpose。Acquisition Cycle 是该 family 的 short-term
aggregate，可由首次学习或长期遗忘触发：

```text
reason: initial | relearning
policyVersion
requiredGateSet
gateProgress
failureHistory
status: active | completed | interrupted
```

Cycle 固定开启时的 Required Gate Set。内容或 Policy 更新不能静默改变已开始 Cycle 的毕业要求；
迁移必须显式发生并保留旧事实。

#### Baseline Gate families

- **Contextual Recognition**：在熟悉或基础语境中从 Form 识别目标 Sense；
- **Meaning-to-form Recall**：从 Sense cue 主动取回目标 Lexeme；
- **Novel-context Transfer**：在未作为教学材料使用的语境中识别同一 Sense；
- **Boundary**：仅当 Profile 声明真实、required confusion target 时存在；
- **Sound recognition**：只有产品/Profile 将听觉输入列为 required 时才成为独立 Gate。

Gate progress 为 `unresolved | passed | failed`。Gate 只能由不泄露答案、经过所需干扰的有效
Attempt 解决。Initial Cycle 的 Recognition、Recall 与 Transfer 各自需要独立 Attempt，不能
合并；条件性 Boundary 可以与其中一个兼容 assessment 共解，并保存独立 basis。

#### Failure and repair

- Gate failure 保存负面 Evidence 并把该 Gate 标记为 failed；
- 无关 Gate 的历史 pass 不机械归零；
- Policy 选择针对性 repair，连续失败可以升级为完整 re-binding；
- repair/reveal 后的即时检查可以确认理解，但不能把 failed Gate 改为 passed；
- 重新解决 Gate 必须在后续独立 Encounter 中进行，并满足版本化 interference rule。

以上是当前 Structured family 的 Progression Policy，不是 Learning Kernel 对所有 Protocol 的失败
硬编码。其他 Protocol 可以声明重置一个 Checkpoint、一个显式 Checkpoint 集合或整个 Run 的当前
credit；内核只负责校验并原子执行 `ResetProgress(scope)`。任何 reset 都不得删除既有 Attempt、
Observation、Evidence、失败历史或旧 Transition，要求“连续通过”时以新的 progress epoch 表达。

所有 required Gates 变为 passed 时完成 Cycle。`initial` Cycle 产生 Acquisition Graduation，并必须
创建 `basis=acquisition_graduation`、`evidenceLevel=behavioral` 的 Scheduling Handoff；FsrsAdapter
只消费 handoff，不直接猜测 Cycle 状态。`relearning` Cycle 产生 Relearning Completion，将 phase
返回 `retaining`，保留失败 Review 已推进的 FSRS State。若当前 Relearning Protocol 明确允许
scheduler-eligible evaluation，该 Cycle 内的合法独立重测还可各自产生新 Memory Outcome；这不改写
触发它的 Review Outcome。两类 Cycle 都不删除既有 Cycle、Attempt 或失败历史。

### Retention Review Protocol

Retention Review 只在已有 FSRS Memory State 上运行。它可以用一个或多个 Step 组织回忆、自评、揭示、
反馈或补充检查，但每个 due Review 最多形成一个 Memory Outcome，并最多更新一次 FSRS。第一次满足
协议结果条件的评价固定该 Outcome；后续 reveal、detail、即时重测或再学不能生成第二个 Outcome。
Outcome 必须携带 scheduler-stable grade `again | hard | good | easy`，并与 basis/evidence level 分离。
二元 assessment 可以只产生 `good/again` 子集，但协议已经区分出的“模糊/费力”必须保留为 `hard`，
不能先压成 `correct: boolean` 再交给 scheduler 猜测。

### Relearning Protocol

Relearning 在失败或明显变弱的 Memory Outcome 已经落账后恢复 Sense ↔ target-language 连接。协议
可以是轻量 re-binding，也可以是上述 Structured Relearning；只有后者创建 Acquisition Cycle。Relearning 成功
产生 Relearning Completion，将 phase 返回 `retaining`，但不创建 Scheduling Handoff、不重建 FSRS，
也不再次更新触发它的 due Review。Protocol Version 可以把指定的独立重学评价声明为
scheduler-eligible；此时每次评价产生自己的 Memory Outcome 并最多推进一次 FSRS。
Relearning Completion 本身不是 Memory Outcome，也不自动改变 due。

## 4. Curriculum lifecycle、Study Scope 与每日额度

Study Plan 是一条 Language Learning Route 内的正式学习安排，而不是 Book 的别名。Route 固定 Target
Language 与可相同的 default Support Language；一个 Learner 可以拥有多条独立 Route。Study Plan 组合：

```text
one active Book Enrollment
zero or more maintenance/paused Book Enrollments
one learner-owned Supplemental Curriculum
versioned Learning Policy Assignments
daily new-Sense limit
current Study Scope Revision
```

Route 的 `active | paused | archived` 只控制后续选择、导航与 Planning eligibility。pause/archive 不删除
Study Plan、Curriculum、Personal Content、Retention Target、Protocol history、Evidence 或 FSRS；恢复后
沿既有身份继续。Active Route Selection 不是 Route status，也不能伪造其状态。

### Book Enrollment 与换词书

Book Enrollment 固定一个不可变 Book Version、一个已解析 Book Range 与 mode：

- `active`：允许从当前 Range 引入新 Sense，并继续该 Enrollment 已开始的 Protocol Run、
  Relearning 与 due Review；
- `maintenance`：不再引入新 Sense，但继续已经开始的 Protocol Run/Relearning 与 due Review；
- `paused`：该 Enrollment 暂时不向任何正式 Planning inventory 提供候选，但不删除事实。

同一 Route 最多有一个 `active` Book Enrollment。换词书默认将旧 Enrollment 转为
`maintenance`，并激活目标 Book Version 的 Enrollment；learner 可以再显式暂停旧 Enrollment。
切换、暂停和恢复都不删除 Learner Sense Progress、Protocol Run、Evidence 或 FSRS State，也不把
任何协议冒充完成。切回旧词书时依据保留的 Retention Target 状态继续。

Book 的新版本不会静默替换 Enrollment 已固定的 Book Version。升级必须是显式 Curriculum 操作：
stable Sense 复用原进度，新加入成员获得新资格，被移除成员不删除历史，active Session 继续使用
其已固定的旧 Scope/Content revisions。

### Book Range

Book Range 是一个 Book Version 内可用于未来 Introduction 的稳定成员选择，可以表达整本、已发布
section、固定 ordinal range 或显式 Sense selection。无论使用哪种表达，都必须在 Curriculum 接纳时
解析为确定的 Book membership snapshot，不能随未来 Book Version 变化漂移。

Range 只控制未来 Introduction。每次 Introduction 保存 Curriculum source provenance；后来缩小
Range 不删除已发生的学习，也不把已经开始的 Sense 变回 `new`。这些 Sense 是否继续进入 Planner，
由其来源 Enrollment 的 `active | maintenance | paused` mode 决定。

### Supplemental Curriculum 与 Add-to-Learning

Supplemental Curriculum 是 Language Learning Route 内 learner-owned、ordered 的正式 Learning Target
来源。Membership 固定 Route revision、stable Sense 和 target Sense Expression Binding，不是 Saved
record、Personal Collection membership 或 Book membership。Add-to-Learning 只有在 Binding Language
Tag 与 Route Target Language 兼容时才被接纳并创建 Membership；其 Resolved Learning Plan 可以处于
`preparing | ready | blocked`，因此 Curriculum membership 与当前可执行性不是同一个事实。每个 Study
Scope Revision 保存固定 Learning Target、Effective Learning Policy、Resolved Learning Plan 与
provisioning/protocol references；只有 `ready` plan 可以进入正式 Planning，Session/Encounter 再冻结
实际 Learning Materialization，内容更新不能在进行中静默替换资源。

Add-to-Learning 可以由 direct Catalog/search selection、Saved Sense、reviewed Alignment 后的 Contextual
Lookup，或 accepted complete Personal Meaning Alignment 发起；Book Enrollment 则通过 Book membership 提供
另一类 Curriculum source。所有来源都固定 Learning Entry Provenance，并在相同 Learning Target/
Retention Target 处去重。Runtime 不要求、也不检查是否存在 Personal Meaning 才接纳 direct/Book entry。

Add-to-Learning Intent 的接纳结果至少区分：

- `accepted`：创建一个 Supplemental Membership，并返回其 `preparing | ready | blocked` plan readiness；
- `already_in_scope`：目标已由 active/maintenance Enrollment 或现有 Membership 覆盖，不重复加入，
  同时返回现有 Effective Learning Policy 与 plan readiness；
- `invalid_target`：没有 stable Sense/Version 或合法 target binding，不创建 Membership；
- `route_language_mismatch`：target Binding 的 Language Tag 与所选 Route Target Language 不兼容，保留
  target 与 Route 并要求显式选择，不创建 Membership；
- `unsupported_policy`：指定 Profile 不适用于该 target/source 且无法解析合法 Assignment，不创建 Membership；
- `declared_mastery_conflict`：存在 active Declared Mastery，必须由 learner 独立撤销后再接纳。

接纳按 `target validation → route-language validation → policy-assignment validation → Declared Mastery
conflict → existing scope → create membership + initial plan` 求值；因此一个已在 Book 中但同时被声明
“已会”的 Sense 仍先返回 conflict，不能用 `already_in_scope` 掩盖恢复学习所需的显式意图。内容生成、
完整 protocol capability 检查和 Materialization 发生在接纳后的 Learning Plan resolution/provisioning
阶段；失败将 plan 标记为带原因的 `blocked`，不删除 Membership，也不伪造 Runtime progress。

### Learning Policy Assignment 与 Plan readiness

Learning Policy Assignment 属于正式 Study Plan/Curriculum 配置，不属于普通 Learner/Device Preference。
它可以位于 learner default、Curriculum source 或显式 Retention Target override，按以下优先级解析：

```text
target override > applicable Curriculum assignment > learner default > system default
```

Effective Learning Policy 固定实际采用的 Learning Policy Profile/version、scope 与 decision provenance。
同一 Retention Target 有多个 Curriculum source 时，新增来源不能静默改变既有 Assignment；显式切换
在第一次正式 Protocol Run 前产生新的 Study Plan/Study Scope revision 和 Resolved Learning Plan
revision；一旦首次 Run 创建，普通 Assignment change 必须被拒绝为 `policy_committed`，不能创建新
Retention Target、重置 FSRS 或改写已开始/历史 Run 来绕过该约束。

Resolved Learning Plan 把 `Learning Target × Effective Learning Policy × content/runtime capabilities`
解析为三个 purpose 的 Protocol references、provisioning requirements 与 readiness。它不预先保存未来
Encounter 顺序或 due calendar。`preparing` 和 `blocked` 目标保留在 Curriculum projection 中供 learner
查看、重试、补充能力或显式切换 Policy，但不进入 `InitialProtocolReady`/`ReviewDue`/`RelearningReady`
inventory；`ready` 只说明当前 purpose 可执行，不表示已经发生学习或 exposure。

尚未创建第一次正式 Protocol Run 时，Policy 更新可以重新解析 Plan；`ready`、进入 Planner inventory
或排入未来 Session 尚不构成 Commitment。第一次正式 Run 创建后，Committed Learning Policy 同时
约束当前与未来三个 purpose 的 Run，产品不再提供普通更新。未来若支持切换，必须使用独立、显式
Learning Policy Migration：在无未结算 Encounter 的安全边界关闭或中断旧 active work，保留全部旧
事实与 FSRS State，创建新的 Assignment、Commitment、Study Scope 与 Plan revisions，并重新验证
readiness。一个已完成 Initial Learning 的 target 迁移到高保证 Profile 时，不自动重开 Initial Learning
或创建第二个 Handoff；重新取得高保证资格必须由独立 qualification/migration 合同规定。MVP 不实现
该迁移，因此进入第一次正式 Run 后学习方式只读锁定。

Direct stable Sense selection、Saved Sense 与 aligned Contextual Lookup 可以显式创建 Intent；Saved
Example 只能通过其绑定 Sense 发起“学习这个意思”，Example
本身不能成为 Curriculum member。unsave 不移除 Supplemental Membership；移除 Membership 也不
unsave、不删除 Note/Anchor/Collection Membership、Retention Target 或 Learner Sense Progress。若同一 target 仍由
其他 active/maintenance source 覆盖，它继续在有效 Study Scope 中；若已无任何有效 source，它从
后续 Session 的正式候选中退出，但保留 phase、Protocol Run、Evidence 与 FSRS，重新加入时从原状态恢复。

### On-demand Content Provisioning lifecycle

需要动态材料的 Resolved Learning Plan 通过 Content Provisioning Task 管理准备状态。Task 是
system-owned 的 durable lifecycle，不是 Agent session，也不进入 formal Protocol Runtime。它固定一个
Learning Target、一个 purpose-specific Protocol、exact Content Demand 和 plan revision；其状态闭集为：

```text
queued | preparing | submitted | validating | ready | blocked | cancelled
```

- `queued`：任务已创建但尚未开始生产；
- `preparing`：系统正在复用资源、运行 Content Agent Attempt 或执行派生；
- `submitted`：一个不可变 Material Candidate Bundle 已提交，产生它的 Agent Attempt 已结束；
- `validating`：system-owned validator/admission 正在检查 Bundle 与 Demand；
- `ready`：独立校验和 assembly 已完成，并已产生可引用的 Learning Materialization；
- `blocked`：当前合法路径、重试预算或必需能力无法满足 Demand，保留可审计原因；
- `cancelled`：该 preparation intent 被显式终止；它不删除已接纳 Curriculum membership 或历史 Attempt。

`submitted`/`validating` 被拒绝或 `preparing` 失败时，Task 可以按固定 retry policy 回到 `preparing` 并
创建新 Attempt；不能恢复或改写旧 Attempt。Content Agent Attempt 自己只有：

```text
running → submitted | failed | timed_out | cancelled
```

Attempt 的 `submitted` 只说明 Bundle 已冻结，不代表 Task `ready`。Bundle 的独立 validation result 为
`accepted | rejected`；`accepted` 后仍由 system-owned assembly 创建 Materialization，`rejected` 保存
validator/version、reason codes 与被检对象 digest，再由 Task 决定重试或 `blocked`。Agent 可执行的
preflight 不产生这个 authoritative result。

Resolved Learning Plan readiness 只投影上述事实：尚在 `queued/preparing/submitted/validating` 的
purpose 为 `preparing`，有效 Materialization 产生后才为 `ready`，Task `blocked` 时为 `blocked`。
`cancelled` Task 不再贡献 readiness；系统从其他合法 provisioning path 重新解析，没有可用路径时以
`preparation_cancelled` 原因保持 plan `blocked`。正式 Planner、Session 与 Protocol Run 永远不读取
Agent state、tool transcript 或 Candidate Bundle，只读取 plan-pinned immutable Learning Materialization。

Provisioning Batch 是多个 Task 的非原子调度/观测容器。一个 Task 的 failure、timeout、cancel 或 retry
不改变其他 Task；batch completion 只是成员状态汇总，不产生 Learning Completion、daily-new quota 消耗
或 Runtime transition。每日学习数量仍只由 learner 的 Study Plan 与 Unified Planner 决定。

### Study Scope Revision 与每日额度

Study Scope 是固定一条 Language Learning Route revision、mode-aware、source-aware、policy-resolved
的去重 scope snapshot：active Enrollment 提供
当前 Range 的新 Sense 与既有工作，maintenance Enrollment 只提供已经开始或进入长期保持的 Sense，
paused Enrollment 不提供候选，active Supplemental Membership 提供对应 Learning Target。每个成员同时保留
Curriculum source 与 Learning Entry Provenance、Effective Learning Policy、Resolved Learning Plan 与已解析 target/provisioning/protocol reference，
只有当前 purpose 为 `ready` 时才提供运行候选，并按 Retention Target 去重。同一
Retention Target 无论来自多少 Book、Range 或 Supplemental Membership，都只有一个 active
Protocol Run 和一个 FSRS State；同一 Sense 的不同 target expressions 不得因此合并。
换词书、调整 Range、切换 Enrollment mode、接纳或移除 Supplemental Membership 都产生新的不可变
Study Scope Revision。

Learning Session 固定开始时的 Study Scope Revision 与 Pinned Language Context。Curriculum、Route 或
Active Route Selection 变更从后续 Session 生效，不能
静默改变正在进行的 Encounter 或队列；如果产品允许在 active Session 中修改 Plan，必须先明确
结束/中断该 Session，而不是把它重绑定到新 Scope。

同一 Curriculum Membership 在固定 Target 与语言方向内发布新的不可变 Learning Materialization，
不属于 Scope 重绑定。当前 Step 尚未接受 Action 时，Runtime 可以用新版替换其绑定并使旧界面 revision
失效；未来 Step 在成为 current 时解析最新版。Action 一旦被接受，事件必须记录实际 materialization，
后续发布不能改写该 Step、Attempt、Observation、Evidence、Outcome 或备份重放结果。

Learning Session 从 Study Plan/Scope 启动，不依赖 Personal Semantic World 页面、Personal Meaning 或
Sense Construction Session。personal-first provenance 只说明目标来源，不能成为 open/resume 的隐含前置条件。

Daily-new quota 是每日新 Sense Introduction 的上限，不是 learner 必须完成的债务，只在 Introduction
被权威接受时消耗：

- learner 只设置 Study Plan 上的一个每日新学数量；Unified Planner 是这个数量的唯一解释者；
- Learning Policy Profile、Protocol、Runtime Adapter 与队列不得再定义每日数量、分组大小、批次大小或
  active window，也不得截断 Planner 已选出的 Target 集合；
- Protocol 可以决定 Planner 所选集合内部的 Step 顺序、穿插和间隔，但不能借编排改变今天获准首学的数量；
- ready Protocol work、Relearning 与 due Review 不消耗 daily-new quota；
- Book 与 Supplemental 的新 Sense 共用同一额度，不能制造隐藏的额外任务；
- 退出 Session 不撤销已经发生的 Introduction，未用额度不滚存为次日欠账；
- 同一 Lexeme 的 sibling Sense 是否错开由版本化 Curriculum/Planning policy 决定；
- Plan 不保存手工累计的“已学数量”或维度待办，所有事实摘要来自权威投影。

实现可以为渲染或存储做不可观察的分页，但这种分页不能进入学习领域合同、learner 设置或改变
Target 的准入与调度语义；对 learner 不存在第二个“同时放多少条进窗口”的概念。

Book/Range completion 同样是事实投影：`新内容已学完` 表示没有 NewEligible member，`首次学习已完成`
表示范围成员都已通过当前协议创建 Scheduling Handoff，或存在 active Declared Mastery。长期
Retention 没有永久“全部完成”。
Curriculum 只提供这些事实摘要，不据此生成维度处方、欠账或 learner-facing Learning Insight。

## 5. Learning Session 与 Session intent

Learning Session 是一次有开始和结束边界的用户活动容器。它固定 intent、Study Scope Revision 与
Pinned Language Context：

Pinned Language Context 固定 Route revision、Target Language 与 Support Language；具体 Step/Action
再声明 Input Language 与 Output Language。阅读中的 target-language input 与 support-language explanation、
反向写作中的 support-language prompt 与 target-language output 因而不会改变 Route 的方向。Session
开始后的 Active Route Selection 或 Interface Locale 变化不能重绑 Session、Encounter 或已发生 Action
的资源。只有上述同一 Membership 与固定语言方向内的材料新版，才能刷新尚未操作的 Step。

### `mixed`

主要的“开始今天的学习”模式，可选择：

- due Retention Review；
- Review-originated Relearning；
- ready initial Protocol work；
- daily quota 允许的新 Sense Introduction。

### `review_only`

次要的“只复习”模式，只可选择：

- due Retention Review；
- 由长期 Review 失败产生、当前 ready 的 Relearning。

它不得引入新 Sense、推进 initial Learning Protocol、移动任何 Curriculum source 的 new eligibility 或消耗
daily-new quota。尚未到期的 retaining Sense 也不因进入该模式被提前评价；learner 若要自主练习，
进入语义完全独立的 Free Practice Session。

Session 不是 FSRS 复习单位，也不聚合出一个总掌握结果。完成 Review-only 后，learner 仍可
回到首页开始或继续 Mixed Session。

## 6. Lexical Reference 与 Contextual Lookup

Lexical Reference 是读取型运行链，既不是 Learning Session intent，也不是 Free Practice Session：

```text
Reference Context + query / Example + exact character span
                           │
                           ▼
              resolve Reference Lexical Unit
                           │
                           ▼
                load full Reference entry
                           │
             Contextual Sense Resolution
        ┌──────────────────┼──────────────────┐
        ▼                  ▼                  ▼
 authored/reviewed   model_confident   ambiguous/unresolved
 “本句中”             “本句中可能是”      不强行强调唯一义项
                           │
                           ╳ Progress / Gate / 5D / FSRS
```

每次读取固定 Reference Context，至少包含 Reference Release；从 Book/Sense/Saved Example 打开时还应
保留其 content/release provenance。全局搜索使用当前公开 Reference Release；旧内容或离线快照可以
使用 pinned release，不能在同一次详情响应里混合不同词典版本的 IDs 或 definitions。

产品的四种读取形态保持边界：Learning Catalog 搜索进入 Lexeme 聚合或具体 Sensa Sense 详情；全局
查词进入 Reference entry；例句点词进入带 occurrence resolution 的同一 Reference entry；Example
Detail 始终固定 exact immutable Example。一个 Lexeme 聚合可以并列 sibling Sense 状态，但不能产生
“整个单词的掌握度”。这些读取可以互相导航，不能用同一个含混详情对象合并身份和副作用。

### Example 点词解析

Contextual Lookup request 传入 exact immutable Example identity 与 clicked `start/end` character span，
不能只传一个脱离上下文的 token string。服务端按以下顺序解析：

1. 校验 Example、span、可见性与 Reference Release；优先匹配覆盖 clicked span 的最长 approved
   multiword Lexical Occurrence；
2. 若命中 authored target span，沿 `Example → Sense Version` 确定 Sensa Sense；存在 reviewed Sense
   Alignment 时再强调对应 Reference Sense，不存在时不调用模型补猜；
3. 若命中其他预计算 occurrence，读取其 `reviewed | model_confident | ambiguous | unresolved` 结果；
4. 仅当 annotation 缺失且当前 delivery contract 允许时，运行 closed-candidate fallback，并用
   `(example, span, reference release, resolver version)` 保存可重建缓存；
5. 返回该 Reference Lexical Unit 的全部可见 Reference Senses，保持 reference order，再附加本句
   emphasis/status；不得只返回被猜中的单个释义，也不得自由生成 definition。

如果一个 span 同时属于短 token 与 multiword expression，结果应先解释最长、最具体的 occurrence，
并允许 learner 显式切回单词查询。无法可靠定位时仍可展示完整词典条目，但必须省略“本句中”的
确定强调；`ambiguous` 只能表述为“可能是”。

### 读取、副作用与答案边界

Reference detail 可以按真实数据条件性显示释义、例句、用法、构词/词源和相关；当前 Reference Sense
对齐 Sensa Sense 时可另外挂载它的 Sense Note，reference-only meaning 不创建通用词典笔记。打开、
切换、播放或展开这些区块：

- 不创建 Learner Sense Progress、Study Scope Membership 或 daily-new consumption；
- 不创建 Learning Attempt、Practice Turn、Evidence、Encounter Outcome、Gate/5D/FSRS update；
- 不自动保存、不自动创建 Note，也不自动提交 Add-to-Learning Intent；
- 只读取 `reference_visible` 内容，永不返回 `learning_only` 或 `assessment_only` asset；
- 不提供“真题”或考试来源聚合区块，也不为空区块生成占位数据。

active assessment 在 learner 提交 primary response 并进入 feedback/reveal 之前，产品内部不得从题面
token、更多菜单或快捷键打开 Reference Lookup；否则它会构成答案泄露。Introduction/reveal、普通
内容浏览与已完成 feedback 可以提供点词，但仍只形成 Product Event 或 read telemetry。系统不试图
阻止 learner 使用外部词典，只保证自身 Action contract 不提供泄露路径。

Reference-only meaning 只有在 reviewed Sense Alignment 指向 stable Sensa Sense 时才显示“学习这个
意思”的候选；最终仍交给 Curriculum Add-to-Learning decision。没有对齐时返回 `invalid_target`；已有
稳定对齐但当前 Effective Learning Policy 找不到合法 published/on-demand/hybrid provisioning path 时，
Membership 可以被接纳，但其 Resolved Learning Plan 必须保持带 `content_unavailable` reason 的
`blocked`。On-demand content 必须在独立的学习准备阶段冻结为 Learning Materialization，不能把 lookup
结果即时冒充学习内容。当前
Personal Content 只接受 Sensa Sense 与 exact Example；本模型不因一次 Reference Lookup 自动新增
Saved Reference Entry。

Reference Release 与 occurrence annotations 是可下载的不可变内容，不通过 learner outbox 修改。
离线客户端使用已安装的 pinned release/index；未安装的 entry 返回诚实 unavailable state。查询历史
若将来需要跨设备保存，必须另建显式 learner-owned contract，不能混入 Evidence 或 Progress sync。

## 7. Personal Content lifecycle

Personal Content 保存 learner 直接或通过明确授权委托创建的事实，不从浏览、学习结果或统计自动推断：

- Semantic Intake operation 至少固定真实 Context；缺少 Expression、teaching-sufficient Sense 或有效
  acceptance 的捕获保存为 Inbox Item。只有完整提交 operation 才创建 Personal Semantic World
  membership；
- 完整提交可以由 learner 直接执行，也可以由 Agent 在 learner grant 下委托执行；二者必须保存不同
  actor/authority provenance，但 delegated commit 不需要二次确认。任意 payload 布尔字段不构成权限；
- Personal Meaning 拥有独立 identity 与 revision，并至少固定一个 Context Anchor、一个 located
  Expression Anchor 与一个 active stable Sense Alignment。Meaning Focus 为可选独立事实，不以节点
  标题或一段富文本充当整个 aggregate；
- Personal Semantic Anchor 绑定 Personal Meaning 而不是直接冒充 Sense 内容。同一经验素材可以直接
  支撑 Context–Expression–Sense resolution，也可以在必要时被多个 Meaning Focus 引用；
- Personal Expression Anchor 固定 exact Language Tag、expression type、provenance 与 verification
  status；target/support/input/output role 只属于 Route 或操作上下文；
- Sense Construction Session 只在普通 Contextual Sense Resolution 不足时固定 Intake/Meaning draft、
  optional Meaning Focus、模型/policy provenance 与提议历史。原始聊天可以用于继续对话和审计，
  但只有被有效 Semantic Acceptance 接受的 Focus/Sense Proposal 才进入权威领域状态；
- Sense acceptance operation 可以由 learner 直接触发，也可以由 Agent 在相应 grant 下委托触发，并
  对同一 proposal/resolution 幂等。成功时创建或引用 stable Sense/Sense Version，并创建 Personal
  Meaning Alignment；重放不得制造重复 Sense 或 Alignment；
- Personal Meaning 在 Sense 确认后继续存在。修改它不会静默修改已确认 Sense；若边界发生变化，
  必须开启新的 proposal/version、split 或显式 relation 流程；
- Saved Sense 在 learner × stable Sense 上唯一、可逆，并保存创建时 Sense Version provenance；
- Saved Example 在 learner × exact immutable Example 上唯一、可逆，不能随 release 更新换成另一条；
- 每个 learner × Sense 最多有一份 current Sense Note；更新与删除使用 revision，离线冲突不能
  静默覆盖另一设备已经提交的正文；
- 每个 Personal Semantic Anchor 有独立 identity 与 revision；同一 Personal Meaning 至少一个且可以有多个
  Anchor，learner 可分别修改、删除或撤销其 scaffold eligibility；
- Personal Collection 有独立 identity、name、description、ordering 与 revision；Collection
  Membership 是指向 stable Sense 或 exact Example 的 typed、ordered reference，同一 target 在
  同一 Collection 中不能重复；
- Add-to-Learning Intent 从 stable Sense 与选定 target expression 解析 Learning Target，并交给
  Curriculum 接纳或拒绝；它与 semantic-world commit 使用独立 authority，即使同一 Agent 连续提交也
  必须形成两个幂等事实；Personal Content 不得
  直接修改 published Book、Supplemental Membership、Study Scope、Learning Phase 或 Planner
  inventory；接纳语义由第 4 节 Curriculum lifecycle 定义。
- direct/Book learning 不创建 Personal Meaning、Focus、Anchor 或 Alignment；Learning/Review/Relearning
  history 也不能作为隐式 semantic-world commit operation；

这些操作保持正交：

- 创建 Personal Meaning、编辑 Focus/Anchor、请求 LLM suggestion、确认 Sense、确认表达、保存、
  Add-to-Learning 与开始 Practice 互不隐式触发；
- unsave 不删除 Note、Anchor 或 Collection Membership；
- 删除 Note/Anchor 不 unsave；
- 从 Collection 移除或删除 Collection 不 unsave，也不删除 Note/Anchor；
- saving、collection membership、Practice 与 Add-to-Learning 互不隐式触发；
- 删除、归档或重组 Personal Meaning/Focus/Anchor/Alignment 不删除已经接纳的 Supplemental Membership、
  Retention Target、Protocol Run、Evidence、Outcome 或 FSRS；失效的 Personal Anchor 只从未来可选
  scaffold inventory 中退出；
- Declared Mastery、Acquisition/Review Outcome 与 Content Release 更新不自动创建或删除 Personal
  Content；
- 重复的同一 personal-content operation 是幂等重放，不得制造重复 Anchor、Membership 或 Intent。

Sense Note 默认只供 learner 查看。Personal Semantic Anchor 只有在 learner 明确允许、Personal
Meaning Alignment 已确认、target Sense 一致且当前 contract 接受 personal scaffold 时，才能被
Learning/Practice renderer 引用；引用只算 scaffold exposure，不能成为答案、Learning Evidence、
Gate pass 或 assessment resource。

内容更新时，Saved Sense 与 Note 继续跟随 stable Sense；Personal Meaning/Anchor 保持自己的 learner
identity，并由 Alignment 保存所确认的 Sense Version provenance。Saved Example 与 Example
Membership 继续固定 exact Example。旧 Example 因退休、授权或媒体不可用而无法显示时，系统返回
诚实 unavailable state，不能静默替换。

Personal Content 可以成为 Learner Semantic Projection 与 Practice Scope 的输入。它不属于 Learning
Session/Encounter，也不产生 Encounter Outcome。

LLM 不可用、超时或 learner 离开对话时，Personal Meaning 与已保存 Anchors 仍然有效；未确认
Proposal 不能被后台任务自动确认。已有 Sense 的相似检索是 confirmation 后或并行的可选治理步骤，
没有命中不阻止新 Sense 创建。每个 Sense Construction Session 固定 Pinned Language Context；具体
delivery profile 可以限制可选 Route 或语言 capability，但不得重解释既有 language-scoped
Expression/Alignment facts，也不得用 Active Route Selection 强制重标捕获内容。

## 8. Free Practice

Free Practice 是独立的语言使用与泛化运行时，不是宽松版 Learning Protocol，也不是第三种 Learning
Session intent。语言相关的 Free Practice Session 同样固定 Pinned Language Context。它可以读取
Learning Target、Personal Semantic World 中完整的 Context–Expression–Sense、Practice Scope 与获准
资源，但不能写入正式学习的证据、进度或调度状态。

听、说、读、写是稳定的 learner-facing **Practice Area**。它们来自 receptive/productive ×
sound/written 的组织矩阵，但不是四个运行引擎、mastery dimensions、分数或 Gate：

| 方向 | 声音通道 | 文字通道 |
| --- | --- | --- |
| Receptive：Form/Context → Sense | listening | reading |
| Productive：Sense/Experience → Form | speaking | writing |

每个 Activity Definition 只指定一个 `primaryArea`，即使实际交互跨多个通道。分类依据 learner 的主要
练习目的，而不是素材形式；stimulus/response channels 另行声明。

Practice Brief 给一次练习提供局部方向，至少可以表达 learner intent 或 communicative goal、scenario、
optional Scope 与 support level。它不是 Learning Objective、Protocol、graduation standard 或评分合同。

Free Practice Session 由 learner 主动开启并至少固定：

```text
practiceBriefSnapshot
primaryArea: listening | speaking | reading | writing
activityDefinitionVersion
practiceScopeSnapshot
practiceProfileVersion
executableInventoryVersion
status: active | completed | abandoned
```

Session 创建前，Practice Runtime 必须解析：

```text
Free Practice Profile
        × approved Package / provider resource availability
        × Runtime / Client capability
        ↓
Executable Practice Capability Inventory
```

Profile 固定允许的 Practice Activity Definitions 及其 target、channel、resource、interaction、feedback
与 session-policy requirements；Package Practice Manifest 声明 Package 内获准复用的 practice
roles/resources，外部 provider 则必须保留自己的来源、授权与可用性事实。Inventory 是上述能力与
当前 client support 的交集。它既不读取 learner mastery 来伪造 capability，也不借用 Acquisition
Required Asset Manifest 推断四个 Area 全部可用。Session 固定 profile 与 resolved inventory version，
运行中能力变化只能在下个 Session 生效。

Practice Scope 可以来自 learner 明确选择的 Personal Meanings/Senses/Expressions、Book slice、最近
学习、已完成首次习得、Saved items 或其他已交付的 typed source。Scope 在 Session 开始时解析成稳定
snapshot，并保留 Context、Expression、Sense、binding 或 Learning Target 的实际身份与 provenance；
后续收藏、Book 或 progress 变化不能静默改变正在进行的活动。Declared Mastery 只排除正式 Planning，
不阻止 learner 自由练习。

Practice Activity Definition 是扩展的主要单元，至少固定：

```text
primaryArea
stimulusChannels[]
responseChannels[]
targetIdentity: Context | Expression | Sense | Sense Expression Binding | Learning Target
practicePurpose
requiredResourceRoles[]
supportPolicy
interactionPolicy
feedbackPolicy
sessionPolicy
```

一次交互保存为 Practice Turn；Runtime 可以从 Turn 得到 Practice Observation，返回 Practice Feedback，
并按 activity policy 保存 optional Practice Artifact。Observation 可以在当前 Session 内选择下一段素材、
调整支架或决定是否建议重试；Feedback 可以包含判断、建议或分数。但这些都不是 Learning Attempt、
Learning Observation、Learning Evidence 或 learner progress，不能被 Unified Planner 或 Scheduler 消费。

### Initial Free Practice Profile

Initial Profile 是 P0 之后首个 Free Practice delivery contract，不是当前 Sensa V1 launch
requirement。首期每个 Area 只开放一个 Activity：

| Primary Area | Activity Definition | 主要交互 | Target 与诚实边界 |
| --- | --- | --- | --- |
| Listening | Real-world Speech Variation（真实语流泛化） | 通过 YouGlish 播放同一 Expression 在不同 speaker、accent、速度与连读环境中的真实片段 | target 是 Expression form 与可用时的 Pronunciation Variant；首期不做 contextual Sense disambiguation，不能宣称每个片段都表达 Scope 中的目标 Sense |
| Speaking | Oral Scenario Rehearsal（情境口语排演） | 给出 Sense-grounded communicative brief，learner 录音作答，ASR transcript 与 AI 提供即时反馈，可重试或继续 | target 是当前 Sense–Expression connection 的情境化使用；首期不提供 phoneme-accurate pronunciation score |
| Reading | Contextual Meaning Inference（语境推义） | 阅读包含目标 Expression 的 Sense-controlled 短语境，先形成理解，再 reveal 当前 Sense 与关键 context cues | target 是该 Context 中的 Sense 理解；首期不要求选择题或把 reveal 后行为当评价 |
| Writing | Written Scenario Response（情境书面表达） | 根据 Sense-grounded scenario 写一句或短回复，AI 给出自然度、意义贴合与修订反馈，并可给 alternative expression | target 是情境化书面表达；不存在唯一标准答案，AI 判断只形成 Practice Feedback |

Oral Scenario Rehearsal 与 Written Scenario Response 可以共享 `Scenario Response` activity family 的
brief、feedback 与 retry 机制，再分别使用 voice/text channel adapter；它们仍是两个 primary Area
下的独立 Activity Definition。Reveal、重听、重试、查看 transcript 等是 interaction/response mode，
不是为了凑数量而建立的新 Activity family。

Real-world Speech Variation 的检索是 form-level：YouGlish occurrence 必须保留 provider provenance，
UI 也必须明确这些片段按 Expression 检索、可能覆盖其他 Sense。若某个相同拼写具有不同发音，只有
能够可靠约束 Pronunciation Variant 的 occurrence 才能用于对应声音泛化；首期省略语义 WSD 不等于
允许错误发音污染活动。

Initial Profile 只发布 Inventory 中确实具备资源、provider、renderer 与 feedback capability 的 Activity。
缺少任一活动不阻止正式 Learning Package 发布，也不能用占位内容伪装可进入。Practice Runtime 只能
读取获准用于 `free_practice` 的资源，永不选择 `assessment_only` 或 protected Transfer inventory。

所有 Practice Turn、Observation、Feedback 与 Artifact 都与正式学习严格隔离：

- 不消耗 daily-new quota，不移动 Book introduction cursor；
- 不改变 `new | acquiring | retaining | relearning` phase；
- 不解决或重开 Acquisition Gate，不完成 Relearning；
- 不产生 Learning Evidence、Encounter Outcome 或 Memory Outcome；
- 不完成、提前或清除一次 due Review，也不调用 FSRS；
- 不自动创建 Personal Meaning、Semantic Intake、Supplemental Membership 或 Add-to-Learning Intent；
- 可以进入独立 Practice history、Learner Semantic Projection 和面向 learner 的练习统计，但不得冒充
  正式能力、掌握度或待复习状态。

如果 Scope 包含尚未正式学习的内容，展示只形成可审计 Practice Turn/exposure，不等于
Introduction，也不消耗 quota。Practice Runtime 不得选择 reserved novel-assessment assets；后续
正式 Policy 必须依据资源 exposure role 保持 Transfer 检验的新颖性。

learner 若要保存练习中发现的新 Context–Expression–Sense，必须显式发起独立 Semantic Intake；若要
进入课程，还需独立 Add-to-Learning。Free Practice 永不产生 Learning Evidence；未来需要正式评价时，
只能新建 Learning Protocol/assessment operation，不能把 Practice fact 通过 bridge 升级、回填或重解释
为 Gate、5D、Memory Outcome 或 FSRS 事实。

## 9. Unified Planning

Planner 在 Session intent 允许的 inventory 中选择下一个 Encounter candidate：

```text
ReviewDue
RelearningReady
InitialProtocolReady
NewEligible
```

具体优先级、fairness、cooldown 和每天是否保留新学容量属于 Planning Policy，但必须满足：

- 所有 candidate 必须来自 Session-pinned Study Scope Revision；`active` Enrollment 可以提供新与
  既有工作，`maintenance` 只提供已经开始或 retaining/relearning 的工作，`paused` 不提供候选；
- candidate 对应的 Resolved Learning Plan 必须为当前 purpose 提供 `ready` protocol/provisioning
  reference；`preparing/blocked` 只进入状态读取和恢复操作，不得被 Planner 当作可执行 Encounter；
- 同一 Retention Target 的多重 source provenance 必须在入选前去重，不能创建重复
  Protocol Run、Encounter 或 FSRS；不同 target expressions 不得仅因共享 Sense 而去重；
- Book 与 Supplemental 的 NewEligible 共用 daily-new quota；Supplemental item 不能永久饿死 Book，
  Book 也不能把 learner 显式添加的 item 永久推迟，具体穿插由版本化 fairness policy 决定；
- 同一 Sense 的独立 Acquisition assessments 之间存在版本化的其他-Sense干扰或等价间隔；
- unresolved Protocol Run 不被不断引入的新 Sense 永久饿死；
- due backlog 不被 daily-new quota 隐藏；
- `review_only` 的候选集合严格受限；
- Declared Mastery 全局排除其覆盖的 Retention Target；
- Planning 只创建计划事实，不直接写 Gate、Evidence 或 FSRS；
- Free Practice 不从这些 inventory 取候选，也不因完成练习改变 inventory membership。

## 10. Protocol Step Instance、Sense Encounter 与 Card Presentation

Protocol Step Instance 是一个 Protocol Run 中某个 Step 的可重放执行实例。它保存 Step definition
version、material role bindings、interaction/grader contract、result eligibility、transition state 与
已经形成的结果。一个 Step 可以通过多个 Encounter 完成；一个 Encounter 也必须只服务于一个 Step
Instance，不能把几个不同结果资格的 Step 偷偷合成一次评价。

Step Instance 成为 current 时解析最新兼容的不可变 Learning Materialization。若 learner 尚未提交任何
Action，同一 Membership 的新材料版本可以刷新当前绑定，同时写入可重放的 Run lifecycle fact 并使旧
UI revision 失效；Action 被接受后，Step 的 materialization 和 role bindings 即成为不可变历史。

Sense Encounter 是对一个 learner、一个 Retention Target 及其 Sense、一个 Step purpose 和一组不可变版本的一次计划接触。
它保存 Study Scope Revision、Curriculum source/Learning Entry Provenance、Learning Materialization、Learning
Protocol/Step/Policy versions；同一 Sense 有多个 source 时只保存实际采用的主 provenance，但不复制
progress。下列是 Step purpose families，不是 Protocol Purpose：

```text
introduction
lightweight_study
acquisition_gate
relearning_gate
retention_review
```

每个 Step/Action 还必须声明与 purpose 正交的 Learning Action Intent：

```text
instruction | practice | assessment | feedback | repair
```

Purpose 决定 Run 可以产生哪类 completion/scheduler transition；intent 决定当前动作是否在教学、练习、
评价、反馈或修复。只有 `assessment` 且固定了合法 response/grader/independence contract 的 Action
才可能进入正式评价；Card 外观、按钮名称和 Step 在序列中的位置不能推断 intent。

一个 Encounter 可以包含：

```text
presentation/support Action
→ one primary evidence-bearing assessment
→ feedback or repair Action
→ Encounter Outcome
```

不是每个 Encounter 都需要 assessment：Introduction 可以只有 binding/reveal。若存在 assessment，
一个 Encounter 最多接受一个有效 primary assessment result；无效输入可以修正，但答案揭示后
不能在同一 Encounter 中制造第二个“独立成功”。

一个 Learning Protocol Run 可以跨多个 Encounter；Encounter 不跨多个 Sense。Card 只是客户端 renderer，
可以把一个 Step 呈现为 prompt、support、response、reveal、feedback 或 detail 等阶段；Card 不拥有
学习身份、课程成员、状态、Evidence、进度或调度。多个 Card Presentation 可以服务于同一个 Step，
同一种 Card 也可以渲染不同协议的 Step；Cards 与 Decks 不成为领域聚合。

Card Presentation 可以进一步声明稳定 Slot。每个 Slot 固定允许的 material roles、数量、顺序、
disclosure 与缺失/溢出处理；Assembly Policy 把 Materialization 中已验证的资源放入 Slot，renderer
只按结果显示。生成模型不能输出布局指令，缺少可选资源时 Slot 折叠，缺少必要资源时 Step 不可执行。
Experience Recall 的任何 Slot 都不得包含 target expression；Expression Reveal 则始终具有 expression
主区与 Sense 确认区，其余发音、语言结构、用法和场景回扣区域均可选。

Card 与页面 renderer 通过 Semantic Design Contract 暴露稳定的呈现角色，再由当前 Sensa Skin 提供
具体视觉实现。Skin 可以改变 typography、surface、shape、elevation、icon、illustration、component
recipe 与受约束的 density/motion，但不能增删或重排具有 disclosure、interaction 或 result 语义的
Slot，不能隐藏当前 Action 必需的信息或 control，也不能改变 answer contract、Attempt eligibility、
Evidence 或 Transition。进行中的 Run 切换 Skin 只重绘 presentation；它不创建 Run lifecycle fact，
不更换 Materialization，也不重置 learner input 或当前 Card phase。

## 11. Action、Attempt、Observation、Evidence 与 Transition

### Learning Action

Learning Protocol 先依据 Protocol Purpose、Step definition 与 Learning Materialization 产生纯 Protocol Decision，
Encounter 再稳定选择具体 immutable resources 并物化 Action。Structured Acquisition 才进一步使用
Executable Capability Inventory、Gate/5D/history 与 Semantic Policy。Action 保存选择原因、scaffold、
assessment independence 与有序 asset references。

### Learning Attempt

Attempt 是 learner 对当前 Action 的追加事实。重复 identity + 相同 canonical fact 是幂等重放；
相同 identity + 不同内容是 immutable conflict。

Learning Attempt 与 Practice Turn 是不同事实类型。即使两者保存相同的文字或语音响应，Practice
handler 也不能调用 Learning Evidence rule，Encounter handler 也不能接收 Practice identity。

### Learning Observation

固定 interaction/grader contract 对 Attempt 作出不可变 Observation。Observation 可以记录 canonical
response、correctness、latency、使用的 support/reveal、learner rating、grader provenance 与有效性；
它回答“发生并观察到了什么”，不自行回答“证明了什么”或“下一步怎么走”。无效 Attempt 可以留下
审计事实，但不能制造结果资格。

### Learning Evidence

本地 Learning Runtime 根据有效 Observation 与固定 Evidence Rule 派生 Evidence。Evidence 只陈述行为，不等于 Gate、
5D level 或 FSRS rating。被动展示、播放、acknowledgement、停留时长、无效响应、自报理解与
Product Event 不产生学习 Evidence。

同一个 Attempt 可以影响多个维度或 Gate，但每个 `(attempt, target, rule version, basis)` 只能
派生一次。重放不得重复推进任何投影。

### Protocol Checkpoint 与 Transition Decision

Protocol Checkpoint 是可选的 Protocol-local 评价里程碑。它引用一个或多个 Learning Capability
Objectives，并在 Run 内拥有当前 credit；它不是 Capability Objective、Retention Target、Card 或
通用 mastery dimension。Acquisition Gate 是 Structured Acquisition 使用的一类特殊 Checkpoint，
Lightweight Protocol 不需要为了接入同一 Runtime 而创建空 Gate。

Evaluation/Progression Policy 基于 Observation、合法 Evidence 与当前 Run state 产生不可变 Protocol
Transition Decision。允许的 effect 由 Learning Kernel 定义并校验，至少可以表达：

```text
CreditCheckpoint
InvalidateCheckpoint
ScheduleRepair
RequireReassessment
ResetProgress(current | declared_set | run)
Advance
Complete
```

Decision 与 effects 在同一事务中原子、幂等应用。Progress Reset 只使显式 scope 内当前 credit 失效，
不删除 Attempt、Observation、Evidence 或历史 Decision；全关重新连续通过等要求通过新的 progress
epoch 表达。Completion 只能由版本化 Completion Policy 基于当前有效状态产生，不能从 Card、队列为空
或客户端 flow state 推断。

## 12. Encounter Outcome 与 Protocol Completion

### Lightweight Study Outcome

Lightweight Study Encounter 完成后产生 `content_completed`、`retrieval_recorded` 或协议定义的其他
封闭结果。满足 Initial Learning Protocol 合同可以另行产生 Study Completion，并必须创建 Scheduling Handoff。
Outcome 必须记录是否存在可判定行为；即使没有，也可以作为诚实的 `protocol_completion` 调度 basis，
但不能写入 Learning Evidence、Gate 或 5D。

### Acquisition Step Outcome

Acquisition Encounter 完成后产生一个语义结果，例如：

```text
introduced
gate_passed
gate_failed
```

它更新 Retention Target progress，并进入 Learner Sense Progress roll-up，不携带 FSRS rating。
`introduced` 只将 phase 从 `new` 转为
`acquiring`。最后一个 required Gate 的 `gate_passed` 可以在同一事务中完成 Cycle，并另外产生
`AcquisitionGraduated` 或 `RelearningCompleted` 领域事件；这不是第二个 Encounter Outcome。
任何单次首次 retrieval 都不能冒充 Acquisition Graduation；FSRS 初始化只消费有效 Scheduling Handoff。

### Initial Learning Completion

Initial Learning Completion 是成功完成正式 Initial Learning Protocol 的统一边界。具体类型可以是
Study Completion、Acquisition Graduation，或经显式导入合同接纳的 imported completion。无论其证据
强度如何，只要系统接受它为成功的首次学习完成，就必须在同一事务边界创建且只创建一个 Scheduling
Handoff；中断、失败或内容不可用不产生 completion，也不能初始化 FSRS。

### Memory Outcome

Memory Outcome 是对现有 Retention Target 的一次协议有效评价所产生的不可变 scheduler event。
Retention Review Encounter 对当次 due Review 产生至多一个；Relearning Protocol 中只有显式声明为
scheduler-eligible 的独立 evaluation 可以另行产生。basis 可以是独立行为、learner rating 或未来受控
grader，但必须显式记录，不能相互冒充：

```text
independent_retrieval
transfer_confirmed
retrieval_failed
learner_rated
```

每个 Outcome 还必须保存规范 grade `again | hard | good | easy`。grade 回答 scheduler 应怎样解释
本次表现，basis/evidence level 回答该判断来自什么以及能支持多强的声明；它们不能合并。某个二元
Protocol 可以合法只映射出 `good/again`，但 `correct` 只是 Observation 或 evaluator 输入，不是
Memory Outcome。learner-rated Protocol 必须把“模糊/费力”保留为 `hard`，不能丢成布尔值。

Outcome 还必须保存 `origin=retention_review | relearning`、Protocol Run/Step/evaluation identity、
target memory-state revision 和幂等 key，再由 FsrsAdapter 映射为版本化 scheduler input。Review 失败后即使 learner
当天完成 repair/relearning，也不能把原失败 Outcome 改写成成功，或为同一次 due Review 重复
调用 FSRS。`认识/模糊/忘记` 一类自评在允许它的 protocol 下可以产生 `learner_rated` Memory
Outcome 并驱动调度，但 evidence level 必须保持 `self_report`；它不能制造独立行为 Evidence、Gate
pass、5D 成功或 Structured Acquisition claim。

FsrsAdapter 消费一个合法 Memory Outcome 后产生 Scheduling Decision，其中包含新 Memory State revision
与 next due。只有 scheduler 可以产生该 Decision；Protocol、Progression Policy、preset、Card 和客户端
都不能直接写 stability、difficulty 或 due time。

### Relearning Completion

Relearning Completion 表示某个 Relearning Protocol 已满足其恢复合同。Lightweight Relearning 可以只
记录 re-binding/retrieval 结果；Structured Relearning 可以同时完成对应 Acquisition Cycle 并更新
Gate/5D。两者都不改写触发它们的 Memory Outcome，不创建新的 Scheduling Handoff，也不
重新初始化 FSRS。Completion 仅表示 protocol 结束，不是 scheduler input；若该 protocol 允许调度结果，
必须由其中明确的独立 evaluation 另行产生 Memory Outcome。

## 13. Scheduling Handoff、FSRS 与 Relearning

- FSRS 按 Retention Target 消费版本化 Scheduling Handoff 或后续 Memory Outcome；
- handoff 至少固定 protocol/version、basis、evidence level、completion time 与 initializer version；
- 每个成功的 Initial Learning Completion 必须且只能产生一个 handoff；Structured Acquisition
  Graduation 使用 `basis=acquisition_graduation, evidenceLevel=behavioral`，Lightweight Study
  Completion 使用 `basis=protocol_completion,
  evidenceLevel=non_evidentiary` handoff，两者不得在分析或 UI 中混为同一证据强度；
- 之后 FSRS 决定 retaining Retention Target 的 due time；
- 后续 protocol 可以使用 learner rating；Structured Semantic Policy 可以轮换 Recognition、Recall、
  Transfer、Boundary 或 Sound assessment；
- due Review 的 Memory Outcome 必须保留 grade、basis 与 evidence level，并最多产生一次 Scheduling
  Decision、推进一次 FSRS revision；
- FSRS/Scheduling Policy 是 Memory State 与 next due 的唯一写入者；Protocol 与客户端只能提交合法
  Handoff 或 Memory Outcome；
- `retrieval_failed` 在记录一次长期遗忘后开启协议选择的 Relearning Protocol Run；只有 Structured
  Relearning 创建 Acquisition Cycle；
- Relearning 可以恢复连接并在 Structured 路径更新 Gate/5D，但不把一次遗忘重复记入、不创建
  Scheduling Handoff，也不重新初始化 FSRS；
- Relearning Completion 不自动改变 due；若 Protocol Version 没有 scheduler-eligible evaluation，
  下次 due 仍由已落账 Review Outcome 的 schedule 控制；
- 若 Protocol Version 启用类 Anki/FSRS 的 relearning 调度，每个合法独立重学评价可产生
  新 Memory Outcome 并最多推进一次 FSRS；它必须保留 `origin=relearning` 且不改写原 Review。

## 14. Encounter 生命周期

```text
planned ──▶ active ──▶ completed
   │           ├─────▶ interrupted
   │           └─────▶ cancelled
   └────────────────▶ cancelled
```

- open/resume 返回尚未解决的当前 Action；
- invalid response 不推进状态或产生 Evidence；
- completed Encounter 恰好保存一个与 purpose 兼容的 Encounter Outcome；
- interrupted/cancelled Encounter 不伪造 Gate pass、Graduation 或 Memory Outcome；
- 同一 learner/Retention Target 的并发 Encounter、Protocol Run 与 projection 更新必须使用一致事务边界；
- 版本化重放必须得到同一 Action、Observation、Evidence、Transition Decision 与 Outcome。

## 15. Declared Mastery

Declared Mastery 是 learner × Retention Target 的独立、可逆声明。当 UI 从 Sense 层发起“已会”时，
必须明示其适用的目标表达集；首版每 Sense 仅一个 primary Retention Target，因而表面行为与
Sense-level 操作一致：

- active declaration 从全部 Planning inventories 排除声明覆盖的 Retention Target；
- 该 target 的 nonterminal Encounter 依事务规则 cancel/interrupt；
- active Protocol Run/Relearning 保留事实但暂停计划资格，不被伪造成 completed/graduated；
- declaration/revocation 不插入 Attempt、Evidence、Outcome，不修改 Gate、5D 或 FSRS；
- revocation 后依据未篡改的 phase/Protocol Run/Memory State 恢复资格；
- declaration 为 active 时 learner 仍可将其 Sense 放入 Practice Scope；任何 Practice fact 都不撤销声明。

实现上，active declaration 必须保存为 Target 上结构化的 `TargetPlanningOverride`，而不是散落在
Protocol/Queue 内部的布尔状态。首版 override 固定 `kind = declared_mastery`、`source = learner`、
创建它的 operation identity 与时间；数组中存在该 kind 即表示 active，撤销则删除 active override，
而 operation ledger 保留声明与撤销历史。

若声明命中 active Run，Runtime 必须在同一事务中写入
`interrupted_by_planning_override` lifecycle fact、推进 Run revision 并撤销 active pointer。恢复资格本身
不伪造 Run 已恢复；learner 再次明确启动时才写入与原 interruption identity 配对的
`resumed_after_planning_override` fact。Lifecycle fact 与 Protocol Action/Event 分离，因此两者都不能携带
Attempt、Evaluation、Evidence、Settlement 或 Memory Outcome。若一个 Run envelope 含多个 Target，任一
成员的 active override 暂停整个 envelope；首版不在运行中静默删改 participant 或重写编排状态。

## 16. Account、Preferences 与 Data Control lifecycle

Settings Surface 组合多个 owner 的读取和命令，不存在一个可以整体覆盖的 `settings` aggregate：

```text
Account snapshot ───────────────┐
Learner Preference revision ────┤
Device Preference (local) ──────┼──▶ Settings Surface
Study Plan summary/link ────────┤
Sync Health ────────────────────┤
Data Control Request status ────┘
```

### Account 与 Account Session

V1 中一个 active Account 恰好关联一个 Learner。Account lifecycle 至少为：

```text
active ──delete requested──▶ deletion_pending ──policy completion──▶ deleted
```

Account Session 只授权访问。sign-out 撤销当前 Session/credential material，不删除 Learner、Progress、
Personal Content 或已同步操作；Learning Session/Encounter 可以被正常中断，但不能因同名 Session
混淆而生成 completion。删除恢复窗口、重新认证方式和 identity-provider token 细节由安全合同决定。

### Preference resolution

Preference 不使用任意 key-value merge。每个字段固定 owner、type、default、revision 与适用时机：

| owner | baseline fields | effect boundary |
| --- | --- | --- |
| Learner Preference | Language-Tag-scoped pronunciation accent、Input/Output-scoped Language-Pair Glossary Entry、Example support-language default visibility | 跨设备同步；从下一次适用的资源选择或呈现开始生效 |
| Device Preference | Interface Locale、surface-scoped Active Route Selection、Appearance Preference（Sensa Skin、color mode、文字大小）、autoplay、reduced-motion override、playback rate/volume | 只在本机生效；系统无障碍设置优先 |
| Study Plan/Curriculum | daily new-Sense limit、Book、Range、Enrollment mode、Learning Policy Assignment | 通过 Curriculum operation/revision 生效，不经过普通 Preference |
| Notification Preference（Later） | reminder permission/schedule/time zone | 独立 permission 与 delivery contract，不混入学习证据 |

Learner Preference update 使用 expected revision 并作为本地版本化事实提交；账号同步只传输提交记录，
并发不同值不能静默 last-write-wins，合并必须产生可解释的 authoritative revision。Device Preference
不进入账号同步，也不要求其他设备收敛。

会改变 immutable asset 选择的 Learner Preference，例如 pronunciation accent，只对下一次尚未物化的
Action/Encounter 生效；active Action 保留已经固定的 asset。纯 presentation setting 可以立即改变
当前视图，但不得改变 Action identity、answer contract、Attempt eligibility 或 Evidence。切换 Sensa
Skin、color mode、文字大小、animation、autoplay、译文默认显示与 playback behavior 永远不能自行产生
exposure Evidence；译文或 autoplay 还必须服从当前 Action 的 asset role/answer-leak contract，没有
授权内容时 Preference 不生效。

### Sync Health 与本机数据

Sync Health 由 connectivity、pending/rejected local commits、last successful upload/download、installed
content/media 与 recovery requirement 派生。用户可以发起 retry、download、repair 或 Local Data
Clearance，但不能直接写 `synced=true`。

sign-out 或 Local Data Clearance 遇到 pending local commits 时必须先尝试同步；若无法同步，只能保留本机
数据，或由 learner 明确确认丢弃列出的提交。Local Data Clearance 清除安装内容、media cache 与本地
学习库后可从账号副本恢复，但不能创建任何服务端 delete/tombstone。

### Data Export 与 Account Deletion

Data Control Request 是幂等、需要授权的服务端 lifecycle。Data Export 至少区分：

```text
requested ──▶ processing ──▶ completed
                    └──────▶ failed
```

Export 固定 request time 与逻辑数据范围，包含 Account/Learner profile、Learner Preferences、Curriculum、
Learning Entry Provenance、Learning Policy Assignments、Resolved Learning Plan provenance、Progress、
Attempt/Evidence/Outcome、Personal Content 与已经交付的 Practice history；派生读取模型可以
重建，不用伪装成独立事实。重复 request identity 不生成两份并行任务。

Account Deletion 只能在线重新授权后请求。进入 `deletion_pending` 后必须：

- 停止接纳新的 learner-scoped operations；
- 撤销 Account Sessions，并让所有 Replicas/refresh credentials 失去写入资格；
- 保存足以拒绝旧离线 outbox resurrection 的 account-deletion barrier；
- 按策略完成 learner-owned data 删除或不可逆匿名化，并使读取返回 deleted state；
- 不把删除建模成 Learning Evidence、Progress reset 或普通 Sync preference。

V1 不提供“重置全部学习历史”。若未来引入，必须是独立、明确范围且可审计的 destructive data
operation；它不能复用 Local Data Clearance 或 Account Deletion 语义。

## 17. 离线与同步边界

主应用先在本地领域事务中验证 learner、目标、固定内容、Protocol/Policy version、Attempt identity 与
当前 revision，再原子地产生 Attempt、Observation、Evidence、Transition、Completion、Handoff、
Memory Outcome、Scheduling Decision 及相应投影。断网不会降低这些规则，也不会阻止已有内容的学习、
复习、重学、恢复或 FSRS 调度。

普通账号同步以本地已经提交的版本化记录为输入，传输清单和内容寻址数据块。服务端可以保存并返回
账号副本，但不得重新运行 Protocol、重新评分、重算 FSRS，或把同步成功本身变成学习事实。下载记录
必须先通过摘要、引用与可重放性校验，再由本地库在提交时合并；同步记账不得触发第二次业务结算。
本机提交是当前设备上的保存结果；账号副本是延迟形成的 Cloud Checkpoint，不参与逐操作确认。
Checkpoint 以本机内容版本与已确认基线判断待同步事实，同步期间产生的新版本必须保留到下一次传输。
Device Operation Ledger 中的命令输入和返回值都不是学习事实，只留在产生它们的设备上。Learning Event
必须自身携带验证与重放所需的 Action、时间、Materialization、Evaluation 和 Transition 引用，云端不得
压缩或改写它，也不得要求原始 operation input 才能验证或恢复。跨设备 Intake 重试从已保存的 Intake
领域事实重建结果，并由独立 Remote Intake Delivery Receipt 保证邮箱投递幂等。

Curriculum、Personal Content、正式 Learning Runtime 与 Free Practice 使用各自的 identity、revision、
tombstone 和幂等规则。界面、模型输出、导入器与同步适配器只能提交各模块允许的 command/fact，不能
直接制造 Effective Learning Policy、Plan readiness、Evidence、Completion、Memory State、掌握百分比
或 `synced=true`。并发冲突必须产生可解释的 revision/merge 结果，不能静默 last-write-wins。

Learner Preference 作为版本化本地事实参与账号同步；Device Preference 留在当前设备。Account
lifecycle 与 Data Control Request 仍需在线重新授权，不能借学习库同步绕过。Account Deletion 删除
云端账号与同步副本；本机学习库清除是独立、显式的 Local Data Clearance。

Sync record、manifest、block canonicalization、容量限制与冲突响应由版本化 Sync contract 定义，不属于
学习运行时本身。

## 18. 当前实现边界

当前生产 Web 的学习权威位于本机：`apps/web/src/experience/learningRuntime` 负责 Protocol/Policy/评价
与运行协调，`packages/learning-kernel` 提供可复用的纯规则，`apps/web/src/data/library` 在 SQLite WASM
事务中保存并恢复个人事实、运行、结果与 FSRS 状态。Card/页面只是 renderer，不能直接写入成功、
证据或调度状态。

Hono/Edge 不是 Learning Runtime。它只提供账号和扩展授权、学习包目录/下载、普通账号 Library Cloud
Sync、在线模型、阅读/语义查询及账号删除等可选在线能力；这些能力可以提供候选内容或运输已提交
记录，但不能拥有 Protocol Run、Encounter、Completion、Memory Outcome 或 FSRS 结算。

服务端旧 Consumer Runtime 及其 Planning/Encounter/replica vertical slice 已退出当前实现；数据库通过
前向迁移删除对应运行、课程副本、内容生成任务与调度表，不保留旧数据兼容路径。以后增加新的
Protocol/Profile 只能扩展本地运行时原语、版本化合同和重放验证，不能重新引入服务端学习权威。

当前交付范围只保证 Web。暂停的原生客户端代码与历史参考文档不定义现行实现，也不能作为 Web
运行时、离线能力或同步合同的验收证据。
