# web-next 学习扩展性架构分解：目标 / 内容 / 实施 / 评价

> 状态：Active implementation decomposition
> 日期：2026-09-04
> Owner 决定：2026-09-03 开放讨论后由 owner 裁决，记录见 §7

## 0. 层级声明

**本文不新增领域定义。** 它把 `CONTEXT.md`、`learning-connection-model.md`、
`learning-runtime-model.md`、`semantic-acquisition-model.md` 已有的规定落成 `web-next` 的实现
seam，并声明扩展点。与领域模型冲突时，一律以领域模型为准；本文只在实现层有效。

要解决的问题（owner 提出的宏观分解）：

```text
目标   学习目标（学什么）+ 能力目标（练什么能力，learner 可选）
内容   由目标推导；可预生产，也可按需生成
实施   短期阶段 + 长期阶段，编排方式随能力目标变化
评价   Observation / Evidence / Checkpoint / Transition 决定短期推进，
       graded Memory Outcome 连接长期调度
```

目标是让「新增一种学习模式」的成本收敛为**配置 + 插件**，而不是改动既有 lightweight /
structured 流程。

## 1. 关键前提：领域模型已经允许按能力扩展 retention scope

这次讨论一度以为需要 owner 重开冻结决定。核查后结论相反——领域模型早已规定了这件事，
连准入条件都写好了。

`CONTEXT.md` 的 **Retention Target**：

> the authoritative learner-specific learning identity for one stable Sense–target-expression
> connection **and any explicitly independent retention scope** … *ordinary* capability
> variation do not create another target

`learning-runtime-model.md` §2 给出了准入门槛：

> 每个 Retention Target **默认**最多只有一份 FSRS Memory State。Recognition、Recall、Transfer、
> Listening 等 capability 拥有独立 Evidence/Gate/5D 投影，但默认共享这一调度状态。……
> **只有具备显式 learner-valued 目标、稳定提示/响应合同、可持续分离表现和独立调度价值的
> 长期能力，才能作为显式 retention scope 扩展 target identity。**

所以本文不需要推翻任何冻结决定，需要做的是：**在 web-next 实现层打开这个既有扩展点，
并把四条准入变成可检查的清单。**

## 2. 四部分解到既有领域对象

| Owner 的分层 | 既有领域对象 | 本文新增 |
| --- | --- | --- |
| 学习目标（学什么） | Learning Target | 无 |
| 能力目标（练什么能力） | 显式 retention scope（见 §3） | 实现层的能力目标注册表 |
| 内容 | Content Provisioning → Learning Materialization | `contentRequirement` 改为能力集合 |
| 实施 · 短期 | Initial Learning Protocol | 编排插件 seam |
| 实施 · 长期 | Retention Review / Relearning Protocol | 编排插件 seam |
| 评价 · 短期 | Observation / Evidence / Protocol Checkpoint / Transition Decision | Progression Kernel + 正交 policy 注册表 |
| 评价 · 长期 | graded Memory Outcome / Scheduling Decision | 分级 Outcome 合同 + scheduler adapter |
| 卡片 | Protocol Step / Card Presentation | Step renderer 注册表 |

领域层零新增；新增全部在实现 seam。

## 3. 进度身份：什么拆、什么不拆

这是本次讨论最容易出错的一点，必须写死。

### 3.1 三种"能力"不是同一个东西

| 概念 | 归属 | 是否产生独立调度 |
| --- | --- | --- |
| **Acquisition Gate**（Recognition / Recall / Transfer / Boundary） | Structured Acquisition Protocol **内部**的毕业检查点 | **否** —— 共享同一份 FSRS |
| **5D 诊断维度**（Grounding / Boundary / Form Mapping / Retrieval / Transfer） | Retention Target 内的历史 Evidence 投影 | **否** —— 不决定 due time |
| **显式能力目标**（learner 选的，如"拼写产出"） | 扩展 retention scope | **是** —— 独立 Retention Target |

`semantic-acquisition-model.md` §6 原则 7 已经裁定："能力证据分开，调度默认共享……不因题型或
Card 变化就拆分 Retention Target"。

**因此 `high_assurance` 不是四个独立进度身份。**它是一个 Retention Target，内部有四个 Gate、
共享一份 FSRS Memory State。把它读成"四个独立调度"会同时违反原则 7 和 §4 的合取毕业语义。

### 3.2 拆分的正确形状

