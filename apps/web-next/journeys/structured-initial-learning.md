# 前端旅程基线：高保证首次学习

> 状态：统一 Target 生命周期与 Runtime Shell 接线已完成，正式学习卡片仍冻结
> 日期：2026-09-02
> 实施阶段：只接入生命周期，不修改现有高保证卡片、内容、交互与样式

## 1. 本轮边界

本轮把高保证 Learning Policy 在 `initial_learning` purpose 下的既有 Runtime 接入统一 Target 生命周期。
接线停留在应用编排和通用 Target 状态投影层：不改动高保证学习卡片、卡片内容、卡片交互或样式，
不提炼正式 API，也不把页面顺序写成领域常量。长期 Review/Relearning 的后续接线记录在
`structured-retention-learning.md`，不反向改变本文的首次学习边界。

目标边界是：

```text
Learning Target ready
→ 创建 Structured Initial Protocol Run
→ Committed Learning Policy 锁定
→ 完成 Required Acquisition Gates
→ Acquisition Graduation
→ Scheduling Handoff
→ Retention Target 进入 retaining
```

`Graduation` 只表示当前连接已经满足交给长期保持的证据门槛，不表示“已经掌握”。

### 原型中的 `sensa`、`baseline` 与 `lightweight`

当前原项目里出现的两个 presentation 名称具有明确来源：

| 名称 | 当前含义 | 在新模型中的位置 |
| --- | --- | --- |
| `sensa` | Sensa 自己设计的高保证学习卡片和 Runtime 叙事 | `high_assurance` Policy 的 Structured Runtime 候选实现 |
| `baseline` | 之前复刻的“不背单词”卡片 | 旧产品对照与视觉/交互参考，不是 Sensa 正式协议 |
| `lightweight` | 本阶段新建立的轻量学习策略 | 独立 Learning Policy，不等于 `baseline` |

因此 `sensa / baseline` 不是两个可以在正式 Runtime 中随意切换的视觉主题，`baseline` 也不能因为
代码上复用了相同回调就自动获得 Structured Gate、Evidence 或 Graduation 语义。当前 Side Panel 只在
词义世界、自由练习、随身听和词典等非学习生命周期页面保留原型比较 switch；正式学习页面不再暴露
baseline 分支。正式路径由 Committed Learning Policy 选择 Protocol，其中高保证路径使用 `sensa`，
轻量路径使用已经独立建立的轻量 Runtime，`baseline` 留在非学习页面的对照范围。

## 2. 必须同时理解的两条叙事

### 2.1 单个 Target 的生命周期

```text
ready
→ Experience Grounding
→ Sense–Expression Binding
→ acquiring
→ Recognition Gate
→ Meaning-to-form Recall Gate
→ Novel-context Transfer Gate
→ optional Boundary Gate
→ Graduation
→ retaining
```

这是一个 Target 的逻辑生命周期，不等于用户连续看到的一组固定页面。Required Gate Set 由当前
Acquisition Profile 固定；Boundary 只有存在真实 confusion target 时才出现。

### 2.2 一次高保证学习 Session

高保证学习必须在不同 Target 之间制造干扰，因此用户实际经历的是 Planner 选择出来的 Action 流：

```text
进入今日高保证学习
→ Target A：Grounding / Binding
→ Target B：Grounding / Binding
→ Target A：Recognition
→ Target C：Grounding / Binding
→ Target B：Recall
→ Target A：Transfer
→ ……
→ 某个 Target 满足全部 Gate，单独 Graduation
→ 继续处理本 Session 中尚未完成的 Target
→ Session 总结
```

Runtime 必须能够回答“当前在处理哪个 Target、为什么出现这个 Action、哪些 Gate 已通过”，但首次学习页
不再为这些信息增加一块独立的顶部状态文案；现有导航、正式卡片和 Session Summary 共同承担这层叙事。
Target Graduation 与 Session 完成是两个不同事实：一个 Target 可以先毕业，Session 仍继续处理其他 Target。

## 3. Runtime 表面及其唯一职责

下表描述的是可呈现状态，不要求每一行都成为独立路由或固定卡片。

