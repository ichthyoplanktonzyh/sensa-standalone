# Sensa 用户旅程

本文定义 Sensa 当前产品图景中的端到端用户旅程，说明用户如何从真实世界或已发布学习内容出发，
经过个人语义世界与学习准备，最终进入学习运行时。本文关注用户意图、状态转换、系统责任和成功出口，
不复制数据库结构、DTO、页面组件或开发进度。

## 1. 文档定位

- `CONTEXT.md` 与领域模型定义对象、身份、权限和不变量；本文不能覆盖它们。
- `product-requirements-v1.md` 定义当前 Web 产品体验；本文把跨页面、跨入口的主旅程集中展开。
- Web、浏览器扩展和 Agent Intake 是当前产品入口。未来手机端、桌面端、拍照、语音或分享入口可以接入
  同一 Semantic Intake 边界，但不属于当前交付承诺。
- 本文中的“个人语义世界”指 learner-owned Personal Semantic World；同名 Web 页面只是它的读取、治理、
  Inbox 处理和学习交接控制面。

## 2. 整体产品图景

Sensa 由三个相互连接但职责独立的产品空间组成：

```text
真实世界入口
Web 创建 / 浏览器捕获 / Agent 委托 / 未来更多入口
                         │
                         ▼
个人语义世界
Intake Inbox / Context–Expression–Sense / Personal Meaning
                         │
                         │ explicit Add-to-Learning
                         ▼
学习运行时
内容准备 / 初次学习 / 保持复习 / 必要时重学
```

学习包是独立的正式学习入口。它可以不经过个人语义世界，直接建立学习目标；学习中形成的“我的场景”
则可以在用户明确接受后，从学习运行时进入个人语义世界。

```text
已发布学习包 ── explicit enrollment ───────────────┐
                                                   │
完整 Personal Meaning ── explicit Add-to-Learning ─┼─▶ Learning Target
                                                   │          │
现有 stable Sense + target binding ── direct entry ┘          ▼
                                                      Learning Runtime
                                                             │
                                                             └─ 我的场景
                                                                  │
                                                                  └─ explicit acceptance
                                                                       ↓
                                                             Personal Semantic World
```

## 3. 统一旅程状态

不同入口不创造不同种类的 Personal Meaning 或 Learning Target。除学习包等正式学习入口外，个人内容
通常经过以下状态：

1. **Capture**：取得一段经历、材料、表达意图或外部来源。
2. **Semantic Closure**：固定可重返的 Context、其中被定位的 Expression、teaching-sufficient stable
   Sense Version，以及兼容的 target Binding。
3. **Semantic Acceptance**：learner 直接接受，或获授权 Agent 基于明确请求/持续授权代为接受。
4. **Personal Meaning**：完整事实成为个人语义世界的正式成员。
5. **Add-to-Learning**：learner 独立表达“我要学习它”，并固定当时的 Language Learning Route。
6. **Content Provisioning**：准备、生成、审核、校验并冻结当前协议所需的 Learning Materialization。
7. **Learning Runtime**：执行初次学习，完成后交给长期保持；到期进入复习，失败时进入合法重学。

`Context + Expression + Sense` 闭合本身仍不足以入库；还必须存在有效 Semantic Acceptance。缺少
Context、完整 Expression、Sense 或 acceptance 中任一事实时，内容仍是 Intake Inbox Item 或澄清草稿，
不是正式 Personal Meaning。

## 4. 跨旅程不变量

所有入口和页面必须共同遵守以下规则：

1. **入口只改变可获得的信息，不改变领域身份。** Web、浏览器、Agent 和未来移动入口最终提交同一种
   Personal Meaning 或 Intake Inbox Item。
2. **Semantic Acceptance 与 Add-to-Learning 是两个独立意图。** 保存一个意义不会自动开始学习；获得
   semantic-world commit 权限的 Agent 也不会自动获得 Add-to-Learning 权限。
3. **个人语义世界不是正式学习的前置条件。** Book、Catalog 或现有 stable Sense 可以直接进入学习；
   学习历史也不能反向推断并静默创建 Personal Meaning。
