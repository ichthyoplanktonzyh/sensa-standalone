# Sensa 用户旅程

本文定义 Sensa 当前产品图景中的端到端用户旅程，说明学习者、内容发布者、发布操作者和支持人员如何从
真实目标出发，经过跨页面、跨设备或跨系统状态，最终到达可观察的产品结果。本文关注用户意图、状态转换、
系统责任、成功出口和恢复出口，不复制数据库结构、DTO、页面组件、测试清单或开发进度。

## 1. 文档定位

- `CONTEXT.md` 与领域模型定义对象、身份、权限和不变量；本文不能覆盖它们。
- `product-requirements-v1.md` 定义当前 Web 产品体验；本文把跨页面、跨入口的主旅程集中展开。
- Web、浏览器扩展和 Agent Intake 是当前产品入口。未来手机端、桌面端、拍照、语音或分享入口可以接入
  同一 Semantic Intake 边界，但不属于当前交付承诺。
- 本文中的“个人语义世界”指 learner-owned Personal Semantic World；同名 Web 页面只是它的读取、治理、
  Inbox 处理和学习交接控制面。
- 长旅程不是页面列表，也不是把相邻功能任意串长。每条长旅程必须有一个明确 actor、一个真实目标、连续的
  状态转换、用户可观察的 checkpoint，以及成功、停止或恢复终态。
- 本文使用稳定的 `LJ-*`、`SJ-*` 和 `OJ-*` 标识，供后续 `Journey → Phase → Scenario → Test Evidence`
  映射使用。标识描述产品语义，不绑定某个组件或测试文件。

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

## 5. 长旅程分类与索引

Sensa 的长旅程分成三层：

- **学习者主旅程（`LJ-*`）**：从学习者目标出发，到达语义、学习、连续性或数据控制结果；
- **支撑旅程（`SJ-*`）**：配置后续主旅程所需的路线、连接、Provider 或产品呈现，不自行制造学习结果；
- **运营旅程（`OJ-*`）**：内容供应、生产发布和支持恢复，由不同权限角色完成。

语言路线、账号/设备范围、失败恢复、Provider 可用性、隐私权限和版本连续性不是第四类业务旅程。它们是
横切覆盖层，必须叠加到每条适用主旅程的 Phase 和 Scenario 上。

### 5.1 学习者主旅程

| ID | 用户目标 | 主入口与可观察终态 | 当前边界 |
| --- | --- | --- | --- |
| `LJ-00` | 第一次打开 Sensa 并开始本机使用 | 公开入口 → 建立或恢复本机资料库 → Today 可用 | 不要求先登录；账号连接是可选后续 |
| `LJ-01` | 从公开 Book 开始长期学习 | Catalog → Book 详情 → 下载/安装 → 明确加入 → 共同学习主干 | Catalog 可匿名浏览；安装不等于加入学习 |
| `LJ-02` | 导入、导出或分享一个 Portable `.sensa` | 只读预览/合格内容快照 → 明确安装或导出 → 本机拥有可复用包 | 不携带进度、Evidence 或调度；加入学习是后续动作 |
| `LJ-03` | 从真实材料形成个人意义 | Web、扩展或 Agent Capture → Semantic Intake → Personal Meaning 或 Inbox | 快轨/慢轨是事实完整性分支，不是不同旅程 |
| `LJ-04` | 处理待确认材料 | Inbox → 补 Context/Expression/Sense/Acceptance 或丢弃 → Meaning/Discarded | 必须继承原来源、媒体和已知事实 |
| `LJ-05` | 从已有 stable Sense 直接学习 | 搜索/Reference/Reviewed Lookup → 选择 Binding 与 Route → Add-to-Learning | 不要求创建 Personal Meaning；Reference-only 结果不冒充 stable Sense |
| `LJ-06` | 明确把一个来源加入正式学习 | Learning Source → 固定 Route 和 consent → Provisioning → Ready/Blocked | 意图、材料准备和 Ready 是三个状态 |
| `LJ-07` | 完成首次正式学习 | Ready Plan → Initial Learning Run → Completion → Scheduling Handoff | 只有 Runtime 可产生正式完成事实 |
| `LJ-08` | 完成一次到期复习 | Due Retention Target → Review Run → Memory Outcome → 新调度 | 每次 Review 至多结算一次 |
| `LJ-09` | 在遗忘或薄弱后重新建立连接 | Relearning Eligible → 独立 Run → Completion → 返回 Retention | 不重复结算触发它的 Review |
| `LJ-10` | 长期维护学习范围和计划 | Route/Book/补充目标 → Scope、每日数量、更新、暂停/恢复 → 可解释的未来计划 | Book 模式与整本／序号范围及明确结束活动可维护；完整补充目标移除、规模与跨设备冲突验收仍有缺口 |
| `LJ-11` | 回看和治理个人语义内容 | Personal Semantic World/Markers → 搜索、查看、修订、标记或移除 → 新 revision/明确终态 | 删除进入回收站；明确恢复原身份，历史与学习互不级联 |
| `LJ-12` | 把学习中的个人场景长期保存 | Runtime Scene → Scene Revision → 明确接受 → Personal Meaning Anchor | 编辑场景不会自动改写已接受 Meaning |
| `LJ-13` | 在网页中阅读、解释、写作或朗读 | Extension 阅读/写作入口 → 真实结果或准确不可用状态 | 保存到 Sensa 是可选分支，不制造学习事实 |
| `LJ-14` | 只读查询表达、Sense、例句或来源 | 固定 occurrence/context → Reference Lookup → 返回原任务 | 查询不自动保存、不自动加入学习 |
| `LJ-15` | 获得真实语流暴露 | Practice Scope → 当前已交付 Listening Activity → 播放/失败/空态终点 | 不产生正式 Evidence；不代表完整 Free Practice Profile 已交付 |
| `LJ-16` | 在账号、设备和离线状态之间继续使用 | 本机事实 → 可选账号连接/新设备恢复 → Sync/Merge/Conflict → 继续 | Sync 是 checkpoint，不是历史备份 |
| `LJ-17` | 用本机加密文件保护和恢复资料 | Export → 加密备份 → 空库预览/验证 → 原子恢复 | 账号云端 Recovery Point 是后续能力 |
| `LJ-18` | 退出在线账号但保留正确的数据范围 | Sign-out → 本机会话结束 → 本机资料库仍可用 | 不等于本机清除或账号删除 |
| `LJ-19` | 清除当前浏览器上的本机资料 | Review impact → Sync 或明确丢弃 pending → Local Clearance | 不删除云端账号副本 |
| `LJ-20` | 永久删除账号与在线服务数据 | 在线重新认证 → Deletion Pending → Deleted/明确失败 | 其他离线设备和用户导出文件需另行处理 |

