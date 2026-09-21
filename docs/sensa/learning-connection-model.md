# Sensa 学习连接模型

> 状态：Canonical domain model
> 更新日期：2026-09-21

本文定义一个 confirmed Sense 与目标语言表达的连接如何取得内容、选择学习方式、形成不同强度的
结果并交给长期调度。个人意义与 Sense 确认由
[`personal-semantic-world-model.md`](personal-semantic-world-model.md) 裁决；Structured Acquisition
的理论细节由 [`semantic-acquisition-model.md`](semantic-acquisition-model.md) 裁决；资源和运行行为
分别由 [`sense-learning-resource-model.md`](sense-learning-resource-model.md) 与
[`learning-runtime-model.md`](learning-runtime-model.md) 裁决。

本文是 [ADR 0006](../adr/0006-three-product-systems.md) 所定义 **Learning System** 的主连接模型：
Curriculum 接纳来自 Book、direct stable-Sense 或 Personal Semantic World bridge 的学习意图，再把固定
Target、Policy/Plan、Content Supply handoff、Runtime outcome 与 Scheduling 串成一条可审计链。
Learning Runtime 是这条链的执行部分，不拥有入口或 Curriculum lifecycle。

## 1. 领域定位

正式学习不创造 Personal Meaning，也不决定公共 Sense。它在 stable Sense、目标语言表达和 learner
意图已经确定后，选择一种方法建立或恢复 meaning–form connection。学习是个人语义世界可以调用的
一种服务，不是 Personal Meaning 存在的前提或唯一去向；反过来，Personal Semantic World 也不是
正式学习的前置入口。

```text
Book membership ───────────────────────────────────────┐
Direct stable Sense + target binding ── Add-to-Learning┼──▶ Learning Target
Accepted complete Personal Meaning + target binding ───┘
      ↓
Retention Target
      ↓
Learning Policy Assignment
      ↓ resolve
Effective Learning Policy
      × applicable Language Learning Route revision
      ↓
Resolved Learning Plan(preparing | ready | blocked)
      ↓ ready
Content Provisioning × purpose-specific Learning Protocol
      ↓
Learning Materialization + Protocol Run
      ↓
Protocol Outcome
      ├── Initial Learning Completion ──▶ Scheduling Handoff ──▶ initialize FSRS
      ├── Memory Outcome ──────────────────────────────────────▶ update FSRS once
      └── Relearning Completion ───────────────────────────────▶ retain existing FSRS
```

Book-first learning 可以直接从已发布 Sense 建立 Learning Target；direct learning 可以从 Catalog、搜索、
reviewed Alignment 后的 Contextual Lookup 或其他已存在的 stable Sense + target binding 显式加入；
personal-first learning 则沿完整 Context–Expression–Sense Personal Meaning 及其 active Alignment 建立
同一类目标。Meaning Focus 可以不存在。三类入口在 Learning Target 处汇合，都保存 Learning Entry
Provenance，但 provenance 不进入 target/retention identity。

直接学习仍然是 Sense-first：一个裸 Lexeme、target-language 字符串或未对齐的 Reference Sense 不能
成为 Learning Target。用户可以不创建 Personal Meaning，但系统仍必须解析并固定具体 stable Sense、
Sense Version 与 target Sense Expression Binding。

## 2. 十个正交问题

一个 Target 的 learner-specific “课程”由 Resolved Learning Plan 表达，而不是把 Target 本身变成课程。
该 Plan 必须保持四个方面可独立演化：**目标**（Learning Target + Capability Objectives）、**内容**
（Materialization）、**实施**（Protocol/Step/Action）和**评价**（Observation/Evidence/Checkpoint/
Transition/Outcome）。实施与评价再跨两个时间尺度运行：短期 Acquisition 建立连接，长期 Retention
持续检验和恢复；Relearning 是 Retention 中的恢复 purpose，不是第三种记忆时间尺度。

领域模型必须分别回答：

1. **学习什么**：固定哪个 Sense Version 和哪个 target expression；
2. **希望形成什么能力**：固定哪些 Learning Capability Objectives，以及哪些确有独立长期调度价值；
3. **希望采用哪种学习保证与方式**：解析哪个 learner-selected Learning Policy Profile；
4. **内容从哪里来**：published、on-demand 或 hybrid；
5. **当前阶段怎样执行**：为当前 Protocol Purpose 使用哪个 versioned Learning Protocol；
6. **怎样评价并推进**：Observation 如何成为 Evidence，Checkpoint 如何结算，失败如何 repair/reset；
7. **当前是否可执行**：target、objectives、policy、content 和 runtime capability 能否解析出 ready plan；
8. **哪个连接独立保持**：Learning Target 解析到哪个稳定 Retention Target；
9. **在哪条语言路线中执行**：固定哪个 Language Learning Route revision，并解析本次 Target、Support、
   Input 与 Output Language 角色；
10. **怎样连接长期调度**：Initial Learning 如何 Handoff、Review 和合法 Relearning
   evaluation 如何产生各自不可变的 Memory Outcome。

Learning Policy、Sense Learning Package、Learning Protocol、Learning Evidence 与 FSRS 不能再合并为一个概念。
同一份 published content 可以服务多种 Protocol；同一种 Protocol 也可以由 published 或 on-demand
content 支持。Learning Policy 可以协调选择这些正交对象，但不能抹掉它们各自的 identity、版本和
结果语义。

| Learning Protocol | Published content | On-demand content | Hybrid |
| --- | --- | --- | --- |
| Lightweight Initial Learning | 可以 | 可以 | 可以 |
| Structured Initial Learning | 可以 | 校验达到协议要求时可以 | 可以 |
| Retention Review | 可以 | grader/novelty 合同允许时可以 | 可以 |
| Lightweight Relearning | 可以 | 可以 | 可以 |
| Structured Relearning | 可以 | 校验达到协议要求时可以 | 可以 |
| 未来会话、边界或专项协议 | 可以 | 可以 | 可以 |

## 3. Learning Target

Learning Target 至少固定：

- stable Sense identity 与 Sense Version；
- target Language Tag；
- primary target Sense Expression Binding 及所需 form version；
- learner、Curriculum provenance 与 Learning Entry Provenance。

Learning Protocol 在创建 Protocol Run 时与 target 绑定；它不属于 target identity，因此切换学习方式
不会悄悄创建另一个“要学的连接”。

Personal Meaning 与 Personal Anchors 可以作为来源或 learner-authorized scaffold，但不成为 target
identity。

### Language Learning Route 与语言上下文

Language Learning Route 固定一个 Target Language、一个可与其相同的 default Support Language，以及
一个 route-scoped Study Plan。它表达 learner 当前希望在什么支持语言环境中习得哪一种语言，而不是
声明全局母语、唯一 Familiar Language 或 proficiency。一个 Learner 可以同时拥有多条 active、paused
或 archived Routes。

