# Sensa Learning Runtime Model

> 状态：Canonical runtime domain model  
> 更新日期：2026-08-28

本文定义 Unified Planning、Acquisition Cycle、Session、Encounter、Evidence、Graduation、
Relearning、FSRS、Lexical Reference、Preferences 与 Account/Data Control 的运行关系。具体 Gate 阈值、
Action/Practice Task payload、context resolver 阈值、cooldown、HTTP、SQL 和 Sync wire format 属于
后续版本化实现合同。

## 1. 运行链

```text
Book Enrollment + Supplemental Curriculum
                         │
Study Plan ──▶ Study Scope Revision + Learner Sense Progress
                         │
Session intent ──────────┤
                         ▼
                  Unified Planning
          ┌──────────────┼───────────────┐
          ▼              ▼               ▼
  new introduction  Acquisition ready  Review/Relearning ready
          └──────────────┼───────────────┘
                         ▼
                  Sense Encounter
                         │
                         ├── Learning Action
                         │      └── Learning Attempt
                         │             └── Learning Evidence
                         │                    ├── Gate projection
                         │                    └── 5D projection
                         └── Encounter Outcome
                                ├── Acquisition Step Outcome
                                │      ├── initial Graduation ──▶ initialize FSRS
                                │      └── Relearning Completion
                                └── Memory Outcome
                                       ├── update FSRS once
                                       └── failure opens Relearning Cycle
```

Planning 决定此刻处理哪个 Sense 与哪类工作；Semantic Policy 决定该 Encounter 最小需要做什么；
Acquisition Policy 决定 Gate、repair、initial Graduation 与 Relearning Completion；FSRS 只在
initial Graduation 后决定长期 due time。

Free Practice 使用平行但隔离的运行链：

```text
Practice Scope + Practice Mode
              │
              ▼
     Free Practice Session
              │
              ▼
        Practice Task
              │
              ├── passive interaction ──▶ Practice Activity
              └── response ──▶ Practice Attempt ──▶ Practice Result
                                                     ╳ Learning Evidence
                                                     ╳ Encounter Outcome
                                                     ╳ Gate / 5D / FSRS
```

## 2. Learner Sense Progress

Learner Sense Progress 是 learner × Sense 的权威运行聚合，至少表达：

```text
phase: new | acquiring | retaining | relearning
activeAcquisitionCycle: optional
gateProgress
5DState
declaredMastery
fsrsMemoryState: optional
```

这些状态职责不同：

- `phase` 决定该 Sense 属于哪类 Planning inventory；
- Gate progress 决定当前 Acquisition Cycle 是否满足毕业条件；
- 5D State 是跨 Cycle、跨 Session 的诊断投影；
- Declared Mastery 是独立、可撤销的 learner 声明；
- FSRS Memory State 仅在 `retaining | relearning` 阶段存在。

客户端可以保存乐观预览，但不能直接声明这些权威投影。

## 3. Acquisition Cycle

Acquisition Cycle 是一次 short-term acquisition aggregate，可由首次学习或长期遗忘触发：

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

### Baseline Gate families

- **Contextual Recognition**：在熟悉或基础语境中从 Form 识别目标 Sense；
- **Meaning-to-form Recall**：从 Sense cue 主动取回目标 Lexeme；
- **Novel-context Transfer**：在未作为教学材料使用的语境中识别同一 Sense；
- **Boundary**：仅当 Profile 声明真实、required confusion target 时存在；
- **Sound recognition**：只有产品/Profile 将听觉输入列为 required 时才成为独立 Gate。

Gate progress 为 `unresolved | passed | failed`。Gate 只能由不泄露答案、经过所需干扰的有效
Attempt 解决。Initial Cycle 的 Recognition、Recall 与 Transfer 各自需要独立 Attempt，不能
合并；条件性 Boundary 可以与其中一个兼容 assessment 共解，并保存独立 basis。

### Failure and repair