### 5.2 支撑旅程

| ID | 配置目标 | 成功出口与边界 |
| --- | --- | --- |
| `SJ-01` | 建立、选择、修改、暂停、归档或恢复 Language Learning Route | 后续新操作使用明确 Route；已开始的 Session 不被重绑 |
| `SJ-02` | 连接、替换、撤销 Extension 或 Agent | 新连接成功后才替换旧连接；排队、应用和撤销状态可区分 |
| `SJ-03` | 配置模型、语音或其他 Provider | 特定 purpose 得到真实可用/不可用状态；保存配置不等于执行成功 |
| `SJ-04` | 配置界面语言、Skin、字号和无障碍偏好 | 后续页面保持行为语义与数据不变 |

### 5.3 运营旅程

| ID | Actor 与目标 | 成功出口与边界 |
| --- | --- | --- |
| `OJ-01` | 内容作者/策展者制作并验证候选 | 得到通过确定性校验的冻结候选；尚未公开发布 |
| `OJ-02` | 有 capability 的 Publisher 检查候选 | `/publisher` 展示候选身份、路线、成员和 digest；不改变 Registry |
| `OJ-03` | 受保护内容发布流程公开候选 | 不可变对象验证完成，Registry 指针提升，Catalog 可发现；失败时旧 Registry 保持可用 |
| `OJ-04` | Release operator/自动编排器发布应用 | 固定 CI candidate → 部署 → 公网 smoke → system release manifest |
| `OJ-05` | 支持人员安全定位和恢复问题 | 使用脱敏诊断与精确边界复现；不索取用户内容、token 或备份密码 |

### 5.4 组合规则

长旅程不是彼此孤立的脚本。入口旅程会汇入共享主干：

```text
Book / Portable / Personal Meaning / stable Sense
                     │
                     ▼
                 LJ-06
     Add-to-Learning + Provisioning
                     │ ready
                     ▼
                 LJ-07
              Initial Learning
                     │ handoff
                     ▼
                 Retention
                     │ due
                     ▼
                 LJ-08 Review
                     │ weak / failed
                     ▼
                 LJ-09 Relearning
                     └──────────────▶ Retention
```

`Today` 是 `LJ-07`、`LJ-08` 和 `LJ-09` 的任务分派入口，不自行产生学习结果。Extension 的完整/不完整
Intake、Book 的只下载、Personal Meaning 的只保存，以及学习中的 Scene Bridge，都是主旅程中的合法分支或
停止点，不能被强制串成每个用户都必须完成的一条超长脚本。

## 6. `LJ-01`：从学习包进入学习

### 6.1 用户目标

用户选择一部由 Sensa 发布的稳定 Book，下载适用于当前目标语言/支持语言路线的版本，明确加入学习，
然后完成初次学习、保持复习和必要重学。

### 6.2 内容发布前置旅程

```text
作者化 Book 内容
    ↓
固定 Book / Book Version / Content Release
    ↓
为每个 Lightweight member 生成并校验 `.sensa`
    ↓
构建内嵌有序 Package identity/version Manifest 的 `.sensa-book`
    ↓
上传并公开验证全部 `.sensa-book`（包含逐成员 Portable 校验）
    ↓
上传按 digest 寻址的 Registry Revision
    ↓
提升服务端发现指针
```

发布后的 Registry、`.sensa-book`、`.sensa` 和对象路径不得原位覆盖。发布失败时，上一版 Registry 必须继续
完整可用。Sensa Official 内容通过额外发布门禁和 Registry provenance 获得策展身份，但仍使用与本地
导入、私人分享和外部作者相同的 Portable Runtime 准入合同。

