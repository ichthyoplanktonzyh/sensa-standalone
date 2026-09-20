# Sense Learning Resource Model

> 状态：Canonical resource model  
> 更新日期：2026-09-15

本文定义 Sensa 如何通过 Published、On-demand 或 Hybrid 路径为一个固定 Learning Target 提供学习
资源，以及这些资源如何在一次 Learning Protocol Run 前冻结为 Learning Materialization。它同时
定义 Sense Learning Package、Reference Lexicon、Lexical Enrichment 与 Semantic Field 如何引用已
审核内容。资源不等于卡片：Protocol Step 按 material role 引用不可变内容并定义交互与结果资格，
Card Presentation 只把当前 Step 阶段渲染给 learner。正式 Action 与 Practice Activity Definition 由版本化
Learning Policy Profile、purpose-specific Protocol 与其他适用 Policy/Profile 从不可变资源中物化。

## 1. Learning content sources 与 materialization

内容来源与 Learning Protocol 是两个正交维度：

- **Published Learning Content**：来自不可变 Content Release，通常由 Sense Learning Package 承载，
  适合复用、离线安装、审核和高保证 assessment；
- **On-demand Learning Content**：在 stable Sense、target expression、Effective Learning Policy、
  Pinned Language Context 与 protocol 已固定
  后按需生成，适合个人语义世界中的长尾目标与轻量学习；
- **Hybrid**：复用 published 语义/词形/例句等基础事实，再为本次 target 补充按需生成的教学材料。

Learning Entry Provenance 是第三个正交维度。Book、direct stable-Sense 与 personal-first entry 都可以
使用 Published、On-demand 或 Hybrid；来源本身不决定 Learning Policy。personal-first/长尾目标通常
更适合用 On-demand 内容快速满足 Lightweight requirements，而 Structured/high-assurance 只有在
required assessment、novelty、grader 与 runtime capabilities 均真实可用时才可 ready。这是 readiness
判断，不是把 Personal Semantic World 永久绑定到 Lightweight。

无论来源为何，Runtime 都不能直接消费仍可变化的 draft。开始前必须建立不可变 Learning
Materialization，至少固定 target、Effective Learning Policy/plan revision、protocol/version、内容项与角色、答案/评分合同（如有）、source/
generator/prompt-policy provenance、校验结果与 digest。learner 作答后不得重新生成并替换 prompt、
答案或评分依据；内容更新只能创建新的 materialization。

Materialization 只回答“本次 run 有哪些固定内容以及它们可承担什么角色”。Protocol Step 回答“这些
角色如何被组织、何时交互、能产生什么结果以及下一步是什么”；Card Presentation 回答“当前阶段
如何显示”。资源不得内嵌 learner session 顺序，Card 也不得反向成为资源 identity。一个资源可以在
合同允许时被不同 Step 绑定为 teaching、cue、assessment、feedback 或 repair role，但每次绑定必须
保留 role、exposure/novelty 与 grader eligibility。

Card Presentation 的版本化 Slot contract 位于 material role 与 renderer 之间。Slot 只声明稳定区域、
允许的 role、cardinality、顺序、disclosure 和 fallback；Assembly Policy 负责把已验证资源装配进去。
模型只生成 Material Candidate，不直接选择区域、CSS 或组件。由此，同一 Expression Reveal 可以对
单词显示可用 pronunciation/lexical facts，对多词表达显示结构与重音，对完整 utterance 显示整句音频
与语调；这些差异不改变 Protocol Step identity，缺少可选区域也不会阻塞运行。

On-demand materialization 不会因为生成成功而自动成为 Published Package，也不因此获得 Structured
Acquisition 的 Evidence eligibility。每个协议必须独立声明最低内容角色、验证强度与允许的结果。
生成内容较少只能说明 Lightweight 更易准备，不能把 AI 输出自动提升为 high-assurance assessment
inventory 或 Acquisition Graduation basis。

### 1.1 Content Demand 与 Candidate admission

Protocol 需求内容时引用版本化 Content Demand。Demand 以开放的 material role identity 声明
schema、cardinality、合法用途、Evidence eligibility、provisioning/validator policy 与外部派生；
它不指定 Card 名称、界面阶段或当日顺序。同一 material role 可以被 Protocol Step 绑定到
prompt、reveal、feedback 或 detail，因此新增 Reveal Card 不要求修改资源 identity 或 Learning Kernel。

Content Provisioning 先为固定 target/Sense/Protocol/Demand 建立 Content Provisioning Task。每次生产
尝试使用独立、幂等的 Content Generation Request，把这些固定身份、初始已授权 Content Context
Artifacts、允许的工具合同与预算一并交给 adapter。adapter 可以复用 Published resource、调用生成
模型或运行获准工具；新取得的事实先冻结为 Context Artifact，生成或派生的内容先成为 Material
Candidate。Candidate 只有通过该 role 全部 required validators，并且整个 Demand 的 cardinality
完整，才可进入 Materialization assembly。

字典、语料与发音索引返回的是 authoritative Content Context Artifact；Personal Meaning 中的原始
场景是必须带 use grant 的 Personal Anchor artifact；TTS 是从已接受文本或发音事实产生媒体
Candidate 的 Content Derivation。这三类输入/操作不能被压成一段不可审计的模型 prompt。

当前 Lightweight Initial 使用 `lightweight-initial-content@v3` Demand。第一张卡建立或唤起经验，
第二张卡把同一个经验与目标表达的音、形、义及实际使用连接起来。Required roles 为
`experience_recall_cue`、`target_expression`、`sense_confirmation`、`pronunciation`、
`scene_bridge`（经验绑定说明）与 `scene_realization`（同场景语言实现）。
`recall_support`、`language_structure`（最小使用框架）、最多四条 `usage_guidance`（补充例句）和
`etymology` 为 bounded optional roles；不适用或没有可靠来源时省略，不阻塞核心学习。

声音必须是已经保存的真实音频，固定准确表达、Language Tag、变体、来源与 recording/TTS 方法。
音标、可变 URL 或设备临时朗读不能独立满足声音要求。经验绑定说明解释“为什么这个表达适合这里”，
同场景语言实现展示“在这里怎么说”；两者必须引用同一不可变经验，后者保留准确 target span。
完整目标话语可以复用为同场景语言实现，不要求生成另一句近义话语。使用框架依表达类型与实际难点
提供，不能为固定回应机械制造语法模板。

资源定义、需求组合与展示规则分别负责“什么内容合法”“本次需要什么”和“何时如何显示”。资源
定义固定 schema/version、适用输入、生成指导、来源与验证责任；协议组合决定 required/cardinality；
Presentation 决定披露与组织。模型不维护另一套资源目录，也不选择布局。表达与 Sense 由权威快照
透传；教学材料先成为 Candidate；声音与词源只接受绑定来源的事实，词源不得由 Agent 自行猜测。
新增可选资源不改变学习目标、完成条件、Evidence 或调度。每个执行版本接受确定的已注册资源集合，
未知类型不能绕过验证；没有用户数据时直接更新合同，不增加旧格式读取或隐式迁移。

### 1.1.1 可扩展资源目录

目录描述已知教学职责，不要求为每个目标预先生产全部内容，也不把它当作永远封闭的全集：

| 资源组 | 已知资源职责 |
| --- | --- |
| 经验 | 经验建立／回想、回想提示 |
| 表达 | 目标形式、主要声音、音形对应 |
| 意义连接 | 义项确认、经验绑定说明、同场景语言实现 |
| 使用 | 最小使用框架、补充例句、Sense-specific 搭配、语体／语用 |
| 形式变化 | 屈折／变位、句法行为、书写与发音变体 |
| 辨析 | 相邻意义边界、易错用法 |
| 理解与助记 | 现代构词、历史词源、字形／拼写线索、编辑性记忆提示 |

