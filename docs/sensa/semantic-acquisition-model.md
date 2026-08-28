# Sensa 语义获取模型

> 状态：Canonical theory model  
> 更新日期：2026-08-28  
> 证据级别：产品理论与可检验假设，尚无真实用户效果结论

本文解释 Sensa 为什么按 Sense 组织学习、首次习得为什么独立于长期保持、Semantic Field 如何
表达有限的意义邻域，以及 Acquisition Gates、五维状态、Lexical Reference 与自由练习通道分别
表达什么。它不规定页面、数据库结构、资源数量或生产 Job。

## 1. 核心学习对象

Sensa 不把学习建模为 `词头 → 中文标签 → 固定题型`。目标是形成可在干扰后双向取回、并能
迁移到新语境的连接：

```text
经验或概念边界 ⇄ 一个具体 Sense ⇄ 可识别、可提取的 L2 词形与声音
```

同一个 Lexeme 可以承载多个 Sense。学习者能理解其中一个意思，不能证明其他意思已经获得；
能在熟悉例句里认出词形，也不能证明换一个语境仍能理解或主动取回。

## 2. 两个时间尺度

### Acquisition：首次习得与重学

新 Sense 仅被揭示一次时，还没有形成足以交给长期调度的记忆。它先进入短期 Acquisition
Cycle，在其他 Sense 的干扰之间完成不同方向的独立检验。长时遗忘后的 Relearning 使用同一
模型，但只重新解决已经暴露的能力缺口。

### Retention：长期保持

只有 Acquisition Graduation 后，FSRS 才开始拥有 due time。FSRS 估计记忆何时需要再次被
检验；它不决定当前检验语义识别、主动提取、迁移还是边界。

这一区分避免把“刚看过答案”误认为长期记忆，也避免让分钟级穿插和天/周级间隔共享一套
含义模糊的状态。

## 3. Acquisition Profile 与 Required Capabilities

Acquisition Profile 是一个 Sense 面向 target language 与 learner locale 的内容诊断。它描述：

- minimum sufficient experience；
- distinguishing features 与真实 confusion targets；
- 需要建立的 form/sound mappings；
- baseline 与条件性 acquisition capabilities；
- 优先、后备 primitives 以及 domain constraints。

Profile 不包含 learner state，不选择当前 Action，也不规定所有 learner 经历相同的媒体或
页面。Required Capability Set 从 Profile 与产品 baseline 推导；Required Asset Manifest 与
Executable Capability Resolver 再证明这些能力在某个 release/runtime 中确实可执行。

## 4. Acquisition Gates

Gate 是 learner-specific 的能力检查点，不是内容资源或固定页面。当前产品理论要求首次毕业
至少覆盖三个互补方向：

| Gate family | 核心方向 | 要排除的假阳性 |
| --- | --- | --- |
| Contextual Recognition | Form + familiar/basic Context → Sense | 只认词头或选择宽泛中文标签 |
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

## 5. 五个诊断维度

| 维度 | 领域含义 | 典型缺口 |
| --- | --- | --- |
| Grounding | 目标 Sense 已连接到足够具体的经验或概念结构 | 只记中文标签，没有语义直觉 |
| Boundary | 能区分该 Sense 与相邻或易混概念 | 理解大致方向，但边界混淆 |
| Form Mapping | Sense 与拼写、声音及合法形式之间可双向连接 | 理解意思却认不出或想不起词形 |
| Retrieval | 在没有直接答案提示时能够取回目标连接 | 阅读时认识，主动回忆失败 |
| Transfer | 能在未见过的真实语境中识别或使用同一 Sense | 只会熟悉例句，换场景失效 |

5D State 是全部历史 Evidence 的可重建诊断投影。它可以帮助 Semantic Policy 选择未来干预，
但不直接承担三种职责：

- 不代替 Acquisition Gate progress；
- 不直接宣告 Graduation 或“掌握”；
- 不决定 FSRS due time。

Gate 回答“当前短期毕业要求是否解决”，5D 回答“长期来看能力结构呈现什么缺口”，FSRS
回答“何时再次检验”。

## 6. 获取原则

1. **先建立语义，再要求独立提取。** Experience、bridge 和 reveal 可以教学，但不产生毕业证据；
2. **提取必须经过干扰。** 同一 Sense 的正式检验之间应穿插其他 Sense，而不是答案揭示后原题重答；
3. **双向连接不可缺一。** 首次习得同时覆盖 Form-in-context → Sense 与 Sense → Form；
4. **至少一次迁移。** 短期毕业前必须在未作为教学材料使用的语境中检验同一 Sense；
5. **边界按需出现。** 没有真实混淆目标时，不为统一卡数制造对立；
6. **词形事实共享，连接按 Sense 学习。** Lexeme 拥有形式，learner progress 属于 Sense；
7. **形态错误不自动等于语义失败。** 规则应区分找错 Lexeme、找对 Lexeme 但合法屈折不合语境，
   以及只回忆出相关派生 Lexeme；V1 默认保留前者的 retrieval 成功并单独反馈 form realization；