| 表面 | 用户要完成的事 | 可以产生的正式事实 | 明确不能产生 |
| --- | --- | --- | --- |
| Runtime Shell | 知道当前 Target、Policy、Action 原因与 Gate 进度 | 无 | Gate pass、Evidence |
| Experience Grounding | 构建足够具体的经验/概念结构 | Introduction step completion | Gate pass、Graduation |
| Sense–Expression Binding | 看见稳定 Sense、目标表达、边界与学习例句 | Introduction completion | 独立取回证据 |
| Contextual Recognition | 从 form + 基础语境识别目标 Sense | Recognition Attempt/Evidence；成功时 Gate pass | Recall/Transfer pass |
| Meaning-to-form Recall | 在不泄露答案时从 Sense 主动取回 form | Recall Attempt/Evidence；仅 independent 成功时 Gate pass | 把首字母/选词/看答案算作 pass |
| Novel-context Transfer | 在未用于教学的新语境中识别同一 Sense | Transfer Attempt/Evidence；成功时 Gate pass | 把熟悉例句记忆算作迁移 |
| Boundary | 区分真实相邻 Sense | Boundary Attempt/Evidence；成功时 Gate pass | 为没有混淆目标的 Target 制造假 Gate |
| Targeted Repair | 恢复失败 Gate 所需的经验、边界或 form 连接 | Repair completion | 把即时理解或揭示算作 Gate pass |
| Graduation | 说明 Required Gates 已全部成立 | Acquisition Graduation + 一次 Scheduling Handoff | “永久掌握”声明、第二份 FSRS state |
| Session Summary | 汇总本 Session 的毕业、进行中与待修复 Target | Session completion projection | 替每个 Target 伪造 Graduation |

## 4. Gate、失败和修复规则

### Gate 成功

- Recognition、Recall 与 Transfer 必须来自互相独立的 Attempt；
- Recall 只有完全独立取回才能通过，首字母、选词或直接看答案都只是支持路径；
- Transfer 使用未作为教学材料出现过的场景；
- Boundary 仅在 Profile 声明真实对比目标时 required；
- 当前 Gate 成功不能替其他 Gate 产生证据。

### Gate 失败

```text
当前 Gate failed
→ 保存失败 Evidence
→ 只打开该 Gate 的 Targeted Repair
→ 其他 Gate 的 pass 保持不变
```

失败不意味着“清空进度”或“从第一关重来”。失败历史是事实，不能被修复页面覆盖。

### Repair 与独立重测

```text
Targeted Repair
→ Gate 回到 unresolved
→ 穿插其他 Target / 满足 interference rule
→ 使用合法的新 Action 或替代资源独立重测
→ 成功后 Gate pass
```

Repair 展示答案、Experience Recap、L1 Bridge、学习例句或 Sense features，目的是恢复连接。Repair
完成本身不能通过 Gate；紧接揭示后的“懂了”也不能升级成独立成功。

## 5. Graduation 与页面状态

当且仅当当前 Target 的全部 Required Gates 为 `passed`：

```text
Acquisition Cycle completed
→ Acquisition Graduation
→ Scheduling Handoff
→ 初始化该 Retention Target 唯一的 FSRS Memory State
→ phase = retaining
```

前端随后应统一投影：

- 首页：该 Target 不再计入“新学”，以后只在 due 时计入“复习”；
- Target 库：`保持中 · 已锁定`；
- Target 详情：展示“高保证首次学习已完成”、已通过 Gate 与下次复习安排；
- Graduation 表面：说明“已交给长期保持”，不使用“已掌握”叙事；
- Learning Policy 继续保持锁定，普通设置不能改写。

## 6. 当前代码已经覆盖的事实

当前实现不是空白，以下内核行为已经基本符合新领域模型：

1. `Learning Target → readiness → first Run → Policy commitment` 已接通；
2. `LearnQueue` 为每个 Package 分开保存 Gate 状态；
3. Recognition、Recall、Transfer 与 conditional Boundary 使用不同 capability；
4. Recall 只有 `independent` 能通过，提示、选词和 miss 会进入失败/修复；
5. Gate 失败只标记当前 capability，不清除其他 Gate；
6. Repair Action 具有独立 `mode=repair`，完成后只把 Gate 恢复为 `unresolved`；
7. 重测可以轮换同 capability 的 Action/Transfer scenario；
8. `minGap`、active window 与 oldest-eligible selection 已存在；
9. 全部 Required Gates 通过后才进入 graduated Sense 集合；
10. Graduation 到本地 FSRS 的写入具有幂等保护；
11. 长期 Retention Review 与 Relearning 已使用另一条 purpose-specific Runtime。

因此后续重点应是把正确的内核事实清晰投影给用户，而不是重写 Gate 调度器。

### 已经接入的生命周期事实

1. `ready` 的高保证 Target 创建首次正式 Protocol Run 时，提交并锁定 `high_assurance` Policy；
2. 正式高保证入口固定使用当前高保证 presentation：各 Gate 使用 `sensa`，
   Introduction 使用 `compact`。学习链路的 `baseline` 展示分支已移除，正式入口不再
   提供 Reveal / Recognition / Recall / Transfer / Example / Review 的 baseline 切换；