现代构词、历史词源、编辑性记忆提示是不同事实类别，不能混成无约束的解释字段。文字、图片、音频、
互动则是资源的呈现形式，不是所有情况下独立的教学职责。当前可执行类型以版本化 Demand 为准，
上述目录不构成所有类型均已实现的交付承诺。

系统支持、目标已有、阶段允许展示是三个不同判断。已有合格资源可以展开；缺少资源时必须经过
准备与验证；不适用或来源不足时保留诚实状态。偏好影响未来内容选择与默认展示，不修改学习完成
条件；补充准备创建新 Materialization，不能原地修改已使用快照。

### 1.2 Agentic material production

复杂的 On-demand 供给可以由 Content Agent Attempt 编排，但 Agent 不是资源 authority 或 admission
boundary。一次 Attempt 只能处理一个 Content Provisioning Task，并固定以下输入：

- Learning Target、Sense Version、target Expression Binding 与 Pinned Language Context；
- Effective Learning Policy、purpose-specific Protocol 与 exact Content Demand；
- 初始 Content Context Artifacts，包括获得明确 use grant 的原始文字或图片场景；
- closed tool catalog、每个工具的版本/权限、调用与成本预算、超时和终止条件；
- provider/model/prompt policy 与 Attempt identity。

原始多模态场景首先是 context，不会自动成为 learner-visible material。每个文字、图片、音频或其
提取结果必须固定 identity、digest、media type、source、rights/use grant 与允许用途；个人原图、原始
叙述和录音只有在某个 material role 明确允许且通过隐私/泄露校验时才能进入 Candidate。OCR、vision
或解析模型的结果必须记录 producer/tool provenance，不能因“来自图片”而获得权威事实资格。

Agent 使用的工具必须是 typed、versioned 的封闭集合。工具结果按领域角色接纳，而不是统一塞回
prompt：authoritative lookup 或解析结果成为 Content Context Artifact；TTS、转码、媒体合成等版本化
转换成为 Content Derivation 及其 Material Candidate；validator 工具在 Agent 内给出的结果只作为
advisory preflight。最终 admission 必须由 Agent 结束后的独立 validator 重新执行或验证其可重放结果。

Attempt 的成功出口只能是一个不可变 Material Candidate Bundle。Bundle 至少固定：

- Task/Attempt/Generation Request identity 与输入 snapshot digest；
- Attempt 中新取得并冻结的 supporting Content Context Artifacts；
- 按 Demand role 标识的 Candidates、schema/version、source artifacts 与 content digest；
- required/optional role coverage，以及每个未提供 optional role 的显式 omission reason；
- 持久化所需的 tool name/version、调用 input/output digest、source/rights 与 derivation provenance；
- provider/model/prompt policy、预算消耗、终止原因和提交时间。

无需保存或信任模型的隐藏思维过程；可审计对象是固定输入、工具调用事实、supporting artifacts、
Candidates、omissions 与终止事实。Bundle 仍是 untrusted proposal，不是 Learning Materialization。
独立 validation/admission 必须只依赖 Task 的固定输入和 Bundle 内的可重放事实；接受整个 Demand 后，
system-owned assembly 才能产生不可变 Materialization。若拒绝，旧 Attempt 与 Bundle 保持终态，重试
必须创建新 Attempt。

Provisioning Batch 仅引用多个独立 Task，并提供 dispatch、预算分配和进度汇总。共享缓存或 provider
batch 必须以 artifact/content digest 保持确定性隔离；一个 Task 的素材、失败或 retry 不得污染、阻塞
或回滚其他 Task，也不得把一批 Expression 合并为一个 Agent context。

### 1.3 Published Package identity

Sense Learning Package 固定：

- 一个稳定 Sense 的 Sense Version；
- 一个 primary target Sense Expression Binding，以及它引用的 Lexeme/form version；
- target Language Tag，以及每项 learner-facing resource 的 Language Tag 与适用 Support Language；
- Acquisition Profile 与 Required Capability Set；
- 同一 Content Release 中获准发布的资源引用；
- 可审计的 source、generator、review、omission 和 media provenance。

Release 发布后不可原位修改。语言事实、源文本、媒体或 Required Capability 发生语义变化时，
必须产生新 version/release。

### 1.4 Package 的概念组成

一个可发布 Package 在领域上组合六类事实，但不要求数据库或传输合同把它们内嵌在一条记录中：

1. **Package contract**：Sense/target expression/form 版本、language-context applicability、Acquisition
   Profile、Required Capability Set 与发布版本；
2. **Semantic specification**：learner-facing gloss、精确定义、Support-Language Bridge、核心语义特征、必要
   Usage Pattern 与真实 confusion targets；
3. **Form binding**：通过 pinned Sense Expression Binding 与 Lexeme/form version 取得 word、phrase、
   pronunciation 与合法 realizations，并声明当前 Recall grading 所需的 form 规则；
4. **Teaching inventory**：Experience Sketch、获准的 Experience Renders、Learning Examples 与
   Sense binding/reveal 所需事实；
5. **Assessment and repair inventory**：Recognition、Recall、novel Transfer、条件性 Boundary 的
   可判分资源，以及每个 required capability 的定向 repair 路径；
6. **Governance manifest**：asset role/visibility、source、review、provenance、omission、digest、
   renderer support 与发布门禁结果。

Package 是以上版本化资源的不可变发布清单。它不拥有 learner exposure、Gate progress、Session
顺序或 FSRS，也不把共享 Lexeme facts、Reference Lexicon 或个人内容复制成 Sense 私有事实。

### 1.5 Book 发布与分发

面向用户持续发布的是稳定 **Book** 的新 **Book Version**，不是覆盖同名 JSON，也不是把一本书
误建模为一个 Sense Learning Package。一个 Book Version 固定有序 membership、primary target
binding 与 Content Release；用于下载的 **Book Release Bundle** 只是在一个精确 Target/Support
Language pair 下聚合这些 Package delivery snapshots 的传输制品，不创造新的学习身份。

**Learning Content Registry** 是不可变、按 digest 寻址的发现快照。一次发布必须先上传并公开验证
所有 Bundle，再上传引用它们的新 Registry Revision，最后才把服务端发现指针提升到该 Revision。
已发布 Registry、Bundle 与对象路径都不能原位覆盖；失败时旧 Registry 继续完整可用。

发现、安装与加入课程是三个不同动作：

- 客户端可低频后台检查 Registry，并立即展示本机缓存；发现新版不改变课程；
- 下载只校验 digest、大小、合同和语言方向并保存不可变 Bundle，不创建 Learning Target 或进度；
- learner 显式“应用更新”后，新的 Book Version 才进入下一 Study Scope Revision；已开始 Session
  继续固定旧 membership 与 materialization；
- 新旧版本保持相同 Sense Version 与 Binding Version 的成员复用同一 Learning Target、Retention
  Target、Evidence 和 FSRS state；纯材料修订通过新的 Content Release/materialization 表达；
- 新增成员只在应用后进入未来 Introduction；删除成员只退出未来 Planning，旧 Bundle、membership、
  已开始学习与历史事实继续可重放；若 Sense 或 Binding 的语义身份变化，则创建新的 Learning Target。

## 2. Lexeme 级共享资源

同一 Lexeme 的多个 Sense 共享：

- lemma、音节、IPA 与合法词形；
- pronunciation audio；
- 不属于单一 Sense 的形态与发音事实。

Package 引用 Lexeme Version，不为每个 Sense 复制词形库存。共享资源不意味着 sibling Senses
共享 Gate、Evidence、Acquisition Cycle 或 FSRS。