### 6.3 用户主流程

```text
公开学习包目录 `/catalog`
    ↓ 跨路线发现 Book
稳定 Book 详情 `/catalog/:bookKey`
    ↓ 用户点击下载
下载并验证一个 `.sensa-book`，通过统一入口原子安装其 `.sensa` 成员
    ↓ 大小 / digest / 合同 / 语言方向 / 资源校验通过
我的学习包 `/library`
    ↓ 用户明确点击“加入学习”
当前路线与 Book 路线精确匹配
    ↓
Book Enrollment + Curriculum Membership + Learning Target
    ↓ ready plan
初次学习运行时
    ↓ completion + scheduling handoff
Retention
    ↓ 到期
复习 / 必要时重学
```

### 6.4 关键分支

- **只发现新版**：只显示更新状态和作者变更摘要，不自动下载、不改变课程。
- **只下载完成**：资源已安装，但尚未加入学习，不产生目标、进度或调度。
- **语言路线不匹配**：解释目标语言或支持语言不匹配，并引导用户切换路线；不得隐式回退或重标语言。
- **目录与资料库分离**：Catalog 可以展示未下载及其他路线的公开 Book；Library 只能展示本机实际拥有的
  Book/Package，刷新目录不能改变 Library 所有权状态。
- **发布后台**：只有服务端授予 `publishLearningContent` capability 的管理员可以看到 `/publisher`；
  候选验证不等于发布，Registry 提升仍通过受保护 release workflow。
- **应用新版**：必须由用户明确操作。新增条目只进入未来学习；删除条目只退出未来计划；身份未变的
  目标保留进度、复习和历史；已经开始的运行不增删 participant，兼容材料更新可刷新尚未操作的当前
  Step 和未来 Step，已经操作的 Step 保留实际材料。
- **运行中断**：保留同一 Run、逐步材料和已提交动作，恢复时不得重新生成或跳过保存。

### 6.5 成功出口

- 用户拥有一个或多个 ready Learning Targets。
- 初次学习完成后，同一目标进入 Retention，并根据正式 Memory Outcome 安排复习。
- 该旅程不要求、也不自动创建 Personal Meaning。

## 7. `LJ-03` 与 `LJ-06`：从 Web 原生创建进入学习

### 7.1 用户目标

用户从自己的经历、上下文、图片、已经知道的表达或“我想表达但不会表达”的意图出发，在 Sensa 中
完成澄清，保存为个人意义，并在需要时把它加入正式学习。

### 7.2 主流程

已明确知道意思的用户可以从“我的语义世界 → 添加内容 → 手动创建”直接填写完整关系：
情境或原句 → 原文中一次精确出现的表达（可另填原形）→ 语言、意思与典型场景 → 确认并保存。
此分支不调用 AI；未点击确认时只有本机编辑草稿。接受后汇入同一个普通 Personal Meaning 详情，
学习仍须另行明确加入。不得省略 Context 或用自动生成的场景冒充用户已确认的意义。

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

### 7.3 澄清原则

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

### 7.4 加入学习和内容准备

- Add-to-Learning 固定用户操作当时的路线，不会因之后切换当前路线而迁移。
- target Language 必须与路线兼容；support Language 作为当前材料和运行上下文保存。
- 是否允许内容生成使用个人 Context，由用户单独授权。未授权时仍可基于固定 Sense 和 Binding 生成。
- 生成、审核或校验失败时保留可恢复状态；不得创建可开始的假目标或伪造 ready。
- Web 内容生成 Agent 的成功出口是 learner-private Materialization，不是 Published Package。只有用户
  另行选择导出/分享时，系统才从合格内容快照构建 `.sensa`，且不携带进度或调度。
- 资源 ready 后，个人来源和学习包来源使用同一个学习运行时、Evidence 和 Retention 边界。

### 7.5 成功出口

- 只保存：完整 Personal Meaning 位于个人语义世界，没有学习进度。
- 加入学习但准备中：拥有明确学习意图和 `preparing` 状态，尚不能运行。
- 准备完成：拥有 ready Learning Target，可进入初次学习运行时。

## 8. `LJ-03`：从浏览器插件捕获

### 8.1 用户目标

用户在真实网页或字幕中遇到内容时原位理解并保存，不需要先打开 Sensa 页面重复录入。

### 8.2 信息完整：解释并确认

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

### 8.3 信息不完整：先保存，之后澄清

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

### 8.4 状态与失败处理

- 插件必须区分“仍在插件队列”和“Web 已持久化”。
- Web 未打开、网络中断或回执未知时保留同一 operation id 幂等重试。
- 捕获语言不在当前学习路线中，不应阻止保存；是否能加入当前路线的学习在 Add-to-Learning 时判断。
- 页面来源、选择位置与捕获 provenance 必须随 Intake 保存，慢轨澄清不能丢弃原始来源。

### 8.5 成功出口

