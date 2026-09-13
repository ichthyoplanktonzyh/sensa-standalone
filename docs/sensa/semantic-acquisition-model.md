# Sensa 语义获取模型

> 状态：Canonical theory model  
> 更新日期：2026-09-13
> 证据级别：产品理论与可检验假设，尚无真实用户效果结论

本文解释 Sensa 为什么按 Sense 组织学习，并完整定义高保证的 **Structured Acquisition Protocol**：
它为何把首次习得与长期保持分开、Semantic Field 如何表达有限的意义邻域，以及 Acquisition Gates、
五维状态、Lexical Reference 与自由练习通道分别表达什么。它不规定页面、数据库结构、资源数量
或生产 Job，也不把 Structured Acquisition 规定为所有学习目标的唯一协议。

内容供给、Lightweight Study、Learning Protocol 与 Scheduling Handoff 的上位关系由
[`learning-connection-model.md`](learning-connection-model.md) 裁决。轻量协议可以在不声称通过本文
Gates 的情况下进入长期调度；一旦产品声称 Structured Acquisition Graduation，就必须满足本文约束。

## 1. 核心学习对象

Sensa 不把学习建模为 `词头 → support-language 标签 → 固定题型`，也不把 target-language 形式
直接绑定到一个 support-language 词。
目标是形成可在干扰后双向取回、并能迁移到新语境的连接：

```text
learner 已有或新构建的经验/概念结构
                    ⇅
   Personal Meaning / Anchor / support-language expression
                    ⇅
       一个已确认 Sense ⇄ 可识别、可提取的 target-language 词形与声音
```

这里的经验或概念结构不等于 Support Language 符号。Support Language 中的词、短语或自然语言说明
只是学习者进入已有经验与概念边界的 access path；Personal Semantic Anchor 是 learner 自己建立的
另一条 access path。它们都
不能取代 confirmed stable Sense identity，也不能自动成为目标语言的正确边界。

不同语言共同体可能以不同方式切分、凸显或组合相近经验，因此 Support-Language Bridge 必须允许
表达“一词多义、多词近似、覆盖更宽、更窄、部分重合或没有自然一词对应”。习得目标是把
target-language 形式连接到当前 Sense 所固定的意义边界，而不是记住一个可逆的跨语言等号。

同一个 Lexeme 可以承载多个 Sense。学习者能理解其中一个意思，不能证明其他意思已经获得；
能在熟悉例句里认出词形，也不能证明换一个语境仍能理解或主动取回。

## 2. 两个时间尺度

### Structured Acquisition：首次高保证习得与结构化重学

新 Retention Target 的 Sense 与目标表达仅被揭示一次时，还没有形成足以交给长期调度的记忆。
它先进入短期 Acquisition Cycle，在其他 target 的干扰之间完成不同方向的独立检验。选择
Structured Relearning Protocol 时，
长时遗忘后的 Relearning 使用同一模型，但只重新解决已经暴露的能力缺口。领域还允许不创建
Acquisition Cycle 的 Lightweight Relearning；因此“长期遗忘”不自动等于进入本文模型。

这里的两个时间尺度与三个 Protocol Purpose 是正交的：`initial_learning` 主要处于短期获取，
`retention_review` 处于长期保持，`relearning` 是长期保持中由遗忘触发的恢复 purpose，而不是第三种
记忆时间尺度。Structured Relearning 可以在恢复 Run 内复用短期 Acquisition Cycle，但不创建新的
Retention Target 或 Scheduling Handoff。

### Retention：长期保持

在 Structured Acquisition Protocol 内，Acquisition Graduation 允许创建证据等级明确的 Scheduling
Handoff，之后 FSRS 才开始拥有 due time。其他 Learning Protocol 也可以依其合同创建较弱 basis 的
handoff；它们不能把 Study Completion 冒充本文定义的 Graduation。FSRS 估计一个 Retention
Target 何时需要再次被检验；它不决定当前检验语义识别、主动提取、迁移还是边界。

这一区分避免把“刚看过答案”误认为长期记忆，也避免让分钟级穿插和天/周级间隔共享一套
含义模糊的状态。

## 3. Acquisition Profile 与 Required Capabilities

Acquisition Profile 是 Structured Acquisition Protocol 下，一个 Learning Target 面向 Target Language 与
Pinned Language Context 的内容诊断。它固定 Sense 边界与 target expression，并描述：

- minimum sufficient experience；
- distinguishing features 与真实 confusion targets；
- 需要建立的 form/sound mappings；
- baseline 与条件性 acquisition capabilities；
- 优先、后备 primitives 以及 domain constraints。