- Gate failure 保存负面 Evidence 并把该 Gate 标记为 failed；
- 无关 Gate 的历史 pass 不机械归零；
- Policy 选择针对性 repair，连续失败可以升级为完整 re-binding；
- repair/reveal 后的即时检查可以确认理解，但不能把 failed Gate 改为 passed；
- 重新解决 Gate 必须在后续独立 Encounter 中进行，并满足版本化 interference rule。

所有 required Gates 变为 passed 时完成 Cycle。`initial` Cycle 产生 Acquisition Graduation，将
phase 改为 `retaining` 并通过 FsrsAdapter 初始化 Memory State；`relearning` Cycle 产生
Relearning Completion，将 phase 返回 `retaining`，保留失败 Review 已推进的 FSRS State。两者
都不删除 Cycle、Attempt 或失败历史。

## 4. Curriculum lifecycle、Study Scope 与每日额度

Study Plan 是 learner 的正式学习安排，而不是 Book 的别名。它组合：

```text
one active Book Enrollment
zero or more maintenance/paused Book Enrollments
one learner-owned Supplemental Curriculum
daily new-Sense limit
current Study Scope Revision
```

### Book Enrollment 与换词书

Book Enrollment 固定一个不可变 Book Version、一个已解析 Book Range 与 mode：

- `active`：允许从当前 Range 引入新 Sense，并继续该 Enrollment 已开始的 Acquisition、
  Relearning 与 due Review；
- `maintenance`：不再引入新 Sense，但继续已经开始的 Acquisition/Relearning 与 due Review；
- `paused`：该 Enrollment 暂时不向任何正式 Planning inventory 提供候选，但不删除事实。

同一 learner 最多有一个 `active` Book Enrollment。换词书默认将旧 Enrollment 转为
`maintenance`，并激活目标 Book Version 的 Enrollment；learner 可以再显式暂停旧 Enrollment。
切换、暂停和恢复都不删除 Learner Sense Progress、Cycle、Evidence 或 FSRS State，也不把
Acquisition 冒充完成。切回旧词书时依据保留的 learner × Sense 状态继续。

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

Supplemental Curriculum 是 learner-owned、ordered、Sense-only 的正式课程来源。Membership 指向
stable Sense，不是 Saved record、Personal Collection membership 或 Book membership。每个 Study
Scope Revision 将可用 Membership 解析到一个已发布且可执行的 Sense Learning Package；Session/
Encounter 再固定该版本，内容更新不能在进行中静默替换资源。

Add-to-Learning Intent 的接纳结果至少区分：

- `accepted`：创建一个 Supplemental Membership；
- `already_in_scope`：目标已由 active/maintenance Enrollment 或现有 Membership 覆盖，不重复加入；
- `content_unavailable`：没有可执行 published Package，不创建幽灵 Membership；
- `declared_mastery_conflict`：存在 active Declared Mastery，必须由 learner 独立撤销后再接纳。

接纳按 `target/package validation → Declared Mastery conflict → existing scope → create membership`
求值；因此一个已在 Book 中但同时被声明“已会”的 Sense 仍先返回 conflict，不能用
`already_in_scope` 掩盖恢复学习所需的显式意图。

Saved Sense 可以显式创建 Intent；Saved Example 只能通过其绑定 Sense 发起“学习这个意思”，Example
本身不能成为 Curriculum member。unsave 不移除 Supplemental Membership；移除 Membership 也不
unsave、不删除 Note/Anchor/Collection Membership 或 Learner Sense Progress。若同一 Sense 仍由
其他 active/maintenance source 覆盖，它继续在有效 Study Scope 中；若已无任何有效 source，它从
后续 Session 的正式候选中退出，但保留 phase、Cycle、Evidence 与 FSRS，重新加入时从原状态恢复。

### Study Scope Revision 与每日额度