4. **加入学习与资源 ready 不等价。** Personal-first 内容可能经历 `waiting → generating → reviewing →
   ready`；只有 ready plan 可以进入运行时。
5. **AI 只产生候选。** 模型输出必须经过系统拥有的独立校验，才能成为不可变 Learning
   Materialization；运行时不直接消费可变化 draft。
6. **相同学习连接保持同一长期身份。** 同一 learner × stable Sense × target binding 无论来自 Book、
   direct entry 或 Personal Meaning，都解析到同一 Retention Target；来源只保留 provenance。
7. **运行时固定事实。** 一次运行开始时固定目标、路线、策略、协议、课程来源和材料；用户之后修改
   当前设置不能改写已经发生的学习步骤、Evidence 或调度结果。
8. **删除不跨边界级联。** 删除学习来源不删除 Personal Meaning；删除 Personal Meaning 不删除
   Learning Target、历史、Evidence、Retention 或 FSRS 状态。
9. **传输状态不能冒充领域结果。** 插件/Agent 的 queued 只表示材料已进入持久队列；只有本地资料库
   committed/applied 后，才可显示“已进入语义世界”或“已进入收件箱”。

## 5. 旅程一：从学习包进入学习

### 5.1 用户目标

用户选择一部由 Sensa 发布的稳定 Book，下载适用于当前目标语言/支持语言路线的版本，明确加入学习，
然后完成初次学习、保持复习和必要重学。

### 5.2 内容发布前置旅程

```text
作者化 Book 内容
    ↓
固定 Book / Book Version / Content Release
    ↓
生成并校验 Package delivery snapshots
    ↓
构建不可变 Book Release Bundle
    ↓
上传并公开验证全部 Bundle
    ↓
上传按 digest 寻址的 Registry Revision
    ↓
提升服务端发现指针
```

发布后的 Registry、Bundle 和对象路径不得原位覆盖。发布失败时，上一版 Registry 必须继续完整可用。

### 5.3 用户主流程

```text
学习包目录
    ↓ 发现与当前路线精确匹配的 Book
Book 详情
    ↓ 用户点击下载
本机安装
    ↓ 大小 / digest / 合同 / 语言方向 / 资源校验通过
已下载
    ↓ 用户明确点击“加入学习”
Book Enrollment + Curriculum Membership + Learning Target
    ↓ ready plan
初次学习运行时
    ↓ completion + scheduling handoff
Retention
    ↓ 到期
复习 / 必要时重学
```

### 5.4 关键分支

- **只发现新版**：只显示更新状态和作者变更摘要，不自动下载、不改变课程。
- **只下载完成**：资源已安装，但尚未加入学习，不产生目标、进度或调度。
- **语言路线不匹配**：解释目标语言或支持语言不匹配，并引导用户切换路线；不得隐式回退或重标语言。
- **应用新版**：必须由用户明确操作。新增条目只进入未来学习；删除条目只退出未来计划；身份未变的
  目标保留进度、复习和历史；已经开始的运行继续固定旧材料。
- **运行中断**：保留同一 Run、逐步材料和已提交动作，恢复时不得重新生成或跳过保存。

### 5.5 成功出口

- 用户拥有一个或多个 ready Learning Targets。
- 初次学习完成后，同一目标进入 Retention，并根据正式 Memory Outcome 安排复习。
- 该旅程不要求、也不自动创建 Personal Meaning。

## 6. 旅程二：从 Web 原生创建进入学习

### 6.1 用户目标

用户从自己的经历、上下文、图片、已经知道的表达或“我想表达但不会表达”的意图出发，在 Sensa 中
完成澄清，保存为个人意义，并在需要时把它加入正式学习。

### 6.2 主流程

```text
Web 创建入口
    ↓
输入文本 / 图片 / 熟悉表达 / 表达意图
    ↓
保存草稿
    ↓ 用户选择继续澄清
语义访谈
    ↓ 补充或确认真实 Context
    ↓ 定位 Context 中的 Expression
    ↓ 解析已有 Sense 或构造 teaching-sufficient Sense Proposal
    ↓ 用户明确接受
完整 Personal Meaning
    ↓
我的语义世界
    ↓ 用户明确点击“加入学习”
固定当前 Language Learning Route + Add-to-Learning Intent
    ↓
Content Provisioning Task
    ↓ 生成候选 / 可选独立审核 / required validators
不可变 Learning Materialization
    ↓ ready
学习运行时
```