Profile 不包含 learner state，不选择当前 Action，也不规定所有 learner 经历相同的媒体或
页面。Required Capability Set 从 Profile 与产品 baseline 推导；Required Asset Manifest 与
Executable Capability Resolver 再证明这些能力在某个 release/runtime 中确实可执行。

## 4. Acquisition Gates

Gate 是 Structured Acquisition 中一种 learner-specific Protocol Checkpoint，不是 Learning Capability
Objective、内容资源或固定页面。Structured Acquisition 的当前
产品理论要求首次毕业
至少覆盖三个互补方向：

| Gate family | 核心方向 | 要排除的假阳性 |
| --- | --- | --- |
| Contextual Recognition | Form + support/basic Context → Sense | 只认词头或选择宽泛的 support-language 标签 |
| Meaning-to-form Recall | Sense → Form | 只会被动认出，不能主动取回 |
| Novel-context Transfer | unseen Context + Form → Sense | 只记住教学例句 |
| Boundary（条件性） | target Sense ↔ real neighbor | 用大致相关代替准确边界 |

初始 Cycle 必须分别取得一次 Recognition、Recall 与 Transfer 的独立成功；熟悉/基础语境的
Recognition 不能与 unseen-context Transfer 合并成同一次 Attempt。条件性 Boundary 可以嵌入
Recognition 或 Transfer，例如一条带真实 `borrow/lend` 干扰项的语境同时解决对应 Boundary。
音频、图片或完形只是可替换的承载方式，不能因为题型不同就自动算作不同能力。

Gate 只能由有效、可判定且不泄露答案的行为解决。揭示后的即时理解检查可以促进加工，但不
算独立成功；repair 后也必须经过其他 Sense 干扰再重测。一个 Gate 的失败只重新打开相关能力，
不删除其他 Gate 或历史 Evidence。

“只重新打开相关 Gate”是当前 Structured Acquisition 的 Progression Policy，而不是 Learning Kernel
对一切 Protocol 的失败语义。其他 Protocol 可以使用自己的 Protocol-local Checkpoints，并声明重置
某个 Checkpoint、一个集合或整个 Run 的当前 credit；任何 Progress Reset 都只改变当前有效进度，
不能删除已经发生的 Attempt、Observation、Evidence 或 Transition history。

## 5. 五个诊断维度

| 维度 | 领域含义 | 典型缺口 |
| --- | --- | --- |
| Grounding | 目标 Sense 已连接到足够具体的经验或概念结构 | 只记 support-language 标签，没有语义直觉 |
| Boundary | 能区分该 Sense 与相邻或易混概念 | 理解大致方向，但边界混淆 |
| Form Mapping | Sense 与拼写、声音及合法形式之间可双向连接 | 理解意思却认不出或想不起词形 |
| Retrieval | 在没有直接答案提示时能够取回目标连接 | 阅读时认识，主动回忆失败 |
| Transfer | 能在未见过的真实语境中识别或使用同一 Sense | 只会熟悉例句，换场景失效 |

5D State 是一个 Retention Target 内全部历史 Evidence 的可重建诊断投影。它可以帮助 Semantic Policy 选择未来干预，
但不直接承担三种职责：

- 不代替 Acquisition Gate progress；
- 不直接宣告 Graduation 或“掌握”；
- 不决定 FSRS due time。

Gate 回答“当前短期毕业要求是否解决”，5D 回答“长期来看能力结构呈现什么缺口”，FSRS
回答“何时再次检验”。

## 6. Structured Acquisition 原则

1. **先建立语义，再要求独立提取。** Experience、bridge 和 reveal 可以教学，但不产生毕业证据；
2. **提取必须经过干扰。** 同一 Retention Target 的正式检验之间应穿插其他 target，
   而不是答案揭示后原题重答；
3. **双向连接不可缺一。** 首次习得同时覆盖 Form-in-context → Sense 与 Sense → Form；
4. **至少一次迁移。** 短期毕业前必须在未作为教学材料使用的语境中检验同一 Sense；
5. **边界按需出现。** 没有真实混淆目标时，不为统一卡数制造对立；
6. **词形事实共享，连接按 Retention Target 学习。** Lexeme 拥有形式；正式进度属于
   learner-specific Sense–target-expression 连接，同一 Sense 的不同目标表达不共享 FSRS；
7. **能力证据分开，调度默认共享。** Recognition、Recall、Transfer 与条件性 Sound 可分别
   产生 Evidence/Gate/5D 投影，但不因题型或 Card 变化就拆分 Retention Target；
