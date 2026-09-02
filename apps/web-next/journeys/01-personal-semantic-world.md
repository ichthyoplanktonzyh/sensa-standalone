# Canonical journey 01：个人词义世界形成 Learning Target 的语义基础

> 状态：Frozen
> 冻结日期：2026-09-02
> 权威范围：`web-next` 的 Personal Semantic World、Sense Construction、Expression Binding 前端叙事

## 1. 旅程结果

这条旅程把连续、私人、尚不稳定的经验结构，逐步澄清成可复现的 Sense，并确认目标语言如何表达
这个 Sense：

```text
具体经验 / 熟悉表达
→ Personal Meaning
→ Meaning Focus
→ Sense Construction
→ Sense Proposal
→ learner 确认
→ stable Sense + immutable initial Sense Version
→ Personal Meaning Alignment
→ Expression Binding
→ 可作为 Learning Target 语义基础的稳定 Sense Expression Binding
```

旅程的完整结果不是一个孤立单词，而是稳定的 `Sense Version + typed Sense Expression Binding`。
它说明“学习哪个意义—表达连接”，但还没有表达“加入学习”。

## 2. 入口与创建

用户从“我的词义世界”创建 Personal Meaning。创建至少需要以下一项：

- 一个熟悉表达；
- 一段具体经验、场景或经历。

目标语言表达不是创建前提。创建后立即获得稳定 `personalMeaningId`：熟悉表达成为 Personal
Expression Anchor，经验成为 Personal Semantic Anchor。Anchors 可以继续修订，但不能替换 Personal
Meaning identity，也不能自动推进 Focus、Sense 或 Expression confirmation。

Personal Meaning 可以无限期保持未澄清；退出、暂停或没有合适表达都不是错误状态。

## 3. 页面叙事

### 3.0 展示层级

领域事实可以复杂，页面叙事必须保持单线。每个页面只突出当前用户问题和一个主动作：

```text
世界首页：我要从哪个经验开始，已经形成了哪些表达？
→ Personal Meaning：我现在处理哪个 Focus？
→ Focus workspace：模型是否已经准确理解这个意义侧面？
→ Confirmed Sense：稳定下来的意思是什么？
→ Expression Binding：哪个表达以什么关系覆盖这个 Sense？
```

- 领域边界文案只在发生确认的关口出现，不能在每张卡片和每个页面尾部重复教学；
- exact identity、provenance、完整 semantic spec 属于可读取事实，但默认进入次级或展开详情；
- 状态必须忠实于双轴 projection，但总览优先表达“下一步”，不把所有 phase 同时做成视觉主角；
- 世界首页按“创建经验 → 继续形成 → 我的表达”组织；完整 Meaning 清单与图谱属于辅助浏览；
- 一屏只保留一个主要行动，返回、暂停、查看技术详情等作为次级行动；
- 不以过小字号、重复英文眉题或大段说明制造领域专业感，优先保证可读性和页面呼吸感。

### 3.1 Personal Semantic World

世界页是个人意义的总览和继续入口，不是学习进度页。清单、展开卡片和图谱读取同一个 world item
projection，并保留两条互不替代的轴：

| 轴 | 可见阶段 |
| --- | --- |
| Sense Formation | 尚未形成 Focus / Focus 待确认 / 澄清中 / Proposal 待确认 / Sense 已确认 |
| Expression Binding | 尚不可开始 / 待绑定 / 部分已绑定 / 已绑定 |

“Sense 已确认但没有 Binding”必须显示为 `Sense 已确认 + 待绑定`。图谱位置只表达事实关系，不是
第三条状态轴，也不能显示 learned、mastery、复习时间或 FSRS 状态。

世界首页必须同时表达这条旅程的输入、过程与结果：

1. 主入口进入稳定语义材料编辑区；learner 可以提供经验、已知 Focus、对 Sense 的理解或
   已想到的 Expression，材料成熟度不得被固定页面阶段限制；
2. “保存材料”与“进入 AI 澄清”是两个明确意图。保存只创建或修订 Personal Meaning/Anchors，
   不调用模型；只有 learner 明确进入 AI 澄清时才开始模型会话；
3. “正在形成”只列出仍需确认 Focus、澄清 Sense、确认 Proposal 或 Binding Expression 的内容，
   每项突出下一步动作；