Learning Target 仍以 stable Sense 与 target Sense Expression Binding 表达“学什么”。Curriculum
Membership、Study Scope Revision 与 Resolved Learning Plan 另外固定适用 Route revision，并校验
Binding 的 exact Language Tag 与 Route Target Language 兼容。Support Language、Interface Locale 和
Active Route Selection 都不进入 Retention Target identity；改变它们不得复制或重置正式进度。

Session、Sense Construction、Content Provisioning Task 与其他跨多步操作在开始时解析 Pinned Language
Context。阅读、解释与写作再按各自意图声明 Input/Output Language；例如 target-language 阅读可以输出
support-language 解释，反向写作则以 support-language prompt 要求 target-language output。后续 Active
Route Selection 只影响新操作，不得重绑已经开始的工作。

同一个 Retention Target 可以从多个兼容 Route 或 Curriculum source 进入，但仍只有一份 Protocol
history、Evidence 与 FSRS Memory State。若 Target Language 或 target Binding 真正改变，则产生新的
Learning/Retention Target；只改变 Support Language 不会宣称建立了新的记忆连接。

### 独立入口与 Personal Semantic World bridge

Learning Runtime 只依赖 Learning System 已在 Curriculum 中解析的 Learning Target、Retention Target、
Effective Learning Policy 与 ready plan，不读取 Personal Semantic World membership 来决定能否学习。
入口边界必须满足：

- Book/Catalog/direct stable-Sense entry 不创建 Personal Meaning、Meaning Focus、Alignment 或 Personal Anchor；
- personal-first entry 只消费已经由 direct 或 delegated Semantic Acceptance 提交的完整 Personal Meaning；
  未完成的 Intake Inbox Item、Context、Expression candidate、Meaning Focus 或 Personal Meaning 本身都不
  能代替 stable Sense Version + target binding；
- personal-first entry 只有在独立的 Add-to-Learning Intent 被 learner 直接提交，或由持有对应独立
  grant 的 Agent 委托提交后，才创建 Curriculum Membership；委托 semantic-world commit 权限不自动
  包含 Add-to-Learning 权限；
- 学习历史、Review、Relearning 或推荐不能反向推断并创建 Personal Meaning；
- 删除、归档或重新组织 Personal Meaning 不删除 Supplemental Membership、Retention Target、Protocol
  history、Evidence 或 FSRS State；
- Personal Anchor 只在 learner 明确授权且当前 Materialization contract 允许时成为可选 scaffold；它
  不是 direct learning 或 personal-first learning 的运行依赖；
- 同一 learner × Sense × target binding 无论来自 Book、direct entry 或 personal-first bridge，都解析到
  同一个 Retention Target，并按 Curriculum source provenance 去重。

这是一条可选单向桥接，而不是模块绑定：

```text
Personal Semantic World ── explicit Add-to-Learning ──▶ Learning
Learning ──╳──▶ implicit Personal Meaning creation
```

### Retention Target：长期记忆身份

Learning Target 是一次正式学习意图的固定输入；Retention Target 是这条连接跨内容版本、
Protocol Run 和多次 Session 持续存在的 learner-specific identity。其默认身份为：

```text
learner × stable Sense × target Sense Expression Binding
```

同一 Sense 下的 `buy`、`purchase` 或 `acquire` 是不同的目标表达，必须拥有独立 Retention
Targets，因为 learner 可能稳定取回其中一个而不能取回另一个。Sense Version、Binding Version、
Materialization 或 Protocol 更新只保留版本 provenance，不因普通修订重置该记忆身份。

每个 Retention Target 默认只拥有一份 FSRS Memory State。Recognition、Recall、Listening、
Transfer 等可以保留各自 Evidence、Gate 或诊断投影，Protocol/Policy 也可优先检验最弱或
最久未触达的能力；它们不会仅因题型、提示方向、输入通道或 Card Presentation 不同就拆分
FSRS 状态。只有当产品显式定义了一项需要独立长期保持的能力，且它拥有稳定的提示/
响应合同、可持续分离的表现和有实际价值的独立调度时，才能为同一 Sense–expression 创建显式
独立的 retention scope；这是一个新 Retention Target，不是新 Card。

Learning Capability Objective 说明 learner 希望形成的可观察表现，并作为内容、Protocol 与评价的
共同输入。普通 Protocol Checkpoint、Acquisition Gate、诊断维度或题型变化不自动成为新的能力目标；
只有 learner-valued、合同稳定、表现可持续分离且有独立调度价值的目标才扩展 retention scope。

Learner Sense Progress 因此只是一个 Sense 下多个 Retention Targets 的 roll-up。某一 delivery profile
可以为一个 Sense 只选定一个 primary target binding，因而实际只产生一个 Retention Target；这是交付
约束，不是把 learner × Sense 当成永久 scheduler identity 的理论结论。

## 4. Learning Policy 与 Resolved Learning Plan

### Add-to-Learning 与准备边界

Add-to-Learning 表达“把这条稳定连接纳入一条明确 Language Learning Route 的正式学习”，不是“内容
已经准备完成”或“立即开始一次 Protocol Run”。Curriculum 先校验 target Binding 与 Route Target
Language 兼容，再在 stable target、合法显式/继承 Policy Assignment、Declared Mastery conflict 与
existing-scope 检查通过后接纳 Intent，创建 route-scoped Supplemental Membership；随后才解析
Effective Learning Policy、Resolved Learning Plan 和实际 Content Provisioning。Book membership 作为
同一 Route 内的另一个 Curriculum 来源进入同一套 Policy/Plan resolution。

因此，暂时缺少 content、grader、客户端或 protocol capability 是 plan readiness/blocked reason，
不是删除已经接纳 learner intent 的理由。只有 invalid target、unsupported policy assignment、显式
Declared Mastery conflict 或其他真正 admission conflict 才拒绝创建 Membership。

### Learning Policy Profile

Learning Policy Profile 是 learner 可以选择、系统可以版本化发布的学习方式合同。它不直接拥有
Protocol Run、Materialization、Evidence 或 FSRS，而是协调一个 Learning Target 在完整生命周期中
应如何选择这些对象。每个 Profile 至少固定或引用：

- 对 `initial_learning | retention_review | relearning` 各 purpose 允许的 Protocol family 与选择规则；
- 每类 Protocol 所需的内容能力、运行时 capability 与保证级别；
- Evaluation/Evidence Policy、Progression/Completion Policy、Repair Policy、Scheduling Policy 与
  learner-visible claim boundary；
- provisioning fallback、blocked 条件和是否允许 learner 显式降级；
- profile identity、version、适用语言/客户端能力与迁移规则。

Profile 不拥有学习数量。learner 只在 Study Plan 设置一个每日新学数量，由 Unified Planner
统一选出当天可以 Introduction 的 Target；Profile、Protocol 与 Runtime Adapter 只能编排获选集合，
不能另设组大小、批次上限或 active window。due Review 与 Relearning 也不受这项新学额度截断。