```text
Learning Target: borrow-receive          ← 对象身份，永不拆分
  ├─ Retention Target(scope: 默认核心连接)   ← lightweight 或 structured 在此运行
  │     structured 时内含 Recognition / Recall / Transfer / Boundary 四个 Gate
  │     一份 FSRS Memory State
  └─ Retention Target(scope: 拼写产出)       ← learner 显式添加，独立 FSRS Memory State
```

`Learner Sense Progress` 已经是"同一 Sense 的全部 Retention Targets 的权威 roll-up"，
库/详情/首页的聚合投影用它，不需要新概念。

### 3.3 扩展 scope 的准入清单

新增一个显式能力目标前，四条全部满足才允许扩展 target identity：

1. **显式 learner-valued 目标** —— learner 主动选择的，不是协议内部产生的变体；
2. **稳定的提示/响应合同** —— 固定 prompt channel、response channel、target capability
   与 support level（`semantic-acquisition-model.md` §8）；
3. **可持续分离的表现** —— 该能力与既有 scope 的表现长期不同步，不是一次波动；
4. **独立调度价值** —— 它的遗忘曲线确实需要独立的 due time。

对照检验：

| 候选 | 判定 | 理由 |
| --- | --- | --- |
| 拼写产出（learner 显式选） | ✅ 扩展 | 四条全中：接受性与产出性长期分离 |
| 听辨（learner 显式选） | ✅ 扩展 | 同上，提示/响应通道稳定 |
| structured 的 Recall Gate | ❌ 不扩展 | 非 learner 选择，是协议内部检查点 |
| 同一能力换成音频卡 | ❌ 不扩展 | ordinary Card variation |

### 3.4 听说读写的正确位置

`semantic-acquisition-model.md` §8 明确："听、说、读、写适合作为 Free Practice 的
learner-facing modes，**但不是四个新的 mastery dimensions 或统一毕业关卡**"。

这与 §3.3 不冲突，二者说的是不同的事：

- 听说读写**不是毕业维度** —— 不要求每个 Sense 机械完成四种模式；
- 但满足四条准入的通道能力**可以成为独立调度 scope**。

产品含义：默认只有一个 scope，learner 显式添加才有第二个。不做"四种模式都要学完"的
进度条。

## 4. 阶段与编排的分层

讨论中曾提议把 Protocol Purpose 从三个减为两个。核查后改为**分层处理**，两者不冲突：

| 层 | 结论 |
| --- | --- |
| 领域层 | **三个 Protocol Purpose 不变**（`initial_learning` / `retention_review` / `relearning`）。它们分类的是 completion 与 scheduler transition 资格，不是编排形态。`Relearning Protocol` 保留声明独立 auditable Memory Outcome 的能力。 |
| 实现层 | 编排插件只需**两个入口**：`fresh` 与 `repair`。relearning 复用 acquisition 的编排机制，正如 Anki 的 relearning steps 复用 learning steps 机制。 |

映射关系：

```text
purpose: initial_learning   → 编排插件 fresh 入口  → 出口 Initial Learning Completion + Scheduling Handoff
purpose: retention_review   → 长期编排            → 出口 至多一个 Memory Outcome
purpose: relearning         → 编排插件 repair 入口 → 出口 Relearning Completion（不重新初始化 FSRS）
```

**新增一种模式时，插件作者只实现两个入口，而不必回答"我的 relearning 协议是什么"。**

### 4.1 数量属于 Study Plan，不属于 preset

learner-facing 的数量控制只有一个：Study Plan 上的每日新学数量。Unified Planner 按它选出
当天允许 Introduction 的 Target；Runtime 接收的是已经选好的集合。preset/Profile、Protocol、
Runtime Adapter 和队列都不得再定义每日数量、组大小、批次上限或 active window。

编排插件仍然可以决定这个集合内部“先出谁、怎样穿插、间隔多少个 Step”，但不能用编排规则
隐藏一部分 Target，或把另一个数量参数伪装成窗口。不同 Protocol Binding 需要分成多个 launch 时，
每个 launch 也必须完整接收 Planner 分给该 Binding 的子集。due Review 与 Relearning 不消耗、也不受
每日新学数量限制。实现层为了渲染或 I/O 做的分页必须不可观察，不能改变上述语义。

## 5. 实现 seam

