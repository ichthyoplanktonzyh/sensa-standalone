# Canonical journey 02：独立 Learning Target 的学习与长期保持

> 状态：Frozen
> 冻结日期：2026-09-02
> 权威范围：`web-next` 从 Learning Target 加入学习到长期 Review/Relearning 的前端叙事

## 1. 旅程结果

这条旅程从一个可供学习的 Learning Target 开始，经由 learner 选择的 Learning Policy 完成首次学习，
随后进入长期保持：

```text
Learning Target
→ 加入“我的学习”
→ 选择/解析 Learning Policy Profile
→ Content Provisioning 与 Learning Plan Readiness
→ ready
→ 创建首次正式 Protocol Run
→ Committed Learning Policy 锁定
→ Initial Learning Completion
→ Scheduling Handoff
→ retaining
→ 到期 Retention Review
├─ 成功：安排下一次 Review → retaining
└─ 失败：一个 Memory Outcome → Relearning → retaining
```

`retaining` 表示连接继续由长期调度维护，不表示永久掌握。Relearning 是已经建立过的连接在一次到期
提取失败后的恢复机制，不是从头创建另一个 Learning Target。

## 2. 独立入口与 Target 库

学习旅程不依赖 Personal Semantic World。Learning Target 可以来自：

- Book/Curriculum；
- 直接选择既有 stable Sense；
- Personal Semantic World 形成的 stable Sense Expression Binding；
- 后续获准的其他来源。

来源只形成 Learning Entry Provenance，不改变 Learning Target/Retention Target identity。相同 learner、
SenseVersion、target Expression Binding 与 retention scope 不因为来源不同建立重复进度。

“我的学习”是 Target 库和统一入口。首页只呈现两个主要行动：

- 新学：已经加入、当前 ready、尚未创建首次正式 Run 的 Target；
- 复习：已经进入长期阶段且当前 due，或正在 Relearning 的 Target。

“需要再学”属于复习/长期恢复，不是第三个首页主入口。若今日同时存在复习与新学，先完成到期复习，
再创建新的首次学习 Run。

## 3. Learning Policy 与内容准备

Learning Policy 和学习内容是不同概念：

- Learning Policy Profile 决定三个 purpose 使用哪些 versioned Protocol：`initial_learning`、
  `retention_review`、`relearning`；
- Content Provisioning 决定当前 Target 是否拥有这些 Protocol 需要的 immutable material；
- Resolved Learning Plan 汇总 purpose-specific Protocol、能力与 `preparing | ready | blocked`；
- 任何 required purpose blocked 时，Target 不能被伪装成整个生命周期 ready，也不能静默降级。

MVP 提供两个 Profile：

| Profile | 首次学习 | 长期 Review/Relearning |
| --- | --- | --- |
| Lightweight | 紧凑经验落地、目标表达与主动回想 | learner-rated 简单复习与轻量恢复 |
| High assurance | Structured Acquisition Gates | evidence-oriented Review 与 targeted Relearning |

learner 可以设置默认 Profile，也可以在首次正式 Run 前为单个 Target 覆盖。正式 Run 创建成功时产生
Committed Learning Policy；此后普通设置不能原地改写它。未来迁移必须是显式、可审计的独立流程。

## 4. 页面职责

| 页面/表面 | 唯一职责 |
| --- | --- |
| 首页 | 汇总“新学”和“复习”，选择今日学习意图 |
| 我的学习 | 进入 Target 库、添加内容、设置默认 Policy 与每日新学数量 |
| 添加学习内容 | 从 Book、direct、Personal Semantic World 等来源建立学习意图 |
| Target 库 | 展示每个 Target 的 readiness、locked Policy、initial/retention projection |
| Target 详情 | 查看来源、目标连接、准备状态、Policy 和唯一合法的继续动作 |
| Policy 选择 | 选择 Profile，诚实呈现 available/preparing/blocked；锁定后只读 |
| Initial Runtime | 执行 committed Profile 的 initial-learning Protocol |
| Retention Runtime | 执行到期 Review，以及失败后同一长期链中的 Relearning |
| Summary | 区分首次完成、直接返回 retaining、Relearning completion 与 Declared Mastery |

页面不得用一个通用 `isLearned/status` 替代 membership、readiness、commitment、completion、due、
Relearning 和 Declared Mastery 等不同事实。

## 5. 短期阶段：Initial Learning

### 5.1 Lightweight Initial

```text
Experience Grounding
→ 从经验和意思主动回想目标表达
→ 显示答案
→ 没想起 / 想起但费力 / 顺利想起
→ Study Completion
→ Scheduling Handoff
```

Experience Grounding 的来源优先级为：Target 引用的 Personal Semantic Anchor、exact Learning Package
Experience、Content Preparation 阶段生成并冻结的经验资源。正式 Runtime 不临时调用生成服务。

`没想起` 回到当前首次 Runtime 的主动回想步骤，不伪装成成功 Evidence；另外两个结果完成本次轻量
首次学习，但不声称 Structured Recognition/Recall/Transfer Gates 已通过。

### 5.2 High-assurance Structured Initial

单 Target 的逻辑链为：

```text
Experience Grounding / 建立 learner 的 meaning–form connection
→ Contextual Recognition Gate
→ Meaning-to-form Recall Gate
→ Novel-context Transfer Gate
→ optional Boundary Gate
→ Acquisition Graduation
→ Scheduling Handoff
```

Required Gates 由 Acquisition Profile 决定；Boundary 只有存在真实 confusion target 时才 required。
Recall 只有 independent retrieval 能通过。任何 Gate 失败只打开该 capability 的 Targeted Repair，保留
其他 Gate；Repair 完成本身不能 pass，必须经过干扰间隔后的独立重测。