同一 Sense 下的不同 target Sense Expression Bindings 也可以引用同一 Lexeme Version 或共享
教学资源，但共享资源不能合并它们的 Retention Target、Protocol Run、Evidence 或 FSRS。

## 3. Reference Lexicon 与 Lexical Enrichment

Reference Lexicon 是独立于 Learning Catalog 的宽覆盖查询语料。一个 Reference Release 至少固定：

- source/provider、edition、entry Language Tags、support-language render scope、license 与 attribution；
- stable Reference Lexical Units、它们的 forms/POS，以及有序 Reference Senses；
- 每个 Reference Sense 的 source-backed definition、usage labels、examples 与 relation references；
- 可公开的 Lexical Enrichment、资源可见性、review status 与内容 digest；
- 可重建 search index 与 contextual resolver 所需的 release/version metadata。

Reference Lexical Unit 可以是单词，也可以是 phrasal verb、idiom 或其他 multiword expression。它不应
被强行压入“一个 lemma 一条记录”；同形异源、不同词性或词典供应商的意义划分必须按 Reference
Release 的真实结构保存。Reference Sense 的 provider order 用于完整词典展示，但不是课程顺序。
Reference Release 可以按独立于 Content Release 的节奏发布；Alignment 必须同时固定两侧版本，不能
因任一侧升级而自动沿用。

Reference Sense 与 Sensa Sense 通过独立的 Sense Alignment 连接：

```text
alignmentRelation:
  equivalent | reference_broader | reference_narrower | overlaps
```

Alignment 固定 Reference Release、Reference Sense、Sensa Sense/Sense Version provenance、reviewer、
review status 与 reason。映射不要求一对一，也不允许仅凭释义文本相似自动建立。没有 Alignment 的
Reference Sense 仍可浏览；只有对齐到 stable Sensa Sense 并拥有合法 target binding 时，才可能通过
Curriculum 的 Add-to-Learning decision 被接纳。接纳后的 Effective Learning Policy 和可执行
published、on-demand 或 hybrid 内容路径决定 Resolved Learning Plan readiness，而不是反向决定该
learner intent 是否存在。

### Lexical Occurrence 与上下文解析

每条可点词 Example 可以拥有有序 Lexical Occurrences。Occurrence 固定 exact immutable Example、
`start/end` character span、surface form、single/multi-token shape、Reference Lexical Unit candidates
与解析版本。不能只保存 token 文本，因为重复词、标点、屈折形式和 multiword expression 都需要
精确 span 才能稳定重放。

Example 的 authored target occurrence 已经通过 target span 与 Sense Version 精确绑定；它的
Contextual Sense Resolution provenance 为 `authored_target`。存在 reviewed Sense Alignment 时可据此
定位 Reference Sense；没有 Alignment 时仍然只确定 Sensa Sense，不伪造 Reference emphasis。非目标
occurrence 在内容生产时按以下闭集流程预计算：

1. 从 token、lemma、POS、morphology、collocation 与 multiword expression 生成 Reference candidates；
2. 只在候选 Reference Sense IDs 中，结合 exact expression/context、审核过的 support-language render、
   definition 和 source examples 排序；
3. 按版本化阈值保存 `reviewed | model_confident | ambiguous | unresolved`，以及 resolver/model/version；
4. target、ambiguous、高风险或会影响 Add-to-Learning 的 occurrence 进入人工审核。

模型只能选择或排序 closed candidates，不能在运行时自由生成 definition。`ambiguous` 与 `unresolved`
是正常、诚实的发布状态：前者可显示“本句中可能是”及少量候选，后者只显示完整 entry，不强调一个
确定义项。运行时 fallback 只能在缺少预计算 annotation 时使用，并按 `(example, span,
reference release, resolver version)` 缓存；不可变预计算 annotation 是离线、速度和可重放的首选。

### 构词、词源与记忆辅助

Lexical Enrichment 可以包含：

- **Morphological Analysis**：有来源支持的 root/affix、compound 或历史构词结构，通常绑定 Reference
  Lexical Unit；不得根据表面字符串机械拆词，也不得把现代不可分析词伪造成透明组合；
- **Etymology Note**：带 source 与 provenance 的历史来源、语音/意义演变事实；必要时可以绑定同形
  词的具体来源或 Reference Sense history，而不是强迫整个词头共享一条错误故事；
- **Etymology Story**：将可靠词源改写成易理解叙事的 reviewed editorial adaptation，必须与原始
  词源事实分层并保留来源；
- **Lexical Family Relation**：经过来源或审核支持的派生、同根、复合与历史关系；不能只因拼写相似
  就建立关系；
- **Mnemonic Aid**：明确标记为记忆辅助的编辑内容。它可以帮助加工，但不是语言学事实、Sense
  definition、Experience Sketch、grading key 或 Learning Evidence。

资源可见性固定为 `reference_visible | learning_only | assessment_only`。Reference Lexicon 及
Contextual Lookup 只显示 `reference_visible` 内容；Package 内只为 Action 服务的 teaching resource
是 `learning_only`；为 Novel-context Transfer 等正式检验保留的内容是 `assessment_only`。一份内容
若要跨用途复用，必须显式声明多个合规角色并通过对应 validator，不能靠页面 fallback 越界读取。

Reference detail 的展示区块只在真实数据存在时出现，典型为释义、例句、用法、构词/词源和相关。
若当前 Reference Sense 已对齐 Sensa Sense，Personal Content 可以另外挂载该 Sense 的 Note；这不把
Note 变成 Reference Release 内容，reference-only meaning 也不会凭空获得一份 Note。区块不是领域
身份，空区块不得伪造供应商内容或占位数据。Sensa 不生产、不授权也不展示“真题”、考试来源聚合
或考试频次 tab。

## 4. Sense 级教学资源

- **Experience Sketch**：与呈现媒介无关、不出现目标词的 reviewed teaching specification，描述要让
  learner 构建什么具体经验、注意什么关系、推断什么意义以及必须避免哪些误导；
- **Experience Render**：对一个 Sketch 的 approved text、image、animation 或 interaction 实现；
- **Experience Recap**：供 Reveal 与 repair 使用的 reviewed learner-facing 简明回顾；它概括同一个
  Sketch，但不是把内部作者规格直接展示给 learner；
- **Support-Language Bridge**：声明自己的 Support Language，用它接住已有概念并指出
  support/target-language 覆盖差异；只有与 Pinned Language Context 兼容时才可进入 Materialization；
- **Learning Example**：拥有 exact target occurrence、Sense Version binding、target-language Context、
  optional support-language render 与审核
  provenance 的不可变例句；Study Example 是它获准承担的首次 binding 或 repair role；
- **Sense identity display facts**：label、part of speech 与准确义项说明；
- **Usage Pattern**：有来源支持且对该 Sense 必要的构式、搭配或使用限制。

教学资源负责建立和修复连接。展示它们不产生 Gate pass 或 Learning Evidence。

### Experience Sketch 与 Render

Experience Sketch 固定教学意图，而不是固定 UI payload。它至少说明：

- learner 应形成的 minimum sufficient experience；
- 情境中的关键角色、状态、变化或因果关系；
- learner 应该推断出的当前 Sense；
- 初次 grounding 时必须隐藏的目标 form；
- Render 必须表达和不得表达的内容约束。

Experience Render 单独绑定 Sketch，并声明 renderer kind、获准内容或 media、accessibility 与支持的
delivery profile。LLM-assisted 内容分析可以根据 minimum sufficient experience 与 Acquisition Primitive
推荐最合适的媒介并生成 Render Candidate，发布流程只接受经过确定性校验和内容审核的 Render；
Runtime 不能重新分析 Sense，只能按 Render Plan 从 Package 已批准且当前客户端可执行的 Render 中选择。
更换 text/image/animation/interaction 不改变 Sketch identity、Sense facts 或 Required Capability。