8. **形态错误不自动等于语义失败。** 规则应区分找错 Lexeme、找对 Lexeme 但合法屈折不合语境，
   以及只回忆出相关派生 Lexeme；首个 Structured delivery profile 候选默认保留前者的 retrieval
   成功并单独反馈 form realization；
9. **只从行为产生 Evidence。** 被动阅读、播放、停留时长和自报理解不构成 Gate pass；
10. **本 Protocol 的失败触发针对性 repair。** 当前 Gate credit 可以失效，已发生的事实不删除，
    连续失败才升级为完整 re-binding；
11. **毕业不是掌握。** Graduation 只表示可以交给长期 Retention 继续验证；
12. **效果主张必须经真实数据验证。** Gate 数量、干扰间隔与题型选择都是可版本化假设。

## 7. Semantic Field 与个人语义投影

潜在 Semantic Space 是解释人类意义结构的理论抽象，不是系统可以直接观察、完整存储或精确
绘制的 learner state。Sensa 工程上只声明有限、可审核的 Semantic Field：同一 Content Release
中由相关 Senses、Sense Relations 与必要的边界说明组成的局部意义邻域。一个 Sense 可以属于
多个 Field；Field 不决定课程顺序，也不构成统一的人类概念 ontology。

Learner Semantic Projection 把 learner 主动建立的 Personal Semantic World、已有 Sense progress、
保存内容、Collections 与 Practice history 与已发布 Field 组合，用于回答“哪些意义由我建立、
哪些公共连接正在形成、已经建立、需要巩固或仍待探索”。它是跨 Sense 的派生读取模型：

- 不能代替任何 Learner Sense Progress、Gate、5D 或 FSRS State；
- 不能把模型距离、图布局或百分比冒充 learner 的真实心理结构；
- 不能因浏览、收藏、写笔记或拖动节点而改变正式学习状态；
- 可以作为语义探索、相邻边界查看和 Free Practice Scope 的入口。

Projection 的 learner-facing 表达应保留三种来源不同的层，而不是把其中任意一层冒充完整意义：

1. reviewed Experience、Sense specification 与 Sense Relations 提供可审核的意义和边界依据；
2. Support-Language Bridge 与 learner-authored Anchor/Note 提供进入该意义的支持通道，并保持 reviewed 与
   personal provenance 可区分；
3. pinned Lexeme forms、声音及其他 approved language resources 提供目标语言表达。

产品可以把这种关系表现为“target-language 符号锚定在意义/经验地表上”，但“地表”只是读取模型的
表达隐喻，不是新的权威 aggregate、可直接存储的 learner 心理对象或第二份 progress。support-language
文本不能成为节点 identity，target-language lemma 也不能取代 Sense identity；一个 support-language
标签可以通向多个 Senses，一个 Sense 也可以需要多个语言片段或完整场景才能充分接近。

某一 delivery profile 可以只把 Lexeme 的 word form 作为主要 target-language 符号，但领域模型不能把
未来表达压平成一个通用字符串。word/inflected form 仍属于 Lexeme，短语或构式由 Usage Pattern 等 typed
resources 表达，完整句子或 utterance 实现一个场景或命题，并通过 exact occurrence 连接具体
Sense。句子不能仅因含有目标词就被建模为贴在该 Sense 上的同类标签。

Personal Semantic Anchor 允许 learner 把 Personal Meaning 连接到自己的真实经历或场景，呼应
理论中的 Experience Repertoire。Sense 确认后，这条个人来源仍通过 Personal Meaning Alignment
连接目标 Sense，而不是被转换成 reviewed content。系统不能把 Anchor 当作 Concept Prior、5D State、
成功 Evidence、评分答案或 novel assessment material。

### 7.1 Learner-owned semantic construction

Personal Semantic World 允许 learner 从自己的经验世界向目标语言主动建构，而不只回看系统已经
教过的 Senses。只有具备 Context、located Expression、teaching-sufficient stable Sense/Binding 并由
learner 直接接受或其获授权 Agent 委托接受的完整 Personal Meaning 才成为成员；未闭合捕获留在
Intake Inbox，学习历史、浏览、推荐和无权限模型推断都不能自动加入。

这是 personal-first enrichment path，不是 Structured Acquisition、Lightweight Study 或长期 Retention
的前置条件。Book/direct learning 可以从 existing stable Sense + target binding 进入相同 Learning Target，
且不会因此创建 Personal Meaning。