`lightweight` 与 `high_assurance` 是两个代表性 Profile，而不是全局固定枚举。轻量 Profile 可以把
Lightweight Study、learner-rated Retention Review 与 Lightweight Rebinding 组合起来；高保证 Profile
可以把 Structured Acquisition、evidence-oriented Retention Review 与 targeted/Structured Relearning
组合起来。未来可以发布其他 Profile，但不能用 UI 名称或任意 Settings 值绕过版本化合同。

因此 Profile/preset 是一组策略的**命名组合**，不是新的进度聚合：

```text
Learning Policy Profile
├── Acquisition Protocol + Evaluation + Progression + Completion
├── Retention Protocol + Memory Outcome mapping
├── Relearning / Repair Policy
├── Content Requirements
├── Scheduling Policy
└── Claim Policy
```

Learning Entry Provenance 和 Learning Policy 保持正交。来源可以影响默认推荐、可用 content capability
和初始 readiness，但不能永久决定方法：personal-first target 可以在资源满足时采用 high-assurance，
Book/direct target 也可以选择 lightweight。若某 Profile 当前不可执行，Plan 必须诚实 preparing/blocked，
不能根据来源静默改成另一个 Profile。

Protocol 负责一次学习/复习过程“如何编排和结算”，Scheduling Policy/FSRS 负责“下一次何时 due”。
Profile 可以同时引用二者以形成 learner 可理解的完整模式，但不能把步骤编排和时间调度合并为一个
含义模糊的 Protocol 状态。

### Learning Policy Assignment 与 Effective Learning Policy

Learning Policy Assignment 是 learner 或 Curriculum 对 Profile 的显式、版本化选择。它可以位于
learner default、Curriculum source 或 Retention Target override 三种 scope；解析优先级为：

```text
explicit target override
      > applicable Curriculum assignment
      > learner default
      > system default
```

解析结果是一个固定 Profile/version 和 decision provenance 的 Effective Learning Policy。一个
Retention Target 来自多个 Curriculum source 时，不得因为新增来源而静默切换已经生效的 Policy；
冲突必须由确定性规则保留现有 assignment，或要求 learner 发出显式 policy-change operation。

上述 precedence 和普通 policy-change 只负责尚未形成 Committed Learning Policy 的 target。只要目标
仍处于 `preparing | blocked | ready` 且尚未创建第一次正式 Protocol Run，新的 Assignment revision
就可以重新解析 Effective Learning Policy、内容准备和 Plan readiness；`ready` 或已进入 Planner
inventory 本身不构成锁定。

### Committed Learning Policy 与迁移边界

当一个 Retention Target 创建第一次正式 Protocol Run 时，系统必须把当时的 Effective Learning Policy
冻结为 Committed Learning Policy。这个边界表示学习方法已经开始产生可解释的步骤、完成条件和长期
调度语义；此后普通 Settings、learner default、Curriculum assignment、新增来源或新增内容都不能原地
改变该 target 的学习方式。后续 `initial_learning | retention_review | relearning` Run 都从这条
Commitment 解析其 purpose-specific Protocol，直到发生显式 Learning Policy Migration。

Learning Policy Migration 不是编辑原 Assignment，也不是“下一次 Run 自动采用新默认值”。它必须：

- 由 learner 发出独立、显式意图，并固定 from/to Profile 与版本；
- 在没有未结算 Encounter 的安全边界结束、中断或归档旧方法的 active work；
- 创建新的 Assignment、Committed Learning Policy 与 Resolved Learning Plan revision；
- 保留旧 Run、Outcome、Evidence、Completion、Scheduling Handoff 与 FSRS State，不重写其解释；
- 重新执行目标方法所需的 content/capability readiness 检查，缺失时保持 `preparing/blocked`；
- 不自动重开 Initial Learning、不重新初始化 FSRS，也不伪造第二次 Initial Handoff；若要取得新的
  高保证资格，必须由独立 qualification/migration Protocol 明确规定。

MVP 不提供 Learning Policy Migration：learner 在第一次正式 Protocol Run 前可以修改方式；一旦创建
该 Run，目标页面只读展示 Committed Learning Policy，不再提供普通“修改学习方式”操作。领域模型
保留未来显式迁移，但不允许客户端用删除后重加、修改默认方式或切换来源绕过锁定。

### Resolved Learning Plan

Resolved Learning Plan 是以下输入的版本化解析结果：

```text
Learning Target
× Learning Capability Objectives
× Effective Learning Policy
× available published/on-demand/hybrid content capabilities
× executable runtime/client/grader capabilities
```

它固定 purpose-specific Protocol references、Content Provisioning requirements、当前 readiness、选择
provenance 与 blocked reason。它不是未来 Encounter/Card 的固定序列，也不预计算长期 due calendar；
Unified Planner 和 purpose-specific Protocol 仍在每次运行时决定下一项合法工作。

每个适用 Protocol Purpose 的 readiness 使用闭集 `preparing | ready | blocked`；产品可按 Retention
Target 当前 phase 投影一个 current readiness，但不能用一个全局布尔值覆盖三种 purpose：

- `preparing`：target 与 Policy 已合法接纳，内容或 capability resolution 尚未完成；
- `ready`：当前 purpose 已能解析合法 Protocol 与 provisioning path，可以进入正式 Planning；
- `blocked`：缺少内容、协议、客户端、grader 或其他必需 capability，保存可解释 reason；
- 任何非 `ready` 状态都不能创建 Protocol Run、Encounter、Completion、Evidence 或 FSRS 事实。

选择高保证 Profile 但资源不足时必须保持 `blocked` 或继续 `preparing`，不能静默切换到轻量 Profile。
learner 可以通过独立、显式的 policy-change operation 选择降级；该操作生成新的 Assignment、Effective
Policy 与 Resolved Learning Plan revision，但只适用于尚未形成 Committed Learning Policy 的 target；
已提交 Runtime 的 target 必须走 Learning Policy Migration。

## 5. Content Provisioning

### Published Learning Content

Published content 在 learner run 之前生产、验证并发布。生产者可以是人工、LLM 或混合流程；真正
决定其身份的是发布时机、review status、provenance 和不可变 release，而不是作者是不是 AI。
Sense Learning Package 是这种路径的可复用 bundle。

它适合：

- 公共 Book 与高复用 Sense；
- 离线交付；
- 高保证 Assessment；
- 需要 protected inventory、严格媒体授权或人工审校的内容。

### On-demand Learning Content

On-demand content 在固定 Learning Target、Effective Learning Policy、Pinned Language Context 与当前
purpose Protocol 后，根据 learner 当前需要生成。生成可以读取 confirmed Sense、target expression、
support-language access path、Protocol requirements、允许的历史与 learner 明确授权的 Personal Anchors，
但不得重新解释或改变 Sense boundary。

它适合：

- learner 按需创建的新 Sense；
- 个性化场景、解释、例句与边界对比；
- 低成本 Lightweight Study；
- published content 不足时的受控补充或 repair。