3. 既有 Structured Runtime 继续独立处理 Introduction、Required Gates、Repair 与 Graduation；
4. 只有 `LearnQueue` 已确认毕业的 Sense 才产生 `structuredGraduationByTarget` 投影；
5. Graduation 只执行一次本地 Scheduling Handoff，并读取同一 Sense 的 Memory State 得到下次复习安排；
6. Graduation 后，首页新学 inventory、Target 库和 Target 详情统一把该 Target 投影为 `retaining`；
7. 已知 Target 在 Graduation 前不会因为旧的本地 FSRS fixture 提前进入高保证 Review inventory；
8. 本轮只移除了学习生命周期内的 baseline 卡片分支和对应死代码；高保证卡片的 DOM、卡片文案、学习
   材料、交互和既有样式保持不变。保留的样式只服务于当前 Sensa 卡片和 Session Summary。

### Runtime 编排与只读投影

1. `LearnQueue` 通过一个只读 projection interface 输出当前 Action、Target phase、Required Gates、
   repair 状态、Graduation 与 Declared Mastery；页面不再读取或复制调度器内部 Map；
2. 今日 inventory 中同时存在多个 `ready + high_assurance` Target 时，一次 Structured Session 会把
   它们作为稳定快照共同交给现有穿插调度器，而不是为每个 Target 创建单独的单词流程；
3. Runtime 的 Target、Action purpose 与 Gate 进度仍由 `LearnQueue` 提供，但首次学习页不再额外渲染
   顶部状态文案；正式卡片的样式、交互和文案均未修改；
4. Structured Session 结束后使用独立 Summary 区分 Acquisition Graduation 与 Declared Mastery，
   不再把两者合并进旧的“本组学习完成”；
5. “熟”是贯穿 Grounding、Assessment、Repair 与长期 Review 的 Declared Mastery 入口。声明只把
   Retention Target 从 Planning inventory 排除并中断当前 Encounter，不产生 Gate pass、Graduation、
   Attempt、Review Outcome、Relearning effect 或 FSRS 更新；
6. Declared Mastery 可以从 Target 详情撤销；当前前端会话内的 Structured Protocol Run 会依据原有
   phase 和 Gate 状态继续，长期 Review 会从未被改写的 Memory State 重新取得资格。

## 7. 当前实现与目标叙事的缺口

### P0：需要另行确认后处理

1. **单 Target inventory 仍只能使用等价 cooldown fallback。** 当今日只有一个高保证 Target 时，
   没有其他真实 Target 可以提供干扰；页面不会声称已经观察到真实多 Target interference，正式
   policy 仍需定义合法的 equivalent spacing。
2. **部分用户文案与内核事实冲突。** 仍存在“进度清零”“从第 1 关重来”等旧说法；实际引擎只
   重新打开失败 Gate。
3. **Transfer 成功文案可能过早宣布完成。** 若 Target 还有 required Boundary，Transfer 通过不等于
   Graduation。
4. **非学习页面仍保留 baseline 对照工具。** 正式高保证入口已经固定到 `sensa`，学习生命周期内的
   baseline switch 与旧卡片分支已移除；词义世界、自由练习、随身听和词典的对照能力不属于本轮清理范围。

第 2、3 项直接涉及正式学习卡片文案，依当前产品约束只登记，不在本轮修改。

### P1：P0 叙事稳定后处理

1. Boundary 目前复用 Review Assessment 组件和内部命名，页面上需要明确它属于 acquisition Gate，
   不能让用户误解为长期复习；
2. 跨刷新中断恢复需要返回同一个 Protocol Run/Step；当前只保证同一前端会话内恢复；
3. 正式 API 契约需要在页面确认后再提炼，当前本地状态不能冒充权威 Evidence/5D/FSRS 写入。

## 8. 后续实施顺序

完成本轮生命周期接线后，剩余代码修改应按以下顺序进行，并先取得对高保证 Runtime 表面的修改授权：

1. 定义单 Target 时合法的 equivalent spacing policy；
2. 在取得卡片文案修改授权后，修正与 Gate-scoped failure 和 Graduation 冲突的旧文案；
3. 明确 Boundary acquisition Gate 的页面命名；
4. 完成前端走查后再提炼请求/响应/事件契约。

## 9. 后续实现验收条件

- 任何失败都只改变当前 Gate；
- Repair 后的即时动作不能让 Gate 通过；
- 相同 Target 的独立 Assessment 之间可观察到真实干扰；
- UI 中能区分 teaching、assessment、repair、graduation；
- 有 required Boundary 时，Transfer 成功不会提前毕业；
- 每个 Target 最多产生一次初始 Scheduling Handoff；
- Graduation 后 Target 从新学 inventory 移除并进入 retaining；
- 页面不宣称“掌握”，客户端不直接写 Evidence、5D 或权威 FSRS 派生状态。
