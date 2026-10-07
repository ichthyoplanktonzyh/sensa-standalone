# Sensa 个人语义世界模型

> 状态：Canonical domain model
> 更新日期：2026-09-21

本文定义泛在语义摄取、个人意义、Context 与表达锚点、按需 Sense 解析/构造、直接或委托确认以及
确认后的学习边界。
统一术语以 [`../../CONTEXT.md`](../../CONTEXT.md) 为准；聚合所有权、资源发布和运行行为分别由
[`production-architecture.md`](production-architecture.md)、
[`learning-connection-model.md`](learning-connection-model.md)、
[`sense-learning-resource-model.md`](sense-learning-resource-model.md) 与
[`learning-runtime-model.md`](learning-runtime-model.md) 裁决。

在 [ADR 0006](../adr/0006-three-product-systems.md) 的顶层架构中，Personal Semantic World 是三个
产品系统之一。它拥有 learner 接受的个人语义事实，并引用 Semantic Foundation 中的 stable Sense、
Sense Version 与 Sense Expression Binding；引用不转移这些共享语义身份的所有权。它可以发出显式
Add-to-Learning bridge，但 Curriculum 和 Learning System 不以 Personal Semantic World membership
作为前置条件。

## 1. 核心命题

Sensa 不把人的意义建模为词的附属定义。对 learner 而言，最先存在的是自己的意义/经验结构；
任意语言中的词、短语、构式或句子都是进入、唤起或表达它的符号锚点。正式学习是让一个已经
确认的意义区别与某条 Language Learning Route 中的目标语言表达建立稳定连接的一种方式，而不是
个人意义存在的前提或唯一用途。

本文描述的是 personal-first semantic construction，不是全产品唯一学习入口。learner 可以从 Book、
Catalog、搜索或 reviewed Contextual Lookup 中选择 existing stable Sense + target binding，直接进入
Curriculum/Learning，而不创建 Personal Meaning。两类路径只在 Learning Target 处汇合。

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

Personal Semantic World 只包含通过有效 Semantic Acceptance 提交的完整 Personal Meanings。这里的
“完整”不是要求穷尽式语言学分析，而是至少固定一个可重返的真实 Context、其中被定位的 Expression、
一个足以教学的 stable Sense Version，以及兼容的 Sense Expression Binding。缺少任一部分的捕获仍是
Intake Inbox Item，不是稳定世界成员。

Semantic Acceptance 可以来自 learner 的直接操作，也可以来自在明确授权范围内代 learner 行动的
Agent。浏览、学习历史、未获授权的模型推断、收藏或推荐只能产生 Intake 或创建建议，不能静默增加
成员。

这里的 Personal Semantic World 是 learner-owned 领域仓库，不等于产品中同名的“我的语义世界”
页面。该页面主要是仓库的读取、治理与学习交接控制面：呈现已经进入的 contextual meanings，处理
Inbox 例外，检查/纠正来源与解析，撤销误收，并显式提交 Add-to-Learning。页面不是第二个事实 owner，
也不是创建 Personal Meaning 的必经入口。

```text
Personal Semantic World
└── Personal Meaning
    ├── Personal Semantic Anchor[]        至少一个 Context
    ├── Personal Expression Anchor[]      至少一个位于 Context 中的 Expression
    ├── Personal Meaning Alignment[] ──▶ stable Sense Version + Binding
    └── Meaning Focus[]                    可选的解析桥梁
```

### Personal Meaning

Personal Meaning 是稳定的 learner-owned identity，表示 learner 直接或通过获授权 Agent 选择保存的
一个完整 contextual meaning。创建入口可以来自一段经历、图片、声音、一个想表达却不会表达的
意思、任意语言中的一个表达；入口可以先不完整，但只有完成 Context–Expression–Sense
闭合并被有效接受后才创建正式 membership。入口不决定是否进入正式学习。

