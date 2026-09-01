# Sensa 学习连接模型

> 状态：Canonical domain model
> 更新日期：2026-08-31

本文定义一个 confirmed Sense 与目标语言表达的连接如何取得内容、选择学习方式、形成不同强度的
结果并交给长期调度。个人意义与 Sense 确认由
[`personal-semantic-world-model.md`](personal-semantic-world-model.md) 裁决；Structured Acquisition
的理论细节由 [`semantic-acquisition-model.md`](semantic-acquisition-model.md) 裁决；资源和运行行为
分别由 [`sense-learning-resource-model.md`](sense-learning-resource-model.md) 与
[`learning-runtime-model.md`](learning-runtime-model.md) 裁决。

## 1. 领域定位

正式学习不创造 Personal Meaning，也不决定公共 Sense。它在 stable Sense、目标语言表达和 learner
意图已经确定后，选择一种方法建立或恢复 meaning–form connection。学习是个人语义世界可以调用的
一种服务，不是 Personal Meaning 存在的前提或唯一去向。

```text
Personal Meaning
      ↓ confirmed Personal Meaning Alignment
Stable Sense + target Sense Expression Binding
      ↓ Add-to-Learning / Book membership
Learning Target
      ↓
Retention Target
      ↓
Content Provisioning × Learning Protocol
      ↓
Learning Materialization + Protocol Run
      ↓
Protocol Outcome
      ├── Initial Learning Completion ──▶ Scheduling Handoff ──▶ initialize FSRS
      ├── Memory Outcome ──────────────────────────────────────▶ update FSRS once
      └── Relearning Completion ───────────────────────────────▶ retain existing FSRS
```

Book-first learning 可以直接从已发布 Sense 建立 Learning Target，不自动创建 Personal Meaning；
personal-first learning 则沿 confirmed Alignment 建立同一类目标。两条入口在 Learning Target 处汇合。

## 2. 五个正交问题

领域模型必须分别回答：

1. **学习什么**：固定哪个 Sense Version 和哪个 target expression；
2. **内容从哪里来**：published、on-demand 或 hybrid；
3. **怎样建立连接**：使用哪个 versioned Learning Protocol；
4. **哪个连接独立保持**：Learning Target 解析到哪个稳定 Retention Target；
5. **怎样连接长期调度**：Initial Learning 如何 Handoff、Review 和合法 Relearning
   evaluation 如何产生各自不可变的 Memory Outcome。

Sense Learning Package、Learning Protocol、Learning Evidence 与 FSRS 不能再合并为一个概念。
同一份 published content 可以服务多种 Protocol；同一种 Protocol 也可以由 published 或 on-demand
content 支持。

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
- target language；
- primary target Sense Expression Binding 及所需 form version；
- learner 与 Curriculum provenance。

Learning Protocol 在创建 Protocol Run 时与 target 绑定；它不属于 target identity，因此切换学习方式
不会悄悄创建另一个“要学的连接”。

Personal Meaning 与 Personal Anchors 可以作为来源或 learner-authorized scaffold，但不成为 target
identity。

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

Learner Sense Progress 因此只是一个 Sense 下多个 Retention Targets 的 roll-up。首版每个英语
Sense 只选定一个 primary target binding，因而实际只产生一个 Retention Target；这是交付约束，
不是把 learner × Sense 当成永久 scheduler identity 的理论结论。

## 4. Content Provisioning

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

On-demand content 在固定 Learning Target 与 Protocol 后，根据 learner 当前需要生成。生成可以读取
confirmed Sense、target expression、中文 access path、Protocol requirements、允许的历史与 learner
明确授权的 Personal Anchors，但不得重新解释或改变 Sense boundary。

它适合：

- learner 按需创建的新 Sense；
- 个性化场景、解释、例句与边界对比；
- 低成本 Lightweight Study；
- published content 不足时的受控补充或 repair。

生成成功不等于发布。On-demand output 在进入一次学习前必须完成适用于当前角色的 schema、target、
language、safety、semantic-consistency 与 renderer validation，并冻结为 Learning Materialization。

### Hybrid