8. **只从行为产生 Evidence。** 被动阅读、播放、停留时长和自报理解不构成 Gate pass；
9. **失败触发针对性 repair。** 已发生的事实不清零，连续失败才升级为完整 re-binding；
10. **毕业不是掌握。** Graduation 只表示可以交给长期 Retention 继续验证；
11. **效果主张必须经真实数据验证。** Gate 数量、干扰间隔与题型选择都是可版本化假设。

## 7. Semantic Field 与个人语义投影

潜在 Semantic Space 是解释人类意义结构的理论抽象，不是系统可以直接观察、完整存储或精确
绘制的 learner state。Sensa 工程上只声明有限、可审核的 Semantic Field：同一 Content Release
中由相关 Senses、Sense Relations 与必要的边界说明组成的局部意义邻域。一个 Sense 可以属于
多个 Field；Field 不决定课程顺序，也不构成统一的人类概念 ontology。

Learner Semantic Projection 把 learner 已有的 Sense progress、保存内容、Sense Notes、Personal
Semantic Anchors、Collections 与 Practice Activity 覆盖到这些已发布 Field 上，用于回答“哪些
意义正在形成、已经建立、需要巩固或仍待探索”。它是跨 Sense 的派生读取模型：

- 不能代替任何 Learner Sense Progress、Gate、5D 或 FSRS State；
- 不能把模型距离、图布局或百分比冒充 learner 的真实心理结构；
- 不能因浏览、收藏、写笔记或拖动节点而改变正式学习状态；
- 可以作为语义探索、相邻边界查看和 Free Practice Scope 的入口。

Personal Semantic Anchor 允许 learner 把一个 Sense 连接到自己的真实经历或场景，呼应理论中的
Experience Repertoire，但它只表达 learner-authored association。系统不能据此推断该经历准确
代表目标 Sense，也不能把它当作 Concept Prior、5D State 或成功 Evidence。只有 learner 明确允许
时，Anchor 才能作为后续教学或 Free Practice 的 optional scaffold；它不能充当评分答案或 novel
assessment material。

Saved Sense、Saved Example、Sense Note 与 Personal Collection 只表达关注、创作与组织行为；它们
既不证明 learner 已获得目标意义，也不证明目标仍然陌生。Add-to-Learning 必须是另一个显式意图。

5D 描述一个 Sense 内部的诊断结构；Learner Semantic Projection 描述多个 Senses 之间的已审核
关系及 learner 对这些有限区域的覆盖。两者职责正交。

## 8. 输入、输出与四种练习通道

对于一个具体 Sense，接收与产出的双向连接可以按声音和文字通道展开：

| 方向 | 声音通道 | 文字通道 |
| --- | --- | --- |
| Receptive：Form/Context → Sense | Listening | Reading |
| Productive：Sense/Experience → Form | Speaking | Writing |

听、说、读、写适合作为 Free Practice 的 learner-facing modes，但不是四个新的 mastery dimensions
或统一毕业关卡。Grounding、Boundary、Form Mapping、Retrieval 与 Transfer 可以分别通过多种通道
表现；产品也不要求每个 Sense 机械完成四种模式。

练习动作本身不能证明其语义目标。例如听写通常是 `spoken form → written form`，跟读是
`spoken form → spoken form`，朗读是 `written form → spoken form`；它们可以训练词形或发音，
却不自动证明 learner 已从 Sense 主动提取表达。只有同时固定 prompt channel、response channel、
target capability 与 support level，系统才能准确说明一次 Practice Task 实际练习了什么。

Free Practice 允许 learner 自主选择范围、顺序与支架，因此当前模型把 Practice Attempt/Result
与正式 Learning Attempt/Evidence 隔离。浏览、随身听和跟读可以形成 Activity；可判分的听辨、
口头提取、阅读辨义或书写可以形成 Practice Result，但都不自行解决 Gate、完成 due Review、
修改 5D/phase、消耗 daily-new quota 或调用 FSRS。未来若某类 assessment-grade practice 要进入
正式证据链，必须另行发布显式、可审计的 Policy 与合同，不能静默提升既有 Practice Result。

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

Acquisition Profile 指出需要什么能力；Resource Model 定义可供给这些能力的材料；Executable
Capability Inventory 证明当前版本能执行什么；Runtime Model 定义 Planner 如何穿插 Encounter、
Policy 如何选择 Action，以及 Evidence 如何更新 Gate 与 5D。

Learner/Device Preferences 可以降低呈现摩擦，例如选择口音、译文默认状态、autoplay 或动画，但它们
不是学习理论变量：Preference 不能重新定义 Sense、Required Capability、Gate、Evidence rule、5D
或 FSRS，也不能把播放/展开变成学习成功。未来若允许 learner 选择会改变 assessment 或毕业要求的
模式，必须发布显式、可审计的 learning policy/profile，而不能把它伪装成普通 Settings 开关。

理论模型不能直接要求“固定三条例句”“所有词必须做听音题”“每个 Sense 必须完成听说读写”
或“答错后全部四关归零”。这类选择只能进入明确版本化的 delivery profile、formal runtime
policy 或 practice profile，并接受真实用户数据检验。
