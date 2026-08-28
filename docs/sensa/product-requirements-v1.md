# Sensa V1 产品需求文档（PRD）

> 状态：Accepted product baseline  
> 决策日期：2026-08-28  
> 产品范围：移动形态 React Web；未来 Flutter iOS/Android 复用相同旅程与语言中立契约  
> 交互原型：[`docs/reference/sensa-v1/product-prototype.html`](../reference/sensa-v1/product-prototype.html)

本文冻结 Sensa V1 的信息架构、用户旅程、用户语言、屏幕职责和交互验收标准。
里程碑与上线边界仍由 [current-stage.md](current-stage.md) 控制；运行时所有权由
[production-architecture.md](production-architecture.md) 控制；学习材料完整性由
[sense-learning-resource-model.md](sense-learning-resource-model.md) 控制。本文不能把
Product Shell 变成 Card/Deck 产品，也不能让客户端接管 Semantic Policy、Evidence、
5D、Memory Outcome 或 FSRS。

## 1. 产品命题

Sensa 帮助学习者学习一个英文词在真实语境中的**具体意思**，而不是背诵“英文词 =
中文标签”。产品内部以 Sense 为课程、学习状态和调度身份；用户界面继续使用自然语言
“单词”和“意思”。

Sensa 借鉴不背单词的沉浸首页、移动节奏、渐进披露和全屏例句体验，但学习内核改为：

1. 先让学习者进入可感知的经验，再揭示英文词形、发音和中文连接；
2. 让一个新 Sense 在其他 Sense 的干扰之间完成 Recognition、Recall 与 Transfer；
3. 只有真实 confusion target 才增加 Boundary requirement；
4. 用 Unified Planner 安排 new、Acquisition、Relearning 与 due Review；
5. 短期 Acquisition Graduation 后才初始化 FSRS，并由 Semantic Policy 决定每次出现做什么。

## 2. V1 目标与非目标

### 2.1 目标

- 用户从打开产品到开始今日学习只需一次主要操作；
- “开始今天的学习”使用统一 Mixed Session；次要“只复习”入口使用同一 Runtime 的
  Review-only intent，而不是复制第二套复习系统；
- 学习界面始终聚焦一个 Sense、一个 Action 和一个主要操作；
- 揭示阶段达到不背单词式的信息层级和沉浸感，同时严格遵守 Action 资产边界；
- Book、Plan、学习历史、Declared Mastery、媒体、离线 outbox 和 Sync 都使用真实数据；
- Account、Learner/Device Preferences、Sync Health、导出与删除都显示真实 owner 和状态；
- 用户永远不需要理解 Lexeme、Sense、Encounter、Action、Evidence、5D、FSRS、Replica 或 Workspace。

### 2.2 非目标

- 不提供商城、会员、虚拟货币、装备、课程、班级打卡、社区或成绩分享；
- 不提供 Cards、Decks 或通用闪卡导入；
- 不展示没有领域契约和持久化能力支撑的占位入口；
- V1 P0 不要求交付独立 Free Practice、Semantic Field 可视化或 Sense Note；这些能力已有领域
  边界，但在 persistence/API/Sync/renderer contract 就绪前不得显示占位入口；
- V1 不交付影视剧、电视或 YouTube 原声例句、synced-media Example Render、词级媒体 timeline
  或外部媒体消歧/授权生产链，也不设置 Listening Gate；当前 pronunciation/example audio 只是
  已审核的静态呈现资源；
- 不伪造 VOA、影视或新闻出处；生成内容必须显示真实 provenance；
- 不建设“真题”、考试语料聚合、考试频次或相应占位 tab；Reference 内容必须有真实来源、授权与
  release provenance；