删除或修改锚点不能悄悄替换 Personal Meaning identity。Sense 对齐、学习开始或内容更新也不能覆盖
它的原始个人来源。删除稳定 identity 必须保留 Personal Semantic Tombstone、已有 revisions 与
provenance，不能通过物理移除记录表达。离线旧副本不得让 tombstone 对象复活；删除与同一对象的并发
编辑必须成为显式冲突，而不是依赖设备时间戳选择一端。
删除采用可恢复移除：用户可明确恢复同一 identity；删除和恢复各自追加不可变 revision 中的生命周期
事实，并推进内容 head 与 lifecycle revision。恢复不重做 Semantic Acceptance，也不抹除原删除事实。
同一后继 revision 槽的并发删除、恢复或内容修订必须显式处理冲突；旧 active 副本没有新的恢复事实，
不能成为恢复依据。被删除的成员只能查看与恢复，不能继续修订、解析或新增材料。

### Meaning Focus

Meaning Focus 是可选的解析桥梁，说明 learner 当前从一段仍有歧义的经验中真正关心的侧面。同一
经历可以支持多个 Focus，例如同一次借伞事件可以分别聚焦“暂时取得他人物品”和“暂时把物品交给
他人”。当 Context 中的 Expression occurrence 已被可靠解析到 teaching-sufficient Sense 时，Personal
Meaning 与 Alignment 都不需要 Focus。系统不得复制 Sense definition 生成伪 Focus 来满足合同。

### Personal Semantic Anchor

Personal Semantic Anchor 用文本、图片、音频、场景、动作、感受或其他受支持媒介，让 Personal
Meaning 可以被 learner 重新进入。它说明“这个意义对我如何有根”，不是标准例句、语言学事实、
评分答案或成功 Evidence。它必须保留来源与捕获 provenance；同一素材可以直接支撑一个已解析
Context–Expression–Sense 关系，也可以在需要时被多个 Meaning Focus 复用。
多块材料组成 Personal Context Composition 时保留 learner 保存的文字／媒体次序。替换情境形成新的有序
组合，新增材料追加到组合末尾；纠正解释、修改 Binding、删除／恢复 Meaning 或同步事实集合不重排材料。

学习运行时中的 Personal Learning Scene 先属于 learner-owned learning scaffold，而不是尚未接受的
Personal Meaning。它按 Learning Target + Language Learning Route 保持一份 current scene，并以不可变
revision 保存文字、图片和当时的 Curriculum provenance；相同目标应用新版 Book 后仍可沿用，换到
另一条 Route 则不会自动共享。用户明确执行“存入我的语义世界”时，当前 revision 与运行时已经固定的
Sense Version、target Binding 和 Expression presentation 一起构成 direct Semantic Acceptance，随后才
创建完整 Personal Meaning。接收方不得再次调用模型判断这个场景是否充足。

Personal Learning Scene 与其已经接受的 Personal Meaning 各自演进。修改 scene 只创建新的 scene
revision，不自动改写已接受的 Personal Semantic Anchor；用户可以再次明确提交当前 revision，以更新
同一个 Personal Meaning 的 Anchor revision。移除 Book、结束学习或删除学习来源不能删除 Personal
Meaning；删除 Personal Meaning 也不改变 Learning Target、Retention、Protocol history 或 scene history。
如果 learner 已独立替换 Personal Context Composition，使原 scene Anchor 退役，再次明确接受 scene
不得复活该 tombstone 或覆盖新整理的 Context；它在同一 Personal Meaning 的当前组合末尾引入新的
scene Anchor，后续 scene 更新沿该活动 Anchor 追加 revision。删除的 Personal Meaning 仍须先明确恢复。
同一 scene identity 只能沿一个 Personal Meaning 演进，包括其退役素材与删除历史；离线分叉不自动
合并成两条长期意义，涉及同一 scene 的分叉必须保留两侧事实并显式处理。

### Personal Expression Anchor

Personal Expression Anchor 是带类型和 Language Tag 的个人符号锚点。它可以是任意语言中的词、
短语、构式、句子或话语策略，并保存 learner-authored、LLM-suggested 或 reviewed provenance 以及
verification status。由 Semantic Intake 创建时，它还必须能定位到对应 Context 中的字符 span、媒体
区域或其他 occurrence locator。target、support、input 与 output 是 Route 或具体操作赋予它的角色，
不属于 Anchor identity；Anchor 也不自动证明两个语言表达等价。

### Personal Meaning Alignment

