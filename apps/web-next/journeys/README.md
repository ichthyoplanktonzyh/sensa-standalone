# web-next 前端叙事基线索引

> 状态：Frozen canonical frontend narratives
> 冻结日期：2026-09-02
> 适用范围：`apps/web-next` 当前阶段的入口、页面职责、用户意图、可见状态与旅程交接

本目录只管理已经由产品讨论和可运行原型共同确认的前端叙事基线。当前只有两条：

| 顺序 | Canonical journey | 起点与终点 |
| --- | --- | --- |
| 1 | [`01-personal-semantic-world.md`](01-personal-semantic-world.md) | 个人经验/熟悉表达 → 稳定 Sense Expression Binding，作为 Learning Target 的语义基础 |
| 2 | [`02-independent-learning.md`](02-independent-learning.md) | 独立 Learning Target → 首次学习 → Scheduling Handoff → 长期 Review/Relearning |

## 权威顺序

1. `CONTEXT.md` 与 `docs/sensa/README.md` 列出的领域文档裁决术语、identity、owner 和不变量；
2. 本目录两份 canonical journey 裁决 `web-next` 当前阶段的前端叙事、页面职责和旅程交接；
3. `FRONTEND_FIRST_WORKFLOW.md` 只定义阶段性工作方式，不定义第三条用户旅程；
4. 组件、状态名、fixture、mock、CSS、旧页面和历史实现只能提供原型证据，不能覆盖前两层。

前端基线的“权威”只发生在它的前端职责范围内，不能覆盖 canonical domain model。若页面需求与
领域文档冲突，必须先显式解决冲突，不能通过修改页面状态名称暗中重定义领域对象。

## 冻结规则

- 其他文档不得再自称“前端旅程基线”或建立平行的主链；
- 轻量、高保证、Review、Relearning 等都是第二条主旅程中的 Policy/Protocol 变体，不是新的主旅程；
- API demand、wire contract、数据库、Sync、实现架构、走查记录和 worker handoff 不属于叙事基线；
- 新页面必须能明确归属其中一条旅程，或先由产品确认确实出现了第三条独立主旅程；
- 修改已冻结的入口、终点、用户意图、页面职责或关键状态时，必须由 owner 明确重新打开决定，
  并在同一次变更中更新对应 canonical journey；
- 纯视觉、动效和组件拆分不需要修改叙事基线，除非它改变用户理解或可执行意图。

## 两条旅程的交接

第一条旅程产生稳定的 `Sense Version + Sense Expression Binding`。它是可学习目标的语义基础，
但尚未自动产生 Curriculum membership、Committed Learning Policy、Protocol Run、Evidence 或 Memory
State。只有显式进入学习后，系统才建立/解析 Learning Target 并进入第二条旅程。

第二条旅程不依赖第一条。Book、直接选择既有 Sense、个人词义世界等来源都通过同一个 Learning
Target 边界进入统一学习生命周期，来源只形成 Learning Entry Provenance，不改变 Target identity。