生成成功不等于发布。On-demand output 在进入一次学习前必须完成适用于当前角色的 schema、target、
language、safety、semantic-consistency 与 renderer validation，并冻结为 Learning Materialization。

### Content Demand 与生成交接

Learning Protocol 不应把对内容的需求压成一段 prompt，也不应要求生成模型读取客户端
代码才能知道“要产生什么”。Content Demand 是 source-neutral 的版本化合同，至少声明：

- material role identity、必选/可选与数量范围；
- 每个 role 的 content schema/version、合法 Step intent 与 Evidence eligibility；
- provisioning policy 与必须通过的 validator policies；
- 哪些冻结 context kind 是供给方必须看到的，以及它们的 schema、数量和允许来源；
- 由外部工具从已接受材料派生新 role 的版本化 Content Derivation。

Content Demand 只说明一次 Protocol Run 必须拥有哪些内容能力，不指定内容来自
Published、On-demand 还是 Hybrid，也不把 Card Presentation 或 Session 顺序写入资源。
增加 prompt / reveal / feedback / detail 呈现可以只调整 Protocol Step 与 material-role binding；
只有它同时改变 Completion、Checkpoint credit 或 reset 语义时，才需要改动相应的版本化
Progression/Completion Policy，不因“多一张卡”修改 Learning Kernel。

Content Generation Request 是交给某个供给 adapter 的独立请求。它必须嵌入 exact Content
Demand，固定 Learning Target / Sense Version / expression binding / Policy / purpose Protocol，
并携带已冻结的 Content Context Artifacts。target expression、confirmed Sense、经授权的原始场景与
词典/语料/发音事实都是有 provenance 的 artifact；模型不得把自身猜测当成权威事实，也不得改写
固定语义事实。模型通过获准工具取得的结果，必须先冻结为带来源的 Content Context Artifact 或
Material Candidate，才可参与后续决策。Personal Anchor artifact 必须引用有效 use grant。

模型、Published source 或外部工具的输出先是 Material Candidate。Candidate 必须引用所属 request、
material role、schema/version、source artifacts、producer/policy provenance 与 digest。只有所有 required
role 的 cardinality 满足、每个 Candidate 通过该 role 声明的 validators，才可按 assembly
policy 冻结为 Learning Materialization。“模型返回了 JSON”不是 ready。

TTS 等媒体生成属于 Content Derivation，不是额外交给内容模型的自由上下文。它在源文本/
发音事实通过适用校验后，按固定 provider/model/voice/accent policy 产出另一个受校验的
Candidate，不由 LLM 伪造 audio URL 或 media provenance。

### Agentic On-demand Provisioning

当原始场景、Expression 类型和可用客观事实不能预先穷举时，On-demand 路径可以使用一个有界的
tool-calling agent loop。它只是 Content Provisioning 内部的生产方式，不是 Learning Protocol Step、
Card、grader 或 Runtime actor。一次 Content Provisioning Task 的身份固定为：

```text
one Learning Target
× one purpose-specific Learning Protocol
× one exact Content Demand
```

任务边界不是裸 Expression。相同表面形式的不同 Sense 必须进入不同任务；同一 Sense 的不同 target
expression binding 也必须进入不同任务。任务输入固定 target/Sense/expression、Effective Learning
Policy、Protocol/Demand、已授权的多模态场景与既有 artifacts，并同时固定允许使用的 tool catalog、
调用预算和终止条件。

每个 Content Agent Attempt 只能在一个任务内分析并调用封闭、typed、versioned 的工具。任意网络、
文件或模型能力都不会因为“Agent 需要”而自动获得许可。工具输出按语义进入两类边界：

- 字典、语料、发音索引、OCR/vision 等查证或解析结果，冻结为带 tool/version、input/output digest、
  source/rights 与授权信息的 Content Context Artifact；
- TTS、媒体合成或其他内容派生，按 Content Derivation 产生 Material Candidate，而不是被当作无来源
  的隐藏 prompt context。

Agent 可以在提交前运行 advisory preflight，但不能批准自己的输出。它的唯一成功产物是一个不可变
Material Candidate Bundle：冻结工具取得的 supporting Context Artifacts，并按 role 列出 Candidates、
provenance、显式 optional-role omission 与生产记录。Bundle 提交后该 Attempt 终止；后续独立
validator/admission 只根据 Task 的固定输入与该 Bundle 校验 schema、target、language、safety、rights、
semantic consistency、renderer support 与 cardinality，并由系统 assembly 产生 Learning Materialization：

```text
Content Provisioning Task
→ Content Agent Attempt + approved tools
→ Material Candidate Bundle     (Agent stops)
→ independent validation/admission
→ Learning Materialization
→ formal Protocol Run
```

校验拒绝 Bundle 时，系统不得恢复已经结束的 Agent，也不得让它在看过最终判定后修改同一提交物。
若 retry policy 与预算允许，任务创建新的 Content Agent Attempt，并显式提供可公开的 rejection facts；
否则任务进入 blocked。所有重试共享固定 Task identity，但各自拥有独立输入快照、调用记录与 Bundle。

批量生成只是 Provisioning Batch 对多个独立 Task 的调度分组。每个 Task 仍拥有独立 Agent context、
budget、结果、失败和重试；单项失败不得使其他项回滚。基础设施可以共享缓存或使用 provider batch
以降本，但不得混合 target context 或候选身份。Provisioning Batch 不定义 learner 每日新学数量，
也不是一个必须整体成功的领域事务。

### Hybrid

Hybrid 可以用 published Sense facts、发音或 protected assessment，组合 on-demand 的个人化场景、
解释和练习。每个 material item 保留自己的 provenance、review status、visibility 与 Evidence
eligibility，不能因同处一个界面而提升资格。

## 6. Learning Materialization

Learning Materialization 是一次 Protocol Run 真正读取的不可变内容快照。无论来源为何，它至少固定：

- Learning Target 与 Sense Version；
- Effective Learning Policy Profile/version 与 plan revision；
- Learning Protocol/version；
- 每项内容的 role、source、generator/reviewer provenance 与 validation status；
- Protocol Step 可引用的 material-role bindings；
- target expression/form、允许的答案与必要 renderer contract；
- personal scaffold authorization；
- materialization identity、revision/digest 与创建时间；
- teaching、practice、assessment、repair 等 visibility/eligibility。

Materialization 固定“有哪些合法内容”，Protocol Step 固定“何时、为何使用哪些 role”，Card
Presentation 决定“当前如何显示”。Action、Attempt、Protocol Outcome 与后续审计都引用该快照。
learner 看到内容或提交响应后，系统不得
重新调用模型改写题目、正确答案、Sense boundary 或评分基础；变化必须产生新的 materialization。

生成失败、模型不可用或校验不通过时，Runtime 只能选择当前 Effective Learning Policy 允许的合法
fallback、改用 published content，或把 Resolved Learning Plan 保持/转为带原因的 `blocked`。它不能
换一个 Sense、放宽 Protocol requirements、静默降级 Learning Policy，或展示未经校验的内容来伪造成功；
Membership 与 learner intent 仍保留，只有正式运行资格被阻止。