Personal Meaning Alignment 把完整 Personal Meaning 对齐到一个 stable Sense Version，并引用兼容的
Sense Expression Binding。它首先由 Context 与被定位 Expression 的解析支撑；只有当这两者仍不足以
说明 intended Sense 时才额外引用 Meaning Focus。Alignment 必须分别保留：

- resolver、词典、模型或已有 Sense 的 resolution provenance；
- learner 直接接受或 Agent 委托接受的 Semantic Acceptance provenance；
- 当时固定的 Context、Expression occurrence、Sense Version 与 Binding；
- 后续撤销、重新解析或版本迁移事实。

用户可以明确纠正同一 Personal Meaning 当前的解释或表达。纠正使用用户这次实际审阅的当前真实 Context
组合，并固定参与的所有 Context revisions；不会无提示地挑选其中第一个素材。此前 Context 修订仍保留在历史中。
用户在此 Context 旁明确填写的 Expression 可以定位到这个个人意义的 Context revision，不要求把表达
硬写进原始叙述。它不是脱离 Context 的独立 Sense 创建，也不把用户编辑误记为模型建议。
纠正追加新的 Semantic Acceptance 和 Alignment，并以不可变事件撤回被替换的连接；原接受、Context、
Expression、Sense Version、Binding 和旧学习引用不改写。Alignment 的接受快照保持不可变，当前有效性
由它的确认／撤回／恢复事件推导；已固定的学习来源引用接受快照，而不是当前有效性。
新的连接只有经独立 Add-to-Learning 才进入学习，不转移或重置旧 Target 的记忆与历史。

模型置信度可以帮助排序或决定 UI，但不能自己构成 acceptance。反过来，只要 Agent 持有 learner
明确授予的正式提交权限，它对一个完整解析的调用本身就是 delegated acceptance，不需要 learner
回到第一方 UI 再确认一次。

检索个人世界时只把当前有效连接作为候选来源；复用已经选定的 Sense Version 时，接受的对象则是
该固定语义合同，而不是原 Personal Meaning 的当前 membership 或表达 Binding。原个人材料后来被
删除、撤销对齐或修改，不会使共享 Sense Version 消失，也不能阻止 learner 在新 Context 下明确接受
一个新的完整 Personal Meaning。新接受不得复活旧 identity、自动采用 Sense 的新 head version，或
宣称复用了未被选定的 Binding；提交时仍须验证固定版本在当前资料库中存在且合同未被改写。

## 3. 公共 Sense 的含义

“公共”不表示 Sense 必须预先存在于一个封闭数据库，也不表示所有人必须共享一个唯一概念本体。
它表示该意义区别在脱离原始私人对话后仍然可被理解、引用、比较、复现和版本化，并能判断新的
场景或表达是否属于其边界。

“公共”也不表示 learner 的经历会被公开。Sense Version 只保存从对话中抽象出的可复现语义边界；
姓名、图片、录音、原始叙述和其他 Personal Anchors 继续属于 learner，除非另有独立、明确的共享
授权，否则不能进入公共 Sense 或公共学习资源。

Sensa 采用按需 Sense Resolution/Construction：普通上下文查词可以把 Context + Expression 解析到
已有 stable Sense；只有没有适用 Sense 或 learner 的 intended meaning 仍不清楚时，才由 LLM 根据
Context、可选 Focus 和对话提出 Sense Proposal。有效的直接或委托 Semantic Acceptance 后，系统
才可复用 stable Sense 或创建新的 `senseId` 与初始 Sense Version。系统不要求先从完整公共 Sense
库中选中已有条目。

Sense “已确定”采用教学充分性标准，而不是穷尽式语义分析。只要它能够说明 Expression 在当前
Context 中的意思、支持内容生成和后续学习，并在确有必要时区分最容易混淆的相邻用法，就可以成为
teaching-sufficient Sense。它不要求语言学教师之外的无限细分，也不把一次方便教学的中文措辞当作
不可修订的本体真理。

一个可确认的 Sense Proposal 至少应表达：

- 核心意义焦点；
- 原型场景以及必要的参与者、状态、方向或因果关系；
- 包含与排除边界；
- 容易混淆的相邻意义及关键区别；
- 在目标语言中的主要词、短语、构式或其他自然表达；
- 提议来源、生成 provenance 和仍待有效 Semantic Acceptance 的部分。