Study Scope 是 mode-aware、source-aware 的去重 eligibility snapshot：active Enrollment 提供
当前 Range 的新 Sense 与既有工作，maintenance Enrollment 只提供已经开始或进入长期保持的 Sense，
paused Enrollment 不提供候选，active Supplemental Membership 提供对应 Sense。每个成员同时保留
source provenance 与已解析 Package reference，但同一 Sense 无论来自多少 Book、Range 或
Supplemental Membership，都只有一个 Learner Sense Progress、一个 active Cycle 和一个 FSRS State。
换词书、调整 Range、切换 Enrollment mode、接纳或移除 Supplemental Membership 都产生新的不可变
Study Scope Revision。

Learning Session 固定开始时的 Study Scope Revision。Curriculum 变更从后续 Session 生效，不能
静默改变正在进行的 Encounter 或队列；如果产品允许在 active Session 中修改 Plan，必须先明确
结束/中断该 Session，而不是把它重绑定到新 Scope。

Daily-new quota 是每日新 Sense Introduction 的上限，不是 learner 必须完成的债务，只在 Introduction
被权威接受时消耗：

- ready Acquisition、Relearning 与 due Review 不消耗 daily-new quota；
- Book 与 Supplemental 的新 Sense 共用同一额度，不能制造隐藏的额外任务；
- 退出 Session 不撤销已经发生的 Introduction，未用额度不滚存为次日欠账；
- 同一 Lexeme 的 sibling Sense 是否错开由版本化 Curriculum/Planning policy 决定；
- Plan 不保存手工累计的“已学数量”或维度待办，所有事实摘要来自权威投影。

Book/Range completion 同样是事实投影：`新内容已学完` 表示没有 NewEligible member，`首次学习已完成`
表示范围成员都已 Graduation 或存在 active Declared Mastery。长期 Retention 没有永久“全部完成”。
Curriculum 只提供这些事实摘要，不据此生成维度处方、欠账或 learner-facing Learning Insight。

## 5. Learning Session 与 Session intent

Learning Session 是一次有开始和结束边界的用户活动容器。它固定 intent 与 Study Scope Revision：

### `mixed`

主要的“开始今天的学习”模式，可选择：

- due Retention Review；
- Review-originated Relearning；
- ready initial Acquisition；
- daily quota 允许的新 Sense Introduction。

### `review_only`

次要的“只复习”模式，只可选择：

- due Retention Review；
- 由长期 Review 失败产生、当前 ready 的 Relearning。

它不得引入新 Sense、推进 initial Acquisition、移动任何 Curriculum source 的 new eligibility 或消耗
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
- 不创建 Learning/Practice Attempt、Evidence、Encounter Outcome、Gate/5D/FSRS update；
- 不自动保存、不自动创建 Note，也不自动提交 Add-to-Learning Intent；
- 只读取 `reference_visible` 内容，永不返回 `learning_only` 或 `assessment_only` asset；
- 不提供“真题”或考试来源聚合区块，也不为空区块生成占位数据。

active assessment 在 learner 提交 primary response 并进入 feedback/reveal 之前，产品内部不得从题面
token、更多菜单或快捷键打开 Reference Lookup；否则它会构成答案泄露。Introduction/reveal、普通
内容浏览与已完成 feedback 可以提供点词，但仍只形成 Product Event 或 read telemetry。系统不试图
阻止 learner 使用外部词典，只保证自身 Action contract 不提供泄露路径。

Reference-only meaning 只有在 reviewed Sense Alignment 指向 stable Sensa Sense 时才显示“学习这个
意思”的候选；最终仍交给 Curriculum Add-to-Learning decision。没有对齐或没有 executable published
Package 时返回 `content_unavailable`，不即时生成 Package。当前 Personal Content 只接受 Sensa Sense
与 exact Example；本模型不因一次 Reference Lookup 自动新增 Saved Reference Entry。

Reference Release 与 occurrence annotations 是可下载的不可变内容，不通过 learner outbox 修改。
离线客户端使用已安装的 pinned release/index；未安装的 entry 返回诚实 unavailable state。查询历史
若将来需要跨设备保存，必须另建显式 learner-owned contract，不能混入 Evidence 或 Progress sync。

## 7. Personal Content lifecycle

Personal Content 保存 learner 主动创建的事实，不从浏览、学习结果或统计自动推断：