Text Experience Render 是完整的自然语言经验场景：它让 learner 在脑中进入具体情境，跟随角色、状态、
变化或因果关系并形成目标推断。它不是对 Sketch 的说明、词典定义、图片 alt text、步骤摘要或 Experience
Recap。文字既可以是内容分析选出的 preferred grounding path，也可以在非文字首选不可执行时承担
approved fallback；这两种角色使用同一种 Text Experience Render 质量标准。

Acquisition Primitive 与 renderer kind 必须分开：Primitive 表达 `causal_sequence`、
`spatial_relation`、`introspective_scenario` 等教学机制；renderer kind 表达 text、image、animation
或 interaction 等交付媒介。同一个 Primitive 可以有多个不同媒介的 Render。Profile 的
`fallback primitive` 表示在必要时换用另一种教学机制；Experience Render Plan 的 fallback 表示保持
同一 Sketch/Primitive、换用当前客户端更可靠的呈现路径。二者不能合并成一个含义模糊的 fallback。

Experience Render Plan 把每个 approved Render 分类为有序的 `preferred | alternative | fallback`，
并固定其支持的 delivery profile 与选择理由。每个 Plan 恰好一个 preferred Render；Runtime 只选择
一条足以实现当前 Sketch 的可执行路径。多个 Render 是经过审核的替代实现，不是要求 learner 依次
完成、逐层丰富或自由切换的教学步骤。preferred 本身是 Text Experience Render 时，它已经是一条完整
可靠路径；preferred 不是 text 时，Plan 必须提供至少一个 approved Text Experience Render fallback。

一个 required Sketch 必须在当前 delivery profile 中至少拥有一条可执行呈现路径。客户端缺少首选
renderer 时只能使用 Package 声明的 approved fallback 或诚实 unavailable，不能把 alt text、技术说明
或运行时自由生成的描述冒充文字经验场景，也不能改写 Sketch。

### 动态 Interaction Render 的协议方向（已接受，暂缓实施）

未来的动态 Interaction Render 借鉴 A2UI 的声明式、组件目录、数据绑定、动作与客户端原生渲染
思想，但 Sensa 不把外部 A2UI wire format 直接作为领域模型或 Package 的永久存储格式。A2UI
属于可替换的表示或传输参考；Sensa 必须拥有稳定、版本化且语言无关的 Interaction Render
Contract，并可在需要时通过 adapter 与具体协议或客户端框架连接。

Interaction Render Contract 位于教学意图与客户端实现之间：

```text
Experience Sketch
      ↓
Acquisition Primitive
      ↓
Interaction Render Contract
      ↓
Sensa Interaction Catalog
      ↓
React / Flutter Renderer
```

该 Contract 只声明获准的教学交互，不携带任意可执行代码。它必须把组件结构、内容数据、局部状态、
允许的事件/动作、语义不变量和无障碍语义分开，并固定 contract/catalog version、
所需客户端 capability 与资源引用。客户端使用可信的 closed catalog 实现样式、布局、动画、输入和
平台无障碍行为；Package 或模型不得下发任意 HTML、JavaScript、CSS、网络请求、隐藏副作用或自由
评分逻辑。

Catalog 应优先提供具有教学语义的高层组件，例如 `state_change`、`force_threshold`、
`sequence_order`、`figure_ground`、`contrast_toggle` 或 `timeline_scrubber`，而不是只让生成器任意
拼接 Text、Button、Slider 等低层控件。生成器可以在封闭 Schema 内选择组件并填写受约束数据，
但状态变化规则、事件边界与渲染安全由版本化组件合同所有。

Interaction Render 有两种生产来源，但只有一套 Contract、Catalog、Validator 与客户端执行模型：

1. **Reviewed authoring**：内容生产阶段预先生成或编辑 Render Candidate，经确定性校验、审核和
   release 后成为 Package 内不可变的 Published Render；
2. **Runtime synthesis**：未来由 AI 在运行时为既有 Sketch 生成替代或 repair Render Candidate，
   仍须经过同一 Schema、target-form 隐藏、资源、capability、无障碍和安全校验，不能成为第二套
   私有协议。

二者的差异是 provenance、review status、lifecycle 与 Evidence eligibility，而不是结构。默认可信
级别如下：Published Render 可以服务正式教学，并仅在独立 Action/Outcome 合同允许时参与正式过程；
由获准组件和获准内容确定性组合的 Runtime Render 必须逐项证明资格；未经审核的 ephemeral AI
Render 只能用于解释、替代呈现或定向 repair，不产生 Gate pass、Learning Evidence，不拥有 grader，
也不覆盖 Published Package。未来若要提高其资格，必须通过新的版本化策略明确提升，不能由客户端
或模型自行推断。

Runtime 可以为固定 target 与 protocol 创建 On-demand Learning Materialization，但不能把该行为冒充
“发布完整 Package”。Lightweight Study 可以使用经过相应合同校验的按需文本、静态场景和练习；
Structured Acquisition 的 Gate policy、protected assessment inventory、正确答案和评分规则仍要求
更强的受控内容与 Runtime 合同。客户端不支持某个 catalog/version 时，只能使用 materialization
中已固定的 approved fallback 或诚实 unavailable，不能在 response 之后让模型改写教学意图。

以上 Interaction Render Contract 仍是 Later 边界。V1 接受按需生成普通文本/静态学习内容，不因此
要求动态组件协议、流式 UI、capability negotiation 或上述 Interaction Catalog。

### Learning Example、Attested Usage 与 Example Render

Learning Example 的语义身份独立于它如何显示。它固定不可变 target-language Context、optional
support-language render、
exact target occurrence、目标 Sense Version、source/review provenance 与获准 roles。Study、repair、
review、free-practice 或 assessment 是显式角色；角色不会因某个页面碰巧读取它而改变。

Usage Pattern 中可点击的构式或搭配必须通过 Usage Example Binding 指向 exact immutable Example 与
其中准确的 usage occurrence span。Binding 不得保存数组位置，也不得依赖运行时 substring search；
每个对 learner 显示为可点击的搭配必须至少拥有一条 learning-visible、reviewed binding。未来由
Attested Usage 支撑的媒体例句仍沿用同一个 Example/Binding identity，只增加 approved Render。

Attested Usage 表示影视、电视、YouTube、播客或其他 source-backed corpus 中的一次真实使用。它可以
进一步固定 source/rights、clip range、transcript、word-level timeline、目标 token 以及经审核的
contextual Sense assignment。Attested Usage 不是天然的 Learning Example；只有在完成消歧、教学
编辑、授权与角色审核后，Learning Example 才能显式引用它。

Example Render 是 Learning Example 的 approved text、static-audio 或 synced-media 呈现。带词级时间轴
的音视频 Render 必须保持 transcript、target token、clip digest 与 Sense assignment 一致，并提供
版本化 fallback。外部媒体下架、地区限制或授权失效只会使对应 Render unavailable，不能修改
Learning Example、替换 target Sense 或绕过当前 Action 的 asset role。

### 示例：`sustain` 的“使持续”义项

一个说明性 Package 可以具有如下概念结构：

```text
Sense: sustain · verb · 使某种状态、活动或过程持续下去
Semantic specification:
  - 已有活动存在减弱或停止的可能
  - 持续投入条件、力量或资源，使它跨越一段时间继续
  - `zh-Hans` Support-Language Bridge 明确它不覆盖所有中文“保持”
Form binding:
  - Lexeme sustain；合法 forms 包含 sustain/sustains/sustained/sustaining
Teaching:
  - Experience Sketch：一个系统会逐渐停止，必须持续补充资源才能继续运行
  - Experience Render：当前 profile 可执行的文本、图像或交互实现及 approved fallback
  - Study Example：资金使一个原本可能停止的项目继续运行
Assessment:
  - familiar/basic context Recognition
  - Sense cue → sustain 的 Lexeme retrieval
  - 覆盖项目、注意力、产能、系统表现、服务与体力节奏的 protected Transfer pool
Repair:
  - grounding re-presentation、form cue fading、retrieval cue fading、varied-context repair
```