LLM 只给出一个 target-language 单词不构成 Sense Proposal。词是 Sense Expression Binding 的一端，
不是 Sense identity；一个词可以承载多个 Senses，一个 Sense 也可以由多个表达实现。

## 4. 泛在 Semantic Intake 与快慢轨

顶层架构中的 Intake Layer 由 Intake Surfaces/adapters、Semantic Intake Module 与可选 Remote Intake
Delivery 组成，但本文件只裁决 Semantic Intake、Inbox 与 Personal Semantic World commit 的领域语义。
Surface 不因捕获材料而取得语义所有权，Remote Delivery 不因持久排队而取得 acceptance authority，
Personal Semantic World 也不拥有 transport credential 或 mailbox lifecycle。

Semantic Intake 是浏览器插件、移动端分享、桌面助手、拍照/语音入口或 learner-authorized Agent
共同使用的端口无关边界。Intake 可以携带 Context、Expression、Sense 和
Semantic Acceptance 中当前已经拥有的任意事实；缺失的部分进入 Inbox 后再澄清。
只有 Context–Expression–Sense 闭合且完成有效接受时，才创建正式 Personal Semantic World
membership。

接收端不判断调用者提供的 Context 在语义上是否“足够”，也不为此再调用模型。
这个判断由捕获当下的 learner 或 Agent 完成；接收端只做字段存在性、类型、定位关系
与大小上限等结构校验。“有 Context”与“Context 质量好”不是同一个接收端状态。

主应用内的手动创建只是上述端口之一，不拥有更高的领域地位。正常摄取可以在 learner 阅读、工作、
交流或使用 Agent 的原位完成，不要求先打开“我的语义世界”页面；任何获授权端口都必须提交同一种
幂等 Intake/commit 语义，并由同一个 Personal Semantic World authority 接纳。端口差异只影响可获得
的 Context、交互方式、acceptance provenance 与 capability，不产生另一套 Personal Meaning。

```text
外部捕获 / Agent 整理
      │
      ├── Context + Expression + teaching-sufficient Sense
      │                    + valid Semantic Acceptance
      │                              │
      │                              ▼ fast track
      │                     complete Personal Meaning
      │
      └── 缺 Context / Expression / Sense / acceptance
                    （主动延后表现为尚未 acceptance）
                                     │
                                     ▼ slow track
                               Intake Inbox Item
                                     │
                       圈定 Expression / 选义 / 对话构造
                                     │
                                     ▼
                              Semantic Acceptance
                                     │
                                     ▼
                            complete Personal Meaning
```

快轨不是绕过确认，而是把解析展示和 acceptance 压缩在摄取端完成。第一方界面的保存动作可以构成
direct acceptance；获授权 Agent 调用正式 commit operation 可以构成 delegated acceptance。二者具有
相同 membership 效力但必须保留不同 provenance。用户在当前 Agent 会话中明确要求“帮我保存”
就是一次 delegated acceptance 的 basis，无需先创建独立 grant id，也无需到 Sensa 再确认一次。
入口来源、Sense 解析来源与 acceptance authority 是三组正交事实：浏览器只可能是 Context 的捕获入口，
不因此成为 Sense resolver；Agent 也只有在实际完成解析或获得委托接受时，才分别出现在对应 provenance
中。任何一组 provenance 都不得产生入口专属的快慢轨、Personal Meaning 或 Alignment。
传输权限由连接或账号认证负责，语义接受由 payload 中的 acceptance provenance 负责，两者不得混为
一个“是否允许调用 API”的布尔值。

委托授权可以是一次性的，也可以是持续规则。learner 选择持续授权即接受更低摩擦伴随的误收成本；
持续规则应保存可撤销的 authorization reference；一次性明确请求只保存 actor 和 basis。
系统还应提供最近写入审计、幂等操作、可恢复移除及合理限额，而不是强迫每次二次确认。
提交到 Personal Semantic World 与提交 Add-to-Learning 是两种独立权限；Agent 获得前者不自动获得
后者。

Agent transport credential 的安装与 Semantic Acceptance 仍是两件事。Web 只签发短时、一次性的 setup code；
长期 intake-only credential 由本机安装器直接兑换，服务端只保留 digest。连接激活、替换、last-used 与撤销
可以审计，但不能因此记录或暴露 CES 内容。替换必须先激活新连接再撤销旧连接；限额按新 operation 计算，
同一 operation 的相同幂等重试不应被当作新的语义写入。