| seam | 合同 | 现状 |
| --- | --- | --- |
| **能力目标注册表** | 声明所需内容能力 + 四项准入依据 + `prerequisite?`（至多一层） | ✅ 已落地：`retentionScopes.ts`；默认只启用核心连接 scope |
| **内容供给插件** | `(Learning Target, 内容能力) → 校验 → 冻结 Learning Materialization` | ✅ 已落地：Lightweight Initial 贯通 context freeze → Candidate producer → validator → coverage/admission → Materialization；Plan 保留 identity |
| **Agentic 内容生产** | `Task → bounded Attempt + closed tools → Candidate Bundle → independent admission` | ✅ v3 合同与 `contentAgentProvisioning.ts` 已落地；模型只能提交候选草稿，系统拥有 identity/policy/provenance/状态，DeepSeek adapter 只用于显式 live smoke |
| **编排插件** | `fresh(targets)` / `repair(target, 依据)` → 产出 Step 序列 | ✅ 已落地：`engine/stepOrchestration.ts` + `learningRuntime/orchestrations.ts` |
| **内容能力集合** | `Protocol Binding → 内容能力集合`，readiness 是集合的合取 | ✅ 已落地：`learningRuntime/contentCapabilities.ts` |
| **Step intent 轴** | `intent: instruction \| practice \| assessment \| feedback \| repair`，只有 assessment 取证 | ✅ 已落地：`engine/types.ts` 的 `LearningStepIntent` |
| **Runtime Surface 登记表** | `surface → flow + 首学/继续/复习三个启动入口` | ✅ 已落地：`learningRuntime/runtimeSurfaces.ts` |
| **Retention Store 登记表** | `storeId → 交接投影 + 状态归谁持有` | ✅ 已落地：`learningRuntime/retentionStores.ts` |
| **Step renderer 注册表** | `stepKind → 组件` | ✅ 已落地：Structured 七种 + Lightweight Initial 两种 renderer |
| **Presentation Slot 合同** | `presentation → slots(role/cardinality/order/disclosure/missing/overflow)`；AI 不控制布局 | ✅ 共享 schema + Lightweight Initial 两张版本化 Card 定义已落地 |
| **数量归属** | `Study Plan → Unified Planner → 完整 RuntimeLaunch`；preset 只编排，不二次选量 | ✅ 已移除 `activeWindow` 与 Adapter 的 target-selection hook |
| **Progression Kernel** | 验证并原子应用 credit / invalidate / repair / reassess / reset / complete effects | ✅ 已落地：`packages/learning-kernel/src/runtime/protocolProgression.ts` |
| **Protocol Policy 注册表** | Evaluation / Progression / Completion / Repair / Memory Outcome 五条正交轴按 identity 组合 | ✅ 已落地：`learningRuntime/protocolPolicies.ts`；composition 阶段 fail closed |
| **分级长期结果** | `again \| hard \| good \| easy` + basis + evidence level；一次 due Review 至多一个 | ✅ 已落地：Learning Kernel、ReviewQueue 与 storage 共用同一 Outcome |
| **Content Demand 合同** | 版本化 role/schema/cardinality/use/validator/derivation；生成 request 自包含冻结上下文 | ✅ 通用合同 + `lightweight-initial-content@v1` 已落地；供给与 validator policy/version 均钉死 |

### 5.1 消除 surface 闭集

`PrototypeRuntimeSurface` 原先是三值闭集。现在 identity 已对扩展开放，由 composition
root 的注册表重新闭合。落地前 `App.tsx` 里有 17 处按它分派的判断，
它们并不是同一类东西：

| 类别 | 处数 | 在问什么 | 处置 |
| --- | --- | --- | --- |
| 启动分发 | 6 | 这个 surface 该调哪个 start、进哪个 flow | ✅ 已收进登记表 |
| retention store 选择 | 7 | 这条 Target 的长期事实存 FSRS 还是存 journey reducer | ✅ 改问 store（§5.4） |
| 计数分桶 | 2 | 首页把这个 launch 计入哪个复习桶 | ✅ 改按 store 分桶 |
| executable 判断 | 1 | 这个 surface 要不要 runtime package | ✅ 改问内容供给（§5.2） |
| 交接依据 | 1 | 首学产出的是不是 Acquisition Graduation | ✅ 改问编排（§5.5） |