## 7. Learning Protocol

Learning Protocol 是建立、检查、加强或恢复连接的方法合同，而不是页面模板。每个版本必须固定
`purpose = initial_learning | retention_review | relearning`，并至少声明：

- 允许进入的 target/content/runtime readiness；
- required 与 optional material roles；
- Protocol Step definitions 与 transition model；
- optional Protocol Checkpoints，以及它们引用的 Learning Capability Objectives；
- 可以物化的 Action/Encounter families；
- pinned interaction/grader、Observation 与 Evidence rules；
- versioned Progression/Completion Policy，以及 failure、repair、reset 与 interruption semantics；
- 可以产生哪些 Protocol Outcomes；
- 与 Scheduling Handoff、Memory Outcome 和 FSRS 的合法关系；
- 与客户端、grader、offline 和 model capability 的兼容要求。

Protocol 选择不会改变 Sense，也不会把一种方法的完成结果冒充另一种方法的证据。三个 purpose 的
scheduler 权限不同：成功的 initial learning 必须 Handoff；retention review 只对当次 due Review
产生最多一个 Memory Outcome；relearning 不重新初始化也不重复评价原 Review，但版本化协议可以
把指定的独立重学评价声明为 scheduler-eligible。

Learning Policy Profile 可以分别为三个 purpose 选择 Protocol family，但不会创建一个跨首次学习、
数月 Review 与 Relearning 的巨大 Protocol Run。每个实际 Run 仍只固定一个 purpose，并引用解析它的
Effective Learning Policy 与 Resolved Learning Plan revision。

## 8. Protocol Step 与 Card Presentation

Protocol Step 是 Protocol 的最小可恢复执行单位，不是固定页面。一个 Step definition 至少声明：

- step purpose、Action intent 与 required material roles；
- prompt、support、response、reveal/feedback 所需合同；
- interaction 与 grading requirement；
- Activity、Attempt、Evidence、Outcome 的 eligibility；
- success、failure、skip、interrupt 后的 next-step rules。

Protocol 可以把 Step 组织成固定顺序、分支、循环、穿插或 Policy-driven transition。Protocol Run 为
learner × Retention Target 固定版本并创建 Step Instances；每个 Instance 保存 material bindings、当前状态、
transition result 与 replay/resume provenance。具体卡片数量不是领域不变量。

```text
Learning Protocol + Learning Materialization
                    ↓
              Protocol Run
                    ↓
       Protocol Step Instance
                    ↓
        Sense Encounter / Action
                    ↓
 Card Presentation(prompt / reveal / feedback / detail)
```

Card Presentation 是当前 Step/Action 的瞬时客户端表现。一个 Step 可以经历多个 presentation phases，
一个 Card 也不能反向拥有 Step、progress、Evidence、Curriculum membership 或 FSRS。Cards/Decks 仍不
是 Sensa 的领域对象；卡片布局、动画和组件树属于 renderer/delivery contract。

### 8.1 实施意图与评价管线

实施和评价使用两条正交轴。Protocol Purpose 区分一次 Run 的 scheduler 权限；Learning Action Intent
区分当前动作是在 `instruction | practice | assessment | feedback | repair`。同一个 Purpose 可以包含
多种 intent，但只有协议声明为 assessment、具备固定 response/grader contract 且尚未泄露答案的动作
才有资格进入正式评价。

正式评价固定为以下管线：

```text
Learning Attempt
      ↓ pinned interaction / grader contract
Learning Observation
      ↓ Evidence Rule（若满足行为证据条件）
Learning Evidence
      ↓ Evaluation / Progression Policy
Protocol Transition Decision
      ↓ atomic effects
Checkpoint credit / Repair / Reassessment / Progress Reset / Completion
```

Attempt 是 learner 的原始追加事实；Observation 记录 correctness、latency、support/reveal 使用、learner
rating 等被固定合同解释后的事实；Evidence 只陈述合法行为支持了什么；Transition Decision 才决定
当前协议如何推进。`correct: boolean`、Card 点击或 learner-facing 文案都不能跨过这条管线直接写进度
或调度。

### 8.2 Protocol Checkpoint 与能力目标

Protocol Checkpoint 是 Protocol-local 的评价里程碑，可以引用一个或多个 Learning Capability
Objectives，但两者不是同一身份。多个 Checkpoint 可以从不同条件检验同一能力，一个 Checkpoint
也可以合取多个能力；Checkpoint 数量、顺序和名称都属于 Protocol Version，不产生 Retention Target。
Acquisition Gate 是 Structured Acquisition 中具有明确能力与独立行为要求的一类特殊 Checkpoint，
不是所有 Protocol 都必须伪造的通用进度格。

Checkpoint 是可选的。Lightweight Protocol 可以只要求规定的教学/练习动作完成，并产生诚实的
Study Completion；没有评价性 Checkpoint 时不得制造 Gate、behavioral Evidence 或 Graduation。

### 8.3 Progression、Reset 与 Completion

Progression Policy 把评价结果解释为受约束的 Transition effects，例如：

```text
CreditCheckpoint(checkpoint)
InvalidateCheckpoint(checkpoint)
ScheduleRepair(checkpoint)
RequireReassessment(checkpoint)
ResetProgress(current | declared_set | run)
CompleteInitialLearning
```

Protocol Version 选择失败时使用哪种 effect；Learning Kernel 验证并原子应用它们。Progress Reset
只让显式 scope 内的当前 credit 失效，必要时开始新的 progress epoch，不删除 Attempt、Observation、
Evidence、失败历史或旧 Transition。Completion 只能由版本化 Completion Policy 基于当前有效状态
推导，不能由“最后一张 Card 已显示”或“队列暂时为空”推导。

## 9. 三种 Protocol Purpose

### 9.1 Initial Learning Protocol

Initial Learning 负责在 `acquiring` 阶段首次正式建立 meaning–form connection。成功结束必须产生一种
protocol-specific Initial Learning Completion，并在同一权威事务边界创建 Scheduling Handoff；中断、
失败或 materialization unavailable 不得初始化 FSRS。

#### Lightweight Study Protocol

这是轻量 Learning Policy 可选择的初始连接方式：

```text
Learning Target
→ resolve/generate compact Learning Materialization
→ execute protocol-defined Steps
→ Study Completion
→ Scheduling Handoff(basis = protocol_completion,
                       evidenceLevel = non_evidentiary)
→ FSRS review planning
```

Study Completion 只证明规定的 Steps 已完成。它不解决 Acquisition Gates，不生成 5D，不证明
independent Recall/Transfer，也不允许产品声称“已经掌握”。一次简单主动回忆可以保存 Attempt 或
protocol-local observation；只有明确的 Evidence Rule 才能把合法行为派生为 Learning Evidence。

首版 Lightweight Study 固定为两个 Step，而不是三张传统单词卡：