外部 Agent 使用同一 Semantic Intake facts 经账号范围内的 Remote Intake Delivery 投递。提交不携带
由 Agent 指定的 library id、client identity 或 acceptance actor；受认证的 intake-only 连接与用户已
登记的本地 library 共同决定目的地。云端只保存幂等邮箱项，本地 authority 取回后用
同一 operation id 执行快/慢轨，再回传实际结果。`queued` 只代表云端已收到；只有
`applied` 才代表本地库已经创建 Personal Meaning 或 Intake Inbox Item。这条邮箱链路不是
云端语义库，也不是备份。

Inbox 是 Personal Semantic World 产品表面的收货区，但在领域上不是稳定 semantic inventory。慢轨
处理可以使用轻量候选选择或 LLM Sense Construction；在三元组闭合前，中断状态继续留在 Inbox/
construction draft，不得通过伪造 Focus、Proposal 或 Confirmation 提前创建完整 Personal Meaning。

因此，“我的语义世界”产品表面的主要职责不是要求 learner 在应用内重复录入，而是让外部 Intake 的
结果可理解、可纠正、可撤销并可交给 Learning。它可以提供补充性的应用内捕获入口，但不能让其他
端口依赖页面状态、组件生命周期或本地表单才能完成相同领域操作。

## 5. LLM 语义访谈

Sense Construction 不是普通的句中词义消歧，也不是每条 Intake 的必经步骤；它用于 Context 无法
直接决定 intended Sense，或 learner 从个人表达意图出发尚无适用 stable Sense 的情况。LLM 面向 learner 的角色是语言老师：帮助理解当前场景并找到自然、合适的表达。
只澄清会影响实际理解或使用的差别，不穷举细微语义边界，不要求 learner 填写内部语义结构；
信息足够便收敛，Focus 始终可选。内部仍需整理可校验的 Sense/Expression 候选并保留真实不确定性。
这一体验定位由 Owner 于 2026-09-09 确认，不改变下述接受权限和事实边界。具体承担：

1. 从非结构化文本、媒介和个人叙述中提出可修改的 Meaning Focus；
2. 识别同一场景中的多个可能焦点，并在必要时建议拆分；
3. 生成少量 Sense Proposals 与目标语言表达；
4. 根据候选边界提出有区分力的问题，而不是只要求 learner “再详细说说”；
5. 解释为什么匹配、为什么可能不匹配以及相邻意义的区别；
6. 在 learner 说“都不是”时继续澄清，而不是为了完成流程强行选择。

LLM 不能凭模型置信度自行扩大写入权限，不能用推断制造 Learning Evidence，也不能在确认后原位
改写已有 Sense Version。它可以在 learner 明确委托的权限内提交完整解析；该事实必须记为 delegated
acceptance，而不是伪装成 learner 亲自审阅了每个字段。

## 6. 确认门与 personal-first bridge 生命周期

下图只描述 Personal Semantic World 向 Learning 的可选桥接，不是所有正式学习必须经过的全局流程：

```text
Context capture
      ↓ complete? ── no ──▶ Intake Inbox / optional Sense Construction
      ↓ yes                         │ optional Meaning Focus + Sense Proposal
Context + located Expression       │ resolve
      + teaching-sufficient Sense ◀┘
      ↓ direct or delegated Semantic Acceptance
complete Personal Meaning + Personal Meaning Alignment
      + stable Sense Version + target Sense Expression Binding
      ↓ 独立的 Add-to-Learning Intent + explicit Language Learning Route
Learning Target + Retention Target + Curriculum Membership
      ↓ Learning Policy Assignment / resolution
Resolved Learning Plan(preparing | ready | blocked)
      ↓ ready / Content Provisioning
Learning Materialization + purpose-specific Learning Protocol Run
      ↓ successful Initial Learning Completion
required Scheduling Handoff
```

每一步都是不同意图：