4. “我的表达”只读取 confirmed current BindingVersion，并明确展示 expression、对应 Sense 与来源
   Personal Meaning。Proposal candidate 不得进入该列表。

Expression 列表是稳定 Binding 的读取 projection，不是新的 Expression identity，也不是 Learning Target
列表。“可加入学习”只说明它已具备后续旅程所需的语义基础；在 learner 显式 Add-to-Learning 前仍不
创建任何学习事实。

### 3.2 Stable material editor

材料编辑区是 learner-owned 的稳定输入面，不是聊天框。它允许从任意成熟度进入，长期支持文字、
图片与语音等多模态 Anchors；MVP 可先以文字材料与熟悉表达入口验证该边界。保存后材料可以稳定
留在世界中，不要求 learner 必须立即开始对话。

### 3.3 AI clarification workspace

AI 澄清使用独立界面，负责：

- 读取一份已保存的材料快照，并允许返回修改材料；
- 让 learner 与模型进行开放的文字多轮对话，而不是填写固定问题或依次打开阶段页；
- 模型在对话中持续更新 Focus、Sense 与 Expression 候选，但不替 learner 确认；
- learner 显式接受 Focus revision 后，在同一段对话中继续澄清 Sense；
- 在模型确有信息缺口时回答有区分力的问题，也允许 learner 主动补充例子、反例、理解或表达；
- learner 确认 Sense 时，把本轮完整对话落为 Construction 与 Proposal 依据，再形成确认事实。

界面始终并列展示三个可独立收敛的事实：Focus、Sense 与 Expression Binding，每个事实只能显示
`待形成 | 有候选/待确认 | 已确认`。这是事实收敛状态，不是强制 Wizard 步骤。

一个经历可以拆成多个 Focus。Sibling Focus 共享 Personal Meaning 与 Anchors，但保持独立 identity、
revision、acceptance、Construction、Proposal 和 Alignment。

Sense Construction 是 LLM 主导的协作过程，不是要求 learner 手工填写 semantic specification 的表单。
模型负责从 Anchors、Focus 和已有对话中形成 prototype scene、included/excluded cases、neighbor
contrasts、open questions 与候选表达：

```text
信息充分 → 模型直接形成 Sense Proposal
信息不足 → 模型只提出当前最有区分力的问题 → learner 回应 → 模型重新判断
```

澄清轮次必须是自适应的 `0..N`，不能把固定题数或“由 learner 自己定义边界”写进页面或 API 契约。
页面以完整消息流和自由输入框作为主界面。每次 Agent turn 都接收材料快照、完整消息历史与已经确认的
事实，并返回一条自然语言回复以及当前最新事实提议。事实轨道是对话的伴随结果，不能取代对话成为
新的 Wizard。完整 semantic spec 与生成 provenance 进入次级详情。

learner 点击“就是这个侧面”可以在一次明确意图中先建立 Focus revision、再记录独立 Acceptance fact；
模型提议本身仍不能代替 Acceptance。Focus 确认后对话原地继续，不重新开会话，也不增加独立过渡页。
确认 Sense 后直接进入 Confirmed Sense 结果页，不再插入第二个
重复的“完成”页面。

### 3.4 Stable result

learner 确认 Proposal 后进入结果页。当 Expression Binding 尚未确认时，该页必须诚实显示“已确认
2 / 3”并将 Binding 作为最后一个待确认事实；只有三个事实全部 confirmed 后，页面才声称形成
稳定语义结果。该页只读呈现：

- core meaning focus 与 prototype scene；
- included / excluded cases；
- neighbor contrasts 与边界；
- open questions；
- exact Sense/SenseVersion identity；
- 当前 Personal Meaning Alignment；
- 已确认 Expression Bindings 及“绑定目标表达”入口。

确认 Sense 不等于表达已经确认，也不等于加入学习。页面必须允许稳定停留在“Sense 已确认，表达待
确认”。第一屏优先显示 core meaning 与“绑定目标表达”主动作；完整 semantic spec、identity 和
provenance 默认折叠，Expression candidates 只在 Binding 页面完整出现。

### 3.5 Expression Binding confirmation

Binding 页面只对 exact active Alignment 开放。用户可以选择或编辑 Proposal 中的候选表达，并明确：

- language 与 expression type；
- surface form；
- relation；
- semantic coverage。

