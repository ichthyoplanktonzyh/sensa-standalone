# Sensa V1 产品需求文档（PRD）

> 状态：Accepted product baseline  
> 决策日期：2026-08-31
> 更新日期：2026-09-07
> 产品范围：`web-next` 为移动端形态的 React 行为原型（UI 不承诺向任何正式客户端迁移）；
> 正式移动端与桌面端均为 Flutter，复用相同旅程与语言中立契约；正式 Web 端继续 React，
> 按自身平台特点另行设计  
> 交互原型：[`docs/reference/sensa-v1/product-prototype.html`](../reference/sensa-v1/product-prototype.html)

本文冻结 Sensa V1 的信息架构、用户旅程、用户语言、屏幕职责和交互验收标准。
里程碑与上线边界仍由 [current-stage.md](current-stage.md) 控制；运行时所有权由
[production-architecture.md](production-architecture.md) 控制；个人意义与 Sense 确认由
[personal-semantic-world-model.md](personal-semantic-world-model.md) 控制；学习材料完整性由
[sense-learning-resource-model.md](sense-learning-resource-model.md) 控制；内容供给、Learning Protocol
与 FSRS 交接由 [learning-connection-model.md](learning-connection-model.md) 控制。本文不能把
Product Shell 变成 Card/Deck 产品，也不能让 UI 直接写入 Evidence、5D、Memory Outcome 或 FSRS。
2026-09-08 本地优先决策后，这些派生与结算由可在本地执行的领域内核负责；旧服务器专属位置
不再是产品要求。

