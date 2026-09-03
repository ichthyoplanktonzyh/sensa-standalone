# web-next 学习扩展性架构分解：目标 / 内容 / 实施

> 状态：Active implementation decomposition
> 日期：2026-09-03
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

## 2. 三层分解到既有领域对象

| Owner 的分层 | 既有领域对象 | 本文新增 |
| --- | --- | --- |
| 学习目标（学什么） | Learning Target | 无 |
| 能力目标（练什么能力） | 显式 retention scope（见 §3） | 实现层的能力目标注册表 |
| 内容 | Content Provisioning → Learning Materialization | `contentRequirement` 改为能力集合 |
| 实施 · 短期 | Initial Learning Protocol | 编排插件 seam |
| 实施 · 长期 | Retention Review / Relearning Protocol | 编排插件 seam |
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

## 5. 实现 seam

| seam | 合同 | 现状 |
| --- | --- | --- |
| **能力目标注册表** | 声明所需内容能力 + 准入依据 + `prerequisite?`（至多一层） | 新增；首批只注册既有默认 scope |
| **内容供给插件** | `(Learning Target, 内容能力) → 校验 → 冻结 Learning Materialization` | 已有 Content Provisioning，需 seam 化 |
| **编排插件** | `fresh(targets)` / `repair(target, 依据)` → 产出 Step 序列 | ✅ 已落地：`engine/stepOrchestration.ts` + `learningRuntime/orchestrations.ts` |
| **内容能力集合** | `Protocol Binding → 内容能力集合`，readiness 是集合的合取 | ✅ 已落地：`learningRuntime/contentCapabilities.ts` |
| **Step intent 轴** | `intent: instruction \| practice \| assessment \| repair`，只有 assessment 取证 | ✅ 已落地：`engine/types.ts` 的 `LearningStepIntent` |
| **Runtime Surface 登记表** | `surface → flow + 首学/继续/复习三个启动入口` | ✅ 已落地：`learningRuntime/runtimeSurfaces.ts` |
| **Retention Store 登记表** | `storeId → 交接投影 + 状态归谁持有` | ✅ 已落地：`learningRuntime/retentionStores.ts` |
| **Step renderer 注册表** | `stepKind → 组件` | ✅ 已落地：`learningRuntime/stepRenderers.ts` + `smoke:renderers` 32 项 |

### 5.1 消除 surface 闭集

`PrototypeRuntimeSurface` 是三值闭集。落地前 `App.tsx` 里有 17 处按它分派的判断，
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
内置七种卡各是一条纯适配函数，把统一的 `StepRendererHost`（宿主能力合同）与
`StepRendererProps`（渲染输入）接线成卡片自己的 props，闭合发生在注册表——
查不到 renderer 直接抛错。`smoke:renderers` 32 项拿真实安装目录钉住三件事：
闭合性、查表与落地前 `LearnScreen` 七个分支逐格等价、宿主接线与 remount key
格式不走样。`LearnScreen` 随之从"七个 stage 分支 + 三十余个 prop"收敛为
"工具栏 + 进度 + 查表渲染"，卡片相关的接线收进 App 提供的一份 host。

剩下的一步是轻量两屏的 Step 化：`LightweightRuntimeStartScreen` 与
`LightweightReviewRuntimeScreen` 仍是自包含的固定屏（相位机），不产出 Step；
它们并入 Step 流之后，"哪块屏拿哪次运行"的最后三处派生才会退场，
`App.tsx` 才真正成为壳。这需要先把轻量会话的相位表达成编排可产出的 Step，
不在本次范围内。

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
intent: instruction | practice | assessment | repair
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

队列驱动的两套编排只产出 `instruction` / `assessment` / `repair` 三种；第四种
`practice`（练但不取证）出现在轻量首学的"回想"那一步——学习者自评，评语只作为
完成记录留档，既不进 Gate 也不改排期。取证边界只能从行为上钉，`smoke:intent`
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
reducer 传 action 里那份 `dueBySenseId`。同一份定义因而在命令式与纯函数两侧都成立，
`smoke:retention` 直接钉住了这一点。

### 5.5 编排插件

落地前，"出哪一步"硬编码在两个队列类的四个方法里（`LearnQueue` /
`ReviewQueue` 各一对 `nextDefinition` / `repairDefinition`）。四个方法说的其实是
同一个二分：**有没有待修复的依据？没有 → 出下一步；有 → 出这一步的定向修复。**

落地形状是 `StepOrchestration` 的两个入口，正是 §4 定的那两个。三件事刻意如此：

- **`fresh` 收候选集而不是单条。**"先出谁"和"出哪一步"是同一个决定，交错与间隔
  属于编排。选中的候选若带着依据，`fresh` 委派给 `repair`——两条路参与同一次
  选择，带依据的 Target 不会因此插队，也不会被饿死。这正是落地前的顺序。