- Saved Sense 在 learner × stable Sense 上唯一、可逆，并保存创建时 Sense Version provenance；
- Saved Example 在 learner × exact immutable Example 上唯一、可逆，不能随 release 更新换成另一条；
- 每个 learner × Sense 最多有一份 current Sense Note；更新与删除使用 revision，离线冲突不能
  静默覆盖另一设备已经提交的正文；
- 每个 Personal Semantic Anchor 有独立 identity 与 revision；同一 Sense 可以有多个 Anchor，
  learner 可分别修改、删除或撤销其 scaffold eligibility；
- Personal Collection 有独立 identity、name、description、ordering 与 revision；Collection
  Membership 是指向 stable Sense 或 exact Example 的 typed、ordered reference，同一 target 在
  同一 Collection 中不能重复；
- Add-to-Learning Intent 指向 stable Sense，并交给 Curriculum 接纳或拒绝；Personal Content 不得
  直接修改 published Book、Supplemental Membership、Study Scope、Learning Phase 或 Planner
  inventory；接纳语义由第 4 节 Curriculum lifecycle 定义。

这些操作保持正交：

- unsave 不删除 Note、Anchor 或 Collection Membership；
- 删除 Note/Anchor 不 unsave；
- 从 Collection 移除或删除 Collection 不 unsave，也不删除 Note/Anchor；
- saving、collection membership、Practice 与 Add-to-Learning 互不隐式触发；
- Declared Mastery、Acquisition/Review Outcome 与 Content Release 更新不自动创建或删除 Personal
  Content；
- 重复的同一 personal-content operation 是幂等重放，不得制造重复 Anchor、Membership 或 Intent。

Sense Note 默认只供 learner 查看。Personal Semantic Anchor 只有在 learner 明确允许、target Sense
一致且当前 contract 接受 personal scaffold 时，才能被 Learning/Practice renderer 引用；引用只算
scaffold exposure，不能成为答案、Learning Evidence、Gate pass 或 assessment resource。

内容更新时，Saved Sense、Note 与 Anchor 继续跟随 stable Sense，并保留创建/编辑时的 version
provenance；Saved Example 与 Example Membership 继续固定 exact Example。旧 Example 因退休、授权
或媒体不可用而无法显示时，系统返回诚实 unavailable state，不能静默替换。

Personal Content 可以成为 Learner Semantic Projection 与 Practice Scope 的输入。它不属于 Learning
Session/Encounter，也不产生 Encounter Outcome。

## 8. Free Practice

Free Practice Session 是 learner 主动选择练习方式与范围后开启的活动容器，不是第三种 Learning
Session intent。它至少固定：

```text
practiceMode: listening | speaking | reading | writing
practiceScopeSnapshot
practiceProfileVersion
status: active | completed | abandoned
```

Session 创建前，Practice Runtime 必须解析：

```text
Free Practice Profile
        × Package Practice Manifest
        × Runtime / Client capability
        ↓
Executable Practice Capability Inventory
```

Profile 固定版本允许的 Task families 与 resource/renderer/grader requirements；Package Practice
Manifest 只声明已审核 practice roles/resources；Inventory 是当前可以诚实执行的交集。它既不读取
learner mastery 来伪造 capability，也不借用 Acquisition Required Asset Manifest 推断四种 Mode
全部可用。Session 固定 profile 与 resolved inventory version，运行中能力变化只能在下个 Session
生效。

Practice Scope 可以来自 Book slice、最近学习、已完成首次习得、Saved Senses、Declared Mastery
或 learner 明确选择的 targets。Scope 在 Session 开始时解析成稳定 snapshot；后续收藏、Book 或
progress 变化不能静默改变正在进行的队列。Declared Mastery 只排除正式 Planning，不阻止 learner
自由练习该 Sense。

Practice Mode 是面向 learner 的四种入口，其基础矩阵为：

| 方向 | 声音通道 | 文字通道 |
| --- | --- | --- |
| Receptive：Form/Context → Sense | listening | reading |
| Productive：Sense/Experience → Form | speaking | writing |