- 捕获 Semantic Intake 只创建候选或 Inbox，不自动增加 Personal Semantic World membership；
- 提交完整 Context–Expression–Sense 关系才创建 Personal Meaning 与 Alignment；
- 接受 Meaning Focus 只确认 learner 当前关注的方面，而且 Focus 可以完全不存在；
- 接受 Sense Proposal 或已有 Sense resolution 才可复用/创建稳定 Sense 与 Personal Meaning Alignment；
- direct 与 delegated acceptance 都有效，但必须保存不同 authority provenance；
- 确认 target-language 表达只建立或接受 Sense Expression Binding；
- 生成例句、对比、发音或练习资源不等于已发布，也不等于已经形成可执行 Materialization；
- Add-to-Learning 才请求进入一条显式 Language Learning Route 的正式 Curriculum；target Binding 必须
  与 Route Target Language 兼容。接纳可以保留 preparing/blocked Membership，但只有
  ready Resolved Learning Plan 才能开始正式 Protocol Run；
- 上述任何对话、确认、播放或浏览都不产生 Learning Evidence。

桥接后两个模块仍保持独立：删除、归档或重新组织 Personal Meaning 不删除已接纳的 Curriculum
Membership、Retention Target、Protocol history、Evidence 或 FSRS；正式 Learning/Review history 也不
反向创建 Personal Meaning。Personal Anchors 只有在 learner 明确授权时才可作为后续 Materialization
的可选 scaffold，不成为 Runtime 前置依赖。

Sense 确认是丰富流程的稳定起点。例句、搭配、边界辨析、Experience Sketch、Assessment、Repair、
Lightweight Study、Structured Acquisition 与 Retention 都必须引用稳定 Sense Version，不能只引用
原始聊天文本、个人节点标题或某个 target-language 字符串。确认后的学习内容既可以来自 published
Package，也可以由 LLM 按需生成并在校验后冻结；两者的协议边界由学习连接模型裁决。

## 7. Sense 的按需增长与复用

Sensa 不把建设穷尽式 Sense 库作为个人创建的前置条件。确认后可以在后台检查已有 Senses：

- 没有相近项时保留新 Sense；
- 高度相近时可以建议复用或建立 `equivalent` 关系，但不得覆盖 learner 已确认的边界；
- 部分相似时建立 `broader`、`narrower`、`overlaps` 或真实对比关系；
- 后续审校可以发布新版本、拆分或建立关系，但不物理抹除原始 identity 与 provenance。

相似度检索与去重是治理优化，不是 Sense Construction 的真理来源或交互阻塞条件。由此形成的是
随真实使用生长、可逐步审校的公共语义网络，而不是要求预先完成的词典本体。

## 8. 多语言长期模型

语言是 Expression 与 Context 的绝对事实；Target Language、Support Language、Input Language 与
Output Language 是 Language Learning Route 或具体操作中的相对角色。Personal Meaning 可以连接
任意数量、任意语言的 Personal Expression Anchors；Anchor 只保存自身 Language Tag 与 provenance，
不会因为当前 Route 改变而被重新分类。

```text
Personal Meaning
├── Personal Expression Anchor (language A)
├── Personal Expression Anchor (language B)
└── Personal Meaning Alignment ──▶ stable Sense Version
                                      ├── Binding (language A)
                                      ├── Binding (language B)
                                      └── Binding (language C)

Language Learning Route
├── Target Language
├── default Support Language
└── route-scoped Study Plan ──▶ selected Learning Targets
```

一个语言表达可以通向多个 Senses，多个语言表达也可以共同接近一个 Sense。不同语言共同体对相近
经验的边界可能不同；只有边界足够一致时才让多个语言的 Expression Bindings 共享同一 Sense，否则
保留独立 Sense 与显式 overlap、broader、narrower 或对比关系。Route 只选择当前要建立的目标连接，
不能把 support-language 表达写成 Sense identity 或可逆翻译等号。

Learner 可以同时拥有多条 Routes，例如 `zh-Hans → en-GB`、`zh-Hans → ja` 与 `en → es`；Support
Language 也可以与 Target Language 相同，以表达沉浸式学习。系统不因此建立全局“母语”、唯一
Familiar Language 或 known-language/proficiency 事实。Active Route Selection 只影响后续操作，已经
开始的 Sense Construction、生成请求或学习 Session 继续使用其 Pinned Language Context。