登记表落地后，"新增一种 Runtime 行为"在启动路径上的改动收敛为**注册一条 definition**；
`App.tsx` 不再出现任何 surface 名字的分发判断。runtimeSession 泛化之后，
`startNextRetentionGroup` 也不再要调用方自报家门——跑完的是哪一组，由会话状态里
那条复习运行回答。

`journeyState.ts` 里现在一处 surface 名字都没有。`App.tsx` 里只剩四处，都不是分派：
三处是"哪块屏拿哪次运行"的派生（集中在一处，等轻量两屏的 Step 化），
一处是收尾时调用方自报跑完了哪条运行。

终局形态仍是 Runtime 只认识 **Step**：编排插件产出 Step，注册表按 `stepKind` 查组件，
`App.tsx` 退化为"当前有无 Step / 渲染它"的壳。Step renderer 注册表
（`learningRuntime/stepRenderers.ts`）已把 `stepKind → 组件` 这条 seam 落地：
Structured 内置七种卡各是一条纯适配函数，把统一的 `StepRendererHost`（宿主能力合同）与
`StepRendererProps`（渲染输入）接线成卡片自己的 props，闭合发生在注册表——
查不到 renderer 直接抛错。`smoke:renderers` 拿真实安装目录钉住三件事：
闭合性、查表与落地前 `LearnScreen` 七个分支逐格等价、宿主接线与 remount key
格式不走样。`LearnScreen` 随之从"七个 stage 分支 + 三十余个 prop"收敛为
"工具栏 + 进度 + 查表渲染"，卡片相关的接线收进 App 提供的一份 host。

Lightweight Initial 已收敛为 Experience Recall 与 Expression Reveal 两个正式 Step：前者把 grounding
与内部回想合并为 `practice`，后者以 `instruction` 揭示 expression 并接受 rating；`again` 循环，
`hard | good` 显式触发 completion-only Progression。React 屏幕不再持有这段相位机，只负责 Runtime
Shell、查 renderer 与显示非 Card 的完成状态。Lightweight Retention 仍是自包含固定屏，等其 Step 化
后，"哪块屏拿哪次运行"的剩余派生才能继续退场。

### 5.2 内容需求改为集合

`contentRequirement` 原为二选一枚举：一个 Binding 要么要"紧凑材料"，要么要"结构化学习包"。
能力目标之间会**共享**内容能力（听辨与听写都需要音频），二选一表达不了"我要这两样"。
落地形状是 `ContentCapabilitySet`，readiness 是这组能力的合取——报最坏那条**自己的** view，
学习者才知道缺的是什么。集合在类型上就是非空的：不声明任何内容能力的 Binding 是建模错误，
不是"永远就绪"。

readiness 是 **Learning Target 级的事实、scope 级的投影**：内容属于 Target（音频是这个词的
音频），所以供给方是按 Target 建的一个 provider，每个用途只对自己声明的那个子集求合取，
而不是按 scope 各建一张表。

同时分出了第二个字段，因为原先那处 `executable` 判断问的正是它：

| 字段 | 是什么 | 谁能改 |
| --- | --- | --- |
| `view.status` | 声明的准备状态 | journey 的"刷新准备状态"能推进它 |
| `provisioned` | 供给事实：有没有可执行的内容 | 只有内容供给能改 |

二者必须允许不一致：紧凑材料按需生成，"还在准备"也照样跑得起来；结构化学习包没有就是没有，
声明成 ready 也变不出来。排期只能信 `view`，启动只能信 `provisioned`。原来那行
`surface !== 'structured_session' || 有包` 把这条事实编码成了界面名字，现在它就是
首学那组能力的 `provisioned` 合取，`smoke:capabilities` 把三条 Target × 两种方式下
新旧两个表达式逐个钉成相等。

### 5.3 Step 与 intent

插件自由定义形式，但必须用领域词汇声明含义：

```text
Step = { stepId, retentionTargetId, stepKind, materialRef, intent }
                                     ↑ 插件自由      ↑ 领域闭集
intent: instruction | practice | assessment | feedback | repair
```

只有 `assessment` 能产生 Evidence 与 Memory Outcome。这条是插件自由度的边界：
**没有它，多个插件会各自解释"什么叫学会了"。**

Step 的完整形状要等编排插件（§8 第 5 项）。先落的是 intent 轴，因为
`introduction` 待在能力枚举里时，类型在说假话：讲解不进 Gate、不产生 Evidence、
也没有对应的 Assessment Resource。代价是三处 `Exclude<LearningCapability,
'introduction'>` 别名和十余处 `capability === 'introduction'` 判断——每一处都在
用界面上看不见的方式绕开这个假成员。