- 完整提交成功：得到完整 Personal Meaning，可继续治理或加入学习。
- 不完整提交成功：Inbox Item 保留全部已知事实和来源，等待补全。
- 传输未完成：材料仍在插件持久队列，不宣称已经进入语义世界。

## 9. `LJ-03` 与 `SJ-02`：从 Agent 进入

### 9.1 用户目标

用户在 Codex 等 Agent 中完成真实工作或交流后，直接要求 Agent 把相关 Context、Expression 和 Sense
整理并保存到 Sensa，而不需要回到 Web 重复录入。

### 9.2 信息完整：明确委托保存

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

### 9.3 信息不完整：进入共同 Inbox

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

### 9.4 Agent 连接与交付

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

### 9.5 加入学习

Agent 的 semantic-world commit 权限不包含 Add-to-Learning。Agent 创建的 Personal Meaning 与 Web、
浏览器创建的 Personal Meaning 具有同等地位；之后必须由 learner 明确加入学习，或由拥有独立
Add-to-Learning grant 的 Agent 提交，才能进入内容准备和学习运行时。

## 10. `LJ-12`：从学习运行时建立“我的场景”

### 10.1 用户目标

用户在学习包提供的公共场景之外，加入更贴近自己经历的文字或图片，让当前表达与自己的真实世界
建立连接；在确认有长期保存价值时，再把它存入个人语义世界。

### 10.2 编辑和学习流程

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

### 10.3 存入个人语义世界

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

### 10.4 后续更新

- 编辑“我的场景”只产生新的 scene revision，不自动修改已接受的 Personal Meaning。
- 并发编辑不静默覆盖当前场景；保留草稿并明确选择最新内容或自己的版本。读取失败不冒充场景不存在。
- 用户可以再次明确提交新 revision，更新同一个 Personal Meaning 的 Anchor revision。
- 若用户已在语义详情独立替换情境，再次存入学习场景会保留其现有整理，并把新场景追加到同一意义；
  不复活已退役素材、不创建第二条意义，也不覆盖用户的新情境。
- 删除或更新 Book 不删除 Personal Meaning；删除 Personal Meaning 也不影响场景历史、Learning Target、
  Retention、Protocol history 或 Evidence。

## 11. `LJ-04`：Inbox 的统一处理旅程

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

“手动补全”与“继续对话”是同一条 Inbox 的两种处理方式。前者预填已知事实，支持按意思／表达查找本机
已有 Meaning 并选择其 Sense 版本；点选不提交，明确确认后才原子消费原 Inbox。用户改写的 Context 与原始
文本／来源分别保留，原媒体不能因补全被隐式移除。已有图片 occurrence 可继续使用，不补造文字位置。
草稿关闭／刷新可继续；来源变更与版本失效必须拒绝旧操作，并保留用户填写内容供重新核对。

## 12. `LJ-07` 至 `LJ-09`：学习运行时的共同出口

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

## 13. 入口汇合表

| 入口 | 首个正式对象 | 是否必须进入个人语义世界 | 是否自动加入学习 | 进入运行时前的资源路径 |
| --- | --- | --- | --- | --- |
| 学习包 | Book Enrollment / Curriculum Membership | 否 | 否，需明确加入/应用 | Published Materialization |
| 本机 `.sensa` | Portable Package Installation | 否 | 否，预览和安装均不加入学习 | Package Materialization |
| Web 原生创建 | 完整则 Personal Meaning；不完整则 Intake Inbox Item | 是，闭合并接受后 | 否 | On-demand 或 Hybrid |
| 浏览器捕获 | 完整则 Personal Meaning；不完整则 Intake Inbox Item | 是，或补全后 | 否 | 明确加入后 On-demand/Hybrid |
| Agent 委托 | 完整则 Personal Meaning；不完整则 Intake Inbox Item | 是，或补全后 | 否，需独立授权 | 明确加入后 On-demand/Hybrid |
| 已有 stable Sense + target Binding | Learning Entry / Curriculum Membership | 否 | 否，需明确加入 | Published、On-demand 或 Hybrid |
| 学习中的我的场景 | Personal Learning Scene | 可选，明确保存后 | 不适用；目标已存在 | 继续使用当前 Learning Target |

## 14. 当前产品入口与未来扩展

当前产品支持：

- Web 内创建、澄清、治理、加入学习和学习运行时；
- 浏览器扩展的网页/字幕捕获、解释、确认和待处理保存；
- 外部 Agent 的 skill + MCP/CLI adapter + 账号范围 mailbox delivery；
- 已发布学习包的发现、下载、加入、更新与运行；
- 学习包运行时中的 Personal Learning Scene bridge。

未来入口可以包括移动端分享、拍照、录音、桌面助手或其他 Agent。新增入口不得创建另一套 Personal
Meaning、Inbox、Acceptance 或 Add-to-Learning 语义；它只需要提供当前能够取得的 Intake facts，并使用
同一幂等 Semantic Intake authority 完成基于事实完整性的直接写入或 Inbox 分流。

## 15. `LJ-00`：首次使用与本机资料库

第一次打开 Sensa 时，用户目标是进入一个真实可用且可持续保存的本机产品，而不是先完成注册。