### 6.3 澄清原则

- 语义访谈只澄清会影响真实理解和使用的区别，不要求用户填写内部语义结构。
- Meaning Focus 是可选解析桥梁；Context 和 Expression 已能确定 intended Sense 时，不应伪造 Focus。
- 模型只给出一个目标语言单词不构成 Sense Proposal；需要能够支持教学、生成材料和区分必要相邻意义。
- 只有用户接受当前 Context–Expression–Sense 关系后，才能创建正式 Personal Meaning。
- 用户关闭或中断澄清时，材料继续作为草稿/Inbox 状态保存，不冒充已确认内容。

### 6.4 加入学习和内容准备

- Add-to-Learning 固定用户操作当时的路线，不会因之后切换当前路线而迁移。
- target Language 必须与路线兼容；support Language 作为当前材料和运行上下文保存。
- 是否允许内容生成使用个人 Context，由用户单独授权。未授权时仍可基于固定 Sense 和 Binding 生成。
- 生成、审核或校验失败时保留可恢复状态；不得创建可开始的假目标或伪造 ready。
- 资源 ready 后，个人来源和学习包来源使用同一个学习运行时、Evidence 和 Retention 边界。

### 6.5 成功出口

- 只保存：完整 Personal Meaning 位于个人语义世界，没有学习进度。
- 加入学习但准备中：拥有明确学习意图和 `preparing` 状态，尚不能运行。
- 准备完成：拥有 ready Learning Target，可进入初次学习运行时。

## 7. 旅程三：从浏览器插件捕获

### 7.1 用户目标

用户在真实网页或字幕中遇到内容时原位理解并保存，不需要先打开 Sensa 页面重复录入。

### 7.2 快轨：解释并确认

```text
网页 / 字幕选区
    ↓
插件捕获来源、上下文、语言和 Expression occurrence
    ↓
用户请求解释
    ↓
得到 teaching-sufficient Sense 与目标表达
    ↓ 用户点击“保存到我的语义世界”
direct Semantic Acceptance
    ↓
完整 Intake payload
    ↓ fast track
Personal Meaning
```

插件中的明确保存动作构成 direct acceptance，因此 Web 不得要求用户对同一关系再次确认。

### 7.3 慢轨：先保存，之后澄清

```text
网页 / 字幕选区
    ↓
用户选择“保存待处理”或当前事实不完整
    ↓
插件持久队列
    ↓ Web 本地资料库成功接收
Intake Inbox Item
    ↓ 用户稍后打开 Inbox
补 Context / 圈定 Expression / 选义或构造 Sense / 接受
    ↓
Personal Meaning
```

### 7.4 状态与失败处理

- 插件必须区分“仍在插件队列”和“Web 已持久化”。
- Web 未打开、网络中断或回执未知时保留同一 operation id 幂等重试。
- 捕获语言不在当前学习路线中，不应阻止保存；是否能加入当前路线的学习在 Add-to-Learning 时判断。
- 页面来源、选择位置与捕获 provenance 必须随 Intake 保存，慢轨澄清不能丢弃原始来源。

### 7.5 成功出口

- 快轨成功：完整 Personal Meaning，可继续治理或加入学习。
- 慢轨成功：Inbox Item 保留全部已知事实和来源，等待补全。
- 传输未完成：材料仍在插件持久队列，不宣称已经进入语义世界。

## 8. 旅程四：从 Agent 进入

### 8.1 用户目标

用户在 Codex 等 Agent 中完成真实工作或交流后，直接要求 Agent 把相关 Context、Expression 和 Sense
整理并保存到 Sensa，而不需要回到 Web 重复录入。

### 8.2 快轨：明确委托保存