落地形状：`LearningStepIntent` 声明领域闭集，`ScheduledActionDefinition.capability`
改为可空——**讲解步的 capability 就是 null，它确实不练任何能力**。三处 `Exclude`
别名随之消失（`ReviewCapability` / `GateCapability` / `AssessmentResourceCapability`
都塌回 `LearningCapability`）。`mode: 'assessment' | 'repair'` 是这条轴的旧名字，
只是它表达不了"讲解"，所以并成了 `intent`。

队列驱动的两套编排只产出 `instruction` / `assessment` / `repair` 三种；
`practice`（练但不取证）出现在轻量首学的“回想”那一步，`feedback` 为可独立编排的
反馈 Step 保留。二者都不能自行进入 Evidence；取证边界只能从行为上钉，`smoke:intent`
19 项钉的就是这个——讲解与修复都不计入 attempts、不把 Gate 判成 passed。

### 5.4 Retention Store

剩下的 surface 判断几乎都在问同一件事：**这条 Target 的长期保持事实存在哪。**
`structured_session` 的 Memory State 由 `storageService` 的 FSRS items 持有；
`lightweight_retention` 的存在 journey reducer 的 `lightweightRetention` 字段里。
每个读写长期状态的地方都得先回答这个问题，判断因此散落在 `App.tsx` 与
`journeyState.ts` 两处，而且问错了对象——问的是界面，要的是持有者。

落地形状是两个 store（`scheduler_memory` / `fixed_ladder`）由 retention 的
Runtime Adapter 声明，调用点问 store 而不是问 surface。新增一个复用同一 store 的
surface（例如拼写产出仍走调度器）时，这九处一处都不用改。

两个实现的**写入路径不对称**，抽象没有掩盖它：调度记忆可以命令式写，固定档期
只能由 reducer 自己落。因此 store 只声明"接收 Scheduling Handoff 时给出什么首次
到期投影"，宿主能力由 `RetentionStoreContext` 注入——App 传 `storageService`，
reducer 传 action 里那份 `dueByRetentionTargetId`。同一份定义因而在命令式与纯函数两侧都成立，
`smoke:retention` 直接钉住了这一点。

### 5.5 编排插件

落地前，"出哪一步"硬编码在两个队列类的四个方法里（`LearnQueue` /
`ReviewQueue` 各一对 `nextDefinition` / `repairDefinition`）。四个方法说的其实是
同一个二分：**有没有待修复的依据？没有 → 出下一步；有 → 出这一步的定向修复。**

落地形状是 `StepOrchestration` 的两个入口，正是 §4 定的那两个。三件事刻意如此：

- **`fresh` 收候选集而不是单条。**"先出谁"和"出哪一步"是同一个决定，交错与间隔
  属于编排。选中的候选若带着依据，`fresh` 委派给 `repair`——两条路参与同一次
  选择，带依据的 Target 不会因此插队，也不会被饿死。这正是落地前的顺序。
- **候选集的数量已经由 Planner 决定。** Runtime Adapter 没有 target-selection hook，
  `StepPlan` 也没有 active-window 参数；编排必须消费同一 Protocol Binding 下的完整 launch，
  只能改变顺序与间隔，不能再做一轮数量裁决。
- **候选视图里没有 content。** 两处产出逻辑从来只读 `actions` / `reviewActions` /
  `repairActions` 与学习者本地状态，seam 因此不需要 `TContent` 泛型。
- **修复依据由宿主给出，不由插件推断。**"哪个 Gate 失败了、失败在哪一步"是学习者
  本地状态，属于 §6 的内核。插件出的只是 Step *定义*；Gate 结算、Evidence 计数、
  Memory Outcome 与 FSRS 全部留在队列里。

`§5.1` 表里最后一处 surface 判断也随之收掉。原来那行
`surfaceFor(policy, 'initial_learning') !== 'structured_session'` 问的是**用哪块屏跑**，
要的却是**这套编排完成了什么、以什么依据交接、证据等级是什么**。这三条轴不能从
surface 推断，也不能从是否出现 assessment 推断。现在每套首学编排显式声明完整出口合同：

```text
Lightweight Study → Study Completion + protocol_completion + non_evidentiary
Structured Acquisition → Acquisition Graduation + acquisition_graduation + behavioral
```