Hybrid 可以用 published Sense facts、发音或 protected assessment，组合 on-demand 的个人化场景、
解释和练习。每个 material item 保留自己的 provenance、review status、visibility 与 Evidence
eligibility，不能因同处一个界面而提升资格。

## 5. Learning Materialization

Learning Materialization 是一次 Protocol Run 真正读取的不可变内容快照。无论来源为何，它至少固定：

- Learning Target 与 Sense Version；
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

生成失败、模型不可用或校验不通过时，Runtime 只能选择合法 fallback、改用 published content 或
返回诚实 unavailable。它不能换一个 Sense、放宽 Protocol requirements 或展示未经校验的内容来
伪造成功。

## 6. Learning Protocol

Learning Protocol 是建立、检查、加强或恢复连接的方法合同，而不是页面模板。每个版本必须固定
`purpose = initial_learning | retention_review | relearning`，并至少声明：

- 允许进入的 target/content/runtime readiness；
- required 与 optional material roles；
- Protocol Step definitions 与 transition model；
- 可以物化的 Action/Encounter families；
- completion、failure、repair 与 interruption semantics；
- 哪些行为可以形成 Learning Evidence；
- 可以产生哪些 Protocol Outcomes；
- 与 Scheduling Handoff、Memory Outcome 和 FSRS 的合法关系；
- 与客户端、grader、offline 和 model capability 的兼容要求。

Protocol 选择不会改变 Sense，也不会把一种方法的完成结果冒充另一种方法的证据。三个 purpose 的
scheduler 权限不同：成功的 initial learning 必须 Handoff；retention review 只对当次 due Review
产生最多一个 Memory Outcome；relearning 不重新初始化也不重复评价原 Review，但版本化协议可以
把指定的独立重学评价声明为 scheduler-eligible。

## 7. Protocol Step 与 Card Presentation

Protocol Step 是 Protocol 的最小可恢复执行单位，不是固定页面。一个 Step definition 至少声明：

- step purpose 与 required material roles；
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

## 8. 三种 Protocol Purpose

### 8.1 Initial Learning Protocol

Initial Learning 负责在 `acquiring` 阶段首次正式建立 meaning–form connection。成功结束必须产生一种
protocol-specific Initial Learning Completion，并在同一权威事务边界创建 Scheduling Handoff；中断、
失败或 materialization unavailable 不得初始化 FSRS。

#### Lightweight Study Protocol

这是首版默认的初始连接方式：

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

### 8.2 Retention Review Protocol

Retention Review 只处理已经拥有 FSRS Memory State 且当前 due 的 target。一个 Review Protocol Run
可以使用一个或多个 Steps，也可以由简单 learner rating 或独立 grader 产生结果，但一次 due Review
最多形成一个 Memory Outcome，并最多推进一次 FSRS revision。

```text
FSRS due
→ Review Protocol Run
→ protocol-defined prompt / response / reveal
→ one Memory Outcome
→ one FSRS update
```

`learner_rated` 是合法 scheduler input，但 evidence level 必须是 `self_report`；它不能冒充独立行为
Evidence。Review 中的 reveal、detail、repair 或当场重测不能为同一个 due identity 再产生第二个
Memory Outcome。

### 8.3 Relearning Protocol

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

## 9. Initial Learning Completion、Outcome 与 Evidence

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

## 10. Scheduling Handoff 与 FSRS

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

## 11. LLM 的不同职责

系统必须区分：

1. **Semantic LLM**：从 Personal Meaning 协商 Sense Proposal；
2. **Learning Content LLM**：为 fixed Sense Version、target expression 与 Protocol 生成内容；
3. **Grading LLM（未来可选）**：在显式 grader contract 下评价开放响应。

Semantic LLM 的确认结果不能顺带成为学习内容；Content LLM 不能改写 Sense；Grading LLM 不能读取
隐藏答案后自由改变 rubric。模型、prompt、input、output、validation 和 fallback provenance 分别
保存，不能用一个含义模糊的“AI generated”标记代替。

Personal Anchors 只有在 learner 明确授权后才可作为 on-demand generation input。生成的公共或共享
内容不得泄露姓名、图片、录音、原始叙述或其他 private data。

