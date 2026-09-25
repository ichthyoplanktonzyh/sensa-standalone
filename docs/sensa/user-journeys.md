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

Sensa 由 Personal Semantic World、Learning System 与 Content Supply System 三个产品系统组成；它们
共享 Semantic Foundation，learner-facing state 与运行位于 Local-first Platform。Intake Layer 把真实
场景中的材料交给 Personal Semantic World，但不是第四个事实系统：Surface/adapter 负责捕获和运输，
Semantic Intake 负责统一分流，稳定 Personal Meaning 仍由 Personal Semantic World 拥有。

```text
真实世界入口
Web 创建 / 浏览器捕获 / Agent 委托 / 未来更多入口
                         │
                         ▼
Intake Layer
port-neutral payload / Semantic Intake / optional Remote Delivery
                         │
                         ▼
Personal Semantic World
Intake Inbox / Personal Meaning / Anchors / Alignment
                         │ explicit Add-to-Learning
                         ├────────────────────────────────────────┐
                         │                                        ▼
Book / Catalog / direct stable Sense ───────────────────────▶ Learning System
                                                                  ▲
Content Supply System ── Published / On-demand / Hybrid ──────────┘
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

### 3.1 “快轨 / 慢轨”不是入口类型

快轨与慢轨只是统一接收端对同一个 Semantic Intake 的完整性判定结果，不是浏览器、Agent、Web 或
未来移动端各自拥有的产品流程：

- 四项事实完整时，接收端原子创建 Personal Meaning；
- 任一项缺失时，接收端原样保留已知事实并创建 Intake Inbox Item；
- Inbox 补全后仍调用同一套 Personal Meaning commit authority，不转换成另一种领域对象；最终确认必须携带
  完整 Context、Expression、Sense 与 Acceptance，缺 Context 的条目可用澄清对话中由用户补充的真实描述完成；
- 入口名称、客户端类型与 transport envelope 不参与分流，也不进入 Personal Meaning、Alignment 或
  Learning Target identity。

来源 provenance 只用于回答“这份 Context 从哪里来、谁解析了 Sense、谁以什么权限接受、出现问题时
如何审计或回到原材料”。它不能决定快慢轨、创建插件专属/Agent 专属的 Meaning，也不能让同一事实走
不同的 Add-to-Learning 或学习运行时。

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
7. **运行时固定事实。** 一次运行开始时固定目标、路线、策略、协议、课程来源和计划材料基线；用户之后
   修改当前设置不能改写已经发生的学习步骤、Evidence 或调度结果。同一目标、语言方向和兼容内容来源内
   显式发布或应用的材料新版，可以刷新尚未操作的当前步骤及后续步骤。
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
为每个 Lightweight member 生成并校验 `.sensa`
    ↓
构建引用精确 Package identity/version/digest 的 Book Version Manifest
    ↓
上传并公开验证全部 `.sensa` 与 Manifest
    ↓
上传按 digest 寻址的 Registry Revision
    ↓
提升服务端发现指针
```

发布后的 Registry、Manifest、`.sensa` 和对象路径不得原位覆盖。发布失败时，上一版 Registry 必须继续
完整可用。Sensa Official 内容通过额外发布门禁和 Registry provenance 获得策展身份，但仍使用与本地
导入、私人分享和外部作者相同的 Portable Runtime 准入合同。

### 5.3 用户主流程

