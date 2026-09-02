# 前端旅程基线：Learning Target 加入到 Policy 锁定

> 状态：`web-next` 可运行原型
> 日期：2026-09-01
> 实施阶段：前端先行、后端契约发现

## 旅程

```text
加入 Target
→ 按所选 Learning Policy 准备并校验内容
→ ready
→ 创建首次正式 Protocol Run
→ Committed Learning Policy 锁定
→ 首次学习完成并进入 retaining
→ 到期 Review
→ 必要时 Relearning
→ 返回 retaining
```

## 前端事实

本原型不使用一个可随意改写的通用 `status`。页面分别保存并投影三个事实：

- `addedLearningTargetIds`：用户是否已经表达学习意图；
- `preparationByTarget`：当前策略对应的内容准备结果；
- `committedPolicyByTarget`：首次正式 Protocol Run 创建时提交的策略；
- `lightweightCompletionByTarget`：轻量首次完成、下次复习时间、本地 Review 次数与遗忘次数的前端投影；
- `structuredGraduationByTarget`：高保证 Required Gates 全部通过后产生的 Acquisition Graduation、
  Scheduling Handoff 与 `retaining` 前端投影；
- `structuredRetentionByTarget`：高保证到期 Review 结算后的 Memory Outcome、下一次安排，以及
  Relearning Cycle 的阶段投影；
- `declaredMasterySenseIds`：learner 对 Retention Target 作出的可撤销 Declared Mastery；它只排除
  Planning eligibility，不覆盖 membership、phase、Gate、Graduation 或 Memory State。

准备中或被阻塞的 Target 仍保留在库中，但不能进入 Runtime。切换策略会重新计算准备结果，
不会静默降级。首次正式运行创建成功前，策略仍可调整；创建成功后以
`committedPolicyByTarget` 为准，详情和列表均只读显示“已锁定”。

## 页面与动作

| 投影 | 主要动作 | 下一事实 |
| --- | --- | --- |
| 未加入 | 加入学习 | membership + 初始 preparation |
| preparing | 更新准备状态 | 本原型把异步准备推进到 `ready` |
| blocked | 更换学习方式 | 新策略对应的新 preparation |
| ready | 从今日学习流开始 | 创建首次 Protocol Run |
| learning / locked | 继续学习 | 不允许原地改写策略 |
| retaining / locked | 等待首次复习 | 首次学习已完成，Policy 仍保持锁定 |
| reviewing / locked | 继续复习 | 本次 due Review 只结算一个 Memory Outcome |
| relearning repair / locked | 继续重学 | 只修复失败的连接，不重复结算 |
| relearning retest / locked | 完成独立重测 | 成功后返回 retaining，不再次更新 FSRS |
| declared mastery | 恢复学习 | 撤销后依据未改写的原有进度恢复 Planning eligibility |

首页“新学”只统计 `已加入 + ready + 未锁定` 的 Target；到期复习仍优先。若今日同时存在复习和
新学，复习完成后才为第一个 ready Target 创建首次运行。

## 轻量首次 Runtime

```text
Experience Grounding
→ 从经验和意思主动回想目标表达
→ 显示答案
→ 没想起 / 想起但费力 / 顺利想起
→ 首次学习完成，等待长期复习
```

- `没想起` 不伪装成成功证据，回到当前 Runtime 的主动回想步骤；
- `想起但费力` 与 `顺利想起` 完成本次轻量首次学习，但保留不同的原始 learner response；
- 页面不计算 Memory Outcome 或 FSRS 间隔，只表达“已经交给长期复习安排”；
- 首次学习完成是独立于 membership、preparation 和 committed policy 的第四个前端事实。

Experience Grounding 的消费顺序固定为：

1. Target 自己引用的 Personal Meaning / Personal Semantic Anchor 经验；
2. exact `runtimeSenseId` 对应的已校验 Learning Package Experience；
3. Content Preparation 阶段生成并校验的经验资源。

当前 `tactful` fixture 代表第一种来源，`borrow/lend` 代表第二种来源。代码中的 generated
projection 是第三种来源的本地 stand-in；生产契约必须在 Target 变成 `ready` 前返回稳定资源引用，
不能在正式 Runtime 中临时调用生成服务。

## 轻量长期 Runtime

```text
到期 Target
→ 从意思和经验线索独立取回表达
→ 显示答案
→ 没想起 / 想起但费力 / 顺利想起
→ 更新下一次复习安排
```

正常到期复习不会再次播放完整 Experience Grounding，而是把经验作为紧凑线索，直接检验能否从
意思取回目标表达。首页“复习”统计会合并轻量 Target 与既有高保证 Review inventory，但 Runtime
仍按照 Target 已锁定的 Policy 进入各自协议；已提交为轻量策略的 Target 不会再进入高保证 Review。

选择 `没想起` 后执行独立修复链：

```text
固定本次 due Review = again
→ Experience Recap + 意思—表达重新绑定
→ 修复后的独立回想
→ Relearning Completion
```

修复后的“现在想起来了”只完成本次 Relearning，不会给同一个 due Review 产生第二个评价或第二次
调度更新；“还是没连上”继续修复，不覆盖已经记录的遗忘事实。

为了能够在一次前端走查中完整验证旅程，本地原型把首次 Scheduling Handoff 的 due time 压缩为
“现在可复习”。完成 Review 后使用确定性演示间隔：`again = 10 分钟`、`hard = 1 天`、`good = 3 天`。
这些值不是领域策略、FSRS 参数或未来 API 合同；正式版本只消费服务端返回的 Scheduling Handoff、
Memory Outcome 与下一次 due time。

## 当前原型边界

- 状态只保存在当前 React 会话，刷新后恢复示例初态；未来需要持久化/API 契约。
- `轻量学习` 已实现 Experience Grounding、首次主动回想、长期到期 Review、三向评价、遗忘修复与
  本轮总结；正式调度和跨刷新持久化另行实现。
- `高保证学习` 的 readiness 由 `runtimeSenseId` 是否能精确解析到已安装的可执行学习 package
  推导；Target 不再重复保存一份容易过期的可用性布尔值，找不到对应内容时不得启动。
- 高保证正式入口固定复用既有高保证 Runtime presentation（各 Gate 使用 `sensa`，Introduction 使用
  现有命名 `compact`）；Target 在 Graduation 之前不会进入高保证长期复习 inventory，Graduation
  后才从“学习中”投影为“保持中”。
- 高保证 Runtime 的“熟”入口在 Grounding、Assessment、Repair 与长期 Review 中保持可用；该动作
  只建立 Declared Mastery 并中断当前 Encounter。Target 详情负责显式撤销，撤销不会重置原 Protocol
  Run、Gate 或 Memory State。
- 高保证长期 Runtime 已通过 `ReviewQueue` 的只读 projection 接入 Target 库、Target 详情、卡片外
  Runtime Shell 与独立 Session Summary。页面只消费 `reviewing / relearning repair /
  relearning retest / retaining / declared mastery`，不读取调度器内部 Map。
- 本文不授权客户端写 Evidence、Memory Outcome、FSRS 或其他服务端派生状态。