```text
公开 Landing / Welcome / How it works
    ↓ 用户进入产品
检查浏览器持久化能力
    ↓
建立或恢复本机 Library / Learner / Device identity
    ↓
Today 与本机功能可用
    └─ 可选：连接账号或继续访客使用
```

- 初始化、账号恢复或远端同步尚未完成时，UI 不得把未知状态显示为确定的零或空库。
- 缺少 OPFS、Worker、Web Locks 等必需能力时，应明确阻止不安全的 volatile fallback。
- 连接账号前，必须检查本机和云端资料范围；两边均非空时保留双方并进入显式冲突处理。
- 首次使用的成功出口是“本机产品可用”。登录、跨设备恢复和同步属于 `LJ-16`，不是进入产品的前置条件。

## 16. `LJ-02`、`LJ-05` 与 `LJ-06`：学习来源准入

### 16.1 Portable `.sensa` 导入、导出与分享

`.sensa` 是一个原子 Portable Learning Package。它与 Catalog 下载的 `.sensa-book`、整库 `.sensa-backup`
和账号同步对象不同。

```text
选择本机 `.sensa`
    ↓ 只读解析和预览
显示作者、许可、语言方向、表达和意义
    ↓ 用户明确确认
校验并原子安装
    ↓
Library 中可见
    └─ 可选：明确 Add-to-Learning
```

- Preview 必须只读；相同字节重复导入应幂等，相同 identity/version 的不同内容必须拒绝冲突。
- 路线不匹配时允许保存，但不能加入当前路线；不得隐式重标语言或降级版本。
- 用户从合格内容快照显式导出/分享 `.sensa` 时，不得携带 Personal Meaning、私有笔记、学习进度、
  Evidence、Run、Retention 或调度状态，也不能自称 Sensa Official。
- 非公开 Portable Package 没有可重新取得来源时，换设备或恢复后必须明确要求用户重选并验证原文件；
  不能仅凭安装记录伪造资源 Ready。

### 16.2 direct stable-Sense entry

个人语义世界不是正式学习的必经入口。用户可以从搜索、词典或 reviewed Contextual Lookup 选中已有的
stable Sense 和 target Binding，再明确加入当前路线：

```text
找到 stable Sense
    ↓ 选择 target Binding
确认当前 Route
    ↓ 用户明确 Add-to-Learning
共同 Provisioning / Ready / Runtime 主干
```

Web 的“添加内容 → 按表达查找”检索本机已有的稳定连接和已安装发布包，选择后预览固定意义、表达与 Route，
明确加入后才保存学习意图。已发布且语言匹配的材料可直接准备，否则由用户明确启动按需准备；失败或中断的
意图可从学习列表找回并重试。没有稳定 Sense/Binding 的 Reference-only 结果不得伪造为可加入的连接。
该路径不得作为副作用创建 Personal Meaning，也不要求用户先给已有稳定 Sense 补造私人 Context。

### 16.3 Add-to-Learning 与 Provisioning

所有正式学习来源最终经过同一准入边界：

1. 解析稳定 Sense Version 与 target Binding；
2. 固定用户操作当时的 Route、支持语言、来源和 Context consent；
3. 写入明确的 Curriculum intent/membership，不制造完成或调度；
4. 解析 Published、On-demand 或 Hybrid 资源；
5. 经 required validators 通过后冻结 Materialization；
6. 对用户显示 `preparing`、`blocked`、`failed` 或 `ready` 的真实状态。

相同 Route 下已由 Book 或其他 Membership 覆盖的同一目标必须返回 `already in scope` 或复用现有目标，不能因
Personal Meaning、Scene Bridge 或另一来源再次加入而创建竞争目标或静默替换当前材料。

## 17. `LJ-07` 至 `LJ-10`：持续学习与课程治理

### 17.1 Initial Learning、Review 与 Relearning

- `LJ-07 Initial Learning` 只消费 Ready Plan。首次 Run 固定目标、路线、策略、协议、课程来源和材料基线；
  中断后恢复同一 Run 和已保存步骤。
- `LJ-08 Review` 只处理真正到期的 Retention Target。一次 Review 最多产生一个有效 Memory Outcome 和一次
  调度更新。
- `LJ-09 Relearning` 是由 Review 结果或明确修复条件触发的独立 purpose。它不重复评分原 Review，不默认
  重新初始化 FSRS，完成后返回 Retention。
- `Today` 只负责读取真实队列并分派 Start、Resume、Review 或 Relearning；Today 的空态、按钮或计数不能
  自行成为学习结果。

正式长流程必须覆盖跨日连续性：开始、退出或关闭、重新打开、恢复、完成、到期、Review、必要 Relearning，
同时保持同一目标身份、固定的 Run 事实和恰好一次的结算。

### 17.2 Curriculum 与 Study Plan 治理

用户长期维护的是每条 Route 下“学习什么、以什么节奏、用哪些来源”，而不只是第一次点击加入：

