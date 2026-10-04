# Sense Learning Resource Model

> 状态：Canonical resource model
> 更新日期：2026-09-25

本文定义 Sensa 如何通过 Published、On-demand 或 Hybrid 路径为一个固定 Learning Target 提供学习
资源，以及这些资源如何先形成 Run 的不可变材料基线、再由每个 Step 固定实际呈现的 Learning
Materialization。它同时
定义 Sense Learning Package、Reference Lexicon、Lexical Enrichment 与 Semantic Field 如何引用已
审核内容。资源不等于卡片：Protocol Step 按 material role 引用不可变内容并定义交互与结果资格，
Card Presentation 只把当前 Step 阶段渲染给 learner。正式 Action 与 Practice Activity Definition 由版本化
Learning Policy Profile、purpose-specific Protocol 与其他适用 Policy/Profile 从不可变资源中物化。

在 [ADR 0006](../adr/0006-three-product-systems.md) 的顶层架构中，本文裁决 **Content Supply System**：
它包含内容生产、独立验证、发布、发现、分发、安装和 Materialization，而不只包含 Package 下载。
Learning Policy、Protocol execution、Curriculum membership、learner progress 与 FSRS 始终属于
Learning System；Package 可以声明内容能力和适用范围，但不能携带这些对象的所有权或执行权限。

## 1. Learning content sources 与 materialization

内容来源与 Learning Protocol 是两个正交维度：

- **Published Learning Content**：来自不可变 Content Release，通常由 Sense Learning Package 承载，
  适合复用、离线安装、审核和高保证 assessment；
- **On-demand Learning Content**：在 stable Sense、target expression、Effective Learning Policy、
  Pinned Language Context 与 protocol 已固定
  后按需生成，适合个人语义世界中的长尾目标与轻量学习；
- **Hybrid**：复用 published 语义/词形/例句等基础事实，再为本次 target 补充按需生成的教学材料。

三个入口不能混为一条隐式发布链：

```text
官方策展 / 外部作者 ──▶ Portable Package ──▶ `.sensa` ──▶ 安装 ──▶ Published Materialization

Web 内容生成 Agent ──▶ Candidate ──▶ 独立准入 ──▶ learner-private On-demand Materialization

learner 明确导出 ──▶ 选定内容快照 ──▶ 新 Portable Package ──▶ `.sensa`
```

第一条统一可分发 Lightweight 内容，第二条服务当前 learner 而不自动发布，第三条是显式转换而不是
On-demand 内容的自然副作用。三条路径在 Runtime 前都形成合格 Materialization，但来源 identity、信任
与所有权保持不同。

Learning Entry Provenance 是第三个正交维度。Book、direct stable-Sense 与 personal-first entry 都可以
使用 Published、On-demand 或 Hybrid；来源本身不决定 Learning Policy。personal-first/长尾目标通常
更适合用 On-demand 内容快速满足 Lightweight requirements，而 Structured/high-assurance 只有在
required assessment、novelty、grader 与 runtime capabilities 均真实可用时才可 ready。这是 readiness
判断，不是把 Personal Semantic World 永久绑定到 Lightweight。

无论来源为何，Runtime 都不能直接消费仍可变化的 draft。Run 开始前必须建立不可变材料基线；当前尚未
操作的 Step 可以在固定 Learning Target、Route 与兼容来源内显式改绑新的不可变 Materialization。每份
Materialization 至少固定 target、Effective Learning Policy/plan revision、protocol/version、内容项与角色、
答案/评分合同（如有）、source/generator/prompt-policy provenance、校验结果与 digest。learner 对 Step
作答后不得重新生成并替换该 Step 的 prompt、答案或评分依据；内容更新只能创建新的 materialization。

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
`etymology` 为当前可执行合同中的 bounded optional roles；这不是完整产品目录。未提供的内容
不伪造资源条目，但应区分不适用与适用而未就绪。目录与适用规则见 1.1.1–1.1.5。

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