声明不是注释：`smoke:orchestration` 拿真实内容把两套队列驱动的编排完整跑一遍
（含一次失败 → 修复 → 独立重测），收集实际产出的 intent 集合与声明逐条核对；同时
用“含 assessment 但只产出 Study Completion”的测试编排钉住**出口不是 intent 推断**。

四套编排里两套由队列驱动，两套是固定屏（轻量首学与轻量复习）。它们同样在登记表里
声明 intent 与 completion contract——出口只认显式合同，不认它跑在哪块屏上。队列接收
`StepOrchestration` 实例，`stepKind` 也由该实例决定；中央 Runtime 不再按 orchestration id
写 switch。

## 6. 不可插内核

以下七条不接受插件覆盖：

1. **Learning Target identity** —— 来源与能力目标数量都不改变对象身份；
2. **Scheduling Handoff** —— 每个 Retention Target 一生一次；
3. **Memory Outcome** —— 一次 due Review 至多一个；FSRS 调度归领域所有；
4. **Provisioning 生命周期** —— `preparing → 校验 → 冻结 → ready`；`blocked` 不静默降级。
5. **每日新学数量** —— learner 只在 Study Plan 设置一次，Unified Planner 唯一裁定；preset
   不能通过分组、批次或窗口覆盖它。
6. **评价事实链** —— Attempt 追加，Observation 不可变，Evidence 只陈述合法行为；
   只有 Transition Decision 能推进 Protocol Progress。
7. **Progression 事务** —— 内核限定 effect 词汇并原子、幂等应用；reset 只失效
   当前 credit，不删除 Attempt、Observation、Evidence 或历史 Decision。

插件决定**练什么、怎么练、用什么卡**；不决定**这次算不算数、下次什么时候来**。

## 7. Owner 裁决记录（2026-09-03—2026-09-04）

| # | 问题 | 裁决 | 实现后果 |
| --- | --- | --- | --- |
| 1 | 能力目标能否中途追加 | **不允许**。运行中的 scope 集合不可变 | 一次 acquisition 的成员集确定，合取毕业语义无歧义 |
| 2 | 追加时如何处理已有进度 | **已有 scope 保留**，另起新的学习；代价由 learner 承担 | 不销毁既有 FSRS Memory State |
| 3 | Declared Mastery 作用域 | **默认 Learning Target 级**，可设置为 scope 级 | 事实存 scope 级，Target 级操作是批量写；新增 scope 不继承 mastery |
| 4 | 能力目标前置关系 | 采用 `prerequisite`，**至多一层** | 同时表达 Gate 内顺序与跨 scope 准入 |
| 5 | 按需内容的生成时机 | **生成后冻结**（生成时机不限，Runtime 只消费冻结材料） | 与 `On-demand Learning Content` 既有定义一致 |
| 6 | 首批模式范围 | **只有 lightweight 与 structured**；不做能力目标选择 UI | 这是第一增量的历史范围；第三 preset 的后续裁决见 #8 |
| 7 | 每日新学数量归谁 | **只属于 learner 的 Study Plan，由 Unified Planner 统一执行** | preset/Protocol/Adapter 不得另设组大小或窗口；Runtime 消费 Planner 已选集合 |
| 8 | 如何验证架构真的可扩展 | 在 `web-next` 新增第三个 `interleaved_four_stage` 验证 preset | 四个 Protocol-local Checkpoint、组内穿插、任一失败整个 Run reset、三向 Review 和 relearning 必须只通过通用 seam 接入；不新增数量设置 |

### 7.1 关于第 5 条

生成时机可以是任意时刻（含 learner 点击"开始学"的那一秒），但 Runtime 永远只消费已校验、
已冻结的材料。需要"每次不一样"时，Provisioning 产出一**批**候选，Runtime 取样。

这不是新规定，`CONTEXT.md` 的 **On-demand Learning Content** 已写明："It must be validated and
frozen before use"。理由是失败必须可归因：材料每次现生成，就无法区分"没记住"与"那次生成的
句子有问题"。

### 7.2 关于第 2 条与 Free Practice

"想练但不想新开 scope"已有出口：Free Practice Session（`learning-runtime-model.md` §8）。
它与正式证据链隔离——不解决 Gate、不完成 due Review、不修改 5D/phase、不消耗 daily-new quota、
不调用 FSRS（`semantic-acquisition-model.md` §8）。Declared Mastery 只排除正式 Planning，
不阻止 learner 自由练习该 Sense。