每个 Practice Task 仍须单独固定：

```text
promptChannel
responseChannel
targetCapability
targetIdentity: Sense | Lexeme form | Example
supportLevel: passive | guided | independent
resourceReferences
gradingContractVersion: optional
```

四种 Mode 不能代替这些语义。Dictation 可以是 `spoken form → written form`，shadowing 可以是
`spoken form → spoken form`，read-aloud 可以是 `written form → spoken form`；这些任务训练词形、
声音或 articulation 时，不能仅因 learner 写了或说了就宣称 Sense retrieval。Speaking/Writing
若要检验 Sense-to-form，prompt 必须定位目标 Sense 而不泄露答案；开放语境产出若没有可靠
grader，只能保存 response/activity，不能伪造正确结果。

### Initial Free Practice Profile

Initial Profile 是 P0 之后首个 Free Practice delivery contract，不是当前 Sensa V1 launch
requirement。它只允许：

| Task family | Runtime 行为 |
| --- | --- |
| Immersive Browse | 从明确 Scope 顺序呈现 approved Sense/Example resources，记录浏览、展开和播放 Activity |
| Portable Listening | 连续播放 approved pronunciation/static-example audio；字幕、译文和播放行为由 Preferences 控制 |
| Dictation | 固定 spoken-form prompt、written-form response、Lexeme/context-form target 与 deterministic grader |
| Quick Spelling | 固定不泄露答案的 Sense/Experience cue、written response 与 Lexeme-identity Recall grader |

初始 Scope 仅从当前 Book slice 或 learner 明确选择的 Senses 解析。Saved、Field、Collection 与 history
来源在各自 contract 就绪前不可显示为可用入口。Initial Profile 不物化 Speaking、发音评分、开放式
造句、AI 对话、自动薄弱项处方、novel Transfer/Boundary assessment、影视/电视/YouTube 原声或运行时
生成题目；缺少对应 Task family 时 UI 省略入口，不显示占位状态。

Practice Runtime 只能读取显式拥有 `free_practice` role 且对当前用途可见的资源，永不选择
`assessment_only` 或 protected Transfer inventory。Portable Listening 只产生 Activity；Dictation
只证明声音到 form 的 practice-local 表现；Quick Spelling 即使复用正式 Recall grader，也只能产生
Practice Result，不能解决 Recall Gate。

不需要 response 的浏览、播放、跟随与展开记录 Practice Activity；可判分响应保存 Practice
Attempt，并通过 pinned grading contract 产生 Practice Result。两者都与正式学习严格隔离：

- 不消耗 daily-new quota，不移动 Book introduction cursor；
- 不改变 `new | acquiring | retaining | relearning` phase；
- 不解决或重开 Acquisition Gate，不完成 Relearning；
- 不产生 Learning Evidence、Encounter Outcome 或 Memory Outcome；
- 不完成、提前或清除一次 due Review，也不调用 FSRS；
- 不自动把 Saved Sense 加入 Study Plan；
- 可以进入 Practice history、Learner Semantic Projection 和面向 learner 的练习统计。

如果 Scope 包含尚未正式学习的 Sense，展示只形成可审计 Practice Activity/exposure，不等于
Introduction，也不消耗 quota。Practice Runtime 不得选择 reserved novel-assessment assets；后续
正式 Policy 必须依据资源 exposure role 保持 Transfer 检验的新颖性。

未来只有通过新的、显式版本化的 assessment-grade bridge，某类 Practice Attempt 才可能被正式
Learning Kernel 接纳；既有 Practice Result 永远不能在事后静默升级成 Gate/5D/FSRS 事实。

## 9. Unified Planning

Planner 在 Session intent 允许的 inventory 中选择下一个 Encounter candidate：

```text
ReviewDue
RelearningReady
AcquisitionReady
NewEligible
```

具体优先级、fairness、cooldown 和每天是否保留新学容量属于 Planning Policy，但必须满足：

