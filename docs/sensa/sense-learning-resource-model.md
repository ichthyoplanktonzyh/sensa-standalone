# Sense Learning Resource Model

> 状态：Canonical resource model  
> 更新日期：2026-08-28

本文定义一个 Sense Learning Package 为建立连接、解决 Required Acquisition Gates、长期复习与
自由练习可以提供哪些资源，并定义 Reference Lexicon、Lexical Enrichment 与 Semantic Field 如何
引用已审核内容。资源不等于卡片；正式 Action 与 Practice Task 分别由版本化 Policy/Profile 从
不可变资源中物化。

## 1. Package identity

Sense Learning Package 固定：

- 一个稳定 Sense 的 Sense Version；
- 其所属 Lexeme 的 Lexeme Version；
- target language 与 learner locale；
- Acquisition Profile 与 Required Capability Set；
- 同一 Content Release 中获准发布的资源引用；
- 可审计的 source、generator、review、omission 和 media provenance。

Release 发布后不可原位修改。语言事实、源文本、媒体或 Required Capability 发生语义变化时，
必须产生新 version/release。

### Package 的概念组成

一个可发布 Package 在领域上组合六类事实，但不要求数据库或传输合同把它们内嵌在一条记录中：

1. **Package contract**：Sense/Lexeme 版本、locale、Acquisition Profile、Required Capability Set
   与发布版本；
2. **Semantic specification**：learner-facing gloss、精确定义、L1 Bridge、核心语义特征、必要
   Usage Pattern 与真实 confusion targets；
3. **Form binding**：通过 pinned Lexeme Version 取得 lemma、IPA、pronunciation 与合法 forms，
   并声明当前 Recall grading 所需的 form 规则；
4. **Teaching inventory**：Experience Sketch、获准的 Experience Renders、Learning Examples 与
   Sense binding/reveal 所需事实；
5. **Assessment and repair inventory**：Recognition、Recall、novel Transfer、条件性 Boundary 的
   可判分资源，以及每个 required capability 的定向 repair 路径；
6. **Governance manifest**：asset role/visibility、source、review、provenance、omission、digest、
   renderer support 与发布门禁结果。

Package 是以上版本化资源的不可变发布清单。它不拥有 learner exposure、Gate progress、Session
顺序或 FSRS，也不把共享 Lexeme facts、Reference Lexicon 或个人内容复制成 Sense 私有事实。

## 2. Lexeme 级共享资源

同一 Lexeme 的多个 Sense 共享：

- lemma、音节、IPA 与合法词形；
- pronunciation audio；
- 不属于单一 Sense 的形态与发音事实。

Package 引用 Lexeme Version，不为每个 Sense 复制词形库存。共享资源不意味着 sibling Senses
共享 Gate、Evidence、Acquisition Cycle 或 FSRS。

## 3. Reference Lexicon 与 Lexical Enrichment

Reference Lexicon 是独立于 Learning Catalog 的宽覆盖查询语料。一个 Reference Release 至少固定：

- source/provider、edition、target language、learner locale、license 与 attribution；
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
Reference Sense 仍可浏览；只有对齐到 stable Sensa Sense 且该 Sense 存在 published executable
Package 时，才可能通过 Curriculum 的 Add-to-Learning decision 加入正式学习。

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
2. 只在候选 Reference Sense IDs 中，结合 `text_l2/context_l2`、审核过的 L1 translation/context、
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
- **L1 Bridge**：用自然中文接住已有概念，并指出 L1/L2 覆盖差异；
- **Learning Example**：拥有 exact target occurrence、Sense Version binding、双语语境与审核
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

Experience Render 单独绑定 Sketch，并声明 renderer kind、获准内容或 media、accessibility/fallback 与
支持的 delivery profile。内容分析可以推荐最合适的媒介，发布流程只接受已审核 Render；Runtime
只能从 Package 已批准且当前客户端可执行的 Render 中选择。更换 text/image/animation/interaction
不改变 Sketch identity、Sense facts 或 Required Capability。

一个 required Sketch 必须在当前 delivery profile 中至少拥有一条可执行呈现路径。未来客户端缺少
首选 renderer 时只能使用 Package 声明的 approved fallback 或诚实 unavailable，不能运行时自由
改写 Sketch。

### Learning Example、Attested Usage 与 Example Render

Learning Example 的语义身份独立于它如何显示。它固定不可变 L2 context、L1 translation/context、
exact target occurrence、目标 Sense Version、source/review provenance 与获准 roles。Study、repair、
review、free-practice 或 assessment 是显式角色；角色不会因某个页面碰巧读取它而改变。

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
  - L1 Bridge 明确它不覆盖所有中文“保持”
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

### Contextual Recognition