### 1.1.1 揭示资源目录 v1

已确认 Expression 与 Sense 后，先确定表达资源范围，再准备资源、组织揭示。
不以“先生成固定小包，再由用户申请补充材料”作为产品模型。目录是本版支持的有限类别集合，
未来增加类别需要显式修订目录；不把音标、音节、词性等字段逐一提升为资源类别。

| 类别 | 常见内容 | 内容约束 |
| --- | --- | --- |
| 发音 | 音频、音标、必要的发音提示 | 声音对应准确表达与语言；音标不能代替声音 |
| 释义 | 当前义项、与第一张卡经验的对应 | 固定当前 Sense，不展开成所有字典义项 |
| 用法 | 词性、结构、搭配、语境、必要的形式变化 | 围绕当前义项提供识别和使用所需内容 |
| 例句 | 同场景表达、其他有帮助的实例 | 目标位置与义项明确，不虚构个人经历 |
| 辨析 | 易混表达、意义和使用边界 | 有真实混淆时提供，不强凑近义词 |
| 构词 | 词根、词缀、组合结构 | 解释有依据的现代结构，不任意拆字 |
| 词源 | 来源与历史演变 | 有可靠来源，不冒充现代构词或当前释义 |
| 助记 | 联想、记忆提示 | 明确标为教学辅助，不冒充语言事实 |

目标表达本身是揭示主体，不另列为资源类别。第一张卡的经验内容也不属于这份揭示目录。
AI 学习问答是固定可发现的交互能力，不是第九种预生成资源。文字、图片、音频和互动是呈现形式。
这些面向产品的类别可以包含多个内部 material roles；不要求把现有精确的来源、校验与场景绑定
合同合并成八个无结构文本字段。经验绑定说明归入释义，同场景语言实现归入例句，职责继续保留。

### 1.1.2 表达类型适用矩阵 v1

“常规”表示该表达类型默认适用；“条件”表示满足下节条件才纳入；“—”表示通常不纳入。
矩阵定义候选范围，不表示所有内容已经生成，也不直接定义学习准入的必需项或默认展开项。

| 类别 | 单词 | 短语 | 构式 | 话语表达 | 具体句子 |
| --- | --- | --- | --- | --- | --- |
| 发音 | 常规 | 常规 | 常规 | 常规 | 常规 |
| 释义 | 常规 | 常规 | 常规 | 常规 | 常规 |
| 用法 | 常规 | 常规 | 常规 | 常规 | 条件 |
| 例句 | 常规 | 常规 | 常规 | 常规 | 常规 |
| 辨析 | 条件 | 条件 | 条件 | 条件 | 条件 |
| 构词 | 条件 | — | — | — | — |
| 词源 | 条件 | 条件 | — | 条件 | — |
| 助记 | 条件 | 条件 | 条件 | 条件 | 条件 |

类型按学习对象确定，而不是按空格或是否带句号判断：

- 单词是词汇单位；短语是作为整体学习的多词表达。
- 构式是带固定部分与可替换槽位的模式；例句应展示完整实例。
- 话语表达是有固定交际用途的表达；具体句子是学习该完整句子本身，不自动推导为可泛化构式。
- 同一表面句子可以实现构式或话语表达；使用已接受 Binding 的类型，不因本次想展示什么而改类型。
  表达类型尚未确定时，不默认当成单词、也不擅自扩大范围。

### 1.1.3 适用规则与状态

先按表达类型读取矩阵，再结合准确语言、表达结构和当前 Sense 逐类判定；保留采用的规则版本与
条件判断依据。同样的输入事实和规则应得到同样的范围，不能让生成 Agent 自由决定删增类别。