这是一份 Package 的领域组成示例，不规定数据库嵌套结构、固定卡片、Action 顺序或客户端页面。

## 5. Sense 级检验资源

Assessment Task Resource 把 reviewed prompt、response contract、grading basis、Sense-specific
distractors 与定向 feedback 绑定到 immutable resources。它是 Package 内容，不是当前 Learning Action、
Card 或 learner Attempt；Protocol Step 先声明所需 material role 与结果资格，Structured Semantic Policy
再根据 Step purpose、exposure、Gate/5D 与 executable inventory 选择本次最小 Action。通用标题、
按钮、选项顺序和 Outcome label 属于 Runtime/Renderer，
不应在每个 Package 重复作者化。

### Contextual Recognition

Recognition 需要能把 Form-in-context 映射到当前 Sense 的语境与可判定响应。教学时已经完整
展示过的 Example 可以用于首次熟悉语境识别，但不能同时冒充 novel Transfer。

### Meaning-to-form Recall

Recall 可以复用不泄露目标 Lexeme 的 Experience Sketch、minimum sufficient experience 或
经过审核的 Sense cue。允许答案来自 pinned Lexeme Version 的合法 forms；是否要求语境中的
精确屈折由版本化规则决定，语义取回与形态错误必须能被区分。

Structured Acquisition 的当前候选 baseline 默认验证 **Lexeme identity retrieval**：无句法约束的 cue 下，pinned Lexeme Version
中的合法屈折形式可以证明 learner 找到了正确 Lexeme，并反馈 canonical lemma；同词族派生词不因
拼写相关而自动判对。有明确句法约束时，系统可以另外判断 form realization。找对 Lexeme 但屈折
不合语境应保留 retrieval Evidence 并给出形态反馈；只有 Acquisition Profile 把 form realization
明确列为 required capability 时，它才独立阻止对应 requirement 通过。

### Novel-context Transfer

Transfer 使用 learner 尚未作为教学内容见过的 approved Example 或等价语境。Example 必须
绑定目标 Sense、包含可核验 target occurrence，并提供足以判断该 Sense 的上下文。

Protected Transfer inventory 必须提供足够的独立机会支持首次检验、失败后使用新语境重测以及
长期 revalidation。内容覆盖按不同 scenario families、syntactic frames、forms、collocations 与
抽象程度审核；仅替换人名、数字或同义改写不形成新的迁移机会。资源的 assessment role 属于
Package，某条资源对 learner 是否仍 novel 属于 learner exposure history。

一条 Transfer 资源被 learner 暴露后仍可在 Policy 允许时用于普通 review，但不能再次为该 learner
产生“首次未见语境”的证据。protected inventory 耗尽时 Runtime 必须报告 exhausted，继续使用
已见语境只能算 repair/practice，不能伪装成 novel Transfer。首个 Structured profile 不在运行时
自由生成考题补池。

### Boundary

Boundary/Contrast/Counterexample 必须依赖可反查的 Sense Relation 与真实 confusion target。
它需要可执行的正反案例或选项，不能用一段说明性 `boundary_note` 冒充可判分资源。

Boundary 是条件能力：没有真实、重要的 confusion target 时，Package 应明确省略，而不是为
统一卡数臆造干扰项。同一个资源可以支持某次 Recognition 或 Transfer 并同时解决 Boundary，
但同一 learner/Cycle 的 familiar Recognition 与 novel Transfer 不能由同一次 Attempt 合并。

默认 repair 直接复用当前 Package 已有资源：grounding 使用 Experience/Reveal，Recognition 使用
Task feedback 与学习例句，Recall 使用 support inventory 与 pinned Lexeme forms，Transfer 使用 Task
feedback、Experience 与新的 assessment opportunity，Boundary 使用 Task 与真实 Relation。Runtime
只需说明本次为何修复、选择哪些已有资源，以及何时安排后续重测。Package 不应为这些默认路径复制
资源或强制作者按 capability 重复声明 Repair Asset Binding；只有某个 failure basis 需要偏离默认
路径、选择特定教学资源时，才需要显式 Binding。

## 6. 媒体与输入通道

- pronunciation audio 绑定 Lexeme Version；
- example audio 绑定已审核 Example 原文与 source-text digest；
- 图片、图示、动画、交互和扩展音频作为 Experience/Example Render 绑定其表达的 Sketch、Example
  或 capability；
- 音频是否成为短期毕业的 required input channel 由 Profile/Product baseline 决定。

TTS 只能在源文本审核通过后执行。媒体记录 provider/model/voice/accent、source digest、duration
与 media digest；源文本变化使旧媒体失效。自动播放只是呈现行为，不是 Sound → Sense Evidence。
word-level timeline、字幕高亮和原声片段同样只是 Render 能力；没有独立 Listening Attempt 与
grading contract 时，播放、跟随或隐藏字幕不能产生 Listening Evidence。

## 7. Semantic Field 与自由练习资源

Semantic Field Version 只能引用同一 Content Release 中的 Sense Versions 与已审核 Sense Relations。
它可以提供 field label、自然语言说明、成员角色与稳定展示顺序，但不能用未经审核的 embedding
距离或自动聚类冒充语义事实。Field 不是 Book，不携带 curriculum position、daily quota 或 learner
state。

Curriculum 可以先接纳 stable Learning Target 与合法 Learning Policy Assignment，再在独立准备阶段
解析 Content Provisioning path；接纳不等于当前可执行，仍未物化、未校验的草稿不能被当作 ready
课程或正式学习内容：

- Book Version 固定其有序 Sense membership 与对应 Content Release；Book Range 只从该不可变
  membership 中解析稳定 selection；
- Supplemental Membership 指向已解析 primary expression 的 Learning Target，并在内容准备期间保留
  learner intent；每个 Study Scope Revision 必须固定其 Retention Target、Effective Learning Policy、
  Resolved Learning Plan readiness 与当前 purpose protocol reference，Session/Encounter 再将
  published、on-demand 或 hybrid 来源解析为不可变 Learning
  Materialization；
- 找不到合法 provisioning path 时必须把 plan 标记为 `blocked(reason=content_unavailable)`，保留
  Membership 并从正式 Planner inventory 排除。词典释义、draft、sibling Sense 或未通过协议校验的
  自由生成内容都不能把 blocked target 冒充成 ready 学习；
- 高保证 Learning Policy 缺少 required assessment/novelty/grader capability 时不得静默使用轻量内容；
  只有 learner 显式改变 Policy Assignment 后，才能按新 Profile 重新解析 plan；
- Published Package/Content Release 或 Book Version 的升级不改变已经开始的 Session/Encounter，
  下载新版也不产生课程效果，必须由 learner 显式应用并由下一 Scope Revision 接纳；Book 新旧版本
  中保持相同 Sense/Binding Version 的成员沿用 Retention state，被删除成员只退出未来 Planning。
  learner-owned Personal Membership 可以在固定 Learning Target、Route 与
  Target/Support Language pair 内发布新的不可变 materialization，供尚未操作的当前或未来 Step 使用。
  两种路径都必须保留此前 Curriculum provenance、已操作 Step 的 materialization 与学习事实。

Free Practice 可以复用 Expression form/pronunciation、Sense display facts、Experience、Study Example、
Usage Pattern、Sense Relation、Personal Semantic Anchor 与已获准媒体，也可以通过获准 provider 在
Session 前后解析外部资源。但 Practice Activity Definition 必须固定实际 target、resource roles、
stimulus/response channels、support/feedback policy，并在 Turn 上保留精确资源版本或 provider
provenance。外部资源可用性不能被伪装成 Package 内已审核内容。

