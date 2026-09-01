# Sensa 个人语义世界模型

> 状态：Canonical domain model
> 更新日期：2026-08-31

本文定义个人意义、经验与表达锚点、LLM 语义访谈、按需 Sense 构造和确认后的学习边界。
统一术语以 [`../../CONTEXT.md`](../../CONTEXT.md) 为准；聚合所有权、资源发布和运行行为分别由
[`production-architecture.md`](production-architecture.md)、
[`learning-connection-model.md`](learning-connection-model.md)、
[`sense-learning-resource-model.md`](sense-learning-resource-model.md) 与
[`learning-runtime-model.md`](learning-runtime-model.md) 裁决。

## 1. 核心命题

Sensa 不把人的意义建模为词的附属定义。对 learner 而言，最先存在的是自己的意义/经验结构；
L1 与 L2 中的词、短语、构式或句子都是进入、唤起或表达它的符号锚点。正式学习是让一个已经
确认的意义区别与目标语言表达建立稳定连接的一种方式，而不是个人意义存在的前提或唯一用途。

个人内部的完整意义结构不可被系统直接观察。Sensa 只保存 learner 主动外化的有限事实，并明确
区分三种身份：

```text
Personal Meaning：这个人明确选择保留的“我指的是这个”
Sense：语言共同体可以重复辨认和表达的稳定意义区别
Expression：某种语言中实现或接近该 Sense 的具体符号形式
```

三者不能相互替代。个人经历不自动成为公共语义事实，Sense 不等于某个词，词与词之间也不因
翻译关系形成可逆等号。

## 2. 个人语义世界的组成

Personal Semantic World 只包含 learner 明确创建的 Personal Meanings。浏览、学习历史、模型推断、
收藏或推荐都可以产生创建建议，但不能静默增加成员。

```text
Personal Semantic World
└── Personal Meaning
    ├── Meaning Focus
    ├── Personal Semantic Anchor[]
    ├── Personal Expression Anchor[]
    └── Personal Meaning Alignment[] ──▶ Sense
```

### Personal Meaning

Personal Meaning 是稳定的 learner-owned identity，表示 learner 主动选择保存的某个意义或经验焦点。
创建入口可以来自一段经历、图片、声音、一个想表达却不会表达的意思、一个 L1 表达或一个遇见的
L2 表达。入口不决定最终 Sense，也不决定是否进入正式学习。

删除或修改锚点不能悄悄替换 Personal Meaning identity。Sense 对齐、学习开始或内容更新也不能覆盖
它的原始个人来源。

### Meaning Focus

Meaning Focus 说明 learner 当前从一段经验中真正关心的侧面。同一经历可以支持多个 Focus，例如
同一次借伞事件可以分别聚焦“暂时取得他人物品”和“暂时把物品交给他人”。拆分 Focus 不需要复制
原始经历；一个过宽 Focus 也可以在后续对话中显式拆分。

### Personal Semantic Anchor

Personal Semantic Anchor 用文本、图片、音频、场景、动作、感受或其他受支持媒介，让 Personal
Meaning 可以被 learner 重新进入。它说明“这个意义对我如何有根”，不是标准例句、语言学事实、
评分答案或成功 Evidence。同一素材可以被多个 Meaning Focus 复用，但每个连接必须说明当前焦点。

### Personal Expression Anchor

Personal Expression Anchor 是带类型和语言的个人符号锚点。它可以是熟悉语言或目标语言中的词、
短语、构式、句子或话语策略，并保存 learner-authored、LLM-suggested 或 reviewed provenance 以及
verification status。它表达接近、唤起或候选实现关系，不自动证明两个语言表达等价。

## 3. 公共 Sense 的含义

“公共”不表示 Sense 必须预先存在于一个封闭数据库，也不表示所有人必须共享一个唯一概念本体。
它表示该意义区别在脱离原始私人对话后仍然可被理解、引用、比较、复现和版本化，并能判断新的
场景或表达是否属于其边界。

“公共”也不表示 learner 的经历会被公开。Sense Version 只保存从对话中抽象出的可复现语义边界；
姓名、图片、录音、原始叙述和其他 Personal Anchors 继续属于 learner，除非另有独立、明确的共享
授权，否则不能进入公共 Sense 或公共学习资源。