- 所有 candidate 必须来自 Session-pinned Study Scope Revision；`active` Enrollment 可以提供新与
  既有工作，`maintenance` 只提供已经开始或 retaining/relearning 的工作，`paused` 不提供候选；
- 同一 Sense 的多重 source provenance 必须在入选前去重，不能创建重复 Cycle、Encounter 或 FSRS；
- Book 与 Supplemental 的 NewEligible 共用 daily-new quota；Supplemental item 不能永久饿死 Book，
  Book 也不能把 learner 显式添加的 item 永久推迟，具体穿插由版本化 fairness policy 决定；
- 同一 Sense 的独立 Acquisition assessments 之间存在版本化的其他-Sense干扰或等价间隔；
- unresolved Cycle 不被不断引入的新 Sense 永久饿死；
- due backlog 不被 daily-new quota 隐藏；
- `review_only` 的候选集合严格受限；
- Declared Mastery 全局排除该 Sense；
- Planning 只创建计划事实，不直接写 Gate、Evidence 或 FSRS；
- Free Practice 不从这些 inventory 取候选，也不因完成练习改变 inventory membership。

## 10. Sense Encounter

Sense Encounter 是对一个 learner、一个 Sense、一个 primary purpose 和一组不可变版本的一次
计划接触。它保存 Study Scope Revision、Curriculum source provenance 与固定 Content/Policy versions；
同一 Sense 有多个 source 时只保存实际采用的主 provenance，但不复制 progress。Purpose families 为：

```text
introduction
acquisition_gate
relearning_gate
retention_review
```

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

一个 Acquisition Cycle 跨多个 Encounter；Encounter 不跨多个 Sense。Card 只是客户端 renderer，
不拥有学习身份、状态或调度。

## 11. Action、Attempt 与 Evidence

### Learning Action

Semantic Policy 先从 Encounter purpose、Executable Capability Inventory、Gate/5D/history 产生纯
Policy Decision，Encounter 再稳定选择具体 immutable resources 并物化 Action。Action 保存
选择原因、scaffold、assessment independence 与有序 asset references。

### Learning Attempt

Attempt 是 learner 对当前 Action 的追加事实。重复 identity + 相同 canonical fact 是幂等重放；
相同 identity + 不同内容是 immutable conflict。

Learning Attempt 与 Practice Attempt 是不同事实类型。即使两者保存相同的文字或语音响应，
Practice handler 也不能调用 Learning Evidence rule，Encounter handler 也不能接收 Practice identity。

### Learning Evidence

服务端根据有效 Attempt 与固定 Evidence Rule 派生 Evidence。Evidence 只陈述行为，不等于 Gate、
5D level 或 FSRS rating。被动展示、播放、acknowledgement、停留时长、无效响应、自报理解与
Product Event 不产生学习 Evidence。

同一个 Attempt 可以影响多个维度或 Gate，但每个 `(attempt, target, rule version, basis)` 只能
派生一次。重放不得重复推进任何投影。

## 12. Encounter Outcome

### Acquisition Step Outcome

Acquisition Encounter 完成后产生一个语义结果，例如：

```text
introduced
gate_passed
gate_failed
```

它更新 Learner Sense Progress，不携带 FSRS rating。`introduced` 只将 phase 从 `new` 转为
`acquiring`。最后一个 required Gate 的 `gate_passed` 可以在同一事务中完成 Cycle，并另外产生
`AcquisitionGraduated` 或 `RelearningCompleted` 领域事件；这不是第二个 Encounter Outcome。
任何单次首次 retrieval 都不能提前初始化 FSRS。

### Memory Outcome

Retention Review Encounter 的第一次有效独立 assessment 产生至多一个 Memory Outcome：

```text
independent_retrieval
transfer_confirmed
retrieval_failed
```

Outcome 保存产品语义，再由 FsrsAdapter 映射为版本化 scheduler input。Review 失败后即使 learner
当天完成 repair/relearning，也不能把原失败 Outcome 改写成成功，或为同一次 due Review 重复
调用 FSRS。`认识/模糊/忘记` 一类自评可以作为产品输入或声明，但不能在没有可判定行为的
情况下直接制造成功 Memory Outcome。