## 12. 中文 L1、英语 L2 的首版协议

首版默认组合为：

```text
confirmed English-oriented Sense
× primary English expression
× on-demand LLM Content Provisioning
× Lightweight Initial Learning Protocol
× Retention Review Protocol
× optional Lightweight Relearning
× FSRS Scheduling
```

首版 Learning Materialization 至少提供：

- 中文可理解的 Meaning Focus；
- 一个具体经验或场景；
- primary English expression 与可用发音；
- 少量自然、绑定同一 Sense 的例句；
- 必要时一个重要相邻意义区别；
- 一个简单主动回忆提示或等价的轻量连接动作。

具体 Step 数量、顺序、Card Presentation 和 rating 操作由后续 delivery/runtime contract 确定。首版不要求 Gate、5D、
protected Transfer pool 或 Structured Acquisition Graduation；已有 published Package 可以作为内容源
或 fallback，但不是 Personal Meaning 加入学习的前置条件。

## 13. 代表性组合

### 公共课程中的高保证学习

一个 Book Sense 使用 reviewed Package 与 Structured Acquisition。所有 required Gates 通过后形成
evidence-backed handoff。这里保留现有完整 Acquisition 模型。

### learner 新建 Sense 的首版学习

learner 确认 `tactful` Sense 后，LLM 根据固定 Sense Version 生成中文场景、英语表达、例句、边界与
简单 recall 内容，冻结后交给 Lightweight Study。完成后产品只显示“已安排复习”，FSRS 从
`protocol_completion + non_evidentiary` basis 开始。

### Hybrid repair

系统复用 published pronunciation 与 Sense boundary，结合 learner 授权的 Personal Anchor 生成新的
解释或例句。生成材料可以用于教学或 repair；没有独立 grader eligibility 时不能产生 Gate pass。

### 简单 Review 后的轻量重学

一个 due target 通过 Retention Review 得到 `learner_rated` 的 forgotten Outcome。系统先完成该 Review
唯一的 FSRS 更新，再运行 Lightweight Rebinding Steps。若首版协议未将重测声明为 scheduler-eligible，
当场恢复只产生 Relearning Completion；若未来协议启用类 Anki 行为，独立重测可另行产生
origin=`relearning` 的 Memory Outcome。两者都不覆盖 forgotten Outcome。

## 14. 不变量

- Content Provisioning、Learning Protocol、Evidence Policy 与 Scheduling Policy 保持正交；
- pre-generated 不等于人工，LLM-generated 也不等于 runtime/on-demand；
- 所有学习内容在使用前固定 target、protocol、provenance、validation 与 immutable materialization；
- 每个 Protocol 固定 `initial_learning | retention_review | relearning` purpose；
- 成功的 Initial Learning 必须产生 Initial Learning Completion 与 Scheduling Handoff；
- Protocol Step 拥有组织和 transition 语义，Card Presentation 只负责瞬时呈现；
- Cards/Decks 不成为学习、课程、同步或调度 identity；
- Retention Target 按 learner × Sense × target expression 隔离；能力维度默认只分开记录，
  不分开调度；
- Content LLM 不能创建或改变 Sense identity；
- learner 提交后不能重新生成题目、答案或 rubric 来改变结果；
- Study Completion、learner rating 与 Learning Evidence 保持不同 identity；
- Lightweight Study 不创建 Gate、5D 或 Acquisition Graduation；
- Structured Acquisition 是高保证 Protocol，不是所有 Sense 的唯一入口；
- FSRS 只负责调度，并保留 Scheduling Handoff basis/evidence level；
- 一次 due Review 最多产生一个 Memory Outcome 并推进一次 FSRS revision；
- Relearning Completion 不重评原 Review、不重新初始化 FSRS，也不自动构成 scheduler input；
- 只有 Protocol Version 显式声明的独立 Relearning evaluation 才能产生新 Memory Outcome，
  且不得改写或重复应用触发它的 Review Outcome；
- generated content 不能泄露未授权 Personal Anchors；
- 没有合法 Materialization 或 Protocol capability 时返回 unavailable，不伪造内容或进度。