- Listening/Reading 若声称练习特定 Sense，所用语境必须具有足够的 contextual Sense control；
- form-level listening 可以按 Expression/Pronunciation Variant 检索而不做语义消歧，但产品必须明确
  它不保证 occurrence 对应当前 Sense；
- Speaking/Writing 的 Sense-grounded scenario 必须定位意图，而不把目标表达变成唯一标准答案；
- AI/ASR feedback 可以评议意义贴合、自然度或可理解性，但它只形成 Practice Feedback，不是
  reviewed linguistic truth、grading key 或 Learning Evidence；
- 为 Novel-context Transfer 保留的 assessment-only assets 不得通过 Free Practice 暴露。

一个 Package 不因缺少四个 Practice Area 中的任何 Activity 就无法支持正式 Acquisition。可提供哪些
练习由独立的 versioned practice profile/capability inventory 如实报告；缺少 external provider、audio、
ASR、AI feedback 或 renderer capability 时应省略相应 Activity，而不是生成不可执行的占位内容。

### Initial Free Practice Profile

为避免和当前 Sensa V1 P0 混淆，首个自由练习交付合同称为 **Initial Free Practice Profile**。
它属于 P0 之后的 Later 能力，不改变当前 launch blocker，也不进入 Acquisition Required Asset
Manifest。它定义的资源解析关系是：

```text
Free Practice Profile
        × approved Package / provider resource availability
        × Runtime / Client capability
        ↓
Executable Practice Capability Inventory
```

- Free Practice Profile 固定允许的 Activity Definitions、target/channel/support 组合，以及 renderer、
  interaction、feedback、fallback 和 resource-role requirements；
- Package Practice Manifest 声明某个 Package 实际具有哪些 approved practice resources；
- external provider capability 独立声明可解析的媒体或服务、provenance、授权与失败边界；
- Executable Practice Capability Inventory 是两者与当前 Runtime/client support 的版本化交集；
- 缺少 Practice Manifest、provider 或任何 Practice Area 不能阻止 otherwise acquisition-ready Package 发布。

Initial Profile 每个 Practice Area 只承诺一个边界明确的 Activity Definition：

| Activity Definition | Primary Area | 实际 target | 反馈语义 | 资源要求 |
| --- | --- | --- | --- | --- |
| Real-world Speech Variation（真实语流泛化） | Listening | Expression form；可用时固定 Pronunciation Variant | 只记录 exposure/navigation，不声称目标 Sense 命中 | YouGlish provider occurrence、来源链接/时间位置及可靠的 pronunciation constraint；不做 contextual WSD |
| Oral Scenario Rehearsal（情境口语排演） | Speaking | Sense-grounded contextual expression | ASR/AI 的即时 Practice Feedback；不提供 phoneme-accurate score | communicative brief、voice capture、ASR transcript、AI feedback capability |
| Contextual Meaning Inference（语境推义） | Reading | controlled Context 中的目标 Sense | reveal 当前 Sense 与 context cues，不把 reveal 后行为当评价 | Sense-controlled short Context、精确 Expression occurrence、Sense reveal/cue binding |
| Written Scenario Response（情境书面表达） | Writing | Sense-grounded contextual expression | AI 提供自然度、意义贴合、修订与 alternative；无唯一标准答案 | communicative brief、written response、AI feedback capability |

Initial Profile 的 Practice Scope 首先支持 learner 明确选择的完整 Personal Meanings、Senses/
Expressions 与当前 Book slice 中可执行的 targets。Saved item、Semantic Field、Personal Collection
或 history-based Scope 只有在对应 content/persistence/API/Sync contract 已交付时才可加入 inventory；
Profile 不根据“薄弱维度”自动创建强制任务或学习债务。

YouGlish 片段属于 form-level provider resource，不成为 Learning Example，也不因为 Scope 中存在 Sense
就获得 contextual Sense assignment。相同拼写存在多种发音时，resolver 必须约束正确 Pronunciation
Variant；无法可靠约束就省略该 occurrence。Sense-controlled Reading Context 与 Speaking/Writing brief
可以来自已获准的不可变资源或受版本化 policy 约束的 runtime generation；来源与生成版本必须保留，
但 AI 输出仍不是 reviewed content 或正式 grading basis。

只有显式拥有 `free_practice` role 且未被 `assessment_only` 隔离的 Package resource 可以进入 Practice
Manifest；protected Transfer inventory 永远 fail closed。Practice Turn、Observation、Feedback 与
Artifact 都不是 Learning Evidence。Free Practice 需要正式评价能力时必须转为独立 Learning Protocol/
assessment operation，不能复用 Activity 名义绕过 evidence policy。

## 8. Learner-owned personal content

Personal Content 不进入 Content Release，也不成为 Sense Learning Package resource：

- Personal Meaning、optional Meaning Focus、Personal Semantic Anchor 与 Personal Expression Anchor
  保留 direct/delegated acceptance 和来源 provenance；Sense Construction 中的原始对话与 Sense
  Proposal 也不能直接成为 reviewed Package resource；
- 有效 Semantic Acceptance 后创建的 Sense Version 是后续内容生产的 semantic source identity，
  但确认本身不证明 Experience、Example、Usage、Assessment 或 Repair assets 已完成审核；
- Personal Meaning Alignment 保存个人意义与 stable Sense 的关系。Package 可以在 learner 明确允许
  时引用其 Personal Semantic Anchor 作为 optional scaffold，但不能把该 Anchor 复制成公共资源；
- Saved Sense 指向 stable Sense identity，并保留保存时可见的 Sense Version provenance；显示时可以
  使用当前可读版本，但语义重大变化必须可解释，不能把 sibling Sense 当作替代；
- Saved Example 固定 exact immutable Example 与其 release provenance；资源退休、授权失效或不可用
  时显示诚实状态，不能静默替换为“类似例句”；
- Sense Note 绑定 stable Sense；Personal Semantic Anchor 绑定 Personal Meaning，并通过 confirmed
  Personal Meaning Alignment 进入 Sense 语境。内容版本升级不删除 learner-authored text；每个
  learner/Sense 只有一份 current Note，但一个 Personal Meaning 可以有多个独立 Anchors；
- Personal Collection 只保存指向 stable Sense 或 exact Example 的 typed references 与 learner
  ordering，不依赖 Saved record，也不复制 Package、Example 或 Semantic Field 内容。

Personal Learning Scene 是 Personal Content 中面向运行时的一层。它在一个 Learning Target + Route 下
保存 current revision 和完整历史；Book 更新不覆盖它，另一个 Route 也不隐式复用它。Protocol 可以把
当前 revision 作为 optional scaffold 呈现，但每次 Action 都必须记录实际使用的 scene revision，过去的
Step 不跟随 current pointer 变化。把 current revision 存入 Personal Semantic World 是另一条显式命令，
它复用 Package 交付的完整 Sense/Expression/Binding semantic snapshots，并建立或更新 learner-owned
Personal Meaning；Package 本身及其 Content Release 保持不变。

Anchor 只有在 learner 明确允许、Personal Meaning Alignment 已确认、目标 Sense 一致且
Practice/Action contract 接受 personal scaffold 时才可以被引用。它不能满足 Required Asset
Manifest、替代 reviewed Experience、成为 grading key、构成 novel assessment 或产生 Learning
Evidence。Note 默认只供 learner 阅读，不能被 Runtime 当作语言学事实解析。

## 9. 生产与治理对象

以下对象保证资源可生产、可审核、可发布，但不是 learner-facing 学习材料：