## 13. FSRS 与 Relearning

- initial Graduation 通过一个版本化 initializer 创建初始 FSRS Memory State；
- 之后 FSRS 决定 retaining Sense 的 due time；
- Semantic Policy 可以轮换 Recognition、Recall、Transfer、Boundary 或 Sound assessment；
- due Review 的 Memory Outcome 最多推进一次 FSRS revision；
- `retrieval_failed` 在记录一次长期遗忘后开启 Relearning Cycle；
- Relearning 更新 Gate/5D 与语义状态，但不把一次遗忘重复记入或重新初始化 FSRS；
- Relearning 完成后的下次 due 仍由失败 Outcome 已产生的保守 schedule 控制，除非未来版本明确
  定义一次单独且可审计的 relearning-completion scheduler transition。

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
- 同一 learner/Sense 的并发 Encounter、Cycle 与 projection 更新必须使用一致事务边界；
- 版本化重放必须得到同一 Action、Evidence 与 Outcome。

## 15. Declared Mastery

Declared Mastery 是 learner × Sense 的独立、可逆声明：

- active declaration 从全部 Planning inventories 排除该 Sense；
- 同一 Sense 的 nonterminal Encounter 依事务规则 cancel/interrupt；
- active Acquisition/Relearning Cycle 保留事实但暂停计划资格，不被伪造成 graduated；
- declaration/revocation 不插入 Attempt、Evidence、Outcome，不修改 Gate、5D 或 FSRS；
- revocation 后依据未篡改的 phase/Cycle/Memory State 恢复资格；
- declaration 为 active 时 learner 仍可将该 Sense 放入 Practice Scope；Practice Result 不撤销声明。

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
| Learner Preference | pronunciation accent、Example L1 default visibility | 跨设备同步；从下一次适用的资源选择或呈现开始生效 |
| Device Preference | autoplay、theme、reduced-motion override、playback rate/volume | 只在本机生效；系统无障碍设置优先 |
| Study Plan/Curriculum | daily new-Sense limit、Book、Range、Enrollment mode | 通过 Curriculum operation/revision 生效，不经过 Preference |
| Notification Preference（Later） | reminder permission/schedule/time zone | 独立 permission 与 delivery contract，不混入学习证据 |

Learner Preference update 使用 expected revision 并通过 learner-scoped sync 收敛；并发不同值不能静默
last-write-wins，服务端返回 authoritative revision。Device Preference 不进 learner outbox，也不要求
其他设备收敛。

会改变 immutable asset 选择的 Learner Preference，例如 pronunciation accent，只对下一次尚未物化的
Action/Encounter 生效；active Action 保留已经固定的 asset。纯 presentation setting 可以立即改变
当前视图，但不得改变 Action identity、answer contract、Attempt eligibility 或 Evidence。autoplay、
译文默认显示、theme、animation 与 playback behavior 永远不能自行产生 exposure Evidence；译文或
autoplay 还必须服从当前 Action 的 asset role/answer-leak contract，没有授权内容时 Preference 不生效。

### Sync Health 与本机数据

Sync Health 由 connectivity、pending/rejected outbox operations、last successful push/pull、installed
content/media 与 bootstrap requirement 派生。用户可以发起 retry、download、repair 或 Local Data
Clearance，但不能直接写 `synced=true`。

sign-out 或 Local Data Clearance 遇到 pending outbox 时必须先尝试同步；若无法同步，只能保留本机
数据，或由 learner 明确确认丢弃列出的 pending operations。Local Data Clearance 清除安装内容、
media cache 与本地 learner replica 后可重新 bootstrap，但不能创建任何服务端 delete/tombstone。

### Data Export 与 Account Deletion

Data Control Request 是幂等、需要授权的服务端 lifecycle。Data Export 至少区分：

```text
requested ──▶ processing ──▶ completed
                    └──────▶ failed
```