| 类别 | 条件判定或按类型调整 |
| --- | --- |
| 发音 | 多词对象提供整体声音。构式使用与模式明确关联的完整可朗读实例，不把槽位符号当成正常话语朗读。音标和发音提示按语言选择 |
| 释义 | 保持当前意义焦点与经验连接；具体句子说明整句在场景中的意义，不要求逐词列释义 |
| 用法 | 单词、短语关注组合和限制；构式关注槽位；话语表达关注场合和回应；具体句子仅在有必要解释其结构或使用条件时纳入 |
| 例句 | 同场景语言实现为基线。目标句子已表达该场景时直接复用，不为凑数量再造一句；其他实例有新增教学价值才提供 |
| 辨析 | 有能说明当前义项或用法边界的真实混淆对象时纳入 |
| 构词 | 单词具有可解释且对学习有用的现代构词结构时纳入；不能仅因拼写可切分就判定适用 |
| 词源 | 单词，或具有约定俗成历史的短语／话语表达可进入来源核实；普通临时组合不追溯整段“词源”。未查到来源不等于没有词源或不适用 |
| 助记 | 存在有助于当前表达且不误导意义、发音或结构的记忆切入点时纳入；不为覆盖目录强行创造 |

非单词中的个别词需要构词或词源解释时，可通过词典或学习问答查看；不把组成词的全部资源
递归纳入整句范围。若有经确认的例外教学需求，显式记录类别与理由，不静默突破默认矩阵。

三个判断独立：

1. **适用性**：适用、不适用；缺少判定事实时保留待判定，不以“当前没有资料”代替适用判断。
2. **准备状态**：适用资源尚未准备、准备中、已就绪或受阻；来源缺失、生成失败与校验未通过属于受阻原因。
3. **展示方式**：合格资源是否默认展开、折叠及排列顺序。折叠不会把正式资源变成“补充材料”。

适用范围确定后，预制包与个人生成都按这份范围组织供给。资源可以由不同 provider 分别准备、
缓存或更新，准备时机不改变类别身份。Protocol 的必需材料缺失时阻止进入相应步骤；其他适用材料
缺失时如实呈现可用性，不为让卡片看似完整而编造内容。AI 对话不可替代缺失的必需材料。
新的合格材料形成新版本，遵守既有 Run/Step 的材料固定规则，不改写学习事实。

### 1.1.4 代表性范围检查

以下用于检查矩阵，不意味着示例的所有条件类别都已适用或已有内容：

| 对象 | 类型 | 常规范围 | 条件或排除示例 |
| --- | --- | --- | --- |
| fragile、sustain、borrow | 单词 | 发音、释义、用法、例句 | 辨析、构词、词源、助记分别判断；已有词源资料不证明存在可复用的现代词缀结构 |
| put up with | 短语 | 发音、释义、用法、例句 | 整体发音与组合使用；不按单词的词根词缀拆解 |
| Would you mind if …? | 构式 | 发音、释义、用法、例句 | 明确槽位，用完整实例提供声音；不要求构词和词源 |
| Thanks! | 话语表达 | 发音、释义、用法、例句 | 用法关注交际场合；整体表达可复用在微型对话中，不要求另造同义句 |
| Could I borrow your charger? | 具体句子 | 发音、释义、例句 | 整句可直接作为同场景实例；用法按需要提供，不附每个组成词的全部资源 |

### 1.1.5 AI 学习问答

揭示模块提供学习问答入口，承接目录之外或需要针对学习者具体疑问展开的问题，例如换词比较、
个人场景中的表达、结构解释和造句反馈。它不要求用户先选择资源类别，也不改变固定目录。

对话固定当前 Expression、Sense、语言上下文、当前经验与已采用资源版本；仅使用获准的个人
上下文。主动询问才启动，切换目标不得把旧对话的上下文误用为新目标。离线或模型不可用时
明确显示状态，已准备好的资源仍可阅读，学习流程不以对话为前提。

