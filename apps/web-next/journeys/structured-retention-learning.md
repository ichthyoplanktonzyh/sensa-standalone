# 前端旅程基线：高保证长期学习

> 状态：统一 Target 生命周期接线已完成，正式学习卡片保持冻结
> 日期：2026-09-02
> 实施阶段：前端可运行原型

## 1. 旅程边界

本轮只把既有高保证 Review 与 Relearning 接入统一 Target 生命周期，不改变正式学习卡片的样式、
交互、内容或文案。

```text
retaining + due
→ Review Protocol Run
→ 独立评测
→ 恰好一个 Memory Outcome
├─ 成功 → 安排下一次 Review → retaining
└─ 失败 → 打开 Relearning Cycle
          → Targeted Repair
          → 独立重测
          ├─ 成功 → Relearning Completion → retaining
          └─ 失败 → 返回 Targeted Repair
```

Review 回答“这次到期时连接是否仍可独立取回”，Relearning 回答“失败的连接是否已经恢复”。两者不是
同一次调度结算：一次 due Review 最多产生一个 Memory Outcome；后续 Repair 与独立重测都不会再次
更新 FSRS。

## 2. Target 状态投影

`ReviewQueue` 对页面只暴露 purpose-specific 的只读 projection：

| 状态 | 页面含义 | 允许的下一动作 |
| --- | --- | --- |
| `review_pending` | 已进入本 Session，等待到期检验 | 等待 Planner 选择 |
| `reviewing` | 正在完成本次 due Review | 提交一次独立评测 |
| `relearning_repair` | 遗忘已经结算，正在修复失败连接 | 完成修复 |
| `relearning_retest` | 修复完成，等待/执行独立重测 | 提交重测结果 |
| `retaining` | 本轮处理结束，已返回长期保持 | 等待下一次 due |
| `declared_mastery` | learner 主动从计划中排除 | 可从 Target 详情撤销 |

该 projection 同时提供当前 Action 的 Target、capability、mode 与 reason。App 和页面不读取
`ReviewQueue` 的 pending queue、cycle map 或内部计数来猜状态。

## 3. 页面职责

- Target 库：显示“复习中 / 重学修复中 / 等待独立重测 / 保持中”，Policy 始终为已锁定；
- Target 详情：为正在运行的 Review/Relearning 提供“继续复习/继续重学”入口；
- Runtime Shell：在正式卡片外说明当前 Target、Action 和本轮长期阶段，不修改卡片；
- Retention Summary：区分直接返回保持、重学完成与 Declared Mastery；
- 首页：只按已锁定 Policy 把 due Target 路由到相应 Runtime，不把高保证和轻量协议混在一起。

## 4. Declared Mastery

“熟”在 Review、Repair 与独立重测中都可用。它只中断当前 Encounter 并把 Target 从 Planning
inventory 排除，不产生 learner response、Review Outcome、Relearning effect 或 FSRS 写入。

撤销 Declared Mastery 后，Target 依据未被改写的 Memory State 与 Relearning Cycle 重新取得计划资格；
不会伪造 Review 成功，也不会重置原有长期记忆状态。

## 5. 当前原型边界

- `structuredRetentionByTarget` 和 Session Summary 只保存在当前 React 会话；权威长期状态仍来自现有
  storage projection，未来由服务端 API 接替；
- 同一前端会话内可以退出并从 Target 详情继续；跨刷新恢复仍待正式 Protocol Run 合同；
- 单 Target 缺少真实 interference item 时仍使用调度器已有的显式 fallback，本轮不改写该策略；
- 本轮没有修改 `components/cards/*`，也没有修改既有正式卡片的样式选择器、交互或文案。

## 6. 验收不变量

- 一个 due Review 最多产生一个 Memory Outcome；
- Review 失败后进入 `repair → independent retest`，不直接伪造恢复；
- Repair 与重测均不重复更新 FSRS；
- 重测失败回到 repair，重测成功才返回 retaining；
- Declared Mastery 不产生 Outcome，也不改变 Memory State；
- Target 库、Target 详情、Runtime Shell 与 Summary 使用同一只读状态投影。