英语表达可以是 word、phrase、construction、sentence 或 utterance strategy，不能压成无类型字符串。
用户可以确认 Binding，也可以暂不绑定。Relation/coverage 不能默认成可逆翻译等式。
Binding 前端按“选择模型候选 → 确认 surface form/type → 确认 relation/coverage”渐进展示，一次只突出
当前决定，不能把三组表单同时铺在一个长页面中。

## 4. 三个独立确认门

以下三个意图绝不能合并：

1. 接受 Meaning Focus revision：确认当前要澄清经验的哪个意义侧面；
2. 确认 Sense Proposal：创建或复用 stable Sense/SenseVersion，并建立 Alignment；
3. 确认 Expression Binding：确认某个 typed expression 如何覆盖 exact SenseVersion。

Suggestion、草稿、打开页面、查看答案或保存 UI step 都不能代替 learner confirmation。重复提交同一
operation 必须回到同一结果，不能创建平行 identity。

## 5. Identity 与事实边界

```text
Personal Meaning ≠ Meaning Focus ≠ Sense ≠ Expression ≠ Learning Target
```

- Personal Meaning 是 learner 主动保留的私人意义 identity；
- Meaning Focus 是从同一 Personal Meaning 中切出的一个意义侧面；
- Sense 是脱离私人原始叙述后仍可复现、引用和版本化的意义区别；
- Expression 是特定语言中的 typed form；
- Sense Expression Binding 是 Sense 与 Expression 的版本化覆盖关系；
- Learning Target 是之后建立的正式学习意图，不是 Binding 的别名。

页面 phase 只能由 revision、acceptance、confirmation、Alignment 和 Binding facts 推导，不能保存成
一个万能 domain `status`。修改 Anchor 或 Focus 不能原位改写已确认 SenseVersion；Binding coverage
更新保留历史版本，世界页只显示已经确认的 current BindingVersion。

## 6. 隐私边界

Personal Anchors、原始经历、媒体和对话原文属于 learner-private scope。可复用 SenseVersion 只保存
可复现的抽象语义边界和必要 provenance，不能复制个人身份信息或私人原文。删除/修订 Anchor 不会
倒写已经确认的 SenseVersion。

## 7. 与独立学习旅程的交接

Expression Binding confirmed 后，页面可以提供“加入学习”入口。这个动作属于第二条旅程的开始：

```text
stable Sense Version + confirmed Expression Binding
→ learner 明确加入学习
→ Learning Target / Learning Entry Provenance
```

在显式加入学习之前，本旅程不得创建或展示：

- Curriculum membership 或 Retention Target；
- Effective/Committed Learning Policy；
- Content Provisioning 或 Learning Materialization；
- Protocol Run、Learning Evidence 或 completion；
- Memory Outcome、FSRS Memory State、learned/mastery 文案。

第二条旅程也可以从 Book 或直接选择既有 stable Sense 独立开始，因此 Personal Semantic World 从来
不是学习的强制前置步骤。

## 8. 冻结验收

- 仅熟悉表达、仅具体经历或两者兼有都能创建 Personal Meaning；
- Anchor identity 稳定，熟悉表达和经验不会被合并成一个通用文本字段；
- 一个经历可以拆出 receive/give 等多个独立 Focus；
- 未显式接受的 Focus 不能开始 Sense Construction；
- Proposal 可继续澄清、拒绝或确认，拒绝不创建 Sense/Alignment；
- Sense confirmation 可 create new 或 reuse existing，并引用 exact immutable SenseVersion；
- Sense confirmed 但 Expression pending 是合法、可恢复状态；
- Binding 保留 expression type、relation、coverage 与独立 confirmation；
- 图谱、展开和清单使用相同双轴 projection；
- 全旅程不产生学习、掌握或长期记忆事实。

## 9. 当前原型边界

当前 `web-next` 使用独立的轻量本地 Agent 服务调用 Muse Spark 1.2 Contributor Responses API；Vite 只
转发 `/api/prototype/semantic-agent/*`，不承载 prompt、key、响应解析或 Agent 业务逻辑。Agent API 只有
一个多轮 `turn`：前端提交材料、完整消息历史和已确认事实，服务返回自然语言回复与最新提议；前端
gateway 继续独立记录 learner 的三个确认事实。确定性 scenario 只用于无额度自动验证。这个接线只是
前端 MVP 的本地 agent loop，不宣称 production API、LLM policy service、Sync、授权或服务端持久化已
完成；当前 prototype JSON 也不是正式 wire contract。