完整产品形态已由 owner 确认，见[领域架构的完整产品蓝图](production-architecture.md#完整产品形态不以首发范围裁剪)：
Flutter PC/移动主应用承载完整本地库，多端采集经快慢轨进入个人语义世界，显式加入学习后准备合格材料，
本地完成学习与复习。可下载学习包是独立入口；Sensa 提供可选加密同步及在线 LLM/资源服务。
以下 Web 先行与首发范围是阶段安排，不裁剪该完整形态。

当前交付目标是 React Web + 浏览器采集插件的小规模受邀测试版，推进顺序见
[生产化路线图](production-migration-plan.md)。本文保留完整 V1 IA 与后续能力定义；首轮按
`current-stage.md` 开放轻量生产闭环，高保证等 Later 能力不因原型已提供入口而成为发布门槛。
首轮已确认的能力清单和状态矩阵见
[first-round-product-baseline.md](first-round-product-baseline.md)。浏览器插件是外部 Semantic
Intake 入口，与 Web 共享领域 authority；它是首轮必交能力，不是后续系统采集的占位项。

## 1. 产品命题

Sensa 帮助学习者把自己的意义/经验结构连接到语言共同体可复现的具体 Sense，并进一步稳定它与
目标语言表达的连接，而不是背诵“英文词 = 中文标签”。Personal Semantic World 是个人建模起点；
正式 Learning Protocol/Retention 是稳定 Sense–L2 连接的重要方式，但不是个人意义存在的前提或
唯一用途。

Sensa 借鉴不背单词的沉浸首页、移动节奏、渐进披露和全屏例句体验，但学习内核改为：

1. 先让学习者进入可感知的经验，再揭示英文词形、发音和中文连接；
2. 把内容来源与学习方式分开：同一 target 可使用 published、on-demand 或 hybrid 内容，并选择
   Lightweight Study 或更高保证的 Structured Acquisition；
3. 首版默认用按需生成的紧凑内容完成一次 Lightweight Study，不把“看完/学完”说成掌握；
4. 通过版本化 Scheduling Handoff 把学习结果交给 FSRS，并如实保留其依据与证据等级；
5. Structured Acquisition 保留 Recognition、Recall、Transfer、条件性 Boundary、干扰与 Gates，作为
   后续高保证协议，而不是首版所有 Sense 的强制路径。

## 2. V1 目标与非目标

### 2.1 目标

- 用户从打开产品到开始今日学习只需一次主要操作；
- “开始今天的学习”使用统一 Mixed Session；次要“只复习”入口使用同一 Runtime 的
  Review-only intent，而不是复制第二套复习系统；
- 学习界面始终聚焦一个 Sense、一个 Action 和一个主要操作；
- 揭示阶段达到不背单词式的信息层级和沉浸感，同时严格遵守 Action 资产边界；
- Book、Plan、学习历史、Declared Mastery、媒体、离线 outbox 和 Sync 都使用真实数据；
- 用户可从浏览器插件或 Web 主动保存 Context/Expression；未闭合材料进入收件箱，完整关系
  经有效 Semantic Acceptance 后才形成 Personal Meaning。信息充分时可原位确认，必要时再进入
  中文澄清对话；模型建议本身不产生接受事实；
- confirmed Sense 可以通过独立的 Learning Content LLM 准备按需学习内容；内容在开始学习前冻结、
  通过合同校验并保留生成 provenance，语义确认对话本身不冒充学习材料；
- 首版可完成 Lightweight Study、产生诚实的 Study Completion/Scheduling Handoff，并由 FSRS 安排
  后续复习；完成不自动产生 Learning Evidence 或 mastery claim；
- Account、Learner/Device Preferences、Sync Health、导出与删除都显示真实 owner 和状态；
- 用户永远不需要理解 Lexeme、Sense、Encounter、Action、Evidence、5D、FSRS、Replica 或 Workspace。

### 2.2 非目标

- 不提供商城、会员、虚拟货币、装备、课程、班级打卡、社区或成绩分享；
- 不提供 Cards、Decks 或通用闪卡导入；
- 没有领域契约和持久化能力支撑的功能不得伪装成可用入口。首轮隐藏未交付的主入口，包括
  尚无可执行资源的活动；2026-09-07 已允许自由练习、词典、统计、签到首发开放，
  仍逐项按真实能力验收，原型中的展示不构成生产完成；
- 完整产品 IA 保留独立 Free Practice，并以首批四种可执行练习方式作为已确认目标；当前生产 P0
  仍由 `current-stage.md` 控制，不因需求确认原型出现入口而声称已经交付。正式产品只有在
  content/persistence/API/renderer contract 就绪后才把相应练习变为可进入状态，不得用课程、班级或
  考试内容充当占位；
- 真实语流 YouGlish 保留为自由练习；V1 不交付正式学习的影视剧、电视或 YouTube 原声例句生产链、synced-media Example Render、词级媒体 timeline
  或外部媒体消歧/授权生产链，也不设置 Listening Gate；当前 pronunciation/example audio 只是
  已审核的静态呈现资源；
- 不伪造 VOA、影视或新闻出处；生成内容必须显示真实 provenance；
- 不建设“真题”、考试语料聚合、考试频次或相应占位 tab；Reference 内容必须有真实来源、授权与
  release provenance；
- 不提供社交 Profile、公开昵称/头像体系、多个 Learner Profile、算法参数面板或“一键重置全部
  学习历史”；每日新学数和词书范围不能伪装成普通 Preference。
- 首版只支持中文 familiar language（L1）与英语 target language（L2），不提供语言角色切换或一个
  用户同时学习多个 L2；长期合同仍保留一对多、多对多及 typed expression 扩展能力。

## 3. 产品语言

| 内部领域词 | 用户界面用语 | 约束 |
| --- | --- | --- |
| Lexeme | 单词 | 只承担词形、发音和同词聚合；不是学习进度身份 |
| Sense | 意思 / 这个意思 | 是课程、进度、已会声明和复习安排的真实身份 |
| Book / Book Version | 词书 | 页面可显示单词数与意思数，成员关系仍按 Sense |
| Study Plan | 学习计划 | 组合当前词书、补充学习内容与每日新学上限，不等于词书本身 |
| Book Enrollment | 词书学习状态（Later） | active/maintenance/paused 不向用户显示技术枚举 |
| Book Range | 学习范围（Later） | 只控制未来新学，不抹除已经发生的学习 |
| Supplemental Curriculum | 加入学习的意思（Later） | 不是收藏夹，也不修改原词书 |
| Study Scope Revision | 当前学习范围版本 | 仅用于一致性与冲突说明，不直接显示技术名称 |
| Learning Session | 今天的学习 / 本次学习 | 用户可离开，未完成 Encounter 不伪造学习结果 |
| Learning Protocol | 学习方式 | 首版默认轻量学习；不向用户显示 protocol 技术枚举 |
| Protocol Purpose | 首次学习 / 复习 / 再学 | 内部固定 `initial_learning | retention_review | relearning`；界面只说自然语言 |
| Protocol Step | 学习中的一步 | 组织本步内容、交互、结果与下一步；不显示技术名称或固定全局步数 |
| Learning Materialization | 本次学习内容 | 开始后固定；生成更新不会悄悄替换正在学习的内容 |
| Initial Learning Completion | 完成首次学习 | 成功后交给系统安排长期复习；不同学习方式保留不同依据 |
| Study Completion | 完成这次学习 | 轻量首次学习的完成类型；不称为掌握、毕业或行为证据 |
| Scheduling Handoff | 交给系统安排复习 | 不显示技术名；系统保留交接依据与证据等级 |
| Relearning Completion | 完成再学 / 已重新连起来 | 不覆盖刚才的忘记结果，也不重新初始化复习计划；它不等于重学评价产生的调度结果 |
| Acquisition Cycle | 深度建立这个意思（Later） | Structured 协议跨多次出现；不显示 Gate 或 Cycle 技术名 |
| Sense Encounter | 这个意思的一次学习 | 不显示技术名称 |
| Learning Action | 当前操作 | 页面只显示自然任务语言，不显示 payload kind |
| Card Presentation | 当前页面 / 当前卡片 | 只是某个 Step 的瞬时呈现，不是学习身份、进度或牌组 |
| Declared Mastery | 已会声明；按钮为“熟” | 永远说“这个意思已经会了”，不能说整词已掌握 |
| Memory State / FSRS | 待复习、暂时稳定、下次出现 | 不显示算法名或 rating |
| Semantic Field | 相关意思 / 词义区域 | 不向用户宣称统一概念本体或 embedding 距离 |
| Reference Lexicon / Reference Release | 查词 / 词典 | 覆盖可以大于当前词书，但不是待学习清单 |
| Reference Sense | 词典里的意思 | 与“当前学习的意思”区分；没有 Alignment 时不显示加入学习 |
| Contextual Lookup | 点词查义 | 展示完整词典，并仅在可靠时标记“本句中”或“本句中可能是” |
| Lexical Enrichment | 构词 / 词源 / 相关 | 只在真实内容存在时显示；记忆辅助不能冒充词源事实 |
| Personal Semantic World | 我的词义世界 | 只有用户明确创建的 Personal Meaning 才是成员；不称为“大脑掌握地图” |
| Personal Meaning | 我想表达的意思 / 我的意思 | 是个人稳定身份，不等于中文标题、英语词或公共 Sense |
| Meaning Focus | 我真正在意的是 | 从一段经验中选出的当前侧面；同一场景可以产生多个 Focus |
| Sense Proposal | 模型理解的这个意思 | 可继续对话和修改，用户确认前不是公共 Sense |
| Personal Meaning Alignment | 已确认的意思连接 | 用户确认后把 Personal Meaning 连接到 stable Sense，不表示已经学会 |
| Personal Expression Anchor | 我的表达 | 可为中文或英语的 typed expression，必须显示建议/确认来源 |
| Learner Semantic Projection | 词义世界视图 | 组合个人意义、Sense 连接与学习状态的读取模型，不拥有进度 |
| Saved Sense / Saved Example | 收藏的意思 / 收藏的例句 | 收藏不表示已会，也不自动加入学习 |
| Sense Note | 我的笔记 | 每个意思一份当前笔记，不称为词典释义 |
| Personal Semantic Anchor | 我的场景 / 经验锚点 | 属于一个 Personal Meaning，不称为标准例句或正确答案 |
| Personal Collection | 自定义集合（Later） | 是个人组织方式，不称为词书或词义区域 |
| Add-to-Learning Intent | 加入学习（Later） | 必须显式触发，不与收藏或自由练习合并 |
| Free Practice Session | 自由练习 | 听说读写入口不改变正式学习与复习进度 |
| Practice Area | 听 / 说 / 读 / 写 | 只组织活动入口，不称为能力维度、得分或待办 |
| Practice Feedback | 本次练习反馈 | 可含判断或分数，但不称为证据、掌握、毕业或复习完成 |
| Sync / outbox | 已保存在本机、同步中、已同步 | 不显示 Replica、cursor 或 operation 名称 |
| Account / Learner | 账号 / 我的学习数据 | V1 一对一；账号管访问，学习数据不并入登录状态 |
| Learner Preference | 学习偏好 | 跨设备同步，只影响未来呈现或已批准资源选择 |
| Device Preference | 本机设置 | autoplay、主题和播放行为只影响当前设备 |
| Sync Health | 数据与同步 | 是事实状态，不能手工设为“已同步” |
| Data Control Request | 导出数据 / 删除账号 | 与退出登录、清除本机数据和重置进度严格区分 |

## 4. 体验原则

1. **一个屏幕，一个主要任务。** 次要操作不得与主要学习动作争夺视觉优先级。
2. **先经历，再揭示。** Grounding 初始态不得显示目标词、发音、L1 bridge 或目标例句。
3. **主动揭示。** 用户明确继续后，页面才转换为词形与当前意思详情。
4. **渐进披露。** 内嵌例句提供学习所需最小信息；完整上下文进入全屏例句卡。
5. **动作资产封闭。** 活跃 Action 只渲染 `action.assets` 明确引用且角色匹配的内容。
6. **被动阅读不冒充证据。** 浏览详情、播放音频、打开例句和 acknowledgement 不自行生成 Evidence。
7. **产品语言自然。** 技术状态只进入审查工具和 telemetry，不进入学习者界面。
8. **离线行为诚实。** 本地操作立即生效；网络失败明确说明“已保存在本机，联网后同步”。
9. **按平台适配。** 沿用当前 Web 桌面侧栏、手机底栏与受限宽度学习区；窄屏单列，
   不再把桌面锁定为 390–430px。现有布局与补充验收要求见 M0-2 状态规格。
10. **可恢复。** 离开、同步冲突、内容缺失和已会撤销都有明确恢复路径。
11. **完成不等于掌握。** Lightweight Study Completion 只表示本次协议完成；不冒充行为证据。
12. **高保证检验经过干扰。** Structured Acquisition 中，揭示或 repair 后的立即回答不计为独立
    成功；Graduation 也只表示可以进入长期保持，不承诺永久记住。
13. **额度不是债务，也是唯一数量设置。** learner 只设置每日新学数这一项；它是上限，
    由 Study Plan / Unified Planner 统一执行。preset 不得另设组大小、批次或“同时学习窗口”；
    未完成部分不滚入次日，也不制造断签或补课压力。
14. **范围变更可恢复。** 换词书、缩小范围和暂停学习不删除 Sense 进度；恢复后从真实状态继续。
15. **参考不制造进度。** 搜索、点词、展开构词词源与播放词典音频都不自动收藏、加入学习或
    改变正式进度。
16. **不确定性可见。** 上下文义项不能可靠解析时不强行标记唯一“本句义”；空数据区块不显示。
17. **设置有真实 owner。** Settings 只是组合入口，每个修改必须进入 Account、Preference、Device、
    Curriculum 或 Data Control 的真实领域对象。
18. **偏好不改历史。** 口音、译文默认状态、autoplay、主题和动画不能重写 Action、Evidence、Gate、
    FSRS 或已经固定的资源。
19. **方法可换，进度不随卡片漂移。** 学习方式可以拥有不同 Step 数量、顺序与分支；页面或卡片只
    呈现当前 Step，不能成为 Sense identity、课程成员、Evidence 或复习调度 owner。
19. **破坏性操作分层。** 退出登录、清除本机数据、重置学习历史和删除账号必须使用不同文案、确认
    与结果；pending outbox 不得被静默清除。

## 5. 信息架构

以下为 2026-09-05 首轮受邀测试范围的页面职责。正式桌面/手机布局与导航形态在 M0-2 设计，
不要求复用原型的固定底部 Tab 或窄屏外壳。

```text
Web
├── 首页：开始/继续今天的学习；只复习；无目标时提供两类开始入口
├── 我的内容
│   ├── 现有 Book/Catalog 与具体意思详情
│   └── 我的词义世界：收件箱、已确认意义、来源与显式加入学习
├── 我的学习：目标、准备/运行状态、每日额度、实际学习记录与基本偏好
├── 自由练习：按真实可执行活动开放，保留真实语流 YouGlish
└── 账号与设置：登录状态、同步、本机数据、导出与删除

浏览器插件（外部入口）
└── 选取网页文字 → 预览上下文/来源
    ├── 保存待处理 → 同账号收件箱 → Web 继续
    └── 解析完整关系 → 原位确认 → 我的词义世界 → 显式加入学习
```

首页是默认落点；插件只承担采集、确认与交接，不是另一套学习客户端。活跃学习期间隐藏
产品导航。首发允许自由练习、词典、统计、签到；无实际选择的 Policy 选择器仍隐藏。
统计和签到复用当前相关页面；签到不能产生正式学习 Evidence、进度或调度。
新增登录/恢复/待确认交互见 [M0-2 状态规格](m0-2-first-learning-state-spec.md)，已完成规格确认，真实实现待后续验收。

### 5.1 原型首页 IA 记录（2026-08-28）

以下保留原型设计来源；其中固定三个底部入口、签到卡与日历不再是当前首轮生产交付要求。
学习入口的 Mixed/Review-only 语义继续适用，正式可见范围以本节首轮 IA 和 M0-1 基线为准。

- `Learn N` 是唯一主要学习入口，启动或继续 Mixed Session。`N` 表示此刻可由 Mixed Planner
  处理的去重 Retention Target 数量，而不是单纯的“今日新词数”；同一 target 即使来自多个
  inventory 也只计一次。首版一个 Sense 仅一个 primary target，因而 UI 仍以“意思数”呈现；
- `Review N` 是次要的自主复习入口，启动或继续 Review-only Session。`N` 只表示当前到期的
  Retention 与可由复习继续的 Relearning Sense，不包含 new 或 initial Protocol work。
- 签到卡只承担签到：点击后写入/显示当日已签到与连续签到事实，不进入学习记录、学习统计或
  Learning Session，也不产生 Attempt、Evidence、Memory Outcome 或学习额度变化。
- `我的学习` 中的签到日历读取同一签到事实；首页签到状态与日历状态不得分别维护或出现冲突。
- 头像进入账号与设置。词书选择、学习范围和每日额度归入 `我的学习`，不再占用独立底部入口。
- 原型中的“不背学堂”正式更名为 `自由练习`。旧课程、班级、备考和真题内容不属于 Sensa IA，
  只保留既有页面外壳，后续由 Sensa 的四类自由练习逐步替换。
- 底部三个入口固定为 `自由练习 / 我的内容 / 我的学习`；首页本身不显示为底部入口。

## 6. 核心用户旅程

### 6.1 首次使用

```text
登录 → 简短设置页确认每日新学数量 → 首页（2026-09-07 owner 确认）
├── 从现有内容开始 → 选择 Book/具体意思 → 加入学习
└── 记录我想表达的意思／继续插件采集 → 收件箱或完整意义 → 显式加入学习
→ 解析 Study Plan、Target 与 readiness → 内容就绪后可开始学习
```

选词书不是使用个人语义入口的前提；未选择 Book 仍可保存材料、确认意义并通过合法的最小
Curriculum 进入学习。首页没有目标时呈现两类开始入口，不强制“选择一本词书”，也不进入空
学习流程。插件发起登录后应可回到原采集，已有材料不因认证跳转无提示丢失。

### 6.2 每日学习

```text
打开产品 → 首页显示今日新学/待复习摘要 → 开始今天的学习
→ start/resume Mixed Session → Planner 从四类 inventory 选择下一个 Sense
→ 为固定 target 解析 Learning Materialization 与带 purpose 的 Protocol Run
→ 执行当前 Protocol Step → 打开 Encounter 并渲染当前 Card Presentation
→ 结算与 purpose 兼容的 Completion/Outcome → 下一 Step 或下一个 Sense
→ 无候选或用户结束 → 完成页 → 首页
```

首页的新学与复习数字是摘要，不是客户端持有的固定队列。Mixed Planner 可以选择 due
Retention、Review-originated Relearning、ready Protocol work 和 daily quota 允许的
new Protocol work。具体优先级由版本化 Planning Policy 控制，但 due backlog 和已经开始的
Protocol Run 都不能被持续引入新 Sense 饿死。

Mixed Session 固定开始时的 Study Scope Revision。用户后来换词书、调整范围或加入个人 Sense，
只影响后续 Session，不能让当前学习队列在后台静默变形。

### 6.3 新 Sense 的首版轻量学习

```text
fixed Learning Target
→ Published / On-demand / Hybrid Content Provisioning
→ 冻结 Learning Materialization
→ Experience/说明/例句等紧凑学习内容
→ 可选的 Recall 或 learner rating
→ Study Completion（Initial Learning Completion）
→ 同一成功边界创建 Scheduling Handoff
→ 初始化 FSRS
```

内容开始前必须固定 target、protocol version、内容角色、generator/policy provenance、校验结果与
digest。模型失败时保留 Personal Meaning、confirmed Sense 与已保存 materialization；不得在 learner
作答后重新生成并替换题面、答案或评分依据。

Study Completion 后产品可以显示“完成这次学习/之后由系统安排复习”，但不显示“已经掌握”。成功
完成首次学习时，Study Completion 与唯一 Scheduling Handoff 必须原子产生；中断、失败或内容不可用
不能创建 completion 或初始化 FSRS。handoff 必须如实记录 `basis=protocol_completion` 与
`evidenceLevel=non_evidentiary`；若协议另有合法自评输入，则其 evidence level 为 `self_report`。轻量
学习不会因此产生 Acquisition Gate、5D 或行为 Evidence。

完整的 Structured Acquisition Protocol 继续作为 canonical 高保证路径：它要求干扰后的 Recognition、
Recall、Novel-context Transfer 与条件性 Boundary，只有全部 required Gates 解决才产生 Acquisition
Graduation。该协议进入 Later，不是首版所有 Sense 的必经步骤。

### 6.4 只复习

```text
首页 → 只复习 N 个
→ start/resume Review-only Session
→ due Sense 执行 Retention Review Protocol
→ 失败/变弱结果落账后可执行 Lightweight Relearning
→ 无 due/relearning 候选 → 复习完成页 → 首页
```

Review-only 不引入新 Sense、不推进 initial Learning Protocol、不移动课程新学位置，也不消耗 daily-new
quota。没有到期内容时入口禁用或弱化；V1 不提供会提前改变 FSRS 的“自由刷题”。

一次 due Review 最多产生一个 Memory Outcome 和一次 FSRS 更新。首版协议可以接纳 learner rating，
但必须将其记录为 `evidenceLevel=self_report`，不能冒充独立行为 Evidence。若存在失败后的 repair/retest，它不得
覆盖原 Outcome 或重复调用 FSRS。首版 Lightweight Relearning 产生独立 Relearning Completion；它不
创建 Scheduling Handoff、不重新初始化 FSRS，也不再次更新刚才这次 Review。若未来协议启用
scheduler-eligible relearning evaluation，它可另行产生 origin=`relearning` 的 Memory Outcome，但不能改写原 Review。Structured Relearning
仍是 Later 选择，不是所有遗忘的默认模型。

### 6.5 浏览内容

```text
首页 → 我的内容，或我的学习中的当前词书 → 单词聚合列表 → 某个具体意思
→ 只读意思详情/完整例句 → 返回原列表
```

这条旅程不产生 Attempt、Evidence 或 Memory Outcome。

### 6.6 查词与例句点词（完整模型，Later）

```text
全局搜索，或在普通 Example 中点击一个 exact single/multi-token span
→ 打开快速释义：完整词典义项 + 可靠时强调“本句中”
→ 展开词典详情：释义 / 例句 / 用法 / 构词词源 / 相关（按真实数据出现）
→ 可选返回、收藏已对齐的意思、或显式“加入学习”
```

目标词 occurrence 不重新做模型猜测，而是沿 Example 已绑定的 Sensa Sense 定位；存在 reviewed
Sense Alignment 时再强调 Reference Sense，没有映射时不补猜。非目标词由预计算 Lexical Occurrence
annotation 提供结果；`ambiguous` 只能显示
“本句中可能是”，`unresolved` 不强调唯一义项。点击 phrasal verb/idiom 时优先返回覆盖该 span 的
最长 multiword expression，同时允许用户切回单词条目。

完整详情展示该 Reference Lexical Unit 在 pinned Reference Release 中的全部可见 Reference Senses，
不能只展示模型选中的一条，也不能运行时自由生成 definition。词根词缀、词源故事、词族和记忆辅助
只在有真实、经过审核的数据时出现；“真题”永不进入详情结构。

Reference-only meaning 可以浏览，但没有 reviewed Alignment，或选定 protocol 没有可执行的
published/on-demand/hybrid 内容路径时，不显示可成功的“加入学习”，Curriculum 返回
`content_unavailable`。查词本身不自动收藏、写笔记或加入
计划，也不产生 Learning Attempt/Evidence 或正式进度。

若当前 Reference Sense 已对齐 Sensa Sense，详情可以挂载该 Sense 的收藏状态与 current Sense Note；
这仍是 Personal Content，不是词典内容。Reference-only meaning 暂无通用收藏或笔记模型。

active assessment 在 learner 提交 primary response 并进入 feedback 前，不提供产品内点词/词典入口。
Introduction reveal、内容浏览和 feedback 后允许查词；这是答案完整性边界，不是试图封锁外部词典。

### 6.7 从个人意义到公共 Sense

```text
浏览器插件或 Web → 主动捕获 Context 与已有 Expression → Semantic Intake
├── 未闭合／稍后处理 → 收件箱 → 圈定表达、选义或必要的中文澄清
└── 信息充分 → 直接呈现当前 Context–Expression–Sense 关系
→ 有效 Semantic Acceptance → 固定 stable Sense/Version/Binding
→ 完整 Personal Meaning 与 Alignment → 显式加入学习
→ Content Provisioning 与 readiness → 正式学习
```

插件可在原位完成快轨确认，不能强制回 Web 再确认一次。复杂多轮澄清首轮由 Web 承接；
Meaning Focus 是存在真实信息缺口时的可选桥梁，不是每条采集的必经步骤。

LLM 不要求先从穷尽式公共 Sense 库命中已有条目。它应根据对话构造包含核心意义、原型场景、
包含/排除边界、相邻意义和英语 expression candidates 的 Sense Proposal；只返回一个英语单词不算
完成。模型可以查询相似 Senses 帮助解释或复用，但没有命中时仍允许 learner 确认并创建新 Sense。

一个场景可以产生多个 Meaning Focus，例如同一次借伞经历可以拆出接收方向的 `borrow` 与给予方向
的 `lend`。系统复用原始经验，不把中文“借”直接等同于其中任一英语 Sense。learner 选择“这些都
不是”时继续澄清或保留未确认状态，不得为了结束对话强行生成确定答案。

捕获材料、接受语义/表达、提交完整 Personal Meaning、生成并物化资源、加入学习和产生
Study Completion/Learning Evidence 保持不同事实。
任何对话、确认、浏览、播放或自报理解都不产生 Learning Evidence。LLM 不可用或 learner 中途离开
时，已保存的 Inbox/Construction 草稿与已接受的 Personal Meaning 分别保留，未确认 Proposal
不得被后台自动确认；只有完整且被有效接受的关系才成为稳定世界成员。

首版固定中文 L1、英语 L2：对话与边界说明以自然中文为主，目标表达为英语 word/phrase 等 typed
expression。首版不显示语言选择器，但数据与交互不得假设一个中文表达只对应一个英语 Sense。

#### 6.7.1 浏览器插件首轮要求

支持用户主动选取网页文字、预览并修正必要上下文、保存来源与固定 occurrence、请求解析、
原位确认完整意义或存入收件箱。保存成功须区分“本机待同步”“服务器收件箱已接纳”和
“完整意义已保存”；只有明确的 Add-to-Learning 才进入学习，不自动生成进度。

首版桌面 Chrome，Unlisted 链接安装与 Sensa 受邀准入；实际兼容页面在 M2 验证；页面受限、无选区、上下文
不足、断网、认证过期、重复提交、插件重启/更新和账号切换均须有状态与恢复路径。
详见 [首轮产品基线](first-round-product-baseline.md)。插件不后台扫描浏览历史、不持有模型
密钥，未明确支持的浏览器/页面不能伪装成兼容。

### 6.8 已会声明

```text
活跃学习顶部“熟” → 确认“这个意思已经会了”
→ 确认当前 primary target expression → 本地写入 learner_declared_mastery.set
→ 该 Retention Target 的所有 active Encounter interrupted；所有 planned Encounter cancelled
→ 无 Attempt/Evidence/Memory Outcome → Planner 选择下一个 target
```

在词书或“我的内容 → 已会”中可以撤销；撤销只恢复该 Retention Target 的计划资格。同一 Lexeme
的 sibling Senses 不受影响。

### 6.9 Curriculum lifecycle（完整模型，Later）

```text
当前词书 A（active）→ 选择词书 B
→ A 默认转为“只继续已学内容”（maintenance）
→ B 成为当前新学词书（active）
→ 新 Study Scope Revision 从下一 Session 生效
```

换词书不清零 A 的学习进度，也不重新初始化重叠 Sense 的 FSRS。用户可以进一步暂停 A；暂停只让
它暂时不再进入正式学习，不等于标记已会。切回时从保留的 phase、Protocol Run 和 Memory State 继续。

Book Range 只控制未来可以开始的新 Sense。缩小范围不得删除已经开始或已经复习的事实；“改变
新学范围”和“暂停既有内容”必须是两个明确操作。

```text
收藏的意思 → 加入学习
→ Curriculum 校验 target、provisioning path、protocol 与当前范围
→ 已接纳 / 已在学习范围 / 内容暂不可用 / 需先撤销已会
```

接纳后创建 Supplemental Curriculum Membership，不改写 Book Version。取消收藏不移出学习；
移出补充学习也不取消收藏或删除进度。收藏例句上的入口必须写成“学习这个例句对应的意思”，
不能把 Example 当作课程成员。

### 6.10 设置与偏好

```text
我的学习 → 学习偏好
→ 修改口音或例句中文默认状态
→ 写入 Learner Preference revision → push → pull → 其他设备收敛

头像 → 账号与设置 → 外观与设备
→ 修改 autoplay / theme / reduced motion / playback behavior
→ 只更新当前 Device Preference
```

会改变 pronunciation asset 选择的口音偏好从下一次尚未物化的 Action 生效，不能替换 active Action
已经固定的音频。译文默认显示、autoplay、主题或动画可以立即改变界面呈现，但不改变当前 Action、
Attempt eligibility、答案合同或 Evidence；当前 Action 没有授权译文/音频时，相应偏好不得绕过
asset boundary。每日新学意思数仍通过 Study Plan 入口修改并产生真实 Curriculum revision，不写入
Preference。

### 6.11 账号、同步与数据控制

```text
头像 → 账号与设置
├── 查看账号标识与当前登录状态
├── 查看 Sync Health / retry / 本机存储
├── 导出数据 → requested → processing → completed / failed
├── 清除本机数据 → 先处理 pending operations → clear / cancel
└── 删除账号 → 在线重新确认 → deletion pending → deleted
```

退出登录只撤销当前 Account Session，不删除云端数据。存在 pending outbox 时，产品先尝试同步；
失败后必须让用户在“保留本机数据”和“明确丢弃列出的未同步操作”之间选择。清除本机数据只移除
已安装内容、媒体和本地副本，之后可以重新同步。

删除账号必须在线并重新确认。进入处理状态后撤销所有登录和 Replica 写入资格；任何旧离线设备
再次上线都只能收到账号已删除，不能重新上传历史 outbox。V1 不提供全量学习历史 reset。

## 7. 屏幕需求

### 7.1 首页

首页使用沉浸背景和低信息密度，只包含：

- 头像；
- 当日日期与必要的学习摘要；
- 唯一主要按钮：`Learn N`，表示当前 Mixed Session 可处理的去重意思数；
- 低于主按钮层级的次要入口：`Review N`，表示当前到期复习数；无到期内容时禁用或弱化；
- 当前学习来源与每日目标的轻量说明；个人语义入口不要求已有词书；
- 我的内容、我的学习和账号入口；具体导航布局在 M0-2 定义；
- 必要时出现一行非阻塞同步状态。

首轮允许签到，入口为我的学习按钮/日历，手动或实际进入正式学习触发；首版无连续天数、奖励或补签；仍隐藏无真实能力的入口。
学习记录由“我的学习”承接。无目标时提供从现有
内容开始或记录自己想表达的意思两类入口；正式学习仍以真实 ready 状态为准。

### 7.2 自由练习

本节定义已经确认的目标 IA。`apps/web-next` 可以用真实静态原型数据验证页面需求，但当前生产
首发已允许 Free Practice，原型不因此成为生产完成证据；上线可见性仍必须满足 `current-stage.md` 与运行合同。

- 首页按 `听 / 说 / 读 / 写` 四个 Practice Area 组织活动；Area 只是稳定导航，不显示能力分数、
  完成度、欠练数量或待办；
- 每个 Activity 只出现在一个 primary Area；跨通道只用简短方向或输入方式说明，不在多个 Area 重复；
- learner 进入活动前可以选择或继承 Practice Scope，并通过简短 Practice Brief 明确意图、场景与支架；
- Session 开始后固定 Brief、Scope、Activity Definition 与资源解析版本，退出后不篡改正式学习队列；
- Activity 可以给即时判断、建议和分数，但这些都只是 Practice Feedback，永不成为 Learning Evidence；
- 练习中发现的新 Context–Expression–Sense 只能通过显式“保存到我的词义世界”发起独立 Semantic
  Intake；加入学习也必须是另一个明确操作；
- 不展示课程、班级打卡、备考、真题、商城或任何原“不背学堂”内容。

#### 7.2.1 第一阶段 Area 与 Activity（2026-09-05）

第一阶段每个 Area 只开放一个 Activity，不用 disabled 占位项把未来路线图伪装成当前能力：

| Practice Area | 可进入 Activity | learner 的主要行为 | 首期边界 |
| --- | --- | --- | --- |
| 听 | 真实语流泛化 | 在 YouGlish 的不同真实片段中反复听同一 Expression | 按 Expression form 检索，不做 contextual Sense 消歧；必须提示片段可能包含其他词义 |
| 说 | 情境口语排演 | 面对一个 Sense-grounded 情境录音作答，查看 transcript 与 AI feedback 后重试或继续 | 不提供 phoneme-accurate 发音分，不把 AI 反馈当正式评价 |
| 读 | 语境推义 | 阅读 Sense-controlled 短语境，先形成理解，再 reveal 当前 Sense 与关键线索 | 不要求选择题，不把 reveal 或继续点击当作正确证据 |
| 写 | 情境书面表达 | 根据 Sense-grounded 情境写一句或短回复，按 AI feedback 修订 | 不设置唯一标准答案，反馈只讨论意义贴合、自然度与可选表达 |

页面先展示当前 Practice Scope，再按固定顺序展示“听、说、读、写”四个通道方块。每个通道方块
复用“标题 + 当前 Activity”的视觉语法；小块显示练习名称和必要的目标/范围摘要，不显示 Area 得分、
完成率、欠练数量或推荐处方。Oral Scenario Rehearsal 与 Written Scenario Response 可以共享
Scenario Response 的 Brief、feedback 与 retry 体验，但分别保留 voice/text interaction 与 primary Area。

交互要求：

- 点击 Activity 时，以当前 Practice Brief、Scope 与 Executable Practice Capability Inventory 创建 Session；
- Activity 缺少所需 provider、resource、capture、ASR、AI feedback 或 renderer capability 时，显示诚实
  unavailable state，不创建不可执行 Session；
- reveal、重听、查看 transcript、请求提示和重试是 Activity 内 interaction，不拆成额外 Activity；
- 每个 Turn 可以保存 response、Practice Observation、Feedback 与 learner 主动保留的 Artifact；
- 四种 Activity 都不改变正式 Learn/Review 数量、Acquisition Gate、5D、FSRS、每日额度或 Book cursor。

每次自由练习必须显式选择或继承一个 Practice Scope，并与正式 Mixed/Review-only Session
隔离；退出自由练习回到原二级页面或首页，不篡改正式学习队列。

自由练习首页先呈现当前 Practice Scope，优先支持 learner 明确选择的 Personal Meaning、Sense/
Expression 或当前在学 Book slice，并展示实际可执行的 typed targets。不得把 Expression 数、Lexeme 数
或 provider 命中数冒充 Sense 数；Session 一旦开始就固定 Scope snapshot。

`真实语流泛化` 使用逐 Expression 的真实媒体 occurrence 播放器：

- 顶部显示 Expression、可用时的 Pronunciation Variant、当前 occurrence 序号，以及“按表达形式检索，
  片段可能包含其他词义”的固定说明；
- 主体通过 YouGlish provider 展示带来源 provenance 的真实片段，支持播放/暂停、重听、上一段与下一段；
- 不把 provider occurrence 保存为 reviewed Learning Example，也不把播放或跟随解释为理解了目标 Sense；
- 相同拼写存在多种发音而又无法可靠约束目标 Pronunciation Variant 时，该 occurrence 不进入队列；
- 播放、暂停、重听和跳过只形成 Practice Turn/Observation，不改变正式学习状态。

`情境口语排演` 与 `情境书面表达` 都先显示 communicative goal 与 scenario，并允许 Activity policy
决定目标 Expression 是显示、提示还是隐藏。口语保存录音与 ASR transcript，书面表达保存 text；
AI feedback 支持 learner 修订、重试或继续，但不能显示“已掌握”或更改正式进度。

`语境推义` 必须使用与目标 Sense 对齐的受控短语境并精确定位 Expression occurrence。learner 先阅读
和形成理解，再主动 reveal Sense 与关键 contextual cues；首期不通过 4 选 1 把理解活动改造成测试。

### 7.3 我的内容

本节保留完整产品及原型的内容组织方向。首轮只开放现有内容、收件箱、已确认词义世界及
必要的学习交接；完整收藏、笔记和集合入口隐藏。未确认材料留在 Inbox/Construction draft，
不能因为它在同一产品页面展示就视为稳定 Personal Meaning。

完整产品的页面 IA：

- 顶部主要入口：我的词义世界，并提供明确的“创建一个我想表达的意思”；
- 我学过的：最近学过、全部已学、已会的意思；
- 我保存的：收藏的意思、收藏的例句；
- 我创建的：我的笔记、自定义集合。

“我的场景”不再是与词义世界平级的独立内容仓库。Personal Semantic Anchor 属于一个 Personal
Meaning，并在其创建/详情流程中编辑；同一素材可以被多个 Meaning Focus 引用。自定义集合可以在
后续进入交付时按真实 contract 开放；首轮隐藏入口，也不能阻塞材料捕获与完整意义接纳。
四个 Free Practice Activity Definition 属于自由练习，在学词书与学习范围属于我的学习，两者都不出现在“我的内容”。

#### 7.3.1 第一版页面确认（2026-08-31）

```text
我的内容
├── 我的词义世界（顶部主要入口卡）
│   ├── 创建一个我想表达的意思
│   ├── 待澄清 / 待确认
│   └── 已确认 Sense 的个人意义
├── 我学过的
│   ├── 最近学过
│   ├── 全部已学
│   └── 已会的意思
├── 我保存的
│   ├── 收藏的意思
│   └── 收藏的例句
└── 我创建的
    ├── 我的笔记
    └── 自定义集合（暂未开放）
```

“我的内容”是多个读取模型的产品聚合页，不把它们合并为同一领域对象：

- “我的词义世界”的成员来自 learner 显式创建的 Personal Meanings；Learner Semantic Projection
  叠加其 Sense Alignment 与学习状态，但不从学习历史自动增加成员；
- “我学过的”读取 Learner Sense Progress roll-up、其 Retention Targets 与 Declared Mastery
  投影，不是用户手工维护的单词本；
- “我保存的”读取 Saved Sense / Saved Example；取消收藏不删除其他个人内容或学习事实；
- Personal Semantic Anchor 在所属 Personal Meaning 内展示和编辑，不复制为独立场景条目；
- “我创建的”读取 Sense Note 与 Personal Collection；它们和 Personal Meaning 生命周期独立；
- 列表可以按 Lexeme 聚合显示，但计数、状态、收藏、笔记和加入学习仍以具体 Sense 为身份；
- “我的内容”内的搜索只搜索 learner 自己的内容与事实投影；全局查词仍属于 Lexical Reference。

#### 7.3.2 页面下钻与交互确认（2026-08-31）

“我的内容”采用 Hub → World/List → Personal Meaning / Sense Detail 的结构：

```text
我的内容 Hub
├── 我的词义世界
│   ├── 创建 Personal Meaning → LLM Sense Construction → 确认
│   ├── 世界视图 / 列表视图
│   └── Personal Meaning 详情 → confirmed Sense 详情
├── 我学过的 → 对应意思列表 → 具体意思详情
├── 收藏的意思 → 意思列表 → 具体意思详情
├── 收藏的例句 → 例句列表 → 例句详情 → 对应意思详情
├── 我的笔记 → 笔记列表 → 编辑当前笔记
└── 自定义集合 → 暂未开放说明页
```

- Hub 顶部使用“我的词义世界”主入口卡，以下按“我学过的 / 我保存的 / 我创建的”分组；每行显示
  当前读取投影的事实数量，不显示目标、欠账、完成率或处方。
- “我的词义世界”首屏必须同时提供已有 Personal Meanings 和主创建动作。空状态解释“记录一个你
  真正想表达的意思”，不能把导入词书或自动生成节点当作创建；
- 创建器允许从中文描述、个人经验、场景/受支持媒介或已有中英文表达开始。保存 Personal Meaning
  与开始 LLM 对话是两个可恢复步骤；模型失败不丢失已保存内容；
- LLM 对话内嵌 Sense Proposal cards，每张展示 Meaning Focus、典型场景、包含/排除边界、相邻意义、
  推荐英语表达以及“为什么匹配 / 可能不匹配”；不能退化成只给一个翻译结果；
- 确认操作固定使用“就是这个意思”；“接近但不是”“我在意另一个角度”“这些都不是”继续澄清或
  拆分 Focus，不得静默确认；
- 世界视图与列表视图读取同一 Personal Meaning/Alignment facts。节点位置不冒充语言学距离、
  embedding 关系或完整能力地图；学习状态只作为 confirmed Sense connection 的 overlay；
- 清单页允许在 learner 自己的内容范围内搜索，并提供空状态；搜索不越界调用全局词典。
- Personal Meaning 详情展示 Meaning Focus、经验/表达 Anchors、Sense Construction 状态与 confirmed
  Alignments；Sense 详情再展示词形、发音、当前一个意思、学习资源、相邻 Sense 和学习入口；
- 首版界面固定中文 L1、英语 L2，不显示语言选择器；中文表达是 familiar access path，英语 word/
  phrase 是 typed target expression，不显示 `中文 = 英文`；
- 例句详情可显示/隐藏译文、播放批准的静态音频、收藏该 Example，并返回它所绑定的 Sense；V1 不在
  此处模拟影视原声、YouTube、逐词时间轴或未经审核的真实出处。
- Sense 确认后才可以启动后续资源准备；资源状态必须区分“尚未准备 / 正在生成 / 已物化可学习 /
  生成或校验失败”。“加入学习”只有在选定 protocol 存在可执行 provisioning path 时才可成功，
  不能因为已有 senseId 或一段模型回复伪造可学习状态；
- 收藏、确认 Sense、加入学习、开始自由练习与声明已会仍是不同操作；
- 兼容原型中的词头级历史状态只有在能够唯一定位一个 Sense 时才能进入 Sense 列表；多义词不得把
  整词状态复制给全部 sibling Senses。旧笔记尚未唯一绑定 Sense 时，列表明确显示待迁移状态。

完整产品模型可以在 Personal Meaning 上叠加 published Semantic Field、正在形成、已经建立、需要
巩固和待探索的有限语义关系，并允许将明确选择结果作为 Free Practice Scope。地图视图与列表视图
必须读取同一批权威事实；任何布局都不宣称是 learner 大脑的真实结构。

完整 Personal Content 还包括每个 Sense 一份 current Note、Personal Collections 与 typed
Sense/Example Membership。取消收藏不删除笔记/Anchor/集合成员，删除集合不删除收藏或正文，删除
Anchor 不删除 Personal Meaning，任何 Personal Content 操作都不修改正式学习状态。

Curriculum contract 就绪后，收藏的 Sense 可以显示独立的“加入学习”；已在有效 Study Scope 中时
显示事实状态而不重复创建 Membership。Saved Example 只允许跳转到其 Sense 的加入学习操作。

### 7.4 我的学习

原型中 `我的学习` 与 `学习偏好` 使用顶部双页签；正式布局在 M0-2 确定。

计划与进度只做事实性呈现，首轮包括真实目标/来源、每日新学上限、实际学习记录与待复习信息。
词书未选择时仍允许个人语义路径；统计与签到已允许首发开放，完整词书范围仍后置。签到
日历与首页须读取同一事实，缺席日期和未用额度不表现为断签、欠账或失败。
该页面不生成维度待办、薄弱项诊断或 learner-facing Learning Insight，也不得显示 raw FSRS state、
reps、Sense ID 或同步实现细节。

当前词书区域：

- 展示当前 Plan 绑定的词书、封面、单词数、意思数和完成进度；
- 支持选择/更换词书、设置每日新学意思数；
- 词头聚合列表下，每个意思拥有独立状态：`待学习 / 学习中 / 待复习 / 需要巩固 / 已会`；
- 支持按单词和意思搜索；
- 点击某一行进入该 Sense 的只读详情；
- 不把 sibling Sense 合并成一个学习状态。

完整 Curriculum lifecycle 上线后，词书页还应区分当前新学、只继续已学内容与已暂停的词书；
换词书默认保留旧词书的维护学习，暂停是另一个明确选择。Book 完成状态只做事实呈现：可以显示
“新内容已学完”或“首次学习已完成”，不能宣称长期复习永久完成。

学习偏好首批包含：

- 美式/英式发音偏好（Learner Preference，跨设备同步）；
- 例句中文默认显示状态（Learner Preference，跨设备同步）；
- 每日新学意思数的计划入口。

这里不重复保存 autoplay、主题或播放行为，也不直接编辑 FSRS、Gate、难度或学习算法。每日新学入口
跳转到 Study Plan；保存后显示新的 Study Plan revision 事实，而不是 Preference update。

### 7.5 账号与设置

- **账号与安全**：真实账号标识、认证方式、当前登录状态与退出登录；V1 不要求公开昵称/头像；
- **外观与设备**：本机 theme、发音/例句 autoplay、reduced-motion override、playback rate/volume；
- **数据与同步**：online/offline、pending/rejected operation count、last successful sync、installed
  content/media 与 retry/repair；
- **本机存储**：下载与媒体占用、清除本机数据；pending outbox 未处理时不能直接清除；
- **导出与删除**：Data Export Request 的状态/下载、Account Deletion 的在线确认和处理状态；
- **快捷入口**：跳转到学习偏好和 Study Plan，不复制它们的字段；
- **关于与支持**：关于、隐私说明、反馈与内容纠错；它们是导航入口，不属于 Account aggregate。

不展示 learner scope ID、IndexedDB 名称、Workspace、Replica、cursor、raw preference key 或 identity
provider token。Sync Health 使用自然语言说明，不提供手工“标记已同步”。

## 8. 学习界面

本节的页面、面板与“卡”都是 Card Presentation 候选，只负责渲染当前 Protocol Step。具体协议可以
把一个 Step 分成多个呈现阶段，也可以在同一呈现中完成一个 Step；首版不把卡片数量、固定顺序或
Deck identity 写入产品合同。服务端 Step/result contract 始终是状态与结算依据。

### 8.1 公共顶栏

从左到右：

- 退出；
- 今日进度，例如 `2 / 10`；
- 收藏当前意思（Bookmark contract 就绪后）；
- `熟`；
- 更多。

不提供无契约支撑的撤回和 `abc` 拼写入口。更多菜单首批只含真实的学习偏好、内容纠错
和退出本次学习。

### 8.2 Grounding：经验态

初始页面只能显示：

- 自然任务标题，例如“先回到这个场景”；
- Action 引用的 `experience_sketch`；
- 唯一主要按钮：`把场景和词连起来`。

不得出现 lemma、IPA、pronunciation、L1 bridge、目标例句或同时存在的“我理解了，继续”。

### 8.3 Grounding：揭示态

用户主动揭示后，页面以不背单词式信息层级显示：

1. **词形头部**：lemma、可用的音节表现、IPA、pronunciation audio；
2. **当前意思**：清晰标记“当前学习的意思”，只突出当前 Sense；
3. **中文连接**：Action 引用的 `l1_bridge`；
4. **内嵌例句**：Action 引用的一个 study example、中文和对应音频；
5. **刚才的场景**：可折叠回看 experience sketch；
6. **主要按钮**：由服务端结果决定 `继续 / 下一个意思 / 完成今天的学习`。

活跃 Action 不平铺 sibling Senses，不读取整个 Package 的词根、派生、近义或 Usage
Pattern 作为 fallback。若以后需要标签页，必须由版本化 Action 明确引用相应资产。

### 8.4 全屏例句卡

- 显示真实来源标签或“AI 生成情境”；
- 高亮目标 span 与经过审核的搭配 span；
- 中文默认状态由用户偏好决定，可随时显示/隐藏；
- 支持查看 `context_l2/context_l1`；
- 支持 study-example audio；
- 切换例句时停止上一条音频，播放按钮始终只控制当前 Example 引用的音频资产；
- 支持收藏例句（Bookmark contract 就绪后）；
- 只有 Action 明确按序引用多个例句时才提供轮播，不得从整个 Package 自动补齐；
- 轮播支持向左滑到下一条、向右滑到上一条，同时提供可见按钮和键盘左右方向键；
- 第一条向右拖、最后一条向左拖时提供阻尼回弹，不循环跳转；切换时分页指示、来源、
  译文、上下文、音频和收藏状态都必须随当前 Example identity 更新；
- 打开、翻页、显示译文和播放不自行产生 Learning Evidence。

V1 的 Example Render 限于当前可稳定发布的 reviewed text 与 static audio。影视/电视/YouTube
原声片段、word-level synced transcript 和逐词媒体高亮属于 Later；产品不得为模拟该能力而伪造
来源、时间轴或 contextual Sense resolution。这里的 static audio 播放不构成 Listening assessment。

在非 active-assessment 或已进入 feedback/reveal 的 Example 中，文本支持按 exact character span 点词。
点击优先匹配 approved multiword occurrence，再打开快速释义；没有安装对应 Reference Release 或该
occurrence 无法解析时，显示诚实 unavailable/unresolved 状态。点词入口不得读取当前 Action 未授权的
learning-only/assessment-only assets，也不得因查询改变当前 Encounter。

### 8.5 词典详情（完整模型，Later）

- 词形头部显示 headword、POS、IPA、发音与当前 Reference Release/source attribution；
- 释义区显示全部可见 Reference Senses，并将可靠的 Contextual Sense Resolution 加重标注；
- `model_confident` 使用“本句中可能是”，不能伪装成人工确认；
- 例句、用法、构词/词源和相关按真实数据条件性出现，不显示空 tab；
- 只有对齐 Sensa Sense 时才显示该 Sense 的收藏/笔记；reference-only meaning 不伪造通用笔记；
- Etymology Story 与 Mnemonic Aid 明确标记为理解/记忆辅助，并可查看来源或编辑 provenance；
- “加入学习”只针对已经对齐的 Sensa Sense，并交给 Curriculum decision，不把 Reference Sense 直接
  变成进度身份；
- 不提供“真题”区块，不伪造柯林斯等未授权 provider 品牌。

### 8.6 Structured Acquisition Action renderer（Later）

| Action | 主要内容 | 主要操作 |
| --- | --- | --- |
| Contextual Recognition | 包含目标 form 的具体语境 + reviewed Sense/paraphrase choices | 选择当前意思 |
| Meaning-to-form Recall | 不泄露答案的 Sense cue / experience | 输入目标词或“不知道” |
| Novel-context Transfer | learner 未作为教学材料见过的 approved context | 选择准确解释；可使用不混淆语法的输入变体 |
| Boundary | Relation-backed positive/negative cases | 单选并提交；可嵌入 Recognition/Transfer |
| Repair / re-binding | 与失败能力匹配的 sketch、bridge、example、contrast 或 audio | 完成修复；稍后重新检验 |
| Cloze（可选变体） | runtime-derived masked text + approved Example | 输入词形；语义与形态错误分开反馈 |

所有 renderer 必须先通过 payload、version、digest、metadata、asset role 和 asset kind 校验；
失败时 fail closed，不泄露答案。正确/错误 feedback 可以与当前 Encounter 连续显示，但一个
Encounter 不得在答案揭示后接受第二个“独立”assessment 结果。

### 8.7 完成页

完成页只显示用户能理解的结果：本次完成的意思数、需要巩固的意思数、下一次由系统安排。
不显示 Memory Outcome、FSRS rating 或 5D 数值。主要按钮为“回到首页”，次要按钮为
“继续学习”（仍有候选时）。

## 9. “熟”交互与不变量

确认面板固定文案结构：

> 这个意思你已经会了吗？  
> `ability · 能力；本领`  
> 标记后，不再安排这个意思的新学或复习。ability 的其他意思不受影响，之后可以在词书中恢复。

必须满足：

- 确认前不改变状态；
- 确认后先写本地 outbox，再立即更新本地 UI；
- operation 使用当前 Retention Target、Declared Mastery revision 和可选 Encounter context；
- 该 target 的所有 active Encounter 变为 interrupted，所有 planned Encounter 变为 cancelled；
- active Protocol Run/Relearning 保留真实进度但退出 Planning；不伪造 Completion 或 Graduation；
- 不写 Attempt、Evidence、Gate pass、Memory Outcome 或 FSRS rating；
- 网络失败时声明仍在本机生效，并显示待同步状态；
- 冲突时拉取服务端 authoritative snapshot，再给出可理解的重试/恢复操作；
- Book 和“已会”列表显示 `已会`，允许反向设置 `isMastered=false`；
- 同词其他意思保持独立。

## 10. 响应式、视觉与无障碍

下列窄屏尺寸与面板宽度保留为原型参考；正式 Web 适配桌面与手机浏览器，具体布局、组件与
性能预算在 M0-2 定义，不要求在桌面上复用移动端原型外壳。可访问性要求继续适用。

- 设计基准为 390×844；触控目标至少 44×44px；
- 桌面端居中显示最大 430px 产品面板，背景只承担氛围，不承载学习内容；
- 使用 8px spacing grid、有限的字号与字重、语义色 token；
- 品牌强调色用于主要行动，成功色用于完成，错误色只用于真实错误；
- 正文与背景对比达到 WCAG AA；图标按钮必须有 accessible name；
- 键盘可访问主要流程、确认面板与例句卡；
- 支持 `prefers-reduced-motion`；动画只用于反馈、方向和连续性；
- 内容加载保留稳定骨架，避免页面跳动；
- 不依赖颜色单独表达正确、错误或已会状态。

## 11. 状态、错误与离线反馈

| 场景 | 用户反馈 |
| --- | --- |
| 首次同步 | 保持布局的加载骨架 + “正在准备今天的学习” |
| 离线提交 Attempt | “已保存在本机，联网后同步” |
| 媒体不可用 | 当前文本仍可学习；播放按钮说明暂不可用，不伪造成功 |
| Action/asset 无效 | “当前学习内容暂时不可用”，不显示 fallback 答案 |
| 退出 active Encounter | 确认离开；说明这次不会算作完成 |
| Gate 检验失败 | 显示针对性修复；说明稍后会再遇到，不在答案揭示后伪造通关 |
| Review-only 无 due | “今天没有到期的意思”，保留返回 Mixed 学习入口 |
| 已会声明冲突 | 拉取 authoritative snapshot，显示当前真实状态与重试入口 |
| 今日无候选 | 区分“今天已完成 / 每日新学额度已满 / 学习计划不可用” |
| Preference revision 冲突 | 保留本机选择，显示服务端当前值并允许明确重试，不静默覆盖 |
| 退出登录但有 pending outbox | 先尝试同步；失败时说明将丢失的本机操作，默认保留数据 |
| 清除本机数据 | 明确“不会删除云端学习记录”；完成后可重新下载和 bootstrap |
| 离线请求导出/删除账号 | 说明该操作必须联网并重新确认，不创建本地伪请求 |
| Data Export processing/failed | 显示事实状态和重试路径，不展示不存在的下载文件 |
| Account deletion pending | 退出全部登录并说明处理中；旧设备不能继续上传 |

## 12. 产品事件与学习证据

可以记录用于 UX 和可靠性的 Product Events：页面进入、主要按钮点击、例句卡打开、音频
失败、同步等待、已会确认/撤销和 Encounter funnel。Product Events 不得成为 Learning
Evidence；只有服务端根据版本化 Action、Attempt 和 evidence rule 推导 Evidence。

Free Practice 上线后，交互与 response 保存为 Practice Turn，并可形成 Practice Observation、Feedback
与 optional Artifact；它们可以进入独立练习历史或统计，但仍不得作为 Product Event 或 Learning
Evidence 混入正式进度。

## 13. V1 功能优先级

### P0：核心闭环

- 浏览器采集插件：主动选区、Context/来源快照、原位解析与确认、收件箱慢轨、Web 交接、
  真实身份/幂等/恢复，以及受邀用户可执行的安装更新路径；
- 中文 L1、英语 L2 的 Personal Semantic World：Intake/收件箱、按需 Sense Construction、
  合法 Semantic Acceptance、完整 Context–Expression–Sense、Personal Meaning 与 Alignment；
- confirmed Sense 的资源准备状态必须真实；通过 published、on-demand 或 hybrid 路径冻结并校验
  Learning Materialization，失败时不显示可成功的学习入口；
- On-demand Learning Content LLM 与 Semantic LLM 角色分离，记录 generator/policy provenance；
- 三种 Protocol Purpose、可版本化 Protocol Step/transition 与 Card Presentation renderer；
- Lightweight Initial Learning、Initial Learning Completion/Study Completion、原子 Scheduling Handoff
  与 FSRS 初始化；
- Retention Target isolation、Retention Review 的 one-outcome/one-update，以及不改写原 Review 的
  Lightweight Relearning；
- 真实 Account、认证、当前 Account Session、退出登录与首次 Plan；
- Mixed 主入口与 Review-only 次要入口；
- 首版紧凑内容 renderer、可选 Recall/learner rating、揭示详情与全屏例句卡；
- 发音、例句音频与授权媒体；
- Book、Sense 详情、进度；
- 首版 primary Retention Target 级 Declared Mastery（在单表达 Sense 界面中显示为“熟”）；
- IndexedDB/outbox/Sync 与诚实错误状态；
- Sync Health、本机 pending 状态与诚实的退出/清除保护；
- Data Export、Account Deletion lifecycle 与旧 Replica resurrection barrier。

### P1：V1 产品完整性

- Book/Sense 搜索；它只搜索已发布 Learning Catalog，不冒充宽覆盖词典；
- Sense Bookmark 与 Example Bookmark 的 schema/contract/Sync/UI；
- typed Learner Preference revision，以及本机 Device Preference；
- 发音口音、例句译文默认状态、自动播放、外观、reduced motion 与 playback behavior；
- 本机内容/媒体占用、清理与重新 bootstrap；
- 可解释的学习日历和历史。

### 已允许首发开放的补充能力（2026-09-07）

自由练习、词典、统计和签到复用现有 UI，按实际能力开放并单独验收；
以下 Later 中的词典/练习条目指完整能力扩展，不再表示整个入口暂不开放。
签到和练习不写正式 Evidence、进度或调度；统计保持事实来源和确认状态可辨。
保留笔记、场景编辑和真实语流 YouGlish，不恢复随身听或拼写/听写弹窗。

### Later

- Structured Acquisition Protocol：Acquisition Cycle、Gate progress、interference pacing、Recognition、
  Recall、Novel-context Transfer、条件性 Boundary、Graduation 与 evidence-backed Relearning；
- Structured Acquisition 所需的完整 Action renderer、protected assessment inventory、5D projection
  与高保证 content validator；
- 版本化 Reference Lexicon、全局查词、Example Lexical Occurrence annotation、Contextual Sense
  Resolution、Reference Sense ↔ Sensa Sense Alignment 与离线 Reference Release；
- 真实的释义/例句/用法/构词词源/相关详情及 source/license attribution；明确不建设“真题”；
- published Semantic Field 浏览，以及 Personal Semantic World 上更完整的跨 Field/多语言 Projection；
- Initial Free Practice Profile：明确选择的 Personal Meanings/Senses/Expressions 与当前 Book slice，
  以及真实语流泛化、情境口语排演、语境推义和情境书面表达；它覆盖四个 Practice Area，但不把
  Area、Practice Observation 或 Feedback 当作 Gate/Evidence；
- 后续 Free Practice Profile 才扩展更多 Activity family、Practice Scope 来源与 provider capability；
- 每个 Sense 一份 current Note；
- Personal Collection 与 typed Sense/Example Membership；
- Book Enrollment/Range、`active | maintenance | paused` lifecycle、Supplemental Curriculum、
  Study Scope Revision 与完整 Add-to-Learning decision；
- 通知提醒；
- 签到之外的额外激励；首版无连续天数、奖励或补签；浏览器文字插件之外的图片/语音、移动分享、桌面全局采集与更多浏览器；
- 多套高级主题；
- 多设备 Account Session 列表、逐设备远程撤销和完整安全活动历史；
- 事实型学习历史与概况的扩展；暂不建设 learner-facing 维度诊断、处方式 Insight 或学习债务面板。

## 14. 验收场景

1. **Target 与内容分离**：confirmed Sense 先固定 Learning Target；published、on-demand 与 hybrid
   只是内容来源，不会改变它的 senseId 或 Personal Meaning Alignment。
2. **按需内容可重放**：开始学习前固定 materializationId、protocol/version、内容角色、generator/
   policy provenance、validator result 与 digest；模型失败显示可恢复状态。
3. **作答后不漂移**：learner 首次看到或回应某个内容后，模型不能重新生成并替换 prompt、answer、
   grader 或反馈依据；更新必须创建新 materialization。
4. **轻量完成不冒充证据**：完成首版学习产生 Study Completion/Lightweight Study Outcome，但不产生
   Gate pass、5D 或 mastery claim；成功的 Initial Learning Completion 与唯一 Scheduling Handoff
   必须原子落账，失败、中断或内容不可用时两者都不产生。
5. **显式调度交接**：FSRS 只在收到版本化 Scheduling Handoff 后初始化；handoff 分别保留
   `protocol_completion | acquisition_graduation | learner_rating | imported` basis 与
   `non_evidentiary | self_report | behavioral | externally_attested` evidence level。
6. **Review-only**：次要入口只返回 due Retention 与允许的 Relearning，不引入新 Sense、不推进
   initial Learning Protocol、不消耗 daily-new quota。
7. **自评诚实**：协议允许“认识/模糊/忘记”时可以产生 learner-rated Memory Outcome，但不能写成
   独立 retrieval Evidence。
8. **一次 Review 一次 FSRS**：一次 due Review 最多产生一个 Memory Outcome 与一次 FSRS revision；
   后续 repair/retest 或 Lightweight Relearning 不能覆盖或重复推进原 Review；Relearning Completion
   不创建 handoff、不重新初始化 FSRS，也不自动成为 scheduler input。只有协议声明的独立
   relearning evaluation 可另产生幂等 Memory Outcome。
9. **全屏例句**：中文、上下文、音频和收藏可独立操作；翻页和播放不产生 Learning Evidence。
10. **熟**：确认后当前 primary Retention Target 退出所有 Planning inventory，active Protocol Run
    不伪造完成，sibling
    Sense 不受影响；撤销后依据保留的 phase/run/FSRS State 恢复。
11. **离线学习**：合法 operation 立即影响本地 UI，联网后 `push → pull` 收敛到服务端投影。
12. **桌面 Web**：学习面板不超过 430px，键盘和屏幕阅读器可完成主要流程。
13. **术语与伪功能审计**：界面不出现 Sense、Protocol、Cycle、Gate、Encounter、Evidence、5D、
    FSRS、Replica、Workspace；不可用入口不伪装成可用。改变 Card 数量、阶段拆分或 renderer 不创建
    新学习 identity，也不改变 Protocol Step 的结果资格或 scheduler 语义。

以下场景在 Structured Acquisition Protocol 进入交付范围时验收：

14. **新 Sense grounding**：目标词在主动揭示前完全不可见；揭示后只显示 Action 引用资产。
15. **干扰后检验**：Introduction 完成后先出现其他 Sense；答案揭示或 repair 后不在同一 Encounter
    将立即重答计为独立 Gate pass。
16. **Baseline Gates**：一个 initial Cycle 必须用三次独立成功分别解决 Contextual Recognition、
    Meaning-to-form Recall 与 Novel-context Transfer；仅浏览内容或一题多算不能毕业。
17. **条件 Boundary**：有 required confusion target 的 Sense 必须通过 Relation-backed 检验；没有
    真实 target 的 Sense 不出现为凑数而生成的 Boundary 卡。
18. **局部失败**：Recall 失败只重新打开 Recall 并触发对应 repair；已经通过的无关 Gate 与历史
    Evidence 不被删除。
19. **Graduation handoff**：只有全部 required Gates 通过才产生 Acquisition Graduation，并必须创建
    `basis=acquisition_graduation`、`evidenceLevel=behavioral` 的 Scheduling Handoff。

以下场景在完整 Curriculum lifecycle 对应功能进入交付范围时验收：

20. **换词书**：A 从 active 转为 maintenance、B 转为 active；A 的未开始成员停止引入，已开始与
    due 内容继续，所有进度保持不变。
21. **暂停与恢复**：暂停 A 后它不再产生正式候选；恢复后使用原 Protocol Run/FSRS State，不伪造
    已会或重置。
22. **范围收缩**：缩小 Book Range 只减少未来 Introduction，已发生事实不删除；active Session 仍
    使用开始时固定的 Scope Revision。
23. **收藏加入学习**：同一 Sense 重复提交幂等；已在 Book/补充范围、内容不可用与已会冲突得到
    不同结果，unsave 不移出学习。
24. **多来源去重**：一个 Retention Target 同时来自 Book 与 Supplemental Curriculum 时只有
    一份 active Protocol Run 和 FSRS State；移除一个来源不会错误移除另一个来源提供的资格；
    同一 Sense 的不同 target expressions 不得被合并。

以下场景在 Lexical Reference 对应功能进入交付范围时验收：

25. **目标词确定解析**：点击 Example 的 authored target span，沿既有 Sense binding 确定 Sensa
    Sense；存在 reviewed Alignment 时强调正确 Reference Sense，否则不调用模型重新猜测。
26. **非目标词与词组**：点击普通 token 或 multiword span，优先返回最长 approved occurrence；
    完整词典义项仍可见，`model_confident/ambiguous/unresolved` 使用诚实文案。
27. **Reference-only meaning**：可以搜索和浏览，但没有 alignment 或 executable provisioning path 时
    加入学习返回 `content_unavailable`，不创建进度或幽灵课程。
28. **无副作用**：搜索、点词、展开构词词源和播放音频不改变 Scope、quota、Gate、5D、due 或 FSRS，
    也不自动收藏、写笔记或加入学习。
29. **答案保护**：active assessment 在提交/feedback 前没有应用内查词路径；Reference API 永不返回
    learning-only/assessment-only assets。
30. **真实详情**：没有内容的区块不出现，词源故事/记忆辅助明确标注，未授权 provider 名称和
    “真题”均不出现。

以下场景用于验收 Settings / Account：

31. **Account/Learner 分离**：退出登录或撤销一个 Account Session 不删除 Learner 的 Plan、Progress、
    Personal Content 或历史事实；界面不出现 Workspace/LearnerScope。
32. **Preference ownership**：口音和例句中文默认状态通过 Learner Preference 在设备间收敛；autoplay、
    theme、reduced motion 与 playback behavior 留在当前设备。
33. **Plan 不是设置值**：在 Settings 修改每日新学数实际执行 Study Plan/Curriculum operation，产生
    正确 revision，不创建同名 Preference。
34. **Preference 不改历史**：切换口音不替换 active Action 的 pinned audio；任何展示偏好都不产生
    Attempt/Evidence、Gate/5D/FSRS update 或改变 novel status。
35. **Pending sign-out**：有未同步操作时退出先尝试同步；失败时默认保留本机数据，只有明确确认才
    丢弃所列 operations。
36. **Local clearance**：清除本机内容不删除服务端数据；重新登录/安装后可以从 authoritative state
    bootstrap，且未处理 outbox 不被静默清除。
37. **Data export**：同一 request identity 幂等；导出固定一个逻辑 snapshot，并如实显示 requested、
    processing、completed 或 failed。
38. **Account deletion**：只允许在线重新确认；进入 deletion pending 后撤销 Account Sessions 与 Replica
    写入资格，旧离线 outbox 永远不能复活数据。
39. **破坏性操作文案**：sign-out、清除本机数据和删除账号使用不同确认及结果；V1 不出现全量学习
    历史 reset。

## 15. 原型边界

高保真原型用于验证 IA、视觉层级、文案和状态转换，不写真实服务端数据，不产生真实
Evidence，也不代表 Bookmark contract 已完成。实现必须以本文和 canonical runtime/content
models 为准，不能从原型 JavaScript 反推领域规则。现有原型早于 2026-08-27 Acquisition
Cycle 决策，也早于 2026-08-31 Learning Connection 决策，只能作为视觉参考，不能证明
Materialization/Protocol/Handoff、Gate/interference/Graduation 或 Review-only 流程。现有
不背复刻中的 token regex、静态 quick dictionary 和多 tab 占位内容也只证明交互形态，不能证明
Contextual Sense Resolution、Reference Release、授权词典数据或 Lexical Enrichment 已实现。
原型或当前 `/me` 中把 profile、Workspace compatibility 字段和单一动画开关放在一起，也不能证明
最终 Account、Learner/Device Preference、Sync Health 或 Data Control lifecycle 已实现。
原型中的学习内容逐字镜像
`rel-2026-v1-candidate` 下 validation status 为 `satisfied` 的 V3 candidate package，并直接
读取这些 Package 通过 `mediaSha256` 登记的本地发音与例句 MP3，不调用 TTS；这个本地文件
路径只用于原型验收，生产端仍须通过授权媒体 URL / Supabase Storage 交付。以上证明内容与媒体形状能和
交互适配，不表示 candidate 已成为公开发布的 Content Release，也不把 Published Structured
Package 变成首版 On-demand Lightweight Study 的唯一来源。

2026-09-07 首条旅程离线范围确认：可继续已授权且材料已下载的学习，不离线新建学习；
本机回答与服务端确认结果分开呈现，具体授权/版本/恢复合同在 M0-3 固定。

2026-09-07 首次数量设置细化确认：登录后简短设置页确认数量再到首页；后续修改只影响当天
尚未开始的新内容，已开始的学习保持原样。

当前登录与签到裁决：采用受邀邮箱、验证码免密码的体验方向，真实认证能力须核实；首次
确认每日数量后到首页，回访/插件认证恢复原入口。签到沿用我的学习按钮与日历，保留手动
并在开始正式学习时自动签到；账号日去重，账号时区初次取设备时区，离线保留发生日期。
首版不做连续天数、奖励或补签；此前有关连续天数的历史设计不再作为首发要求。自动签到
只记录活动，不证明学习完成，不写 Evidence 或调度。

M0-2 收口：体验与状态规格已完成；插件首版只直接划表达自动取所在句子，使用就近浮层，
不含双次划选、聊天或语境调整；跨站需点击图标继续。短期重学初始间隔 10 分钟，只有等待
项时可结束或主动提前继续，失败重排间隔。具体恢复、汇总与工程验收要求以两份 M0-2 规格
为准；消费合同和生产运行验收不由规格确认代替。