Recognition 需要能把 Form-in-context 映射到当前 Sense 的语境与可判定响应。教学时已经完整
展示过的 Example 可以用于首次熟悉语境识别，但不能同时冒充 novel Transfer。

### Meaning-to-form Recall

Recall 可以复用不泄露目标 Lexeme 的 Experience Sketch、minimum sufficient experience 或
经过审核的 Sense cue。允许答案来自 pinned Lexeme Version 的合法 forms；是否要求语境中的
精确屈折由版本化规则决定，语义取回与形态错误必须能被区分。

V1 baseline 默认验证 **Lexeme identity retrieval**：无句法约束的 cue 下，pinned Lexeme Version
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
已见语境只能算 repair/practice，不能伪装成 novel Transfer。V1 不在运行时自由生成考题补池。

### Boundary

Boundary/Contrast/Counterexample 必须依赖可反查的 Sense Relation 与真实 confusion target。
它需要可执行的正反案例或选项，不能用一段说明性 `boundary_note` 冒充可判分资源。

Boundary 是条件能力：没有真实、重要的 confusion target 时，Package 应明确省略，而不是为
统一卡数臆造干扰项。同一个资源可以支持某次 Recognition 或 Transfer 并同时解决 Boundary，
但同一 learner/Cycle 的 familiar Recognition 与 novel Transfer 不能由同一次 Attempt 合并。

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

Curriculum 只能选择已发布、可执行的 Package，不能因 learner 改变范围或从收藏加入学习而生成一份
未审核的临时内容：

- Book Version 固定其有序 Sense membership 与对应 Content Release；Book Range 只从该不可变
  membership 中解析稳定 selection；
- Supplemental Membership 指向 stable Sense，但每个 Study Scope Revision 必须把它解析到一个
  当前可用的 published Package；Session/Encounter 再固定实际使用的 Release、Sense Version、
  Lexeme Version、Profile 与 resources；
- 找不到可执行 Package 时 Add-to-Learning 必须返回 `content_unavailable`，不能从词典释义、draft、
  sibling Sense 或运行时自由生成内容拼出幽灵课程；
- Content Release 更新不改变已经开始的 Session/Encounter；下一 Scope Revision 可以显式解析新
  Package，但必须保留此前 Curriculum provenance 与学习事实。

Free Practice 可以复用 Lexeme form/pronunciation、Sense display facts、Experience、Study Example、
Usage Pattern、Sense Relation 与已获准的媒体，但 Practice Task 必须固定资源版本、asset role 和
实际 target：

- Listening/Reading 的 Sense 练习需要能从声音或文字语境判断目标 Sense；
- Speaking/Writing 的 Sense 练习需要不泄露目标表达的 Sense/experience cue；
- dictation、shadowing 与 read-aloud 可以只训练 Lexeme form 或 pronunciation，不能伪装成
  Sense retrieval；
- contextual production 必须有版本化、可审计的 grading contract；无法可靠判分时只能保存
  activity 或 learner response，不能宣称成功；
- 为 Novel-context Transfer 保留的 assessment-only assets 不得通过浏览、随身听或自由练习暴露。

一个 Package 不因缺少四种 Practice Mode 就无法支持正式 Acquisition。可提供哪些练习由独立的
versioned practice profile/capability inventory 如实报告；缺少 speaking、audio 或 production
grader 时应省略相应模式，而不是生成不可判分的占位任务。

### Initial Free Practice Profile

为避免和当前 Sensa V1 P0 混淆，首个自由练习交付合同称为 **Initial Free Practice Profile**。
它属于 P0 之后的 Later 能力，不改变当前 launch blocker，也不进入 Acquisition Required Asset
Manifest。它定义的资源解析关系是：

```text
Free Practice Profile
        × Package Practice Manifest
        × Runtime / Client capability
        ↓
Executable Practice Capability Inventory
```

- Free Practice Profile 固定允许的 Task families、target/channel/support 组合，以及 renderer、grader、
  fallback 和 resource-role requirements；
- Package Practice Manifest 声明某个 Package 实际具有哪些 approved practice resources；
- Executable Practice Capability Inventory 是两者与当前 Runtime/client support 的版本化交集；
- 缺少 Practice Manifest 或任何 Practice Mode 不能阻止 otherwise acquisition-ready Package 发布。

Initial Profile 只承诺四种边界明确、可诚实实现的 Task family：