捕获发生在 Route 选择之前：Semantic Intake 保存 Context、located Expression 与 Language
Observation。若捕获语言未知、能力暂不支持，或不属于当前 Route，它可以继续留在 Inbox 等待 learner
确认、暂存或显式放入一条 Route；系统不得依据 Active Route Selection 强制改写其 Language Tag。

同一个 Personal Meaning 面向多个 Target Languages 时，各语言按真实语义边界建立 Binding 或独立
Sense 对齐。不同目标语言的正式学习进度保持隔离，不能因 learner 已掌握其中一种语言的表达而推断
另一种已经学会。

正式长期记忆还要在 Sense 之下继续按 target expression 隔离。一个 Personal Meaning 若对齐
某 Sense，而 learner 又选择分别学习 `buy` 与 `purchase`，这两条 Sense Expression Bindings
产生两个 Retention Targets；它们可以共享 Personal Meaning、Sense boundary 和一部分内容，但不共享
Protocol Run、Evidence 或 FSRS Memory State。Recognition、Recall 等能力默认是每条 Retention Target
内部的不同证据视角，不因 Card 不同而另建记忆身份。

## 9. 代表性 Language Learning Routes 与交付边界

`zh-Hans → en` 是一条代表性 Route，而不是全产品的语言身份：

- learner 可以从任意语言的描述、表达或个人经验开始创建 Personal Meaning；
- 该 Route 的语义访谈默认使用 `zh-Hans` 作为 Support Language，并寻找自然的英语 target expression；
- 中文表达只作为这次 Route/operation 的 support-language access path，不成为英语 Sense identity 或
  assessment answer；
- 英语词形、短语和构式保持 typed identity，不压成无来源字符串；
- 同一个 learner 可以另有 `en → es` 或 `en → en` Route，彼此的 Study Plan、active selection 与
  Pinned Language Context 保持显式。

某一交付版本可以只开放部分 Route、语言、富媒体 Anchor、表达类型或实时生成能力，但限制必须由
版本化 language/content/runtime capability 诚实表达。交付限制不能反向改写 Language Tag、Personal
Meaning、Expression Anchor、Sense 或 Route 的长期领域关系。

## 10. 代表性边界场景

### 一次借伞，两个 Meaning Focus

同一段“对方把伞给我、之后归还”的经验可以被两个 Focus 复用。聚焦接收方向时，LLM 可以提出与
英语 `borrow` 对应的 Sense；聚焦给予方向时，可以提出与 `lend` 对应的 Sense。系统不得把中文
“借”直接等同于其中任一个，也不得为了保留单节点而混合两个正式学习目标。

### 一个 Focus，多个相邻候选

“表达真实意见但不让对方难堪”可能接近 `tactful`、`diplomatic` 与 `considerate`。LLM 应通过
边界问题帮助 learner 确认当前最在意的 Sense；其他候选可以作为相邻或重叠关系保留，不能被合并
成一个宽泛学习目标。

### 暂时没有合适表达

Intake/Construction draft 可以长期保持未确认 Sense 或没有自然的一词表达。系统可以继续使用短语、
构式或完整说明作为候选，也可以等待后续澄清；在 Context–Expression–Sense 闭合前它仍留在 Inbox，
不得为了进入 Personal Semantic World 或继续学习流程而伪造一个确定对应。

## 11. 不变量

- Personal Semantic World 是 optional personal-first source，不是 Book/direct learning 的前置条件；
- Learning 不因 Book、Catalog、搜索或 Contextual Lookup 入口而创建 Personal Meaning；
- personal-first bridge 必须经过显式 Add-to-Learning；桥接后的 Personal Content 与 formal learning
  lifecycle 相互独立，任何一侧的删除/进度都不能暗中改写另一侧；
- Personal Semantic World 的每个正式成员都必须固定真实 Context、被定位的 Expression、
  teaching-sufficient stable Sense Version 与兼容 Binding；未闭合材料属于 Intake Inbox；
- 创建 Personal Meaning 不得以打开“我的语义世界”页面为前提；应用内表单、浏览器/移动/桌面端口
  与 authorized Agent 都必须汇入同一幂等 Intake/commit authority；