- 不提供社交 Profile、公开昵称/头像体系、多个 Learner Profile、算法参数面板或“一键重置全部
  学习历史”；每日新学数和词书范围不能伪装成普通 Preference。

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
| Acquisition Cycle | 正在学习这个意思 | 跨多次出现建立连接；不向用户显示 Gate 或 Cycle 技术名 |
| Sense Encounter | 这个意思的一次学习 | 不显示技术名称 |
| Learning Action | 当前学习步骤 | 页面只显示自然任务语言，不显示 payload kind |
| Declared Mastery | 已会声明；按钮为“熟” | 永远说“这个意思已经会了”，不能说整词已掌握 |
| Memory State / FSRS | 待复习、暂时稳定、下次出现 | 不显示算法名或 rating |
| Semantic Field | 相关意思 / 词义区域 | 不向用户宣称统一概念本体或 embedding 距离 |
| Reference Lexicon / Reference Release | 查词 / 词典 | 覆盖可以大于当前词书，但不是待学习清单 |
| Reference Sense | 词典里的意思 | 与“当前学习的意思”区分；没有 Alignment 时不显示加入学习 |
| Contextual Lookup | 点词查义 | 展示完整词典，并仅在可靠时标记“本句中”或“本句中可能是” |
| Lexical Enrichment | 构词 / 词源 / 相关 | 只在真实内容存在时显示；记忆辅助不能冒充词源事实 |
| Learner Semantic Projection | 我的词义世界 | 是有限内容上的个人投影，不称为“大脑掌握地图” |
| Saved Sense / Saved Example | 收藏的意思 / 收藏的例句 | 收藏不表示已会，也不自动加入学习 |
| Sense Note | 我的笔记 | 每个意思一份当前笔记，不称为词典释义 |
| Personal Semantic Anchor | 我的场景（Later） | 是用户自己的经验，不称为标准例句或正确答案 |
| Personal Collection | 自定义集合（Later） | 是个人组织方式，不称为词书或词义区域 |
| Add-to-Learning Intent | 加入学习（Later） | 必须显式触发，不与收藏或自由练习合并 |
| Free Practice Session | 自由练习 | 听说读写入口不改变正式学习与复习进度 |
| Practice Result | 本次练习结果 | 不称为掌握、毕业或复习完成 |
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
9. **移动优先。** Web 桌面端保持 390–430px 的移动学习面板；不把 Study 拉伸成桌面表单。
10. **可恢复。** 离开、同步冲突、内容缺失和已会撤销都有明确恢复路径。
11. **经过干扰再检验。** 揭示或 repair 后的立即回答不计为独立成功；同一意思在其他意思间穿插。
12. **毕业不等于掌握。** 完成短期习得只表示进入长期保持，不向用户承诺永久记住。
13. **额度不是债务。** 每日新学数是上限；未完成部分不滚入次日，也不制造断签或补课压力。
14. **范围变更可恢复。** 换词书、缩小范围和暂停学习不删除 Sense 进度；恢复后从真实状态继续。
15. **参考不制造进度。** 搜索、点词、展开构词词源与播放词典音频都不自动收藏、加入学习或
    改变正式进度。
16. **不确定性可见。** 上下文义项不能可靠解析时不强行标记唯一“本句义”；空数据区块不显示。
17. **设置有真实 owner。** Settings 只是组合入口，每个修改必须进入 Account、Preference、Device、
    Curriculum 或 Data Control 的真实领域对象。
18. **偏好不改历史。** 口音、译文默认状态、autoplay、主题和动画不能重写 Action、Evidence、Gate、
    FSRS 或已经固定的资源。
19. **破坏性操作分层。** 退出登录、清除本机数据、重置学习历史和删除账号必须使用不同文案、确认
    与结果；pending outbox 不得被静默清除。

## 5. 信息架构

```text
沉浸首页
├── 开始今天的学习
│   └── Mixed Learning Session
├── 只复习（次要入口，有 due 时显示）
│   └── Review-only Learning Session
├── 头像
│   └── 账号与设置
│       ├── 账号与安全
│       ├── 外观与设备
│       ├── 数据与同步
│       ├── 导出与删除
│       └── 关于与支持
└── 三个二级入口
    ├── 词书
    ├── 我的内容
    └── 我的学习
        ├── 计划与进度
        └── 学习偏好
```