- 选择 Book Range、补充目标、每日新学数量与允许策略；
- 只发现 Book 新版、下载新版和显式应用新版必须分开；
- 新增成员只进入未来计划，删除成员只退出未来计划，未变化目标保留历史与 Retention；
- 已开始 Run 不增删 participants；已操作 Step 保留当时材料；
- 暂停可继续原 Session；明确结束本次学习不产生完成或调度，之后开始按新计划建立 Session，
  并在当前范围允许时恢复原 Run 的已保存步骤。保存失败留在原步骤，丢回执只重读不重提交；
- Enrollment `active / maintenance / paused` 保留进度并支持恢复；词书与范围安排影响下一条尚未开始的内容，每日数量仍从后续会话生效。
  不得用删除 Package 或删除历史替代暂停；
- 用户“声明已会”是可撤销的 planning override：可以排除目标并中断非终态 Run，但不产生 Evidence、Outcome
  或 FSRS 更新；撤销只恢复计划资格，不自动恢复旧 Run；
- 修改 Support Language 或 Route revision 只影响未来操作和新材料。旧 Run 按 pinned context 继续；未来
  计划必须准备匹配新语言的材料，或者显示真实 Blocked/Preparing 状态。

## 18. `LJ-11`：个人语义世界的持续治理

当前 Web checkpoint 覆盖个人内容的回看、修订、收藏／笔记、资源更新及回收站闭环。
公共 Sense 的 revision／split／relation 审查、轻量主线新增例句收藏入口保留待建设，不以个人纠正或内部
Structured 分支认领完成。默认界面收起已确认空的例句收藏；已有收藏及其可用回看入口保留，来源缺失不冒充空库。

Personal Semantic World 不是只写不读的 Intake 终点。用户可以反复回到已积累内容：

```text
Personal / Learning / Markers / Inbox
    ↓ 搜索、筛选或打开详情
查看 Personal Meaning、Sense、Expression、Context、来源与媒体
    ├─ 修订 Context / Anchor
    ├─ 补充 Binding
    ├─ 收藏、笔记或其他 Personal Content
    ├─ 明确加入学习
    └─ 删除/恢复或解决并发冲突
```

- Context 或 Anchor 更新产生新 revision，不抹除原 Semantic Acceptance 或 provenance。
- 纠正意思或表达需审阅当前 Context 并明确保存；原材料、原解释和学习历史保留。旧解释的收藏与笔记仍可
  从 Markers 找回并编辑原 Sense 的笔记，不跳到修改后的意思，也不自动重新加入学习。
- Personal Meaning 删除必须使用 tombstone；旧离线副本不得把它复活。删除不能级联删除 Learning Target、
  Run、Evidence、Retention、FSRS 或 Personal Learning Scene。
  回收站恢复必须追加明确的新生命周期事实并保留原删除修订；删除项只读，恢复不重做 Semantic Acceptance。
- Inbox 是待处理区，不是稳定内容库；处理完成后必须进入 Personal Meaning 或明确 discarded 终态。
- 不同 operation id 的相似捕获不能仅凭表面形式或 Sense 自动合并。精确重试幂等与跨捕获语义去重是两个
  问题；在产品规则明确前，应保留来源和用户选择，不能静默覆盖。
- Scenes/Collections 等尚未交付的 UI 不因存在占位页面而成为已完成旅程。
- 从实际学习包收藏、记笔记后，用户无需先创建 Personal Meaning 或完成学习，也能在 Markers 找回
  原内容。实际学习连接按 Target 保留；共享 Sense 的不同表达不合并学习状态。读取失败不冒充空列表，
  重读恢复原引用且不创建学习结果。

## 19. `LJ-13` 至 `LJ-15`：阅读、参考与练习

### 19.1 浏览器扩展日常阅读与写作

扩展不只是一条 Intake 管道。它还支持用户在原网页中完成即时目标：

- 按扩展自己的当前 Route 与术语表解释或翻译选区、页面和字幕；
- 使用设备端语音逐块朗读，并在无合适 voice 时准确显示不可用；
- 对可编辑输入框提出明确写作转换，并由用户决定是否替换原文字；
- 使用站点排除与权限规则控制哪些页面可读取；
- 用户另行选择保存时，才进入 `LJ-03` Semantic Intake。

临时解释、翻译、朗读或改写不会创建 Personal Meaning、Learning Target、Evidence 或调度事实。

### 19.2 Lexical Reference

Reference 是只读查询：用户从一个确切 occurrence 或当前学习材料打开 Sense、例句、词典信息或来源，阅读后
返回原任务。查询可以成为“保存”或“加入学习”的显式入口，但查询成功本身不创建用户数据，也不改变
当前 Run。

当前 Web 公开查询使用在线 prototype 词典；其查询、例句往返与失败出口按实际交付路径验收。固定可下载
Reference Release 和离线索引尚未交付，在线结果及其测试不能替代这部分保证。
当前 `LJ-14` 以在线只读查询、确切来源查阅及返回原任务作为收口范围；固定离线词典保留为待建设能力，
不纳入这条已交付主线的通过声明。它交付后仍须单独验证固定版本、离线索引与恢复保证。

学习揭示阶段的 AI Q&A 属于定义中的可选能力，但当前没有完整接入。交付前不得把 Reference 展示测试或普通
模型调用当作 Q&A 已可用；交付后回答也不能改写固定材料或学习结果。