| Task family | Practice Mode / channel | 实际 target | 结果语义 | 资源要求 |
| --- | --- | --- | --- | --- |
| Immersive Browse（沉浸刷词） | Reading | Sense / Example | Practice Activity | 获准的 Sense facts、Experience Render、Learning Example 与可选 enrichment |
| Portable Listening（随身听） | Listening | Lexeme / Example | Practice Activity | pronunciation 或 reviewed static example audio；可选文字/译文 |
| Dictation（听写） | Listening → Writing | Lexeme form 或 approved context form | Practice Attempt/Result | 稳定 audio、精确 target form 与 deterministic form grader |
| Quick Spelling（随手拼写） | Writing | Sense → Lexeme retrieval | Practice Attempt/Result | 不泄露 form 的 Sense/Experience cue 与 pinned Recall grading |

Initial Profile 的 Practice Scope 首先支持当前 Book slice 与 learner 明确选择的一组 Senses。Saved
Sense/Example、Semantic Field、Personal Collection 或 history-based Scope 只有在对应
content/persistence/API/Sync contract 已交付时才可加入 inventory；Profile 不根据“薄弱维度”自动
创建强制任务或学习债务。

Initial Profile 明确不提供 Speaking、发音评分、开放式造句评分、AI 对话、运行时自由生成题目、
novel Transfer/Boundary 正式检验、影视/电视/YouTube 原声媒体或 assessment-grade bridge。只有显式
拥有 `free_practice` role 且未被 `assessment_only` 隔离的资源可以进入 Practice Manifest；protected
Transfer inventory 永远 fail closed。

Portable Listening 和 Dictation 不建立 Listening Gate。前者只记录播放、跟随和展开 Activity；后者
只对声音到 Lexeme/context form 的确定性响应产生 Practice Result，不能仅因写对形式而宣称理解了
目标 Sense。Quick Spelling 可以复用 Lexeme-identity Recall grading，但其 Result 仍不解决 Recall
Gate、不进入 5D/FSRS，也不改变正式学习或复习安排。

## 8. Learner-authored personal content

Personal Content 不进入 Content Release，也不成为 Sense Learning Package resource：

- Saved Sense 指向 stable Sense identity，并保留保存时可见的 Sense Version provenance；显示时可以
  使用当前可读版本，但语义重大变化必须可解释，不能把 sibling Sense 当作替代；
- Saved Example 固定 exact immutable Example 与其 release provenance；资源退休、授权失效或不可用
  时显示诚实状态，不能静默替换为“类似例句”；
- Sense Note 与 Personal Semantic Anchor 绑定 stable Sense，内容版本升级不删除 learner authored
  text；每个 learner/Sense 只有一份 current Note，但可以有多个独立 Anchors；
- Personal Collection 只保存指向 stable Sense 或 exact Example 的 typed references 与 learner
  ordering，不依赖 Saved record，也不复制 Package、Example 或 Semantic Field 内容。

Anchor 只有在 learner 明确允许、目标 Sense 一致且 Practice/Action contract 接受 personal scaffold
时才可以被引用。它不能满足 Required Asset Manifest、替代 reviewed Experience、成为 grading key、
构成 novel assessment 或产生 Learning Evidence。Note 默认只供 learner 阅读，不能被 Runtime 当作
语言学事实解析。

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

scene domain、construction、disambiguating cue、collocations 和 variation note 可以帮助选择与质检，
但除非版本化合同明确说明，不能成为跨 Package 的机械配额。

## 10. 运行时派生，而非生产资源

以下事实由 Package、learner history 与版本化 Policy 派生，不应交给生成模型作为独立内容：

- 当前 Gate、Encounter purpose、Action、scaffold 和下一步；
- masked text、答案位置、选项顺序和本次 distractor 组合；
- Example 对该 learner 是 study-seen、assessment-seen 还是 novel；
- cooldown、组内穿插位置与 Session intent；
- Practice Scope snapshot、Practice Task 顺序、scaffold 与本次 mode-specific response contract；
- Learner Semantic Projection 中的 learner status overlay、布局与可视化聚类；
- Attempt、Evidence、Gate progress、5D State、Acquisition Graduation、Memory Outcome 与 FSRS；
- Practice Activity、Practice Attempt 与 Practice Result；
- Declared Mastery；
- Reference search ranking、lookup presentation grouping 与未预计算 occurrence 的临时 candidate order；
- Learner/Device Preference resolution、autoplay、theme、translation default visibility 与 playback behavior。

干扰项若表达真实语义边界，语义内容必须来自已审核 Relation/Boundary 资源；运行时只能决定
确定性的选取和顺序，不能自由编造一个似是而非的相邻 Sense。

## 11. 资源质量不变量

- Experience Sketch 不出现目标英文词或合法变形，也不退化为词典定义；
- Experience Sketch 与 Render 必须分离：Sketch 固定媒介无关的教学意图，Render 固定一种已审核
  呈现；renderer fallback 不得改变目标 Sense 或教学约束；