首页是默认落点，不作为第四个底部 Tab。二级页面通过底部三个带文字标签的入口打开，
顶部返回/收起回到首页。活跃学习期间隐藏全部产品导航。

## 6. 核心用户旅程

### 6.1 首次使用

```text
登录 → 选择词书与首个 Book Range → 设置每日新学意思数
→ 建立 Study Plan 与 active Book Enrollment
→ 下载/同步当前 Book Version → 首页可开始
```

没有可用 Plan 时，首页主要按钮改为“选择一本词书”，不得进入空学习流程。

### 6.2 每日学习

```text
打开产品 → 首页显示今日新学/待复习摘要 → 开始今天的学习
→ start/resume Mixed Session → Planner 从四类 inventory 选择下一个 Sense
→ 打开一次 Encounter → 渲染一个主要任务 → Attempt/feedback/repair
→ 更新 Acquisition Gate 或结算一次 due Review → 下一个 Sense
→ 无候选或用户结束 → 完成页 → 首页
```

首页的新学与复习数字是摘要，不是客户端持有的固定队列。Mixed Planner 可以选择 due
Retention、Review-originated Relearning、ready initial Acquisition 和 daily quota 允许的
new Introduction。具体优先级由版本化 Planning Policy 控制，但 due backlog 和已经开始的
Acquisition 都不能被持续引入新 Sense 饿死。

Mixed Session 固定开始时的 Study Scope Revision。用户后来换词书、调整范围或加入个人 Sense，
只影响后续 Session，不能让当前学习队列在后台静默变形。

### 6.3 新 Sense 的短期习得

```text
Introduction：Experience → 主动揭示 Sense/Form/Audio/Bridge/Example
→ 穿插其他 Sense
→ Contextual Recognition
→ 再次穿插
→ Meaning-to-form Recall
→ 再次穿插
→ Novel-context Transfer
→ required Boundary（可嵌入 Recognition/Transfer）
→ Acquisition Graduation
→ 初始化 FSRS
```

Introduction 与 reveal 只建立连接，不产生 Gate pass 或 FSRS due。正式检验必须在其他 Sense
干扰后发生；同一 Cycle 可以跨 Session 恢复。一个 Gate 失败时，系统显示针对性 repair 并在
后续 Encounter 重测该能力，不要求用户机械重做已经通过的无关 Gate。答案揭示后的立即重答
不得算作独立成功。

Recognition、Recall 与 Transfer 都通过且所有 required Boundary 已解决时，产品把该意思标记
为“已完成首次学习/待系统复习”，但不宣称“已经掌握”。此时才初始化 FSRS。

### 6.4 只复习

```text
首页 → 只复习 N 个
→ start/resume Review-only Session
→ 只选择 due Retention 或 Review-originated Relearning
→ 无 due/relearning 候选 → 复习完成页 → 首页
```

Review-only 不引入新 Sense、不推进 initial Acquisition、不移动课程新学位置，也不消耗 daily-new
quota。没有到期内容时入口禁用或弱化；V1 不提供会提前改变 FSRS 的“自由刷题”。

一次 due Review 的第一次有效独立结果最多产生一个 Memory Outcome 和一次 FSRS 更新。失败先
记录真实遗忘，再进入 Relearning；当天之后的 repair/retest 不得覆盖失败或重复调用 FSRS。

### 6.5 浏览内容