语言事实按对应来源策略核实；没有依据时保留不确定性，助记明确作为教学提示。回答不是已审核
资源，不自动修改 Sense、资源范围或材料版本，也不产生正式 Evidence、Completion 或调度变化。
问题涉及另一义项时说明区别，不能在当前目标下静默替换 Sense；反复出现的问答需求可以成为
未来目录修订的依据，但一次提问不动态增加类别。

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
binding 与 Content Release。`.sensa-book` 在一个精确 Target/Support Language pair 下固定并一次分发
完整 Book Version；其内嵌 Manifest 固定成员顺序及 Portable Package 的 identity/version，外层摘要固定
整本书的精确字节。它原样包含各个独立 `.sensa`，不是另一种可执行学习内容合同，也不创造新的学习
身份，官方内容仍不能绕过 Portable 公共合同。

**Learning Content Registry** 是不可变、按 digest 寻址的发现快照。一次发布必须先上传并公开验证
所有 `.sensa-book`，再上传新的 Registry Revision，最后才把服务端发现指针提升到该
Revision。已发布 Registry、Book archive、Package artifact 与对象路径都不能原位覆盖；失败时旧 Registry
继续完整可用。Sensa Official、外部作者和私人分享采用同一 Portable Runtime 准入合同；Official 身份、
策展关系和质量等级来自 Registry provenance 或其他独立验证，不由包内字段自报。

发现、安装与加入课程是三个不同动作：

- 客户端可低频后台检查 Registry，并立即展示本机缓存；发现新版不改变课程；
- 下载校验 `.sensa-book` 的 digest、大小、Manifest、全部 `.sensa` 合同和语言方向，并原子保存安装
  候选，不创建 Learning Target 或进度；
- learner 显式“应用更新”后，新的 Book Version 才进入下一 Study Scope Revision；已开始 Session
  不增删 participant；
- 新旧版本保持相同 Sense Version 与 Binding Version 的成员复用同一 Learning Target、Retention
  Target、Evidence 和 FSRS state；纯材料修订通过新的 Package version/materialization 表达。已经操作的
  Step 保留其实际材料；当前尚未操作的 Step 可以显式刷新，后续 Step 读取已应用新版；
- 新增成员只在应用后进入未来 Introduction；删除成员只退出未来 Planning，旧 membership、已经发生的
  Step material fact 与学习历史继续可重放；若 Sense 或 Binding 的语义身份变化，则创建新的 Learning
  Target。Portable/Manifest 是交付载体，不要求为历史回放永久保留每一份完整旧归档。

### 1.6 Portable Lightweight Package

所有可分发的 **Published Lightweight Content** 都以最终、可运行的 Portable Lightweight Package 跨越
生产与分发边界，包括 Sensa Official 策展内容、外部作者内容和 learner 明确导出的内容。`.sensa` 不暴露
Sensa Official 的作者稿、数据库、Target Core、Support Overlay、提示词或生产编排。生产者可以使用任意
工具和内部结构；最终文件必须通过同一公共 Runtime 准入校验。Official 内容可以另行通过更严格质量门禁，
但不能拥有绕过 `.sensa` 的 Runtime 私有入口。

`.sensa` v2 是一个单文件 ZIP 归档，内部是公开的 `package.json` 合同与 `media/<sha256>` 原始媒体，固定
一个 Sense、目标表达和精确 Target/Support Language pair。清单不接受任意媒体路径，媒体文件由摘要寻址；
裸 JSON 与目录只属于作者工作区，不是第二种正式交换格式。归档不携带 learner progress、调度、Evidence、
Materialization、官方 review status 或可执行代码。Portable 文件是 untrusted transport candidate；导入
成功也不自动成为 Published Content 或 Sensa Official 内容，安装与加入学习仍是独立动作。

本地消费遵循 `选择文件 → 只读预览 → 明确安装 → 明确加入学习 → Runtime`。预览不写 Library；安装只
保存可执行内容和来源，不创建 Learning Target；Route 不匹配的包可以保存但不能在当前 Route 加入。
安装后可从保留的公开清单和已冻结媒体确定性重建 `.sensa`，因此生产者的分发权不依赖中心目录。