- L1 Bridge 使用自然中文，明确必要的跨语言范围差异；
- Example 必须自然表达目标 Sense，target form/span 可确定性核验，双语语义一致；
- Attested Usage 必须固定真实 source/rights、exact clip/context、target occurrence 与 approved
  contextual Sense assignment；word-level timeline 必须与 transcript 和 target token 一致；
- 外部媒体 Render 不得成为 Required Gate 的唯一资源路径；不可用时只能使用 approved fallback
  或诚实 unavailable；
- Lexical Occurrence 必须绑定 exact Example + exact span；multiword expression 不得被拆成相互误导的
  单词查询结果；
- Contextual Sense Resolution 只能从 pinned Reference Release 的 closed candidates 中选择；不确定时
  必须保留 ambiguous/unresolved，不得自由生成一个“看起来合理”的义项；
- Reference Sense 与 Sensa Sense 只能通过 reviewed/versioned Alignment 连接，词典条目本身不能成为
  Learner Sense Progress identity；
- root/affix、词源与词族关系必须有来源或明确 review provenance；Etymology Story/Mnemonic Aid 必须
  标记为编辑性支架，不能冒充语言事实；
- Reference 读取只能暴露 `reference_visible` 资产；`learning_only` 与 `assessment_only` 均 fail closed；
- Study 与 novel assessment 使用历史必须可区分；已经揭示的语境不能再声称 novel；
- Transfer pool 必须覆盖多个真实 scenario families；机械改写或重复暴露不能冒充独立迁移素材；
- Recall grading 必须区分错误 Lexeme、合法屈折、派生词与 context-specific form realization；
- Usage Pattern 必须有来源；省略比臆造更正确；
- Boundary 必须指向真实 Relation、target 与 distinguishing feature；
- Semantic Field membership 与 Relation 必须可追溯到同一 release 的稳定 Sense identity；
- Package 必须能支持 Required Capability Set，而不只是满足资源数量；
- Practice Task 必须区分 Sense target、Lexeme-form target 与 Example target；
- free-practice resources 不能泄露 reserved novel-assessment inventory；
- learner-authored Note/Anchor 不能通过 content validator 冒充 reviewed Package asset；
- Learner Preference 只能在 approved alternatives 中选择未来资源，例如可用 accent；找不到匹配项时
  使用版本化 fallback 或诚实 unavailable，不能修改 Package 或绕过 Required Asset Manifest；
- Device Preference 只控制本机呈现；autoplay、译文默认状态、theme、animation 与 playback behavior
  都不能改变 asset role、novelty、Attempt contract 或 Evidence eligibility；
- 被动阅读、播放、继续点击和答案揭示后的立即重答不构成 Learning Evidence；
- 确定性 validator 检查结构事实，语义质量由独立审核负责。

## 12. Delivery profile 与迁移边界

当前 `sensa-package-validator-v3` 仍以 exactly 1 Experience Sketch、exactly 1 L1 Bridge、
3 study + at least 3 quiz Examples、Lexeme pronunciation 和三条 study audio 作为兼容门禁，并
要求 required Boundary 拥有 Relation-backed executable asset。

该 V3 profile 是现有 release 与实现合同，不足以单独证明新 Acquisition Cycle 可用。下一版
delivery/validator 必须进一步证明：

- Recognition、Recall 与 novel Transfer 都有可执行资源路径；
- study-seen 与 novel assessment inventory 可确定地区分；
- required Boundary 可以嵌入 Recognition/Transfer 或独立执行；
- Recall grading 能区分错误 Lexeme 与允许的 form/morphology 结果；
- 所有 required capabilities 都有当前 Runtime 支持的 Action role、payload 与 renderer。

Sensa V1 的下一版 Acquisition delivery profile 进一步固定以下阶段性要求；这些要求属于 V1
发布门禁，不是跨版本学习理论：

- standard Package 的 protected novel-Transfer inventory 发布下限为 5 条，生产目标为 6 条；复杂、
  抽象或易混 Sense 可以由 Profile 要求更多，并必须覆盖不同 scenario families；
- Recall 默认以正确 Lexeme identity 为基础结果；合法屈折形式保留 retrieval 成功，派生 Lexeme
  不自动接受，context-specific form realization 独立反馈；
- V1 不要求 Listening Gate，也不把音频播放、字幕跟随或词级高亮计作毕业 Evidence；
- V1 不交付影视剧、电视或 YouTube 原声 Attested Usage、synced-media Example Render、词级媒体
  timeline 或相应的外部媒体消歧/授权生产链；这些对象保留在长期领域模型中，但不得进入 V1
  Required Asset Manifest、renderer coverage 或验收承诺；
- V1 的 Example 继续使用可稳定发布的 reviewed text 与当前获准 static audio；媒体只是呈现资源，
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