一次 Structured Session 可以穿插多个 ready Target。Target Graduation 与 Session completion 是不同
事实：某个 Target 可以先毕业，Session 继续处理其他 Target。Graduation 只说明已满足交给长期保持的
证据门槛，不表示 mastery。

## 6. Scheduling Handoff

任一 Initial Learning Protocol 成功后都产生共同的 Initial Learning Completion，并且只做一次
Scheduling Handoff。完成来源可以是 Lightweight Study Completion 或 Structured Acquisition
Graduation，但 committed Profile 的 `retention_review` Protocol 决定后续进入哪一种长期 Runtime。

Handoff 后：

- Target 从“新学”移除；
- Policy 继续锁定；
- Target 库和详情投影为 retaining；
- 等待下一次 due；
- 同一 Retention Target 最多只有一个 Memory State。

## 7. 长期阶段：Review、Relearning 与 retaining

正常长期循环为：

```text
retaining + due
→ Retention Review
→ learner 独立提取
├─ 成功：一个 Memory Outcome → 下一次 due → retaining
└─ 失败：一个 Memory Outcome / lapse
          → Relearning Repair
          → 独立 Retest
          ├─ 成功：Relearning Completion → retaining
          └─ 失败：继续 Repair
```

一次 due Review 最多产生一个 Memory Outcome。Review 失败已经完成本次调度结算；后续 Repair 与
Retest 只恢复连接，不为同一次 due Review 重复 rating、Outcome 或 FSRS 更新。

Lightweight 长期 Runtime 使用紧凑经验线索、独立回想和 `没想起 / 想起但费力 / 顺利想起`。失败后
执行轻量 Experience Recap 与重新绑定，再进行独立回想。

High-assurance 长期 Runtime 依据失败 capability 执行 targeted Repair 与独立重测。Review、Repair、
Retest 和 returning to retaining 必须是可区分的 projection；正式卡片不拥有 Target 生命周期或调度事实。

Policy 可以选择显式或折叠的 Relearning presentation，但领域上仍需区分 Review Outcome 与连接恢复。

## 8. Declared Mastery

“熟”是整个学习阶段都可触发的 Declared Mastery。它表达 learner 主动将 Target 从 Planning inventory
排除：

- 不产生 Gate pass、Graduation、Attempt、Review Outcome、Relearning effect 或 FSRS 更新；
- 不删除 Target membership、Committed Policy、Protocol history 或 Memory State；
- 可以从 Target 详情撤销；撤销后依据未被改写的原进度重新取得 Planning eligibility。

Declared Mastery 与 Acquisition Graduation、Initial Completion、Review success 都不是同一个事实。

## 9. 前端事实与只读投影

当前原型分别保存/投影：

- Add-to-Learning membership；
- preparation/readiness；
- Effective 与 Committed Policy；
- common Initial Learning Completion / Scheduling Handoff；
- Lightweight 或 Structured retention state；
- due Review、Memory Outcome 与 Relearning stage；
- Declared Mastery。

客户端可以呈现这些事实的本地原型投影，但不能把页面选择直接声明成权威 Evidence、Memory Outcome、
5D projection 或 FSRS state。Target 库、Target 详情、首页和 Runtime Summary 必须读取同一 projection，
不能各自通过组件内部 Map 猜测生命周期。

## 10. 当前 Runtime 扩展边界

`web-next` 通过 Learning Policy Profile Registry 把 Profile 解析为 purpose-specific Protocol plan，通过
Runtime Coordinator/Adapter 输出包含 purpose、Protocol version、surface 和 Target batch 的 launch。

- 新 Profile 若只复用已经安装的 Protocol，并遵守现有长期 Adapter 的阶段交接，只增加 Profile 配置；
- 真正新的 Protocol 行为需要新增 Runtime Adapter 与 renderer，但不得向页面加入 Profile-name 分支；
- 当前 Lightweight 与 Structured Adapter 各自在一个连续长期 Runtime 中管理 Review → Relearning，
  因此把这两个 purpose 分配给不同 Adapter 仍需要显式的跨 Adapter handoff，不是单纯配置；
- 只有完全相同的 Protocol binding 才能进入同一 Runtime batch。

这些是当前前端原型的 module seam，不是未来 API 或持久化合同。

## 11. 冻结验收

- Personal Semantic World 不是学习的强制前置入口；
- 不同来源的同一 Target 不建立重复 progress identity；
- Policy 与内容分离，blocked 不会静默降级；
- 首次正式 Run 创建前可选 Policy，创建后锁定；
- Lightweight 与 High-assurance 共用 Target lifecycle，但保留不同 Protocol completion/evidence semantics；
- Initial Completion 只产生一次 Scheduling Handoff；
- 到期 Review 最多产生一个 Memory Outcome；
- Review 失败进入 Repair → independent Retest，成功才返回 retaining；
- Repair/Retest 不重复更新同一次 Review 的调度结果；
- Declared Mastery 不伪造 learning/memory facts，并且可撤销；
- 首页、库、详情、Runtime 与 Summary 的状态叙事一致。

## 12. 当前原型边界

当前前端为了单次走查把首次 Review due time 压缩为“现在可复习”，轻量演示间隔也使用确定性本地值；
它们不是领域策略、FSRS 参数或未来 API 合同。部分状态只在 React 会话或本地 prototype storage 中保存，
跨设备、正式 Sync、服务端 Planning/Evidence/Memory owner 和生产恢复语义仍需后续契约实现。

既有正式 High-assurance 卡片的样式、交互和文案不由这次冻结重定义；`baseline` 旧卡片只保留在学习
生命周期之外的原型比较范围，不构成第三种 Learning Policy。