Personal Meaning 是“我在这个 Context 中指的是这个 Expression 的这个 Sense”的稳定个人 identity。
Personal Semantic Anchors 用场景、图像、声音、叙述或动作让它可重新进入；Personal Expression
Anchors 保存其中被定位的 typed forms。Meaning Focus 只在 Context 仍有多个可能 intended Sense 时
把丰富经验收敛到当前关心侧面，可以完全不存在。任何一层都不能单独冒充公共 Sense。

创建路径可以从个人经验或任意语言表达开始。普通 Contextual Sense
Resolution 足以确定教学所需 Sense 时直接走快轨；只有它不足时，LLM 才通过 Sense Construction
帮助 learner 提炼 optional Focus、识别同一场景的多个可能焦点、提出边界问题，并生成 Sense
Proposal。该过程不是从封闭公共 Sense 库中选择唯一答案；现有 Sense 检索只是一种可选复用与治理
手段。

Sense Proposal 仍是 suggestion。只有有效 direct/delegated Semantic Acceptance 后，系统才创建
stable Sense identity、初始 Sense Version 与 Personal Meaning Alignment。Acceptance 保存原始 Context、
Expression、grant/actor 和全部 provenance；后续相似性发现只能建立 equivalence、overlap、
broader/narrower 或对比关系，不能静默改写已经确认
的语义边界。确认对话、模型置信度和接受按钮都不构成 Acquisition Evidence。

同一个经验可以产生多个 Meaning Focus，例如一次借伞事件中的接收视角与给予视角。一个语言表达
也可以通向多个 Senses，多个语言片段则可以共同接近一个 Sense。系统必须允许拆分、保留重叠和
承认没有自然一词对应，不能生成跨语言翻译等号。

个人建构与正式学习保持显式边界：提交完整 Personal Meaning、编辑 optional Focus/Anchor、接受
Sense resolution、确认 Sense Expression Binding、提交 Add-to-Learning Intent 和准备学习内容是不同
意图。前四者都不会创建 Curriculum Membership、Learner Sense Progress、Learning Protocol Run、
Evidence、5D 或 FSRS Memory
State。Add-to-Learning 可以先接纳 stable target 与合法 Learning Policy Assignment；只有后续 Resolved
Learning Plan 为当前 purpose 解析出合法 Protocol、published/on-demand/hybrid provisioning path 与
Learning Materialization，并达到 `ready` 后，Unified Planner 才能把它纳入正式学习运行。

完整对象、确认门、多语言边界和代表性旅程由
[`personal-semantic-world-model.md`](personal-semantic-world-model.md) 裁决。具体运行固定一条
Language Learning Route 与 Pinned Language Context；任何交付版本对语言组合的限制都不能成为
长期领域模型中的一对一翻译约束。

Saved Sense、Saved Example、Sense Note 与 Personal Collection 只表达关注、创作与组织行为；它们
既不证明 learner 已获得目标意义，也不证明目标仍然陌生。Add-to-Learning 必须是另一个显式意图。

5D 描述一个 Sense 内部的诊断结构；Learner Semantic Projection 描述多个 Senses 之间的已审核
关系及 learner 对这些有限区域的覆盖。两者职责正交。

## 8. 输入、输出与四个 Practice Area

对于一个具体 Sense，接收与产出的双向连接可以按声音和文字通道展开：

| 方向 | 声音通道 | 文字通道 |
| --- | --- | --- |
| Receptive：Form/Context → Sense | Listening | Reading |
| Productive：Sense/Experience → Form | Speaking | Writing |

听、说、读、写是 Free Practice 的四个 learner-facing **Practice Area**，不是四个引擎、mastery
dimensions、分数或统一毕业关卡。Grounding、Boundary、Form Mapping、Retrieval 与 Transfer 可以
通过多种通道表现；产品也不要求每个 Sense 机械完成四个 Area。跨通道活动只选择一个主要 Area，
并另外声明实际 stimulus/response channels，避免同一个活动在导航中重复出现。

Practice Area 只组织入口，真正可扩展的教学单元是 Practice Activity Definition。它必须诚实固定
主要 Area、stimulus/response channels、typed target、practice purpose、所需资源、支架、交互、
反馈与 session policy。听写、跟读或朗读之类的表面动作并不能自行证明语义目标：它们可以训练形式、
声音或 articulation，却不自动证明 learner 已从 Sense 主动提取表达。