### 19.3 当前 Listening 与未来 Free Practice

当前产品可提供真实语境 Listening Activity：选择范围和表达、加载外部语流、播放、暂停、切换或重试。
无目标、无结果和 Provider 失败必须有不同空态/错误状态。它不写入正式 Evidence、Completion 或 FSRS。
材料按表达组织，当前聆听只需表达文本与语言；个人表达与已下载词书表达不以学习 enrollment 为准入条件。
浏览、搜索、轻量选择、启动当前表达和重开恢复分别验收，不以全量 Meaning／Target 快照代表材料正确性。
返回再进入与刷新继续同一表达；明确重选材料后重新开始，原表达不可用时如实提供重选或重试。

完整 Free Practice Profile 的 listening、speaking、reading、writing 活动、Practice Turn/Feedback 和历史属于
后续能力。可见但禁用的 tile 不是已交付旅程。
未交付活动不进入默认练习入口；当前活动的无内容状态仍需让用户能选择内容或返回原任务。
个人来源的加载或读取失败不得把已存选择改成当前学习内容；目标语言变化后必须重新核验来源，不能启动旧语言
内容。已核验的个人来源不依赖无关学习区读取成功。规模验证区分练习入口、内容选择、全选使用和开始聆听的
本机处理时间与外部媒体等待；文字库、正式学习目标和媒体规模分别声明，不互相替代。

## 20. `LJ-16`：账号、设备、同步与冲突

### 20.1 账号连接与新设备恢复

```text
已有本机资料或空本机库
    ↓ 用户登录
检查 Account / Library owner 与云端 head
    ├─ 本机非空、云端空：连接并首次上传
    ├─ 本机空、云端非空：恢复资料和精确安装事实
    ├─ 两端非空：保留双方，等待显式冲突决定
    └─ owner 不符：停止并要求原账号或明确的新流程
```
预检未完成或失败时，空设备的资料仍未知，不显示确定的空清单或零学习。用户可以明确重试恢复或进入
设置处理账号；在初次恢复完成前不运行学习规划。已有可用本机事实继续离线/本机使用，失败不回退为假空库。

路线集合属于 learner data，可以恢复；Web 与 Extension 的 active Route selection 属于设备偏好，不跨设备
同步。新设备必须让用户看清当前回退或选择的路线，不能暗示旧设备 selection 已恢复。

### 20.2 离线工作与同步

本机事务在离线时仍是权威提交。联网后，同步通过稳定 operation、content-addressed blocks、CAS head 和
三方合并形成新的 Cloud Checkpoint。`pending`、`offline`、`failed` 与 `synced` 必须分别显示；同步成功只
说明当前 checkpoint，不是历史恢复点。

### 20.3 冲突与学习历史 Reconciliation

- 普通内容冲突必须保留 base/local/remote 的可理解差异，并在写入前重新验证 head revision；
- Personal Semantic World 的 delete-vs-edit 不按时间猜测；
- 个人意义明确裁决须跨设备传播：未再修改的另一端采用同一结果，未选分支、操作收据、媒体及历史学习 pin 仍可验证；后续离线新改动或相反并发裁决不能被旧选择覆盖；
- 两设备并发完成的学习 Run 不能使用通用“保留本机/使用云端”。两边 Run/Event 均保留，由版本化
  reconciliation decision 决定当前 Memory/Schedule 分支，另一支成为 history-only，不重复结算；
- 多标签页共享一个 OPFS 资料库，由单一 owner 和 Web Locks 协调；旧页面或旧 schema 不得越权写入。

## 21. `LJ-17` 至 `LJ-20`：备份与数据控制

### 21.1 本机加密备份与恢复

用户可以从可读的当前 Library 导出加密 `.sensa-backup`，在允许的空资料库中先预览、核对 owner 与摘要，
再原子恢复。错误密码、损坏文件、非空目标库或 owner 不匹配不得产生部分写入。公共资源的后续 rehydrate
失败可以延后处理，但不能回滚已经成功恢复的 learner facts。

Account Cloud Checkpoint 不是备份。不可变 Account Recovery Point、服务端备份路由和历史恢复流程属于
后续能力；在它们交付前，产品必须如实说明“没有事先导出的本机备份时，历史状态可能无法恢复”。

### 21.2 三个不同的数据控制目标

| 目标 | 用户可观察终态 | 必须保留的边界 |
| --- | --- | --- |
| Sign-out (`LJ-18`) | 当前浏览器结束在线会话，本机 Library 仍可用 | 不删除本机或云端数据；不同账号不能自动认领旧 Library |
| Local Clearance (`LJ-19`) | 当前浏览器得到新的空 Library | 先同步 pending 或明确确认丢弃；不产生云端删除 tombstone |
| Account Deletion (`LJ-20`) | 在线账号进入 `deletion_pending` 后完成删除，或停在明确失败状态 | 需要近期重新认证；阻止旧 session/outbox 复活账号；其他离线设备和导出文件需另行清理 |

服务端范围的 Data Export Request 与本机 Library Backup 也不是同一能力。若未来提供账号数据导出，必须有
独立的范围选择、请求状态、一致快照和交付终态。