```text
Experience Recall（practice，隐藏 target expression）
        ↓ learner 主动请求 reveal
Expression Reveal（instruction，显示 expression + Sense binding）
        ├─ again → Experience Recall
        ├─ hard  → Study Completion
        └─ good  → Study Completion
```

Experience Recall 同时承担 grounding 与内部回想：必要呈现是经验速写与 Sense 线索，可选辅助资源
只能进入声明过的 Presentation Slot，并且在 Reveal 前不得以任何形式泄露 target expression。
Expression Reveal 必须覆盖目标形式、可感知声音、确切 Sense、经验连接与同场景表达；
音标、使用框架、补充例句与词源按适用性和真实资源提供。协议和 renderer
都不得假定 Expression 必然是单词。rating 是 Reveal 上的交互，不是第三个 Step；完成页是 Run
结果，也不是 Card 或 Step。

Card Presentation Slot 是版本化 delivery contract，不是 Content Demand 或资源 identity。Content
Demand 声明教学上需要什么 material role，Step 声明何时使用它，Assembly Policy 才把已验证的 role
放入允许的 Slot；生成模型不得直接指定布局或在运行时临场决定 UI。

#### Structured Acquisition Protocol

Recognition、Recall、Novel Transfer、conditional Boundary、interference、Gate、5D 与 repair 共同
构成高保证初始协议。它适合需要独立行为验证和更强学习声明的目标，但不再是每个新 Sense 的
强制路径。

```text
Learning Target
→ executable capability inventory
→ interference-spaced Acquisition Cycle
→ all required Gates resolved
→ Acquisition Graduation
→ Scheduling Handoff(basis = acquisition_graduation,
                       evidenceLevel = behavioral)
→ FSRS
```

只有该 Protocol 可以使用其 Gate/5D/Graduation 术语。其他 Protocol 不得伪造空 Gate、默认 pass 或
虚构 Graduation 来复用同一状态机。

### 9.2 Retention Review Protocol

Retention Review 只处理已经拥有 FSRS Memory State 且当前 due 的 target。一个 Review Protocol Run
可以使用一个或多个 Steps，也可以由简单 learner rating 或独立 grader 产生结果，但一次 due Review
最多形成一个 Memory Outcome，并最多推进一次 FSRS revision。

```text
FSRS due
→ Review Protocol Run
→ protocol-defined prompt / response / reveal
→ one Memory Outcome(grade + basis)
→ one FSRS update
```

`learner_rated` 是合法 scheduler input，但 evidence level 必须是 `self_report`；它不能冒充独立行为
Evidence。Review 中的 reveal、detail、repair 或当场重测不能为同一个 due identity 再产生第二个
Memory Outcome。

Memory Outcome 使用 scheduler-stable grade `again | hard | good | easy`，并把 grade 与 basis、evidence
level 分开保存。某个 Protocol 可以只产生其中一部分 grade，例如二元行为评测把独立成功映射为
`good`、失败映射为 `again`；但只要它区分“模糊/费力”，就必须保留为 `hard`，不能先压成 Boolean
再由 scheduler 猜测。learner-facing 的“认识/模糊/忘记了”只是输入文案，由版本化 evaluator 映射。

### 9.3 Relearning Protocol

Review 暴露遗忘或修复需要后，系统可以在原 Memory Outcome 已结算的前提下打开 Relearning
Protocol Run。Relearning 负责恢复连接，不负责重新评价那次 Review：

```text
failed / weak Memory Outcome
→ FSRS updated once for that Review Outcome
→ Relearning Protocol Run
→ optional scheduler-eligible relearning evaluation
→ separate Memory Outcome → FSRS updated once for that Outcome
→ Relearning Completion
→ retaining
╳ no FSRS reinitialization
╳ no rewrite or second Outcome for the triggering due Review
```

Lightweight Rebinding 可以复用紧凑内容、reveal、例句和简单重测；Structured Relearning 可以打开
Relearning Cycle，只处理已暴露的 Gate/capability 缺口。两者都保留此前 Evidence、Review Outcome
和 FSRS history，不能通过当场答对覆盖一次真实遗忘。

Relearning 的 scheduler 权限由 Protocol Version 显式声明。一个轻量协议可以只生成 Relearning
Completion，不提供新调度输入；一个类 Anki/FSRS 协议也可将一个或多个不泄露答案的独立
relearning evaluations 映射为各自的 Memory Outcome。每个 Outcome 必须固定 origin=`relearning`、
Protocol Step/evaluation identity、basis 与 scheduler policy version，并且只能应用一次。Relearning
Completion 本身不自动产生 Outcome，也不改变已经落账的 Review Outcome。

### 9.4 两个代表性 Profile 如何组合这些原语

| 合同轴 | `lightweight` | `high_assurance` |
| --- | --- | --- |
| Initial Protocol | compact instruction + optional retrieval/practice | Structured Acquisition |
| Checkpoint | 可以没有评价性 Checkpoint | required Acquisition Gates |
| Acquisition evaluation | learner rating 或 non-evidentiary observation | independent behavioral assessment |
| Failure progression | 当前 recall/practice 重试 | 当前 Gate 失效、定向 repair、干扰后独立重测 |
| Completion | required learning acts → Study Completion | all required Gates → Acquisition Graduation |
| Handoff | `protocol_completion + non_evidentiary/self_report` | `acquisition_graduation + behavioral` |
| Retention evaluation | learner-rated graded Memory Outcome | evidence-oriented graded Memory Outcome |
| Relearning | lightweight re-binding/repair | targeted or Structured Relearning |
| Scheduling | 可使用固定阶梯等轻量策略 | 可使用 FSRS 等记忆调度策略 |

两者共享 Attempt、Observation、Evidence、Transition、Completion、Handoff 与 Memory Outcome 内核；
差异来自 Profile 组合的 Protocol 与 Policy。Lightweight 不为复用内核而伪造 Gate，High Assurance
当前采用“只重开失败 Gate”的 Progression Policy，但这不是所有 Protocol 的内核不变量。

## 10. Initial Learning Completion、Outcome 与 Evidence

Initial Learning Completion 是 Initial Learning Protocol 成功结束的上位语义：Lightweight Study
产生 Study Completion，Structured Acquisition 产生 Acquisition Graduation，合法迁移可以产生
Imported Completion。它授权但不等于 Scheduling Handoff，也不自动成为 Learning Evidence。
这里的“不是同一事实”不表示 handoff 可省略：成功 completion 后必须在同一权威事务边界创建它。

Protocol Outcome 说明一次方法运行发生了什么；Learning Evidence 说明独立行为支持了什么判断；
两者不等价。