Free Practice 的目的是真实使用、泛化、尝试与即时反馈，而不是证明课程目标已经达成。Practice
Turn 可以形成 Practice Observation、Feedback 与 learner-owned Artifact，其中也可以包含正确性判断
或分数；这些事实的权威边界始终停留在 Free Practice 内，不能解决 Gate、完成 due Review、修改
5D/phase、消耗 daily-new quota、创建 Memory Outcome 或调用 FSRS。Free Practice **永不产生 Learning
Evidence**；如果未来需要把某种行为用于正式评价，应建立独立的 Learning Protocol/assessment
operation，而不是升级、回填或重解释既有 Practice 事实。

## 9. Lexical Reference 与理解记忆支架

在真实语境中阅读例句时，学习者会遇到当前目标以外的陌生表达。Contextual Lookup 的理论作用是
降低这种 incidental comprehension friction：学习者不必离开当前语境，在需要时可以看到完整词典
条目，并在解析可靠时知道“本句中”更可能使用哪个 Reference Sense。它是学习者主动调用的参考
支架，不是 Planner 安排的任务，也不暗示所有可点击词都应进入正式课程。

Sensa 区分三种事实：

- Reference Sense 是词典来源对意义的划分；
- Sensa Sense 是经过课程筛选、能够拥有 Package 与进度的学习身份；
- Contextual Sense Resolution 是对某次 occurrence 的版本化解释，可能可靠，也可能 ambiguous 或
  unresolved。

这一分离避免把“词典里存在一个意思”“这句话可能用了这个意思”和“用户正在学习这个意思”混成
同一判断。浏览完整词典、点词、播放发音或阅读构词词源只表示 exposure；除非另有独立、可判定的
正式 Action/Attempt，它们不产生 Evidence、不解决 Gate，也不改变 5D 或 FSRS。

root/affix、词源、词族关系与记忆辅助可以增加 elaboration，为词形、概念和已有知识提供更多可取回
线索，但它们不是所有词都适用的必修机制：

- 构词透明且来源可靠时，Morphological Analysis 可以帮助理解 form–meaning connection；表面相似
  或历史上已不透明时，强拆反而制造错误模型；
- 词源可以解释某些现代意义和词族关系，但历史来源不等于现代 Sense definition；
- Etymology Story 与 Mnemonic Aid 可以提高可记忆性，但必须标记为编辑性支架，不能冒充语言真相；
- 学习者可以展开或忽略这些内容；系统不把“看过词源”“完成构词模块”建模为维度、Gate、每日
  待办或学习债务。

因此，Lexical Reference 扩大的是自主理解的可用空间，不是正式学习路径的强制长度。真实产品数据
可以检验哪些 enrichment 被使用、是否减少退出或查询成本，但不能仅凭展开率声称学习效果。

## 10. 与资源和运行时的关系

Learning Connection Model 先决定目标、内容供给与协议目的；当选中 Structured Initial Learning 或
Structured Relearning Protocol 时，Acquisition Profile 指出需要什么能力，Resource Model 定义可
供给这些能力的材料，Executable Capability Inventory 证明当前版本能执行什么，Runtime Model 定义
Protocol Step 如何组织材料、Planner 如何穿插 Encounter、Policy 如何选择 Action，以及 Evidence
如何更新 Gate 与 5D。Card Presentation 只负责渲染当前 Step，不属于本文的 Gate、Cycle 或 learner
progress identity。

Learner/Device Preferences 可以降低呈现摩擦，例如选择口音、译文默认状态、autoplay 或动画，但它们
不是学习理论变量：Preference 不能重新定义 Sense、Required Capability、Gate、Evidence rule、5D
或 FSRS，也不能把播放/展开变成学习成功。learner 选择会改变 assessment 或毕业要求的模式时，必须
使用显式、可审计的 Learning Policy Profile 与 Assignment；高保证 Profile 解析到 Structured
Acquisition，轻量 Profile 解析到其他 purpose-specific Protocol，二者都不能伪装成普通 Settings 开关。

Profile 切换不会修改已开始 Cycle 的 Required Gate Set，也不会把既有轻量 Study Completion 升级成
Acquisition Graduation。若当前 target 的高保证资源或 runtime capability 不足，Resolved Learning Plan
必须 blocked。第一次正式 Protocol Run 前，learner 只能通过显式 Policy Assignment revision 选择另一
保证级别；Run 创建并形成 Committed Learning Policy 后，普通 Assignment 不再可改，未来只能通过
Learning Connection Model 定义的显式 Learning Policy Migration 建立新版本。MVP 不提供该迁移。

理论模型不能直接要求“固定三条例句”“所有词必须做听音题”“每个 Sense 必须完成听说读写”
或“答错后全部四关归零”。这类选择只能进入明确版本化的 delivery profile、formal runtime
policy 或 practice profile，并接受真实用户数据检验。