Sensa 采用按需 Sense Construction：LLM 根据 learner 的经验、Focus 和对话提出 Sense Proposal；
learner 明确确认后，系统才创建稳定 `senseId` 与初始 Sense Version。系统不要求先从完整公共
Sense 库中选中已有条目。

一个可确认的 Sense Proposal 至少应表达：

- 核心意义焦点；
- 原型场景以及必要的参与者、状态、方向或因果关系；
- 包含与排除边界；
- 容易混淆的相邻意义及关键区别；
- 在目标语言中的主要词、短语、构式或其他自然表达；
- 提议来源、生成 provenance 和仍待 learner 确认的部分。

LLM 只给出一个 L2 单词不构成 Sense Proposal。词是 Sense Expression Binding 的一端，不是 Sense
identity；一个词可以承载多个 Senses，一个 Sense 也可以由多个表达实现。

## 4. LLM 语义访谈

Sense Construction 不是普通的句中词义消歧，而是发现 learner 在一个可能同时包含多个意义的
经验里真正想保留哪个焦点。LLM 扮演语义访谈者和 Sense 导航器，承担：

1. 从非结构化文本、媒介和个人叙述中提出可修改的 Meaning Focus；
2. 识别同一场景中的多个可能焦点，并在必要时建议拆分；
3. 生成少量 Sense Proposals 与目标语言表达；
4. 根据候选边界提出有区分力的问题，而不是只要求 learner “再详细说说”；
5. 解释为什么匹配、为什么可能不匹配以及相邻意义的区别；
6. 在 learner 说“都不是”时继续澄清，而不是为了完成流程强行选择。

LLM 不能替 learner 决定他真正关心什么，不能把建议静默升级为确认，不能用模型置信度制造
Learning Evidence，也不能在确认后原位改写已有 Sense Version。

## 5. 确认门与生命周期

```text
个人经验或表达
      ↓ learner 明确创建
Personal Meaning
      ↓ learner 与 LLM 澄清
Meaning Focus + Sense Proposal
      ↓ learner 明确确认
Sense identity + Sense Version + Personal Meaning Alignment
      ↓ 独立的 Learning Target / Content Provisioning
Retention Target + Learning Materialization + Learning Protocol
      ↓ 独立的 Add-to-Learning Intent
Curriculum / Initial Learning Protocol Run
      ↓ successful Initial Learning Completion
required Scheduling Handoff
```

每一步都是不同意图：

- 创建 Personal Meaning 只改变 Personal Semantic World membership；
- 接受 Meaning Focus 只确认 learner 当前关注的方面；
- 确认 Sense Proposal 才创建稳定 Sense 与 Personal Meaning Alignment；
- 确认 L2 表达只建立或接受 Sense Expression Binding；
- 生成例句、对比、发音或练习资源不等于已发布，也不等于已经形成可执行 Materialization；
- Add-to-Learning 才请求进入正式 Curriculum；
- 上述任何对话、确认、播放或浏览都不产生 Learning Evidence。

Sense 确认是丰富流程的稳定起点。例句、搭配、边界辨析、Experience Sketch、Assessment、Repair、
Lightweight Study、Structured Acquisition 与 Retention 都必须引用稳定 Sense Version，不能只引用
原始聊天文本、个人节点标题或某个 L2 字符串。确认后的学习内容既可以来自 published Package，也
可以由 LLM 按需生成并在校验后冻结；两者的协议边界由学习连接模型裁决。

## 6. Sense 的按需增长与复用

Sensa 不把建设穷尽式 Sense 库作为个人创建的前置条件。确认后可以在后台检查已有 Senses：

- 没有相近项时保留新 Sense；
- 高度相近时可以建议复用或建立 `equivalent` 关系，但不得覆盖 learner 已确认的边界；
- 部分相似时建立 `broader`、`narrower`、`overlaps` 或真实对比关系；
- 后续审校可以发布新版本、拆分或建立关系，但不物理抹除原始 identity 与 provenance。

相似度检索与去重是治理优化，不是 Sense Construction 的真理来源或交互阻塞条件。由此形成的是
随真实使用生长、可逐步审校的公共语义网络，而不是要求预先完成的词典本体。

## 7. 任意 L1/L2 的长期模型

L1 与 L2 是 learner 在一个学习目标中的相对角色，不是语言自身的固有属性。Personal Meaning 可以
连接任意数量、任意语言的 Personal Expression Anchors，并可与多个语言共同体中的 Senses 对齐。