```text
首页 → 词书/我的内容 → 单词聚合列表 → 某个具体意思
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

Reference-only meaning 可以浏览，但没有 reviewed Alignment 或 executable published Package 时不显示
可成功的“加入学习”，Curriculum 返回 `content_unavailable`。查词本身不自动收藏、写笔记或加入
计划，也不产生 Attempt/Evidence/Practice Result。

若当前 Reference Sense 已对齐 Sensa Sense，详情可以挂载该 Sense 的收藏状态与 current Sense Note；
这仍是 Personal Content，不是词典内容。Reference-only meaning 暂无通用收藏或笔记模型。

active assessment 在 learner 提交 primary response 并进入 feedback 前，不提供产品内点词/词典入口。
Introduction reveal、内容浏览和 feedback 后允许查词；这是答案完整性边界，不是试图封锁外部词典。

### 6.7 已会声明

```text
活跃学习顶部“熟” → 确认“这个意思已经会了”
→ 本地写入 learner_declared_mastery.set
→ 同一 Sense 的所有 active Encounter interrupted；所有 planned Encounter cancelled
→ 无 Attempt/Evidence/Memory Outcome → Planner 选择下一个 Sense
```

在词书或“我的内容 → 已会”中可以撤销；撤销只恢复该 Sense 的计划资格。同一 Lexeme
的 sibling Senses 不受影响。

### 6.8 Curriculum lifecycle（完整模型，Later）

```text
当前词书 A（active）→ 选择词书 B
→ A 默认转为“只继续已学内容”（maintenance）
→ B 成为当前新学词书（active）
→ 新 Study Scope Revision 从下一 Session 生效
```

换词书不清零 A 的学习进度，也不重新初始化重叠 Sense 的 FSRS。用户可以进一步暂停 A；暂停只让
它暂时不再进入正式学习，不等于标记已会。切回时从保留的 phase、Cycle 和 Memory State 继续。

Book Range 只控制未来可以开始的新 Sense。缩小范围不得删除已经开始或已经复习的事实；“改变
新学范围”和“暂停既有内容”必须是两个明确操作。

```text
收藏的意思 → 加入学习
→ Curriculum 校验 published executable Package 与当前范围
→ 已接纳 / 已在学习范围 / 内容暂不可用 / 需先撤销已会
```

接纳后创建 Supplemental Curriculum Membership，不改写 Book Version。取消收藏不移出学习；
移出补充学习也不取消收藏或删除进度。收藏例句上的入口必须写成“学习这个例句对应的意思”，
不能把 Example 当作课程成员。

### 6.9 设置与偏好

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

### 6.10 账号、同步与数据控制

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
- 日期与一句产品主张；
- 今日摘要：`7 个新意思 · 3 个待复习`；
- 唯一主要按钮：`开始今天的学习`；
- 有到期内容时显示低于主按钮层级的次要入口：`只复习 3 个`；
- 当前词书与每日目标的轻量说明；
- 底部 `词书 / 内容 / 学习` 三个入口；
- 必要时出现一行非阻塞同步状态。

### 7.2 词书

- 展示当前 Plan 绑定的词书、封面、单词数、意思数和完成进度；
- 支持选择/更换词书、设置每日新学意思数；
- 词头聚合列表下，每个意思拥有独立状态：`待学习 / 学习中 / 待复习 / 需要巩固 / 已会`；
- 支持按单词和意思搜索；
- 点击某一行进入该 Sense 的只读详情；
- 不把 sibling Sense 合并成一个学习状态。

完整 Curriculum lifecycle 上线后，词书页还应区分当前新学、只继续已学内容与已暂停的词书；
换词书默认保留旧词书的维护学习，暂停是另一个明确选择。Book 完成状态只做事实呈现：可以显示
“新内容已学完”或“首次学习已完成”，不能宣称长期复习永久完成。

### 7.3 我的内容

V1 信息组：

- 最近学过；
- 全部已学；
- 已会的意思；
- 收藏的意思；
- 收藏的例句。

Bookmark 功能必须先有服务端 schema、语言中立 contract、Sync operation 和本地 store，
才能在产品中显示星标。笔记、随身听队列和听写不进入 V1。

完整产品模型在这些事实之上生成“我的词义世界”：按 published Semantic Field 展示正在形成、
已经建立、需要巩固和待探索的有限语义区域，并允许将 Field、列表或选择结果作为 Free Practice
Scope。该投影和听说读写入口只有在对应 content/persistence/API/Sync contract 完成后才显示；
地图视图与列表视图必须读取同一批权威事实。

完整 Personal Content 还包括每个 Sense 一份 current Note、零到多个 Personal Semantic Anchors、
Personal Collections 与 typed Sense/Example Membership。收藏、笔记、我的场景、集合、自由练习
和“加入学习”必须是独立操作：取消收藏不删除笔记/场景/集合成员，删除集合不删除收藏或正文，
任何 Personal Content 操作都不修改正式学习状态。

Curriculum contract 就绪后，收藏的 Sense 可以显示独立的“加入学习”；已在有效 Study Scope 中时
显示事实状态而不重复创建 Membership。Saved Example 只允许跳转到其 Sense 的加入学习操作。

### 7.4 我的学习

`我的学习` 与 `学习偏好` 使用顶部双页签。

计划与进度只做事实性呈现，包括当前词书/范围、每日新学上限、今日完成、累计已学、待复习和
学习日历。它不生成维度待办、薄弱项诊断或 learner-facing Learning Insight，也不得显示 raw
FSRS state、reps、Sense ID 或同步实现细节。缺席日期和未用额度不表现为断签、欠账或失败。

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

### 8.6 其他 Action renderer

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
- operation 使用当前 Sense、Declared Mastery revision 和可选 Encounter context；
- 同一 Sense 的所有 active Encounter 变为 interrupted，所有 planned Encounter 变为 cancelled；
- active Acquisition/Relearning 保留真实进度但退出 Planning；不伪造 Graduation；
- 不写 Attempt、Evidence、Gate pass、Memory Outcome 或 FSRS rating；
- 网络失败时声明仍在本机生效，并显示待同步状态；
- 冲突时拉取服务端 authoritative snapshot，再给出可理解的重试/恢复操作；
- Book 和“已会”列表显示 `已会`，允许反向设置 `isMastered=false`；
- 同词其他意思保持独立。

## 10. 响应式、视觉与无障碍

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

Free Practice 上线后，播放、展开与跟随形成 Practice Activity，可判分响应形成 Practice Result；
两者可以进入练习统计，但仍不得作为 Product Event 或 Learning Evidence 混入正式进度。

## 13. V1 功能优先级

### P0：核心闭环

- 真实 Account、认证、当前 Account Session、退出登录与首次 Plan；
- Mixed 主入口与 Review-only 次要入口；
- Acquisition Cycle、Gate progress、interference pacing、Graduation 与 Relearning；
- 全部 V1 Action renderer；
- 揭示详情与全屏例句卡；
- 发音、例句音频与授权媒体；
- Book、Sense 详情、进度；
- Sense 级 Declared Mastery；
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

### Later

- 版本化 Reference Lexicon、全局查词、Example Lexical Occurrence annotation、Contextual Sense
  Resolution、Reference Sense ↔ Sensa Sense Alignment 与离线 Reference Release；
- 真实的释义/例句/用法/构词词源/相关详情及 source/license attribution；明确不建设“真题”；
- Semantic Field 浏览与 Learner Semantic Projection（“我的词义世界”）；
- Initial Free Practice Profile：当前 Book slice/明确选择的 Senses，以及沉浸刷词、随身听、听写和
  随手拼写；它支持 Reading/Listening/Writing，但不把 Mode 当作 Gate；
- 后续 Free Practice Profile 才考虑 Speaking、发音评分、开放式语境产出，以及 Field/收藏/历史等
  已完成各自 contract 的 Practice Scope；
- 每个 Sense 一份 current Note；
- Personal Semantic Anchor（“我的场景”）与 learner-controlled scaffold eligibility；
- Personal Collection 与 typed Sense/Example Membership；
- Book Enrollment/Range、`active | maintenance | paused` lifecycle、Supplemental Curriculum、
  Study Scope Revision 与完整 Add-to-Learning decision；
- 通知提醒；
- 多套高级主题；
- 多设备 Account Session 列表、逐设备远程撤销和完整安全活动历史；
- 事实型学习历史与概况的扩展；暂不建设 learner-facing 维度诊断、处方式 Insight 或学习债务面板。

## 14. 验收场景

1. **新 Sense grounding**：目标词在主动揭示前完全不可见；揭示后只显示 Action 引用资产。
2. **干扰后检验**：Introduction 完成后先出现其他 Sense；答案揭示或 repair 后不在同一
   Encounter 将立即重答计为独立 Gate pass。
3. **Baseline Gates**：一个 initial Cycle 必须用三次独立成功分别解决 Contextual Recognition、
   Meaning-to-form Recall 与 Novel-context Transfer；仅浏览内容或一题多算不能毕业。
4. **条件 Boundary**：有 required confusion target 的 Sense 必须通过 Relation-backed 检验；
   没有真实 target 的 Sense 不出现为凑数而生成的 Boundary 卡。
5. **局部失败**：Recall 失败只重新打开 Recall 并触发对应 repair；已经通过的无关 Gate 与
   历史 Evidence 不被删除。
6. **Acquisition/FSRS 分界**：Introduction 或单次 retrieval 后仍无 FSRS due；只有全部 required
   Gates 通过并发生 Graduation 后才初始化 Memory State。
7. **Review-only**：次要入口只返回 due Retention 与 Review-originated Relearning，不引入新
   Sense、不推进 initial Acquisition、不消耗 daily-new quota。
8. **一次 Review 一次 FSRS**：due Review 首次独立失败后记录一次失败 Outcome；当天 repair/
   Relearning 不能覆盖它或重复推进 FSRS revision。
9. **全屏例句**：中文、上下文、音频和收藏可独立操作；翻页和播放不产生 Gate Evidence。
10. **Cloze 变体**：题面不泄露 target；找错 Lexeme 与正确词族但形态不合语境得到可区分结果。
11. **熟**：确认后当前 Sense 退出所有 Planning inventory，Cycle 不伪造毕业，sibling Sense 不受影响。
12. **撤销已会**：恢复后依据未改变的 phase、Cycle 与 FSRS State 重新取得正确候选资格。
13. **离线学习**：Attempt 和声明立即影响本地 UI，联网后 `push → pull` 收敛到服务端投影。
14. **桌面 Web**：学习面板不超过 430px，键盘和屏幕阅读器可完成主要流程。
15. **术语审计**：界面不出现 Sense、Cycle、Gate、Encounter、Evidence、5D、FSRS、Replica、Workspace。
16. **无伪功能**：不可用入口不出现在主产品 IA；媒体失败不展示播放成功。

以下场景在完整 Curriculum lifecycle 对应功能进入交付范围时验收：

17. **换词书**：A 从 active 转为 maintenance、B 转为 active；A 的未开始成员停止引入，已开始与
    due 内容继续，所有进度保持不变。
18. **暂停与恢复**：暂停 A 后它不再产生正式候选；恢复后使用原 Cycle/FSRS State，不伪造已会或重置。
19. **范围收缩**：缩小 Book Range 只减少未来 Introduction，已发生事实不删除；active Session 仍
    使用开始时固定的 Scope Revision。
20. **收藏加入学习**：同一 Sense 重复提交幂等；已在 Book/补充范围、内容不可用与已会冲突得到
    不同结果，unsave 不移出学习。
21. **多来源去重**：一个 Sense 同时来自 Book 与 Supplemental Curriculum 时只有一份 Progress、
    Cycle 和 FSRS State；移除一个来源不会错误移除另一个来源提供的资格。

以下场景在 Lexical Reference 对应功能进入交付范围时验收：

22. **目标词确定解析**：点击 Example 的 authored target span，沿既有 Sense binding 确定 Sensa
    Sense；存在 reviewed Alignment 时强调正确 Reference Sense，否则不调用模型重新猜测。
23. **非目标词与词组**：点击普通 token 或 multiword span，优先返回最长 approved occurrence；
    完整词典义项仍可见，`model_confident/ambiguous/unresolved` 使用诚实文案。
24. **Reference-only meaning**：可以搜索和浏览，但没有 aligned executable Sensa Package 时加入学习
    返回 `content_unavailable`，不创建进度或幽灵课程。
25. **无副作用**：搜索、点词、展开构词词源和播放音频不改变 Scope、quota、Gate、5D、due 或 FSRS，
    也不自动收藏、写笔记或加入学习。
26. **答案保护**：active assessment 在提交/feedback 前没有应用内查词路径；Reference API 永不返回
    learning-only/assessment-only assets。
27. **真实详情**：没有内容的区块不出现，词源故事/记忆辅助明确标注，未授权 provider 名称和
    “真题”均不出现。

以下场景用于验收 Settings / Account：

28. **Account/Learner 分离**：退出登录或撤销一个 Account Session 不删除 Learner 的 Plan、Progress、
    Personal Content 或历史事实；界面不出现 Workspace/LearnerScope。
29. **Preference ownership**：口音和例句中文默认状态通过 Learner Preference 在设备间收敛；autoplay、
    theme、reduced motion 与 playback behavior 留在当前设备。
30. **Plan 不是设置值**：在 Settings 修改每日新学数实际执行 Study Plan/Curriculum operation，产生
    正确 revision，不创建同名 Preference。
31. **Preference 不改历史**：切换口音不替换 active Action 的 pinned audio；任何展示偏好都不产生
    Attempt/Evidence、Gate/5D/FSRS update 或改变 novel status。
32. **Pending sign-out**：有未同步操作时退出先尝试同步；失败时默认保留本机数据，只有明确确认才
    丢弃所列 operations。
33. **Local clearance**：清除本机内容不删除服务端数据；重新登录/安装后可以从 authoritative state
    bootstrap，且未处理 outbox 不被静默清除。
34. **Data export**：同一 request identity 幂等；导出固定一个逻辑 snapshot，并如实显示 requested、
    processing、completed 或 failed。
35. **Account deletion**：只允许在线重新确认；进入 deletion pending 后撤销 Account Sessions 与 Replica
    写入资格，旧离线 outbox 永远不能复活数据。
36. **破坏性操作文案**：sign-out、清除本机数据和删除账号使用不同确认及结果；V1 不出现全量学习
    历史 reset。

## 15. 原型边界

高保真原型用于验证 IA、视觉层级、文案和状态转换，不写真实服务端数据，不产生真实
Evidence，也不代表 Bookmark contract 已完成。实现必须以本文和 canonical runtime/content
models 为准，不能从原型 JavaScript 反推领域规则。现有原型早于 2026-08-27 Acquisition
Cycle 决策，只能作为视觉参考，不能证明 Gate/interference/Graduation/Review-only 流程。现有
不背复刻中的 token regex、静态 quick dictionary 和多 tab 占位内容也只证明交互形态，不能证明
Contextual Sense Resolution、Reference Release、授权词典数据或 Lexical Enrichment 已实现。
原型或当前 `/me` 中把 profile、Workspace compatibility 字段和单一动画开关放在一起，也不能证明
最终 Account、Learner/Device Preference、Sync Health 或 Data Control lifecycle 已实现。
原型中的学习内容逐字镜像
`rel-2026-v1-candidate` 下 validation status 为 `satisfied` 的 V3 candidate package，并直接
读取这些 Package 通过 `mediaSha256` 登记的本地发音与例句 MP3，不调用 TTS；这个本地文件
路径只用于原型验收，生产端仍须通过授权媒体 URL / R2 交付。以上证明内容与媒体形状能和
交互适配，不表示 candidate 已成为公开发布的 Content Release。