- “我的语义世界”页面是 Personal Semantic World、Inbox、provenance 与 learning projection 的读取/
  控制面，不拥有第二份 semantic state，也不能绕过真实领域 owner 写入；
- 只有 learner 的直接 Semantic Acceptance 或其显式授权的 delegated acceptance 才能增加 Personal
  Semantic World membership；delegated acceptance 无需额外二次确认，但必须保存 actor 与
  `explicit_user_request | standing_authorization` basis，只有持续授权强制保存 authorization reference；
- Intake 接收端只以 Context、Expression、Sense 和 acceptance 的结构存在性分流，不用模型
  二次评估调用方已确认的 Context 充足性或 Sense 质量；
- 远程投递的 `queued` 与本地提交的 `applied` 是两个事实；不得把邮箱入队、设备间 Sync
  收敛或尚未验证的上传宣称为本地已保存或可恢复备份；
- Personal Meaning、Sense 与 Expression 保持不同 identity；
- Personal Semantic World 的稳定 identity 以 revisioned tombstone 表达删除；同一 revision 槽分叉、
  删除与同一对象的并发编辑必须停止为冲突，独立子对象的不可变事实追加才可自动合并；
- 本地 command、Repository commit、跨设备同步和备份恢复必须经过同一个领域 authority；合法 JSON
  结构本身不足以获得写入资格，immutable fact 改写、断裂引用、revision 跳号、物理删除与没有明确
  恢复事实的 tombstone 复活都必须在事务提交前被拒绝；
- Meaning Focus 是可选解析桥梁，不是 Personal Meaning、Alignment 或快轨的必要字段；不得从 Sense
  definition 合成伪 Focus，也不得为快轨伪造零轮 Sense Construction/Proposal 链；
- LLM 提议本身不是 learner 意图；受授权 Agent 的 commit operation 可以表达 delegated learner
  acceptance，但确认仍不是学习成功；
- Sense 可以按需生成，不依赖穷尽式预建库，但确认后必须拥有稳定 ID 与不可变版本；
- Sense revision、split、equivalence 和 overlap 必须显式、可追溯，不能静默改写已引用边界；
- 同一经验可支持零到多个 Focus，同一语言表达可通向多个 Senses；
- Language Tag 是 Context/Expression 的绝对事实；target、support、input 与 output 只是 Route 或操作角色，
  不得永久写入 Personal Expression Anchor identity；
- Learner 可以拥有多条 Language Learning Routes，且 Target Language 可以与 Support Language 相同；
  领域模型不从 Route 推导全局母语、唯一 Familiar Language 或 known-language/proficiency 事实；
- Semantic Intake 必须保留声明、检测或 learner 确认的 Language Observation provenance；未知语言
  使相关 Expression 事实保持待补齐，暂不支持或不属于 Active Route 不是 Intake 拒绝理由，
  也不得被强制重标为当前 Target/Support Language；
- 已开始的 Sense Construction 与其他语言相关操作固定 Pinned Language Context；Active Route Selection
  的改变只影响后续操作；
- 正式记忆身份是 learner-specific Sense–target-expression 连接，不是 Personal Meaning、
  Sense 本身或 Card；
- Personal Anchors 不成为 reviewed content、评分答案或 Learning Evidence；
- 创建公共 Sense 不公开 Personal Meaning、原始对话或任何 Personal Anchor；
- 没有稳定 Sense 的个人内容不能进入正式 Curriculum；
- 没有合法 Learning Materialization 与可执行 Learning Protocol 的目标不能进入正式 Learning Runtime；
- Personal Semantic World 的布局、距离和区域不宣称是 learner 大脑的真实结构。


### 2026-09-10 已确认扩展：图文 Context

个人 Context 可以组合文字和用户图片；澄清接收图文，语义接纳保留已确认的图文
Context 与 Sense、Expression 的关联。用户可修改 Context，修订不改变稳定的
Sense–Expression 身份，不重置学习事实。原始澄清资料与 Context 修订历史保留。

Context 修订不自动替换学习资源。用户明确请求资源更新后，生成使用该次固定的
Context 版本；失败保留原可用资源，成功产生新 Materialization。已开始的学习中，
已经发生的操作继续固定当时资源；尚未操作的当前步骤和后续步骤可以在目标、路线与课程
成员关系兼容时使用已发布的最新资源。