```text
Personal Meaning
├── 熟悉语言表达：L1-a, L1-b, ...
├── target-language Sense：L2-a
│   └── word / phrase / construction / utterance
└── target-language Sense：L2-b
    └── word / phrase / construction / utterance
```

一个熟悉语言表达可以通向多个目标语言 Senses，多个熟悉语言表达也可以共同接近一个 Sense。
同一个 Personal Meaning 面向多个 L2 时，各目标语言按照自己的共同体边界产生独立 Sense 对齐；
只有边界足够一致时才复用同一跨语言 Sense 关系。不同目标语言的正式学习进度保持隔离，不能因
learner 已掌握其中一种语言的表达而推断另一种已经学会。

正式长期记忆还要在 Sense 之下继续按 target expression 隔离。一个 Personal Meaning 若对齐
某 Sense，而 learner 又选择分别学习 `buy` 与 `purchase`，这两条 Sense Expression Bindings
产生两个 Retention Targets；它们可以共享 Personal Meaning、Sense boundary 和一部分内容，但不共享
Protocol Run、Evidence 或 FSRS Memory State。Recognition、Recall 等能力默认是每条 Retention Target
内部的不同证据视角，不因 Card 不同而另建记忆身份。

## 8. 中文 L1、英语 L2 的首版边界

首版产品固定 familiar language 为中文、target language 为英语：

- learner 可以从中文描述、中文表达或个人经验开始创建 Personal Meaning；
- LLM 主要用中文进行语义访谈，生成可由 learner 理解和修改的 Sense Proposal；
- 每个待进入学习的确认 Sense 必须给出至少一个自然的英语 word 或 typed expression candidate；
- 中文表达只作为熟悉入口，不成为英语 Sense identity 或 assessment answer；
- 英语词形、短语和构式保持 typed identity，不压成无来源字符串；
- 首版不提供语言角色切换或同时学习多个 L2，但持久化 identity 与领域关系不得依赖
  `Chinese = English` 的一对一结构。

具体支持哪些富媒体 Anchor、表达类型和实时生成能力由版本化 delivery profile 与客户端能力决定，
不能反向缩窄这里的长期领域模型。

## 9. 代表性边界场景

### 一次借伞，两个 Meaning Focus

同一段“对方把伞给我、之后归还”的经验可以被两个 Focus 复用。聚焦接收方向时，LLM 可以提出与
英语 `borrow` 对应的 Sense；聚焦给予方向时，可以提出与 `lend` 对应的 Sense。系统不得把中文
“借”直接等同于其中任一个，也不得为了保留单节点而混合两个正式学习目标。

### 一个 Focus，多个相邻候选

“表达真实意见但不让对方难堪”可能接近 `tactful`、`diplomatic` 与 `considerate`。LLM 应通过
边界问题帮助 learner 确认当前最在意的 Sense；其他候选可以作为相邻或重叠关系保留，不能被合并
成一个宽泛学习目标。

### 暂时没有合适表达

Personal Meaning 可以长期保持未确认 Sense 或没有自然的一词表达。系统可以继续使用短语、构式
或完整说明作为候选，也可以等待后续澄清；不得为了继续学习流程而伪造一个确定对应。

## 10. 不变量

- 只有 learner 的显式创建行为才能增加 Personal Semantic World membership；
- Personal Meaning、Sense 与 Expression 保持不同 identity；
- LLM 提议不是 learner 意图，learner 确认不是学习成功；
- Sense 可以按需生成，不依赖穷尽式预建库，但确认后必须拥有稳定 ID 与不可变版本；
- Sense revision、split、equivalence 和 overlap 必须显式、可追溯，不能静默改写已引用边界；
- 同一经验可支持多个 Focus，同一 L1 表达可通向多个 L2 Senses；
- 正式记忆身份是 learner-specific Sense–target-expression 连接，不是 Personal Meaning、
  Sense 本身或 Card；
- Personal Anchors 不成为 reviewed content、评分答案或 Learning Evidence；
- 创建公共 Sense 不公开 Personal Meaning、原始对话或任何 Personal Anchor；
- 没有稳定 Sense 的个人内容不能进入正式 Curriculum；
- 没有合法 Learning Materialization 与可执行 Learning Protocol 的目标不能进入正式 Learning Runtime；
- Personal Semantic World 的布局、距离和区域不宣称是 learner 大脑的真实结构。