- Acquisition Profile；
- Required Capability Set；
- Required Asset Manifest；
- Executable Learning Capability Inventory；
- provenance、source evidence、review report 与 omission reason；
- IDs、ordinals、target spans、digests、status 与 release references；
- Reference Release、Reference candidate inventory、Sense Alignment、Lexical Occurrence annotation、
  Contextual Sense Resolution 与 resolver/reviewer provenance。

按需 Sense Construction 不要求预先维护穷尽式 Sense 库。有效 Semantic Acceptance 后创建的 Sense
必须先固定 Sense Version，内容供给再以该版本和 Learning Target 为输入：可以生产 Published Package，也可以
为选定协议生成一次性 On-demand Learning Materialization。LLM 可以协助两种路径，但内容角色、
provenance、冻结时点和 Validator 由各自合同决定；按需内容不能自行获得 Published 或 Evidence
eligible 身份。

已有 Sense 的相似检索、复用和 equivalence/overlap/broader/narrower 关系属于治理流程，不是个人
创建的前置条件。后台治理不得物理合并已被 Package、Personal Meaning Alignment 或 learner progress
引用的 stable identity；语义修订通过新 Sense Version、显式 split 或 Sense Relation 完成。

scene domain、construction、disambiguating cue、collocations 和 variation note 可以帮助选择与质检，
但除非版本化合同明确说明，不能成为跨 Package 的机械配额。

## 10. 运行时派生，而非生产资源

以下事实由 Learning Materialization、learner history 与版本化 Protocol/Policy 派生，不应交给
生成模型作为可覆盖权威状态的独立内容：

- 当前 Gate、Protocol Step Instance、Step purpose、material role binding、Action、scaffold 和下一步；
- 当前 Card Presentation、prompt/reveal/feedback/detail visual state；
- masked text、答案位置、选项顺序和本次 distractor 组合；
- Example 对该 learner 是 study-seen、assessment-seen 还是 novel；
- cooldown、组内穿插位置与 Session intent；
- Practice Brief/Scope snapshot、Activity 顺序、scaffold 与本次 channel-specific interaction contract；
- Learner Semantic Projection 中的 learner status overlay、布局与可视化聚类；
- Attempt、Evidence、Gate progress、5D State、Acquisition Graduation、Memory Outcome 与 FSRS；
- Practice Turn、Practice Observation、Practice Feedback 与 Practice Artifact；
- Declared Mastery；
- Reference search ranking、lookup presentation grouping 与未预计算 occurrence 的临时 candidate order；
- Learner/Device Preference resolution、Appearance Preference、autoplay、translation default visibility
  与 playback behavior。

干扰项若表达真实语义边界，语义内容必须来自已审核 Relation/Boundary 资源；运行时只能决定
确定性的选取和顺序，不能自由编造一个似是而非的相邻 Sense。

## 11. 资源质量不变量

- Learning Materialization 与 Content Provisioning Task 必须固定 Pinned Language Context；后续 Active
  Route Selection 或 Support Language 变化只能产生新的 Task/Materialization，不能改写已有内容；
- 每个 Expression、Context、Bridge、Example render 与媒体派生必须保存 exact Language Tag；script、
  region 或 voice fallback 必须显式记录，不能重写源语言事实；
- language support resolution 只能返回 exact support、approved fallback 或 unavailable；缺少 speech、
  reference、translation、content 或 renderer capability 不得把内容重标成另一种语言或伪造资源；
- Language-Pair Glossary Entry 只能影响与其 exact Input/Output Language Tags 匹配的未来 Candidate 或
  render；同形 term 不得跨 Route 或语言方向全局覆盖，也不得作为 Sense/translation truth；
- Experience Sketch 不出现 target expression 或合法变形，也不退化为词典定义；
- Experience Sketch 与 Render 必须分离：Sketch 固定媒介无关的教学意图，Render 固定一种已审核
  呈现；Text Experience Render 必须是可独立建立经验的场景而非说明，renderer fallback 不得改变
  目标 Sense 或教学约束；
- Support-Language Bridge 使用其声明的 Support Language，明确必要的跨语言范围差异；
- Example 必须自然表达目标 Sense，target form/span 可确定性核验；存在 support-language render 时，
  两侧语义必须一致；
- Attested Usage 必须固定真实 source/rights、exact clip/context、target occurrence 与 approved
  contextual Sense assignment；word-level timeline 必须与 transcript 和 target token 一致；
- 外部媒体 Render 不得成为 Required Gate 的唯一资源路径；不可用时只能使用 approved fallback
  或诚实 unavailable；
- Lexical Occurrence 必须绑定 exact Example + exact span；multiword expression 不得被拆成相互误导的
  单词查询结果；
- Contextual Sense Resolution 只能从 pinned Reference Release 的 closed candidates 中选择；不确定时
  必须保留 ambiguous/unresolved，不得自由生成一个“看起来合理”的义项；
- 上一条只约束 Reference Lookup 对既有词典条目的上下文解析；它不禁止 Personal Semantic World 中
  的 LLM-assisted Sense Construction。后者必须经过有效 direct/delegated Semantic Acceptance 并创建
  stable Sense Version，仍不能
  冒充 Reference Sense 或已发布 Package；
- On-demand 内容必须在 learner 使用前冻结为带 digest 的 Learning Materialization，记录 target、
  Effective Learning Policy/plan revision、protocol、generator/policy provenance 与验证结果；任何
  Action 被接受之后都不得重新生成并替换该 Step 的 prompt、answer、grader 或反馈依据；未接受 Action
  的 current/future Step 只能切换到同一 Curriculum Membership、Learning Target 与固定语言方向下
  另一个已验证、不可变的 materialization；
- 原始多模态场景及其解析结果必须固定 identity、digest、media type、source、rights/use grant 与用途；
  原始个人媒体不能因被 Agent 看见而自动成为 learner-visible material；
- Content Agent Attempt 只能处理一个固定 Content Provisioning Task 并调用其 closed tool catalog；
  tool result 必须按 Context Artifact、Content Derivation 或 Material Candidate 的真实角色保存；
- Material Candidate Bundle 是 Agent 终止时提交的未受信提案，不是 Learning Materialization；Agent
  preflight 不能替代 system-owned validation/admission，拒绝后的重试必须创建新 Attempt；
- Provisioning Batch 中每个 Task 的 context、Candidate、失败与 retry 必须隔离；batch 不提供跨 target
  内容身份，也不具有整体成功或回滚语义；
- Content Provisioning failure 只改变 purpose-specific plan readiness/blocked reason，不删除已接纳的
  Supplemental Membership，也不能静默切换 Learning Policy Profile 或制造 Runtime progress；
- Protocol Step 只能绑定 Materialization 中具备对应 role、visibility、exposure 与 grader eligibility 的
  内容；Card Presentation 不得临时补造内容、替换评分依据或升级结果资格；
- Presentation Slot 只能接收其合同允许的 material role；模型输出的布局指令一律不进入
  Materialization。Experience Recall 的全部 Slot 必须通过 target-expression non-disclosure 校验；
- Semantic LLM、Learning Content LLM 与未来 Grading LLM 是不同领域角色；同一次模型调用不能因
  “模型很懂语言”而绕过各角色独立的权限、输入最小化、校验与审计合同；
- Reference Sense 与 Sensa Sense 只能通过 reviewed/versioned Alignment 连接，词典条目本身不能成为
  Retention Target 或 Learner Sense Progress identity；
- root/affix、词源与词族关系必须有来源或明确 review provenance；Etymology Story/Mnemonic Aid 必须
  标记为编辑性支架，不能冒充语言事实；