Export 固定 request time 与逻辑数据范围，包含 Account/Learner profile、Learner Preferences、Curriculum、
Progress、Attempt/Evidence/Outcome、Personal Content 与已经交付的 Practice history；派生读取模型可以
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

客户端先把原始学习操作写入本地 outbox，再执行 `push → pull`。服务端验证 learner scope、
Session intent、Study Scope revision、Cycle/Gate revision、版本、内容引用与 Attempt identity，随后
派生权威投影。
网络失败只让操作保持 pending，不能把本地乐观 Gate 或 Graduation 冒充服务端事实。

Sync entity、cursor、canonicalization 与冲突响应由版本化 Sync contract 定义，不属于本领域模型。

Curriculum、Personal Content 与 Free Practice 必须使用各自 learner-scoped operation、identity、
revision、tombstone 与幂等规则；它们不能复用 learning attempt/encounter operation 以绕过正式
验证。Book switch、Range change、Enrollment mode change、Add-to-Learning acceptance 与
Supplemental removal 的并发冲突必须返回 authoritative Study Plan/Scope revision，
不能让两个设备各自维护一份“当前词书”或有效范围。

Note、Anchor 与 Collection 的文本/顺序冲突必须返回 authoritative revision，而不是静默采用
last-write-wins。Learner Semantic Projection 通过 pull/read model 重建，客户端不能直接上传
节点状态、掌握百分比或图布局为权威事实。

Learner Preference 使用独立 versioned operation 与 revision，经 `push → pull` 跨设备收敛；Device
Preference 留在当前 Device Installation。Account lifecycle 与 Data Control Request 不得借 learner
outbox 绕过在线重新授权。服务端 account-deletion barrier 必须优先于任何旧 cursor/bootstrap，确保
deleted Account 的离线 Replica 不能重新建立 LearnerScope 或回放历史 operation。

## 18. 现有实现迁移边界

当前 `runtime-rule-packet-v2.md` 与 `curriculum-runtime-contract.md` 仍描述 pre-redesign vertical
slice：Study Plan 只能固定一个 Book Version，Introduction 后的首次 retrieval 即初始化 FSRS，
Planner 主要使用 `new/due`，Encounter 可以在一次接触内连续 Boundary、retrieval、repair 与
retry。这些合同是现有事实与历史重放输入，不能覆盖本文新 canonical model。

实现新模型必须发布新的 Runtime Rule Packet、Curriculum/Runtime persistence contract 与 Sync
contract version，迁移或丢弃当前 first-user 测试进度，并验证 Acquisition Cycle、Gate、Session
intent、Graduation 与 one-review-one-FSRS-update 不变量。

现有合同同样没有 Book Enrollment/Range mode、Supplemental Curriculum/Membership、Study Scope
Revision、Semantic Field、Saved Sense/Example、Sense Note、Personal Semantic Anchor、Personal
Collection/Membership、完整 Add-to-Learning decision、Free Practice Session/Task/Attempt/Result 或
Learner Semantic Projection，也没有 Reference Release/Reference Sense、Sense Alignment、全句 Lexical
Occurrence annotation、Contextual Sense Resolution 或 Contextual Lookup API 的 production 语义。在对应
新合同完成前，当前 `/me` 中混合 profile、`selectedWorkspaceId` 与单一
`reviewReactionAnimationsEnabled` 的形状只能作为 compatibility bootstrap read model，不能定义最终
Account 或 Preference aggregate；
客户端不得把原型的换词书、局部范围、星标加入学习、笔记、集合、随身听、听写、拼写或语义图
状态当作真实产品事实，也不得把基于 token regex 与静态词表的弹窗称为上下文词典。

现有合同同样没有 Account lifecycle/Session management、typed Learner Preference revision、明确的
Device Preference、Sync Health read model、Local Data Clearance 或 Data Control Request 状态机。真实
Cognito、导出、删除及 deletion barrier 完成前，不能把本地 auth、清空 IndexedDB 或一个 `/me`
response 冒充 production Account/Data Control 能力。