```text
学习包目录
    ↓ 发现与当前路线精确匹配的 Book
Book 详情
    ↓ 用户点击下载
验证 Book Version Manifest 并通过统一入口安装其 `.sensa` 成员
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
  目标保留进度、复习和历史；已经开始的运行不增删 participant，兼容材料更新可刷新尚未操作的当前
  Step 和未来 Step，已经操作的 Step 保留实际材料。
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
Sensa 对话入口
    ↓ 用户直接发送文字 / 图片，或从记录场景进入
统一澄清 Agent
    ↓ 每一轮都先理解用户并形成自然的语言老师回复
    ↓ 同一轮静默判断 Context / Sense / Expression 是否清楚
    ↓ 仅在复用判断确有需要时检索已有语义世界
    ↓ 解析已有 Sense 或构造 teaching-sufficient Sense Proposal
    ↓ 提出一个或多个目标语言 Expression
    ↓ 三者都清楚时显示完整 Context / Sense / Expression 候选
    ↓ 用户明确接受
完整 Personal Meaning
    ↓
我的语义世界
    ↓ 以已确认 Expression 展示；点击进入表达详情，不重新启动澄清
表达详情（Expression / Sense / 当前 Context；Context 可版本化修订）
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

- Sensa 自身提供一个可从空白开始的对话入口；从记录场景或 Inbox 打开的澄清使用同一个对话工作区，
  只是预先携带各自已有的文字、图片、来源和候选事实。当前入口只支持文字和图片。
- 每个用户回合都由同一个有界教师 loop 处理，不以回合数切换模式。模型先理解用户实际要解决的问题，
  用普通对话回答、解释或提出至多一个真正影响含义的问题。
- 模型在同一次最终回复中给出隐藏的清晰度判断和可选候选；这是结构化模型输出，不是工具。Context、
  Sense 和 Expression 全部清楚时才显示完整候选，用户不需要执行“整理”“抽取”或切换表单模式。
- 面向用户的回复在生成时增量显示；隐藏的清晰度和候选仍要等整个结构化结果校验通过后才进入会话与候选区。
  中断或格式无效的增量文字不是事实，不会保存。
- 澄清不查询外部词汇参考。模型使用自身语言能力；唯一工具是读取用户已有语义世界，并且只在明确意义
  已经形成、需要判断是否复用时调用。工具活动只保存可审计结果，不保存或展示模型隐藏推理。
- 语义访谈只澄清会影响真实理解和使用的区别，不要求用户填写内部语义结构。
- Meaning Focus 是可选解析桥梁；Context 和 Expression 已能确定 intended Sense 时，不应伪造 Focus。
- 模型只给出一个目标语言单词不构成 Sense Proposal；需要能够支持教学、生成材料和区分必要相邻意义。
- 只有用户接受当前 Context–Expression–Sense 关系后，才能创建正式 Personal Meaning。
- 用户关闭或中断澄清时，材料继续作为草稿/Inbox 状态保存，不冒充已确认内容。
- 已确认的 Expression 是“我的语义世界”的可见主对象；重新打开时进入表达详情。Context 修改是显式的
  版本化修订，不会自动再次调用澄清 Agent，也不会重写当时的 Sense / Expression 接受事实。

### 6.4 加入学习和内容准备

- Add-to-Learning 固定用户操作当时的路线，不会因之后切换当前路线而迁移。
- target Language 必须与路线兼容；support Language 作为当前材料和运行上下文保存。
- 是否允许内容生成使用个人 Context，由用户单独授权。未授权时仍可基于固定 Sense 和 Binding 生成。
- 生成、审核或校验失败时保留可恢复状态；不得创建可开始的假目标或伪造 ready。
- Web 内容生成 Agent 的成功出口是 learner-private Materialization，不是 Published Package。只有用户
  另行选择导出/分享时，系统才从合格内容快照构建 `.sensa`，且不携带进度或调度。
- 资源 ready 后，个人来源和学习包来源使用同一个学习运行时、Evidence 和 Retention 边界。

### 6.5 成功出口

- 只保存：完整 Personal Meaning 位于个人语义世界，没有学习进度。
- 加入学习但准备中：拥有明确学习意图和 `preparing` 状态，尚不能运行。
- 准备完成：拥有 ready Learning Target，可进入初次学习运行时。

## 7. 旅程三：从浏览器插件捕获

### 7.1 用户目标

用户在真实网页或字幕中遇到内容时原位理解并保存，不需要先打开 Sensa 页面重复录入。

### 7.2 信息完整：解释并确认

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
    ↓ 接收端判定事实完整
Personal Meaning
```

插件中的明确保存动作构成 direct acceptance，因此 Web 不得要求用户对同一关系再次确认。

### 7.3 信息不完整：先保存，之后澄清

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

- 完整提交成功：得到完整 Personal Meaning，可继续治理或加入学习。
- 不完整提交成功：Inbox Item 保留全部已知事实和来源，等待补全。
- 传输未完成：材料仍在插件持久队列，不宣称已经进入语义世界。

## 8. 旅程四：从 Agent 进入

### 8.1 用户目标

用户在 Codex 等 Agent 中完成真实工作或交流后，直接要求 Agent 把相关 Context、Expression 和 Sense
整理并保存到 Sensa，而不需要回到 Web 重复录入。