```text
用户在 Agent 会话中明确要求“存入我的语义世界”
    ↓
Agent 整理 Context
    ↓
定位 Expression occurrence + Language Tag
    ↓
解析或构造 teaching-sufficient Sense
    ↓
附带 delegated Semantic Acceptance provenance
    ↓
提交统一 Semantic Intake payload
    ↓
本地 Personal Semantic World authority 应用
    ↓
Personal Meaning
```

当前 Agent 会话中的一次明确请求可以构成 one-shot delegated acceptance basis，不要求额外 grant id，
也不要求用户回到第一方界面二次确认。系统必须保存 actor、basis 和 provenance。

### 8.3 慢轨：信息不完整

```text
Agent 提交部分事实
    ↓
接收端按字段存在性机械分流
    ├─ 缺 Context ───────▶ pending_context
    ├─ 缺完整 Expression ▶ pending_expression
    ├─ 缺 Sense ─────────▶ pending_sense
    └─ 缺 Acceptance ────▶ pending_acceptance
                               ↓
                         Intake Inbox
                               ↓
                         用户继续澄清
                               ↓
                         Personal Meaning
```

接收端只校验字段、类型、定位关系和大小限制，不重新判断 Agent 给出的 Context 是否“足够好”，也不
为了快轨再次调用模型。

### 8.4 本机 Agent 交付

```text
Codex skill / local CLI
    ↓
本机持久队列
    ↓
Sensa Web 打开或重新获得焦点
    ↓
拉取并由本地 authority 提交
    ↓ 成功后
ACK applied
```

CLI/skill 只负责提交和持久排队，不能直接写入 Personal Semantic World。只有本机库事务提交成功后才
可回执 applied。

### 8.5 远程 Agent 交付

```text
远程 Agent
    ↓
账号范围 Remote Intake Delivery mailbox
    ↓
queued
    ↓ 用户 Web 登录、联网且本机 library identity 已恢复
Web 拉取同一 canonical payload
    ↓
本地 authority 执行快轨或慢轨
    ↓
applied + 真实结果
```

云端邮箱不是云端语义库，也不是备份。`queued` 只说明云端持久接收；`applied` 才说明本地库已创建
Personal Meaning 或 Intake Inbox Item。

### 8.6 加入学习

Agent 的 semantic-world commit 权限不包含 Add-to-Learning。Agent 创建的 Personal Meaning 与 Web、
浏览器创建的 Personal Meaning 具有同等地位；之后必须由 learner 明确加入学习，或由拥有独立
Add-to-Learning grant 的 Agent 提交，才能进入内容准备和学习运行时。

## 9. 旅程五：从学习运行时建立“我的场景”

### 9.1 用户目标

用户在学习包提供的公共场景之外，加入更贴近自己经历的文字或图片，让当前表达与自己的真实世界
建立连接；在确认有长期保存价值时，再把它存入个人语义世界。

### 9.2 编辑和学习流程

```text
学习 Package target 的首次经验步骤
    ↓
公共 Package 场景
    ↓ 用户添加/编辑“我的场景”
Personal Learning Scene revision
    ↓ 按 Learning Target × Route 保存
个人学习体验中优先呈现
    ↓
运行时提交动作时固定当时 scene revision
```

“我的场景”是 learner-owned private scaffold。它可以在个人学习体验中成为主要场景，但不会删除、
覆盖或改写学习包中不可变的公共资源。编辑场景本身不产生 Evidence、Completion 或调度变化。

### 9.3 存入个人语义世界

```text
表达揭示完成 + 当前个人场景存在
    ↓ 用户点击“存入我的语义世界”
复用 Package 已固定的：
Sense Version + target Binding + Expression presentation
    ↓
当前 scene revision 成为 Personal Semantic Anchor
    ↓ direct Semantic Acceptance
完整 Personal Meaning
```

因为学习包已经固定并审核了相关语义事实，这条桥不再进入 AI 澄清流程，也不要求模型重新判断场景
是否充分。它不会创建第二个 Learning Target，也不会重置或复制现有进度。

### 9.4 后续更新