| Outcome / basis | 可以声称 | 不能声称 |
| --- | --- | --- |
| `study_completed` | 已完成首次学习、已安排复习 | 已独立回忆、已迁移、已掌握 |
| `learner_ready` | learner 选择进入保持 | 已有客观行为证据 |
| `independently_verified` | 已满足当前 Protocol 的独立要求 | 永久掌握 |
| `learner_rated` | learner 对本次记忆表现作出判断 | 客观行为验证 |
| `relearning_completed` | 已完成本次连接修复 | 原 Review 已变为成功，或 completion 本身就是 FSRS 更新 |
| `declared_known` | learner 声明已会 | 系统验证通过 |
| `imported` | 已导入指定来源状态 | 来源之外的证据强度 |

展示、播放、停留、继续按钮、自报理解与 Study Completion 仍不是 Learning Evidence。它们可以在
Protocol 明确允许时成为 completion 或 scheduling basis，但必须保留真实保证级别，不能污染 Gate、
5D 或 independently verified cohort。

## 11. Scheduling Handoff 与 FSRS

FSRS 是 retention scheduler，不是学习方法或掌握证明。每个 Retention Target 默认最多拥有一份
FSRS Memory State。它只通过 Initial Learning Completion 对应的合法 Scheduling Handoff 初始化；
之后可由 due Review 的 Memory Outcome，以及协议显式允许的独立 Relearning Memory Outcome 更新。
Relearning Completion 既不重新初始化，也不为同一 due Review 产生第二个 Outcome；合法重学结果是具有
自己 identity 和幂等边界的后续 scheduler event。

Scheduling Handoff 至少固定：

- target/protocol/materialization identity；
- Initial Learning Completion 与 Protocol Outcome；
- initialization basis；
- evidence level 与可选 Evidence references；
- scheduler policy/initializer version；
- learner-visible claim boundary。

首批 initialization basis 使用闭集 `protocol_completion | acquisition_graduation | learner_rating |
imported`；evidence level 独立使用 `non_evidentiary | self_report | behavioral | externally_attested`。
Structured Acquisition 使用 `acquisition_graduation + behavioral`；Lightweight Study 首版通常使用
`protocol_completion + non_evidentiary`。历史 initialization basis 不被后续 Review 或 Relearning
覆盖。

## 12. LLM 的不同职责

系统必须区分：

1. **Semantic LLM**：从 Personal Meaning 协商 Sense Proposal；
2. **Learning Content LLM**：为 fixed Sense Version、target expression 与 Protocol 生成内容；
3. **Grading LLM（未来可选）**：在显式 grader contract 下评价开放响应。

Semantic LLM 的确认结果不能顺带成为学习内容；Content LLM 不能改写 Sense；Grading LLM 不能读取
隐藏答案后自由改变 rubric。模型、prompt、input、output、validation 和 fallback provenance 分别
保存，不能用一个含义模糊的“AI generated”标记代替。

Personal Anchors 只有在 learner 明确授权后才可作为 on-demand generation input。生成的公共或共享
内容不得泄露姓名、图片、录音、原始叙述或其他 private data。

## 13. `zh-Hans → en` Route 的轻量 Policy 示例

一个可选的轻量组合为：

```text
Language Learning Route (`target=en`, `support=zh-Hans`)
× confirmed English-oriented Sense
× primary English expression
× on-demand LLM Content Provisioning
× Lightweight Initial Learning Protocol
× Retention Review Protocol
× optional Lightweight Relearning
× FSRS Scheduling
```

该轻量 Profile 的 `lightweight-initial-content@v3` 要求经验 cue、目标表达、义项确认、主要声音、
经验绑定说明和同场景语言实现。回想提示、最小使用框架、补充例句和有来源的词源为可选。
word、phrase、construction 与 utterance 共用需求组合，但不会把词性或语法模板假定为所有表达的
必填属性。完整目标话语可同时承担场景语言实现；职责不同不要求 UI 重复同一内容。
声音缺失不能以音标、设备朗读或假音频满足 readiness。新增可选资源不改变学习完成或调度。

其中 target expression 与 confirmed Sense 是权威直通材料，生成模型不得改写；经验 cue、回想支持、
结构说明、用法提示与场景回扣可以由教学内容供给方提出 Candidate；发音/TTS 只能由有来源的发音事实
或版本化外部工具派生，不得由 LLM 伪造。Experience Recall 使用的所有 pre-reveal Candidate 必须通过
不泄露 target expression 的验证。该 Profile 不要求 Gate、5D、protected Transfer pool 或 Structured Acquisition Graduation；
已有 published Package 可以作为内容源或 fallback，但不是 Personal Meaning 加入学习的前置条件。

## 14. 代表性组合

### 公共课程中的高保证学习

一个 Book Sense 使用 reviewed Package 与 Structured Acquisition。所有 required Gates 通过后形成
evidence-backed handoff。这里保留现有完整 Acquisition 模型。

### 不经过 Personal Semantic World 的直接学习

learner 从 Catalog、Book 或 reviewed Contextual Lookup 选择一个 existing stable Sense 及 primary target
binding，直接发起或继承 Curriculum membership。系统保存 direct/book provenance，解析相同的
Learning Target、Policy 与 Retention Target；整个过程不创建 Personal Meaning 或 Personal Anchor。

### learner 新建 Sense 的轻量学习

learner 确认 `tactful` Sense 后，系统为固定 Sense Version、target binding 与 Lightweight Content
Demand 创建 Content Provisioning Task。一个有界 Content Agent Attempt 可以根据经授权场景并调用
获准工具提出 Material Candidate Bundle；它提交后退出，系统独立校验并冻结 Learning
Materialization，才交给 Lightweight Study。完成后产品只显示“已安排复习”，FSRS 从
`protocol_completion + non_evidentiary` basis 开始。

### Hybrid repair

系统复用 published pronunciation 与 Sense boundary，结合 learner 授权的 Personal Anchor 生成新的
解释或例句。生成材料可以用于教学或 repair；没有独立 grader eligibility 时不能产生 Gate pass。

### 简单 Review 后的轻量重学

一个 due target 通过 Retention Review 得到 `learner_rated` 的 forgotten Outcome。系统先完成该 Review
唯一的 FSRS 更新，再运行 Lightweight Rebinding Steps。若该轻量协议未将重测声明为 scheduler-eligible，
当场恢复只产生 Relearning Completion；若未来协议启用类 Anki 行为，独立重测可另行产生
origin=`relearning` 的 Memory Outcome。两者都不覆盖 forgotten Outcome。

## 15. 不变量

- Formal Learning 可以由 Book、direct stable-Sense selection 或 personal-first bridge 独立进入；Personal
  Semantic World 不是前置条件，Learning 也不反向创建 Personal Meaning；
- learner 可以为一个 Learning Target 在当前 Language Learning Route 中建立 revisioned Personal Learning
  Scene。它是 optional scaffold，不替换 Package required resources，不改变 Learning Target、Protocol、
  Evidence 或 Retention；当前尚未操作的 Step 可以读取最新版，Action 必须固定实际呈现的 revision；
- 从已解析的 Package target 把当前 Personal Learning Scene 存入 Personal Semantic World 是独立的
  direct Semantic Acceptance：复用 Package 固定的 Sense Version 与 target Binding，不经过 Sense
  Construction，也不产生新的 Learning Target。后续 scene revision 只有再次明确提交才更新该 Personal
  Meaning；