### 8.2 信息完整：明确委托保存

```text
用户在 Agent 会话中明确要求“存入我的语义世界”
    ↓
Agent 整理 Context
    ↓
定位 Expression occurrence + Language Tag
    ↓
解析或构造 teaching-sufficient Sense
    ↓
用户明确调用保存；连接派生 delegated Semantic Acceptance
    ↓
提交统一 Semantic Intake facts
    ↓
本地 Personal Semantic World authority 应用
    ↓
Personal Meaning
```

当前 Agent 会话中的一次明确请求可以构成 one-shot delegated acceptance basis，不要求额外 grant id，
也不要求用户回到第一方界面二次确认。Agent 不自行填写 acceptance 身份；Sensa 从可撤销连接派生并保存
actor 与 basis，Sense resolver provenance 仍记录真正完成解析的一方。

### 8.3 信息不完整：进入共同 Inbox

```text
Agent 提交部分事实
    ↓
接收端按字段存在性机械分流
    ├─ 缺 Context ───────▶ pending_context
    ├─ 缺完整 Expression ▶ pending_expression
    └─ 缺 Sense ─────────▶ pending_sense
                               ↓
                         Intake Inbox
                               ↓
                         用户继续澄清
                               ↓
                         Personal Meaning
```

接收端只校验字段、类型、定位关系和大小限制，不重新判断 Agent 给出的 Context 是否“足够好”，也不
为了直接写入再次调用模型。

### 8.4 Agent 连接与交付

```text
用户选择 Agent 客户端并创建一次性 setup code
    ↓
安装器直接兑换长期凭据并安装/配置 MCP/CLI adapter
    ↓
Codex Skill 或 MCP prompt/tool 提供领域命令说明
    ↓
Agent 调用 save（Sensa 派生连接身份与 acceptance）
    ↓
账号范围 Remote Intake Delivery mailbox
    ↓
queued
    ↓ 用户 Web 登录、联网且本机 library identity 已恢复
Web 拉取同一 canonical payload
    ↓
本地 authority 按同一完整性规则决定直接写入或 Inbox
    ↓
applied + 真实结果
```

浏览器扩展不在这条链路中。Skill 类似领域斜杠命令：告诉 Agent Sensa 需要的数据格式和如何解释回执，
但不是事实完整性检查器。云端邮箱不是云端语义库，也不是备份；`queued` 只说明云端持久接收；
`applied` 才说明本地库已创建 Personal Meaning 或 Intake Inbox Item。复制命令只带约十分钟有效的一次性
setup code，不带长期 token。连接可在设置中查看 last-used 和生命周期审计、原子更新或立即撤销；安装器
可以安全重试并只卸载自己管理的本机配置。默认每个连接每小时最多产生 120 个新 operation。

### 8.5 加入学习

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
| Web 原生创建 | 完整则 Personal Meaning；不完整则 Intake Inbox Item | 是，闭合并接受后 | 否 | On-demand 或 Hybrid |
| 浏览器捕获 | 完整则 Personal Meaning；不完整则 Intake Inbox Item | 是，或补全后 | 否 | 明确加入后 On-demand/Hybrid |
| Agent 委托 | 完整则 Personal Meaning；不完整则 Intake Inbox Item | 是，或补全后 | 否，需独立授权 | 明确加入后 On-demand/Hybrid |
| 学习中的我的场景 | Personal Learning Scene | 可选，明确保存后 | 不适用；目标已存在 | 继续使用当前 Learning Target |

## 13. 当前产品入口与未来扩展

当前产品支持：

- Web 内创建、澄清、治理、加入学习和学习运行时；
- 浏览器扩展的网页/字幕捕获、解释、确认和待处理保存；
- 外部 Agent 的 skill + MCP/CLI adapter + 账号范围 mailbox delivery；
- 已发布学习包的发现、下载、加入、更新与运行；
- 学习包运行时中的 Personal Learning Scene bridge。

未来入口可以包括移动端分享、拍照、录音、桌面助手或其他 Agent。新增入口不得创建另一套 Personal
Meaning、Inbox、Acceptance 或 Add-to-Learning 语义；它只需要提供当前能够取得的 Intake facts，并使用
同一幂等 Semantic Intake authority 完成基于事实完整性的直接写入或 Inbox 分流。