## 8. 实施范围与验证进度

第一增量先保持轻量 / 高保证两个选项，用下列工作打开 seam：

1. ✅ `App.tsx` 的 surface 启动分支 → Runtime Surface 登记表（`runtimeSurfaces.ts` +
   `smoke:surfaces` 17 项回归）；
2. ✅ `runtimeSession` 的按策略命名字段 → 按运行泛化（`initialRuns` 按 surface
   并存 / `retentionRun` 单条），并在同一块地基上落 Retention Store
   （`retentionStores.ts` + `smoke:retention` 14 项）；
3. ✅ `contentRequirement` → 能力集合 + readiness provider（`contentCapabilities.ts` +
   `smoke:capabilities` 32 项），`executable` 随之改问内容供给；
4. ✅ `LearningCapability` 中移出 `introduction`，降级为 `intent: instruction`
   （`LearningStepIntent` + `smoke:intent` 19 项），三处 `Exclude` 别名随之消失；
5. ✅ 编排插件 seam 化为 `fresh` / `repair` 两入口（`stepOrchestration.ts` +
   `orchestrations.ts` + `smoke:orchestration`），首学 Completion / Handoff / Evidence
   改由编排显式声明，`stepKind` 由插件实例决定，`journeyState.ts` 里的 surface
   判断清零；
6. ✅ Step renderer 注册表（`stepRenderers.tsx` + `smoke:renderers` 32 项），
   `stepKind` 由编排盖章、查表渲染，`LearnScreen` 的卡片分支与十余个
   卡片接线 prop 随之消失；
7. ✅ 能力目标注册表（`retentionScopes.ts` + `smoke:scopes`），四项独立 scope
   准入条件与一层 prerequisite 在注册时校验；scope definition 升级不改变
   Retention Target identity；
8. ✅ 调度身份从 `senseId` 改为必填 `retentionTargetId`：首学/复习队列去重、运行投影、
   Review Outcome 幂等键、本地 FSRS 与 Relearning store 都以 Retention Target 为主键；
   可复用 Catalog Package 不携带 learner identity，只有进入 Runtime 时才显式绑定
   Retention Target；不保留 sense-keyed 兼容路径或伪造的 Catalog target；
9. ✅ 内容供给注册表与 composition root（`contentProvisioning.ts` /
   `runtimeComposition.ts`）：开放 identity 在应用启动时重新闭合，悬空 adapter、
   orchestration、surface、store、renderer 或 content capability 直接失败；根级
   build/typecheck 已纳入 `apps/web-next`；
10. ✅ 语言无关合同补齐 Retention Scope、Learning Policy Profile、Protocol Run、
    Initial Learning Completion 与 Scheduling Handoff
    （`packages/contracts/src/sensa/learningConnection.ts`）；合同直接升级为 v2，移除
    Learning Target 内嵌的单一 Retention Target，并由 Retention Target 显式引用父 Target，
    Web 原型不再是这些边界的唯一解释者。
11. ✅ 每日新学数量收回 Study Plan / Unified Planner：删除公开 `activeWindow` 与 Adapter 的
    target-selection hook；structured 编排完整接收 Planner 所选集合，lightweight 也把完整集合
    放入同一次运行并逐条呈现；smoke 钉住 preset 不再拥有第二个数量参数。
12. ✅ 通用 Progression Kernel：Protocol 可声明检查点、当前检查点重置或整个 Run
    reset；内核先校验全部 effect 再原子应用，repair 不授予 credit，replay 幂等。
13. ✅ Protocol Binding 补齐 Evaluation / Progression / Completion / Repair / Memory Outcome
    五条 policy identity；composition root 对所有引用 fail closed，Runtime 不按 profile 名称分支。
14. ✅ Memory Outcome 保留 `again | hard | good | easy`，`vague → hard` 不再被布尔化；
    Relearning repair target 支持 Capability 或 Protocol-local Checkpoint，完成重学不重复结算 FSRS。
15. ✅ `interleaved_four_stage` 作为第三个架构验证 preset 接入：Planner 选中的全部
    Target 进入同一运行，`minGap=2` 只表达接触间隔；四个当前 epoch Checkpoint
    全通过才完成，任一失败开启新 epoch；Review 保留 known / vague / forgotten 三向结果，
    forgotten 开启当日 relearning。