- 所有入口都必须固定 stable Sense/Version 与 target binding；裸词、未对齐 Reference Sense 或 Personal
  Meaning 本身不能成为 Learning Target；
- personal-first bridge 可以来自 direct 或 delegated Semantic Acceptance，但只接受已经闭合的
  Context–Expression–Sense Personal Meaning；Meaning Focus 不是 bridge 或 target identity；
- Personal Semantic World commit 与 Add-to-Learning 是不同意图和权限，即使一个获授权 Agent 在一次
  用户请求中连续执行二者，也必须留下两个独立、幂等、可审计事实；
- Learning Entry Provenance 只记录来源，不改变 Learning/Retention Target identity；同一连接跨来源去重；
- Language Learning Route 固定 Target Language、可与其相同的 default Support Language 与 route-scoped
  Study Plan；Learner 可拥有多条 Route，但不由此产生全局母语或 known-language/proficiency 事实；
- Curriculum Membership、Study Scope Revision 与 Resolved Learning Plan 固定适用 Route revision；
  target binding 必须与 Route 兼容，而 Support Language 与 Interface Locale 不进入 Retention identity；
- Session、Sense Construction 与 Content Provisioning Task 固定 Pinned Language Context；Input/Output
  Language 由操作意图决定，Active Route Selection 的后续变化不得重绑进行中的操作；
- 同一 Retention Target 跨兼容 Route 仍共享一份正式进度、Evidence 与 FSRS State；只改变 Support
  Language 不创建新的记忆身份；
- Personal Content lifecycle 不删除或重写 Curriculum Membership、Protocol history、Evidence 或 FSRS；
- Entry Provenance 与 Learning Policy 正交；来源可以影响推荐/readiness，但不得静默决定或降级 Policy；
- Learning Policy Profile 是显式、版本化、可审计的 Protocol/Policy 命名组合，不是普通呈现
  Preference、进度聚合或每日数量 owner；
- 一个 Profile 协调三个 purpose 的 Protocol 选择，但每个 Protocol Run 仍只能固定一个 purpose；
- Effective Learning Policy 的 scope、precedence、profile version 与 decision provenance 必须可重放；
- 第一次正式 Protocol Run 创建时必须冻结 Committed Learning Policy；普通 Assignment、默认方式、
  新来源或新内容此后不得改变该 target 的学习方式；
- Resolved Learning Plan 只解析 Protocol/provisioning/readiness，不预写 Encounter、Card 或未来 due 日历；
- Add-to-Learning 接纳可以先于内容物化；`preparing/blocked` Membership 保留 learner intent，但只有
  `ready` plan 可以进入正式 Runtime；
- 高保证 Profile 缺少资源时不得静默降级；未提交 Runtime 的 target 通过显式 policy-change revision
  切换，已提交 Runtime 的 target 只能通过未来显式 Learning Policy Migration 切换；两者都不改变
  Target、不重置 FSRS、不改写 active/historical Protocol facts；
- Content Provisioning、Learning Protocol、Evidence Policy 与 Scheduling Policy 保持正交；
- pre-generated 不等于人工，LLM-generated 也不等于 runtime/on-demand；
- Content Provisioning Task 必须固定单一 Learning Target、purpose Protocol 与 exact Content Demand；
  裸 Expression 不是任务边界，Agent context 不得跨 Task 混合；
- Content Agent Attempt 只能调用任务获准的 typed/versioned tools；所有可持久采用的 tool result 必须
  成为有 provenance 的 Content Context Artifact、Content Derivation 或 Material Candidate；
- Agent 的权限止于提交未受信的 Material Candidate Bundle；它不能批准自身输出、创建 Learning
  Materialization、改变 Plan/Protocol/Card、写 learner progress 或在终止后继续参与；
- Bundle 被拒绝后的修复必须创建新的 Content Agent Attempt；Provisioning Task 拥有生命周期与重试，
  Agent Attempt 不拥有任务状态；
- Provisioning Batch 只聚合独立 Task 的调度与观测，不共享 target context 或失败事务，也不拥有
  learner 的 daily-new quota；
- 所有学习内容在使用前固定 target、protocol、provenance、validation 与 immutable materialization；
- 每个 Protocol 固定 `initial_learning | retention_review | relearning` purpose；
- 成功的 Initial Learning 必须产生 Initial Learning Completion 与 Scheduling Handoff；
- Protocol Step 拥有组织和 transition 语义，Card Presentation 只负责瞬时呈现；
- Learning Capability Objective、Protocol Checkpoint、Step/Action 与 Card 保持不同 identity；
  Checkpoint 是可选的 Protocol-local 里程碑，Acquisition Gate 只是其中一个高保证子类；
- 正式评价必须沿 `Attempt → Observation → Evidence（若合格）→ Transition Decision` 推进；
  correctness、learner rating 或 UI 事件不能绕过 evaluator 直接写进度或调度；
- failure/reset 由版本化 Progression Policy 产生受约束 effect，并由内核原子应用；Reset 只使显式
  scope 内当前 credit 失效，不删除 Attempt、Observation、Evidence 或历史 Transition；
- Initial Learning Completion 只由版本化 Completion Policy 推导，不能由最后一张 Card、当前队列为空
  或某个 renderer 状态推导；
- Cards/Decks 不成为学习、课程、同步或调度 identity；
- Retention Target 按 learner × Sense × target expression 隔离；能力维度默认只分开记录，
  不分开调度；
- Content LLM 不能创建或改变 Sense identity；
- learner 提交后不能重新生成题目、答案或 rubric 来改变结果；
- Study Completion、learner rating 与 Learning Evidence 保持不同 identity；
- Lightweight Study 不创建 Gate、5D 或 Acquisition Graduation；
- Structured Acquisition 是高保证 Protocol，不是所有 Sense 的唯一入口；
- FSRS 只负责调度，并保留 Scheduling Handoff basis/evidence level；
- 一次 due Review 最多产生一个带规范 `again | hard | good | easy` grade 的 Memory Outcome 并推进
  一次 FSRS revision；grade、basis 与 evidence level 必须分离，不能先压成 Boolean 再猜测；
- Memory State 与 next due 只能由 scheduler 根据有效 Handoff/Memory Outcome 更新；Protocol、preset、
  Card renderer、界面与同步适配器不能直接写入；
- Relearning Completion 不重评原 Review、不重新初始化 FSRS，也不自动构成 scheduler input；
- 只有 Protocol Version 显式声明的独立 Relearning evaluation 才能产生新 Memory Outcome，
  且不得改写或重复应用触发它的 Review Outcome；
- generated content 不能泄露未授权 Personal Anchors；
- 所有 Progression、Completion、Handoff、Memory Outcome 与 Scheduling transition 必须原子且幂等；
- 没有合法 Materialization 或 Protocol capability 时返回 unavailable，不伪造内容或进度。