- **候选视图里没有 content。** 两处产出逻辑从来只读 `actions` / `reviewActions` /
  `repairActions` 与学习者本地状态，seam 因此不需要 `TContent` 泛型。
- **修复依据由宿主给出，不由插件推断。**"哪个 Gate 失败了、失败在哪一步"是学习者
  本地状态，属于 §6 的内核。插件出的只是 Step *定义*；Gate 结算、Evidence 计数、
  Memory Outcome 与 FSRS 全部留在队列里。

`§5.1` 表里最后一处 surface 判断也随之收掉。原来那行
`surfaceFor(policy, 'initial_learning') !== 'structured_session'` 问的是**用哪块屏跑**，
要的却是**这套编排取不取证**——两者今天一一对应，只因为恰好只有结构化首学会出
assessment 步。现在编排在登记表里声明自己产出哪些 intent，出口依据从那一条规则推出：

```text
产出 assessment → Acquisition Graduation（取证毕业）
不产出 assessment → Study Completion（学过了，但没取证）
```

声明不是注释：`smoke:orchestration` 30 项拿真实内容把两套队列驱动的编排完整跑一遍
（含一次失败 → 修复 → 独立重测），收集实际产出的 intent 集合与声明逐条核对，并把
新旧两个表达式在两条 Policy 上钉成同真同假。

四套编排里两套由队列驱动，两套是固定屏（轻量首学与轻量复习）。它们同样在登记表里
声明 intent——出口依据只认声明，不认它跑在哪块屏上。

## 6. 不可插内核

以下四条不接受插件覆盖：

1. **Learning Target identity** —— 来源与能力目标数量都不改变对象身份；
2. **Scheduling Handoff** —— 每个 Retention Target 一生一次；
3. **Memory Outcome** —— 一次 due Review 至多一个；FSRS 调度归领域所有；
4. **Provisioning 生命周期** —— `preparing → 校验 → 冻结 → ready`；`blocked` 不静默降级。

插件决定**练什么、怎么练、用什么卡**；不决定**这次算不算数、下次什么时候来**。

## 7. Owner 裁决记录（2026-09-03）

| # | 问题 | 裁决 | 实现后果 |
| --- | --- | --- | --- |
| 1 | 能力目标能否中途追加 | **不允许**。运行中的 scope 集合不可变 | 一次 acquisition 的成员集确定，合取毕业语义无歧义 |
| 2 | 追加时如何处理已有进度 | **已有 scope 保留**，另起新的学习；代价由 learner 承担 | 不销毁既有 FSRS Memory State |
| 3 | Declared Mastery 作用域 | **默认 Learning Target 级**，可设置为 scope 级 | 事实存 scope 级，Target 级操作是批量写；新增 scope 不继承 mastery |
| 4 | 能力目标前置关系 | 采用 `prerequisite`，**至多一层** | 同时表达 Gate 内顺序与跨 scope 准入 |
| 5 | 按需内容的生成时机 | **生成后冻结**（生成时机不限，Runtime 只消费冻结材料） | 与 `On-demand Learning Content` 既有定义一致 |
| 6 | 首批模式范围 | **只有 lightweight 与 structured**；不做能力目标选择 UI | learner 可见界面不变 |

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

## 8. 首批实施范围

learner 可见界面**与当前完全一致**（轻量 / 高保证两个选项）。全部工作在实现层：

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
   `orchestrations.ts` + `smoke:orchestration` 30 项），首学交接依据随之改由
   编排按 intent 声明，`journeyState.ts` 里的 surface 判断清零；
6. ✅ Step renderer 注册表（`stepRenderers.tsx` + `smoke:renderers` 32 项），
   `stepKind` 由编排盖章、查表渲染，`LearnScreen` 的卡片分支与十余个
   卡片接线 prop 随之消失。

首批**不做**：能力目标选择 UI、拼写/听写 scope、第三个 preset、
"失败即全部重置"的 completion policy。

验收标准：lightweight 与 structured 的可观察行为零变化。

## 9. 与 canonical journey 02 的关系

**不是推翻，是补充。**journey 02 的冻结验收条目全部继续成立，主语需要精确化：

| journey 02 条目 | 需要的补充 |
| --- | --- |
| §3「MVP 提供两个 Profile」 | 保持；补充 Profile 是 preset（scope 集合 + 编排选择）的说明 |
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

API demand、wire contract、数据库 schema、Sync 版本、FSRS 参数、内容生成 prompt、
页面视觉与文案。本文只声明 `web-next` 的实现 seam 与既有领域规定的落点。