- 编辑“我的场景”只产生新的 scene revision，不自动修改已接受的 Personal Meaning。
- 用户可以再次明确提交新 revision，更新同一个 Personal Meaning 的 Anchor revision。
- 删除或更新 Book 不删除 Personal Meaning；删除 Personal Meaning 也不影响场景历史、Learning Target、
  Retention、Protocol history 或 Evidence。

## 10. Inbox 的统一处理旅程

Inbox 是所有不完整入口的共同收货区，不是稳定 semantic inventory。

```text
Intake Inbox Item
    ↓ 展示已知事实、缺失状态、来源和媒体
    ├─ 补充 Context
    ├─ 定位/确认 Expression
    ├─ 选择已有 Sense
    ├─ 启动 Sense Construction
    ├─ 明确 Semantic Acceptance
    └─ 丢弃
          ↓
Context–Expression–Sense–Acceptance 完整
          ↓
原子提交 Personal Meaning
          ↓
移出 Inbox
```

Inbox 澄清必须尽可能继承原 Intake 的 Context、Expression、Sense candidate、来源、媒体和 provenance；
不得通过另建一条无来源草稿来丢弃捕获事实。中断时继续停留在 Inbox/construction draft，不能提前创建
正式 Personal Meaning。

## 11. 学习运行时的共同出口

无论来源是学习包、Personal Meaning 还是 direct stable-Sense entry，进入 ready 后都使用同一学习边界：

```text
ready Resolved Learning Plan
    ↓
Initial Learning Run
    ↓ valid completion
Scheduling Handoff
    ↓
Retention Target + FSRS Memory State
    ↓ due
Retention Review
    ├─ 成功 ─▶ 更新一次 Memory State
    └─ 失败 ─▶ 合法 repair / Relearning
```

- 当前步骤只负责呈现和收集输入，不能直接宣称 Evidence、Completion 或调度成功。
- 每一步保存成功后才能推进。
- 复习只处理已经进入 Retention 的目标，不引入新内容。
- 一次复习最多产生一次有效结果和一次调度更新；失败后的 repair/relearning 不重复结算原复习。
- 自由练习与正式学习 Evidence 隔离；练习中发现的内容只有经用户明确保存后，才进入个人内容旅程。

## 12. 入口汇合表

| 入口 | 首个正式对象 | 是否必须进入个人语义世界 | 是否自动加入学习 | 进入运行时前的资源路径 |
| --- | --- | --- | --- | --- |
| 学习包 | Book Enrollment / Curriculum Membership | 否 | 否，需明确加入/应用 | Published Materialization |
| Web 原生创建 | Draft / Inbox Item | 是，闭合并接受后 | 否 | On-demand 或 Hybrid |
| 浏览器快轨 | Personal Meaning | 是 | 否 | 明确加入后 On-demand/Hybrid |
| 浏览器慢轨 | Intake Inbox Item | 是，补全后 | 否 | 明确加入后 On-demand/Hybrid |
| Agent 快轨 | Personal Meaning | 是 | 否，需独立授权 | 明确加入后 On-demand/Hybrid |
| Agent 慢轨 | Intake Inbox Item | 是，补全后 | 否 | 明确加入后 On-demand/Hybrid |
| 学习中的我的场景 | Personal Learning Scene | 可选，明确保存后 | 不适用；目标已存在 | 继续使用当前 Learning Target |

## 13. 当前产品入口与未来扩展

当前产品支持：

- Web 内创建、澄清、治理、加入学习和学习运行时；
- 浏览器扩展的网页/字幕捕获、解释、确认和待处理保存；
- 本机 Agent 的 skill/CLI + durable queue；
- 远程 Agent 的账号范围 mailbox delivery；
- 已发布学习包的发现、下载、加入、更新与运行；
- 学习包运行时中的 Personal Learning Scene bridge。

未来入口可以包括移动端分享、拍照、录音、桌面助手或其他 Agent。新增入口不得创建另一套 Personal
Meaning、Inbox、Acceptance 或 Add-to-Learning 语义；它只需要提供当前能够取得的 Intake facts，并使用
同一幂等 Semantic Intake authority 完成快慢轨分流。