- Reference 读取只能暴露 `reference_visible` 资产；`learning_only` 与 `assessment_only` 均 fail closed；
- Study 与 novel assessment 使用历史必须可区分；已经揭示的语境不能再声称 novel；
- Transfer pool 必须覆盖多个真实 scenario families；机械改写或重复暴露不能冒充独立迁移素材；
- Recall grading 必须区分错误 Lexeme、合法屈折、派生词与 context-specific form realization；
- Usage Pattern 必须有来源；省略比臆造更正确；
- 可点击的 Usage Pattern/Collocation 必须拥有 exact Usage Example Binding；数组 index、substring
  search 或 assessment-only Example 不能成为正式导航合同；
- Experience Recap 必须忠实概括其 Sketch、隐藏 target forms，并与内部 Experience Sketch 身份分开；
- Assessment Task Resource 必须引用合法 Example/Relation/Form facts，且每个 required capability 都有
  当前 delivery profile 可执行的 response/grading path；
- Repair Asset Binding 只能引用 approved teaching resources；默认 repair 从 Package 与当前 Action
  直接推导，不要求按 capability 重复 Binding；Binding 不规定 learner 顺序，也不能把 reveal、
  acknowledgement 或 repair 后即时重答升级为独立 Evidence；
- Boundary 必须指向真实 Relation、target 与 distinguishing feature；
- Semantic Field membership 与 Relation 必须可追溯到同一 release 的稳定 Sense identity；
- Structured Acquisition Package 必须能支持 Required Capability Set，而不只是满足资源数量；
- Practice Activity Definition 必须区分 Context、Expression、Sense、binding 与 Learning Target；
- free-practice resources 不能泄露 reserved novel-assessment inventory；
- learner-authored Note/Anchor 不能通过 content validator 冒充 reviewed Package asset；
- Sense Proposal 或确认对话不能直接成为 Package asset；资源生产必须固定 confirmed Sense Version，
  且 Sense Expression Binding 不能只保存无类型、无 language/provenance 的字符串；
- Learner Preference 只能在 approved alternatives 中选择未来资源，例如可用 accent；找不到匹配项时
  使用版本化 fallback 或诚实 unavailable，不能修改 Package 或绕过 Required Asset Manifest；
- Device Preference 只控制本机呈现；Sensa Skin、color mode、文字大小、autoplay、译文默认状态、
  animation 与 playback behavior 都不能改变 asset role、Slot disclosure、novelty、Attempt contract 或
  Evidence eligibility；Skin 自带的装饰或插图不能冒充 Learning Materialization 资源、教学内容或答案；
- Card、页面与 Deck 都不是资源 identity、Retention Target 或学习聚合；改变 Card 数量、
  阶段拆分或 renderer 不得改变
  Protocol Step 的结果资格、历史事实或 scheduler 语义；
- 被动阅读、播放、继续点击和答案揭示后的立即重答不构成 Learning Evidence；
- 确定性 validator 检查结构事实，语义质量由独立审核负责。

## 12. Delivery profile 与迁移边界

当前 `sensa-package-validator-v3` 是 **Published Structured Acquisition Package** 的兼容合同：它仍以
exactly 1 Experience Sketch、exactly 1 Support-Language Bridge、
3 study + at least 3 quiz Examples、Lexeme pronunciation 和三条 study audio 作为兼容门禁，并
要求 required Boundary 拥有 Relation-backed executable asset。

该 V3 profile 是现有 release 与实现合同，不是 Lightweight Study 或 On-demand materialization 的
通用门禁，也不足以单独证明新 Structured Acquisition Cycle 可用。后续 Structured delivery/validator
必须进一步证明：

- Recognition、Recall 与 novel Transfer 都有可执行资源路径；
- study-seen 与 novel assessment inventory 可确定地区分；
- required Boundary 可以嵌入 Recognition/Transfer 或独立执行；
- Recall grading 能区分错误 Lexeme 与允许的 form/morphology 结果；
- 所有 required capabilities 都有当前 Runtime 支持的 Action role、payload 与 renderer。

若后续启用高保证 Structured Acquisition delivery profile，当前候选要求如下；这些要求属于该
协议的发布门禁，不是首版 Lightweight Study 的上线前置条件，也不是跨版本学习理论：

- standard Package 的 protected novel-Transfer inventory 发布下限为 5 条，生产目标为 6 条；复杂、
  抽象或易混 Sense 可以由 Profile 要求更多，并必须覆盖不同 scenario families；
- Recall 默认以正确 Lexeme identity 为基础结果；合法屈折形式保留 retrieval 成功，派生 Lexeme
  不自动接受，context-specific form realization 独立反馈；
- 首个 Structured profile 不要求 Listening Gate，也不把音频播放、字幕跟随或词级高亮计作毕业 Evidence；
- 首个 Structured profile 不交付影视剧、电视或 YouTube 原声 Attested Usage、synced-media Example Render、词级媒体
  timeline 或相应的外部媒体消歧/授权生产链；这些对象保留在长期领域模型中，但不得进入该
  Structured Required Asset Manifest、renderer coverage 或验收承诺；
- 该 profile 的 Example 继续使用可稳定发布的 reviewed text 与当前获准 static audio；媒体只是呈现资源，
  不增加新的 required capability。

改变门禁应发布新 validator/delivery version 并迁移 release；它不改变 Lexeme、Sense、Example、
Acquisition Gate 或 Encounter 的领域含义。

Semantic Field 和 Free Practice 需要独立、版本化的 field/practice validation profile。它们不能
借用 Acquisition delivery profile 推断“所有四种模式可用”，也不能因自由练习缺失阻止一个
otherwise acquisition-ready Package 发布，除非未来某个明确产品版本把对应 Practice capability
列为该 release 的交付承诺。

Reference Lexicon 同样需要独立的 reference validation profile，验证 provider/license、稳定 IDs、
definition/source provenance、Sense Alignment、Occurrence spans、candidate closure、resolver version、
可见性与 enrichment review。当前 authoring 流程中用于筛选 Sensa Sense 的冻结词典 evidence 只是
生产输入，不等于已经发布的 learner-facing Reference Release；当前 Example 只保证 target span，
也不等于完成了全句 occurrence annotation。

## 13. 发布门禁

Package validator 是不访问数据库、模型、网络或 TTS 的纯函数，返回稳定 status、issue codes、
requirements 与 digest。发布门禁与 Runtime 使用相同版本的 Executable Learning Capability
Resolver，避免“validator 认为能教、Runtime 实际无法检验”。

Resolver 只读取 Package 快照并返回 capability inventory 或稳定失败码；它不读取 learner
progress，也不选择本次具体 Asset。Release、Manifest、Encounter 与重放必须固定 Resolver
version。缺失资源必须如实报告，不能以运行时 fallback、自由生成或伪造媒体通过门禁。


### 2026-09-10 已确认扩展：经验回想内容

轻量学习的经验回想内容用于建立或唤起经验，可以由文字、图片、离线 HTML 互动
或其组合构成；首次学习允许通过互动建立经验。资源可由学习包预先提供，也可
根据已确认的个人内容生成，两种来源遵守同一资源需求与运行时准入规则。

当前必需资源为经验回想内容、目标表达、含义确认、主要声音、经验绑定说明与同场景语言实现。
回想提示、最小使用框架、补充例句与有来源的词源为可选。图片和 HTML 是经验内容的呈现形式，不是新增的
必需角色；没有图片或互动的既有文字资源仍合法。

资源详情应展示实际保存和使用的完整材料，查看不是学习前置确认。用户提供的
图片可以直接成为回忆线索；不要求生成模型重新生成图片。本阶段不加入图片中
目标表达文字的检测、裁剪或遮挡流程。

首版互动允许点击、拖动和状态变化，随资源保存、离线可用，无外部网络能力。
互动只服务于经验建立/唤起，不具有修改正式学习进度、揭示步骤或评分的权限。