16. ✅ 新增 source-neutral Content Demand / Generation Request / Material Candidate 合同与
    coverage admission：生成 adapter 获取 exact Demand 和冻结 artifacts，输出必须通过 role 的
    schema、validator 与 cardinality 覆盖检查。该增量只固定通用 seam，不裁决 lightweight
    需要哪些 role 或 Card。
17. ✅ Lightweight Initial 两卡合同：Experience Recall / Expression Reveal 作为正式 Protocol Step，
    rating 不是第三张 Card，Completion 不是 Step；共享 Presentation Slot contract 固定必要/可选区域与
    pre-reveal non-disclosure，运行状态机移出 React renderer 并通过 completion-only kernel 执行。
18. ✅ Lightweight Initial Content Demand v1 纵切：expression/Sense 权威直通，教学 Candidate 与客观
    pronunciation derivation 分离；无成本 deterministic adapter 贯通 request、validation、coverage 与
    immutable Materialization。Step Instance 固定 material-role/resource binding，Presentation 只消费
    Materialization；optional resource 缺失、word/phrase/utterance 共用合同与 pre-reveal 泄露均有 smoke。
19. ✅ Agentic Content Provisioning 纵切：Content Contract v3 固定 Task/Attempt/Bundle、approved tool
    catalog、model/tool budget、tool-call provenance、supporting artifacts 与显式 optional-role omission；
    `contentAgentProvisioning.ts` 执行有界 ReAct loop，`lightweightAgenticProvisioning.ts` 在 Agent 终止后
    独立 validation/admission 并物化。无成本 smoke 覆盖工具调用、成功物化、pre-reveal 泄露拒绝与
    未授权工具阻断；DeepSeek Chat Completions adapter 另有 mock-transport smoke。真实
    `deepseek-v4-flash` 验收只能由 `npm run sensa:content-agent-live-smoke` 显式触发，缺少
    `DEEPSEEK_API_KEY` 时不会发起请求，也不成普通 build/smoke 的一部分。

当前**仍不做**：能力目标选择 UI、拼写/听写 scope、第三 preset 的生产 API/
跨端持久化，以及复刻应用的非核心宿主层功能（拼写弹窗、全屏例句、点词查询等）。

当前验收标准：日计划集合只由 Unified Planner 决定；三个 preset 通过正交 policy
轴组合；新 preset 能表达整体 reset 与分级 Review Outcome，同时 lightweight 与
high_assurance 的原有行为回归不变。

## 9. 与 canonical journey 02 的关系

**不是推翻，是补充。**journey 02 的冻结验收条目全部继续成立，主语需要精确化：

| journey 02 条目 | 需要的补充 |
| --- | --- |
| §3「MVP 提供两个 Profile」 | 生产 MVP 裁决仍由 `current-stage.md` 控制；`web-next` 的第三 Profile 是架构验证 preset，不自动构成生产承诺 |
| §6「Initial Completion 只产生一次 Scheduling Handoff」 | 主语精确化为 Retention Target（含显式 scope），"只一次"不变 |
| §10 扩展边界 | 用 §5 的四个 seam 替换 surface/adapter 表述 |
| §11「到期 Review 最多产生一个 Memory Outcome」 | 主语精确化为 Retention Target，规则不变 |

这些是**表述精确化**，不改变任何已冻结的用户可见行为，按 journeys README 的冻结规则，
可在实现落地的同一次变更中更新。

## 10. Open questions

1. 显式 scope 的首个具体实现（拼写产出？听辨？）——首批不做，形态待定；
2. 多个 scope 同日 due 时的会话内去冲突策略（先做识别会给拼写喂答案）——
   `LearnQueue` 现有 `minGap` 机制可复用，参数待定；
3. 新 scope 的 FSRS 初始化基准 —— 是否复用既有 scope 的 memory state 作为先验；
4. `prerequisite` 是否需要跨 Learning Target（当前限定同一 Target 内）。

## 11. 不属于本文

生产 API demand、数据库 schema、Sync 版本、FSRS 参数、内容生成 prompt、页面视觉与文案。
`packages/contracts` 中的语言无关 schema 只固定跨客户端所需形状；它们尚未构成生产 API、
权威持久化或 Sync 实现。本文主要声明 `web-next` 的实现 seam 与既有领域规定的落点。