## 22. 支撑旅程与横切覆盖层

### 22.1 Language Route

所有语义、内容和学习旅程都必须说明何时读取当前 Route、何时固定 Route revision，以及切换后哪些状态不变：

- Capture 保存材料的绝对语言事实，不因当前 Route 重标；
- Add-to-Learning 固定当时的 Web Route；Extension 阅读使用扩展自己的 selection；
- Curriculum membership、材料、每日计划和 Personal Learning Scene 按 Route；
- 兼容路线可共享同一稳定 Learning/Retention Target；
- active Route 切换只影响未来操作，活动 Run 按原 pinned context 恢复；
- 暂停或归档 Route 不删除历史，也不能隐式迁移 membership。

### 22.2 Recovery 与幂等

每条适用长旅程必须至少覆盖：刷新、后退、关闭重开、断网重连、重复点击、lost acknowledgement、过期凭据、
跨标签/设备并发、Provider 失败和版本升级。恢复必须回到原用户目标，不能仅展示错误页：

- 传输重试复用 operation id，但不同 operation 的事实不会被静默合并；
- Package 校验失败不留下部分安装；
- Provisioning 失败保留真实 task/checkpoint，并由用户重试；
- Runtime 恢复同一 Run/Step/material，不重复结算；
- PWA 或应用升级不得把旧 Library 显示为空，也不得让旧页面写入不兼容 schema；
- 发布失败不提升生产指针，上一成功版本继续可用。

### 22.3 Provider、权限与产品呈现

- Provider 配置只决定某个 purpose 的执行能力；保存配置不等于连接或调用成功。常规验证不得调用收费模型或
  TTS 服务。
- Extension、Agent、Publisher、账号数据和 Release 使用不同授权边界。获得 semantic-world commit 权限不
  等于获得 Add-to-Learning 或发布权限。
- 界面语言、Skin、字号、窄屏、键盘、减少动效、加载/空态/错误态必须保持相同业务语义，不改写学习事实。
- 所有来源、acceptance actor、resolver、Package provenance、material version 和 release candidate 都必须可审计。

## 23. 运营旅程

### 23.1 内容作者、Publisher 与内容发布

内容供应是三个连续但权限不同的目标：

1. `OJ-01`：作者/策展者制作 Core、Overlay、媒体和 Book membership，经确定性校验得到冻结候选；
2. `OJ-02`：有 `publishLearningContent` capability 的账号在 `/publisher` 检查候选 identity、路线、成员与
   digest；浏览器校验不改变 Registry；
3. `OJ-03`：受保护 workflow 固定候选和媒体 digest，上传并验证不可变对象，最后提升 Registry revision。

内容发布任一阶段失败时，不得覆盖对象或提升发现指针；上一 Registry 必须继续可用。Catalog 能发现正确的
Book Version 和 provenance 才是发布的消费者可观察终态。

### 23.2 应用/系统发布

`OJ-04` 消费同一成功 CI 的固定 candidate，而不是重新构建可变 HEAD：

```text
固定 SHA / CI run / attempt / artifact digests
    ↓ Release Planner
按 scope 发布 Content、Application 或二者
    ↓
生产 smoke
    ↓
成功 system release manifest
```

日常符合策略的应用发布可以自动执行。内容、权限、迁移、生产配置、bootstrap、重发或灾难恢复需要精确的
owner 授权。任何组件失败都不得生成成功系统 manifest。

### 23.3 支持与恢复

`OJ-05` 从用户主动提供的问题时间、步骤、请求 ID 和脱敏诊断开始。支持人员先保全可恢复副本，再按 Web
OPFS、Extension、Edge、Database、Content 或 Release 边界复现。诊断不得包含账号、内容、URL、token、
备份密码或不必要堆栈；没有已验证恢复点时必须如实说明，不能以空库或同步状态冒充恢复成功。

## 24. 当前交付边界

以下项目属于已定义但尚未完整交付或仍需产品决策的边界，不能因存在 schema、按钮、占位页或局部测试而
算作完整旅程：

- direct stable-Sense 的完整用户入口；
- Curriculum Enrollment 的 maintenance/paused、整本退出与恢复；
- Personal Learning Scene 的用户可见删除/恢复（Personal Meaning 的回收站与明确恢复已进入当前 Web 范围）；
- 学习揭示阶段 AI Q&A；
- 完整 Free Practice Profile 及 speaking/reading/writing activities；
- Account Recovery Point、服务端历史恢复和账号范围 Data Export Request；
- 同一内容使用不同 operation id 重复捕获时的提示、追加 Anchor 或保留策略；
- 同一浏览器安全切换到不同账号且保留原账号 Library 的流程；
- Agent mailbox 的待投递取消、原始 envelope 保留期限与应用后最小化；
- 无公开来源的本机 `.sensa` 在换设备或恢复后的材料重获流程。

这些边界应进入能力/旅程矩阵，标记为 `product decision`、`implementation gap` 或 `not delivered`；代码未实现
不能成为从需求清单中删除它们的理由，局部合同测试也不能被解释为用户已经可以完成该目标。