Portable identity 使用 `packageId + positive integer version`。相同 identity 与相同规范化内容重复导入
幂等；相同 identity 出现不同公开内容时必须拒绝覆盖，生产者应递增 version。新版本只是可安装候选，
不会自动改写当前材料、课程 membership、已开始 Run 或进度。learner 明确应用更高版本后，稳定 identity
继续使用原 Learning Target、Retention Target 与进度，并将新版设为当前材料；已操作 Step 的 material
fact 不改写，尚未操作的当前 Step 可以显式刷新，后续 Step 读取新版。identity 改变则建立新的 Learning
Target，旧 Target 默认保留。Portable 作者自己的 `senseId` 用来稳定编译本地 Sense/Binding identity；若
作者实际改变 Sense 或目标表达语义，应使用新的 identity，而不是借版本号悄悄复用 learner progress。
Package 只是分发载体，Portable v2 不把永久 Package Version 历史或历史内容回放定义为产品合同，也不提供
静默课程降级。

公共准入门禁只检查 Runtime 可执行性、必需角色、引用、媒体、大小、摘要和目标 span 等确定性事实。
经验提示不泄露目标表达、语言自然度、文化边界与编辑质量属于生产者或策展者的质量策略，不属于外部
作者的通用准入条件。信任级别由实际导入来源、签名或 Registry 赋予，不能由文件自报。

Portable v2 允许 `.sensa` 携带可选的 stable Sense/Binding semantic declaration，使同一经认证的官方
target 能跨 Book/Route 复用，并支持从 Personal Learning Scene 建立 Personal Meaning。字段存在本身不
产生语义权威；本地文件导入继续使用 Package-local identity。只有 Registry 对精确 artifact digest 与
publisher namespace 的 attestation 才能使声明作为 Sensa Official fact 使用。普通作者省略这些字段仍可
得到完整 Lightweight Runtime；自报官方 identity 只能作为 untrusted provenance 保存。

Portable 合同的当前字段与命令见
[`content/portable-lightweight-package.md`](../../content/portable-lightweight-package.md)。官方 Core/Overlay
流程必须最终编译到同一公共合同，不能为官方内容保留 Runtime 私有入口。

Web 内容生成 Agent 属于 On-demand Provisioning：它为固定 learner、Learning Target、Route 与 Demand
生成并发布 learner-private Materialization，不因生成成功而自动创建 Package。Personal Learning Scene
同样保持 Personal Content revision。只有 learner 明确选择导出或分享时，系统才把一组符合 Portable
合同的内容快照转换成新的 `.sensa`；导出不会反向把原 On-demand/Personal identity 改写为 Published
Content，也不会携带学习进度。

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
- 对当前 Sense 真正必要的关系、感受、区别或其他经验要素；人物、物体、动作和状态都不是固定必填项；
- learner 应该推断出的当前 Sense；
- 初次 grounding 时必须隐藏的目标 form；
- Render 必须表达和不得表达的内容约束。

Experience Render 单独绑定 Sketch，并声明 renderer kind、获准内容或 media、accessibility 与支持的
delivery profile。LLM-assisted 内容分析可以根据 minimum sufficient experience 与 Acquisition Primitive
推荐最合适的媒介并生成 Render Candidate，发布流程只接受经过确定性校验和内容审核的 Render；
Runtime 不能重新分析 Sense，只能按 Render Plan 从 Package 已批准且当前客户端可执行的 Render 中选择。
更换 text/image/animation/interaction 不改变 Sketch identity、Sense facts 或 Required Capability。

Text Experience Render 是完整的自然语言经验场景：它让 learner 进入或重建一个具体经验，并由此形成
目标推断。场景可以自然地使用人物、物体、动作、状态、关系、感受、时间或空间，但不要求机械地包含
其中任何一类。它不是对 Sketch 的说明、词典定义、图片 alt text、步骤摘要或 Experience Recap。

对于当前具有兼容 Support Language 的 Lightweight Delivery / Acquisition Profile，approved Text Experience
Render 本身就是完整、可执行的经验路径。图片、动画和互动是同一 Experience Sketch 的可选替代呈现
或增强资源；缺少或推迟这些资源，不会使学习包变成不完整或不可用。

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

只有显式版本化，并明确声明不能或不应依赖 Support Language 文字的 Delivery / Acquisition Profile，
才可以把非文字 Render 设为必要条件。“无支持语言学习”“低识字学习”或“儿童视觉学习”可以是未来
此类 Profile 的候选，但它们不会自动成为当前 Profile 的要求或产品承诺。新的 Profile 必须明确声明
能力要求与 fallback，不得静默收紧既有语言路线。

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
- Published Package/Content Release 或 Book Version 的下载不产生课程效果，必须由 learner 显式应用并由
  下一 Scope Revision 接纳；Book 新旧版本中保持相同 Sense/Binding Version 的成员沿用 Retention state，
  被删除成员只退出未来 Planning，已开始 Run 不增删 participant。应用后的兼容 Package material revision
  与 learner-owned Personal Membership revision 都可以在固定 Learning Target、Route 与 Target/Support
  Language pair 内供尚未操作的当前或未来 Step 使用。两种路径都必须保留此前 Curriculum provenance、
  已操作 Step 的 materialization 与学习事实。

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
- Sense Context Note 也绑定 stable Sense，但只是一条私有 text/media annotation。它既不冒充 Personal
  Semantic Anchor，也不成为 Package resource、runtime answer、grading key 或 Learning Evidence；
- Personal Collection 只保存指向 stable Sense 或 exact Example 的 typed references 与 learner
  ordering，不依赖 Saved record，也不复制 Package、Example 或 Semantic Field 内容。

Personal Learning Scene 是 Personal Content 中面向运行时的一层。它在一个 Learning Target + Route 下
保存 current revision 和完整历史；Book 更新不覆盖它，另一个 Route 也不隐式复用它。Protocol 可以把
当前 revision 作为 optional scaffold 呈现，但每次 Action 都必须记录实际使用的 scene revision，过去的
Step 不跟随 current pointer 变化。把 current revision 存入 Personal Semantic World 是另一条显式命令，
它复用 Package 交付的完整 Sense/Expression/Binding semantic snapshots，并建立或更新 learner-owned
Personal Meaning；Package 本身及其 Content Release 保持不变。

Personal Semantic Anchor 只有在 learner 明确允许、Personal Meaning Alignment 已确认、目标 Sense 一致且
Practice/Action contract 接受 personal scaffold 时才可以被引用。它不能满足 Required Asset
Manifest、替代 reviewed Experience、成为 grading key、构成 novel assessment 或产生 Learning
Evidence。Sense Note 与 Sense Context Note 默认只供 learner 阅读，不能被 Runtime 当作语言学事实解析。

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
  面向 learner 的含义呈现与固定 Sense 语义原文分离，必须保持同一 Sense Version 的范围与视角，
  不得把源文字直接重标成另一种语言，也不得以翻译或重述创建新的 Sense 或 Personal Meaning；
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
必需角色；兼容 Support Language 的 approved Text Experience Render 本身可完整满足当前 Profile，
没有图片或互动不构成资源缺失或降级。

资源详情应展示实际保存和使用的完整材料，查看不是学习前置确认。用户提供的
图片可以直接成为回忆线索；不要求生成模型重新生成图片。本阶段不加入图片中
目标表达文字的检测、裁剪或遮挡流程。

首版互动允许点击、拖动和状态变化，随资源保存、离线可用，无外部网络能力。
互动只服务于经验建立/唤起，不具有修改正式学习进度、揭示步骤或评分的权限。


揭示资源先按 1.1.1–1.1.5 的目录与适用规则规划，再准备和展示；不将其中的类别另设为
用户必须申请的“补充材料”。历史词源、现代构词与助记保持不同的事实和校验责任。
