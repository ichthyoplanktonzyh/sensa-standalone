# web-next 阶段性前端先行工作方式

> 状态：当前阶段有效
> 适用范围：`apps/web-next` 及其直接需要的共享契约
> 生效日期：2026-09-01
> Canonical frontend narratives：[`journeys/README.md`](journeys/README.md)
> 退出条件：本文第 9 节所列条件满足后，由后续 API/后端集成工作方式替代

## 1. 目的

当前阶段先通过 `web-next` 确认 Sensa V1 的真实用户旅程、页面状态与用户意图，再从已经确认的
前端需求中提炼 Query、Command、结果、错误和同步契约。后端正式业务实现、最终持久化映射与
production Sync 接入在这些消费契约稳定后开始。

这不是“让 UI 定义领域”。它是用可操作的前端旅程发现领域模型中尚未被证明需要的部分，避免先按
想象设计完整后端，再迫使前端迁就错误边界。

## 2. 权威顺序

发生冲突时按以下顺序裁决：

1. `CONTEXT.md` 与 `docs/sensa/README.md` 列出的 canonical domain documents 定义术语、身份、
   生命周期和不变量；
2. `docs/sensa/current-stage.md` 定义当前里程碑，`docs/sensa/product-requirements-v1.md` 定义 V1 IA、
   用户旅程和验收；
3. 本文定义当前阶段的开发顺序和交付物；
4. `web-next` 现有组件、类型、fixture 和交互只提供原型证据，不是领域事实来源；
5. 旧 production contracts、旧数据库和旧客户端实现只能作为迁移输入，不能覆盖新领域文档。

已确认的领域不变量不会因页面实现方便而改变。例如 Personal Meaning、Sense 与 Expression 保持
不同 identity；confirmation 不等于 Add-to-Learning；Card 不是学习或调度 identity；正式 Evidence、
Outcome 与 FSRS 投影不能由客户端直接声明。

## 3. 四层模型必须分开

```text
Canonical domain boundary and invariants
                 ↓
web-next screen state and user intent
                 ↓
consumer-driven Query / Command contracts
                 ↓
backend API, persistence and Sync implementation
```

### 领域模型

定义稳定术语、identity、owner、生命周期、确认门和不变量。只有当具体旅程暴露了新的领域事实或
矛盾时才补充，不因为一个组件需要某个字段就立即新增领域对象。

### 前端页面状态

服务于具体交互，可以包含选中项、弹窗、展开状态、动画阶段、草稿输入、乐观预览和临时错误。
这些状态默认属于 `web-next`，不自动进入共享契约或数据库。

### API 消费契约

表达一个真实用例需要读取什么或请求系统做什么。Query 返回可为页面优化的只读 Projection；
Command 表达用户意图，并返回权威结果、冲突或可恢复错误。契约不能直接复制组件树，也不能退化成
数据库表的通用 CRUD。

### 持久化模型

由后端在消费契约和领域边界稳定后设计。前端 mock shape、页面 Projection 和数据库 schema 不要求
一一对应。

## 4. 每条纵向旅程的工作循环

### 第一步：选择一条用户旅程

每次只选择一条可从入口走到明确结果的旅程或其中一个明确子段。当前主旅程只能来自
`journeys/README.md`：

```text
Personal Semantic World → stable Sense–Expression connection

Learning Target → Initial Learning → Retention/Relearning
```

子段可以单独实施和走查，但不能另建第三份“前端旅程基线”。不得用“完成所有数据模型”“重写整个
状态管理”一类横向任务代替用户旅程。

### 第二步：建立页面状态矩阵

在修改领域或后端结构前，先明确：

- 入口条件与当前权威事实；
- 页面必须展示的信息；
- learner 可以触发的意图；
- loading、empty、pending、offline、conflict、unavailable 与 retry 状态；
- 离开、刷新、恢复和重复操作的行为；
- 成功、失败、中断和取消后的下一状态；
- 哪些只是 presentation state，哪些需要服务端权威确认。

### 第三步：用场景 fixture 和 mock port 完成前端

`web-next` 通过显式的 frontend port/gateway 消费数据，不让组件直接依赖未来 HTTP 路径或数据库
结构。先用确定性的 scenario fixtures 覆盖主流程和关键边界，再实现页面。

mock 可以模拟服务端权威结果，但不得借此宣称后端、Sync、FSRS、LLM policy 或持久化已经完成。
页面必须能诚实呈现 unavailable、pending、conflict 和 offline，而不是让 mock 永远成功。

### 第四步：提炼消费者驱动契约

只有前端旅程证明存在真实需求后，才提炼共享契约：

- Query 名称、输入和只读 Projection；
- Command 名称、operation identity、输入与预期 revision；
- accepted、replayed、conflict、unavailable 等封闭结果；
- 幂等、恢复、离线与错误语义；
- 需要固定的 domain/version/provenance references；
- 客户端可乐观预览但不能权威写入的派生状态。

契约以业务用例命名，例如 `ConfirmSenseProposal`、`GetLearningReadiness`、`AddToLearning`，不以
`PATCH /table/:id` 一类存储操作命名。

### 第五步：领域检查点

对新契约逐项确认：

- 是否出现了新的稳定 identity；
- 谁拥有该事实，谁只能读取 Projection；
- 是否存在新的不可逆确认门或生命周期；
- 重放、并发、删除、离线和版本升级时怎样表现；
- 是否侵犯 Personal Content、公共语义、Learning Evidence 或 scheduler 的边界；
- 是否与 canonical documents 冲突。

只有答案确实改变领域语言或不变量时，才同步更新 canonical domain documents。纯 UI 布局、组件
形态、动画和页面顺序不进入领域文档。

### 第六步：记录 API 需求，但暂不实现后端

进入契约发现阶段后，依据已冻结旅程留下可由后端直接消费的 API demand：所需 Query、Command、
Projection、错误、幂等和版本语义。API demand 不是前端叙事基线，不得放进 `journeys/` 或覆盖其中
的入口、终点与用户意图。当前阶段不因此自动开始 route、service、repository、production Sync
handler、FSRS adapter 或部署实现。

## 5. 每条旅程的最小交付物

- 可运行并经用户确认的 `web-next` 交互；
- 页面状态矩阵和关键边界场景；
- 确定性的 mock scenarios；
- 隔离组件与数据来源的 frontend port；
- 契约发现启动后，已被真实页面证明需要的 Query/Command demand；
- 尚未解决的领域问题和明确的 unavailable/fallback 行为；
- 不依赖 production backend 的前端 smoke check。

共享契约只收录已经跨过领域检查点、且预计由 Web/API/Mobile 共同使用的稳定形状。组件私有 props、
CSS class、弹窗状态和临时 prototype payload 留在 `web-next`。

## 6. 必须覆盖的边界场景

至少用以下场景检验相关旅程：

- Sense 已确认，但 on-demand 内容仍在准备或最终不可用；
- confirmation 或 Add-to-Learning 因网络重试被重复提交；
- 本地 operation pending 时刷新、离线、退出或重新进入；
- 同一 Retention Target 同时来自 Book 与 Personal Meaning，不重复建立进度；
- Review 失败已经产生 Memory Outcome，随后 Relearning 不能改写该结果；
- active flow 固定的 Sense/Materialization/Protocol revision 在后台更新后仍可重放；
- Personal Anchor 未授权、已撤销或删除时，不泄漏到公共内容或 assessment；
- 服务端权威结果与乐观 UI 不一致时，界面能回到明确、可解释的状态。

## 7. 当前阶段禁止的捷径

- 不从旧组件、旧 TypeScript type、旧 API 或旧数据库反推新的领域真相；
- 不把 mock fixture 直接宣布为 production persistence schema；
- 不为方便渲染重新引入 Card、Deck、generic flashcard progress 等领域对象；
- 不让页面直接写 Gate、5D、Learning Evidence、Outcome、Learning Phase 或 FSRS state；
- 不用一个含义模糊的 `isLearned`、`isReady` 或通用 `status` 合并不同领域事实；
- 不把 frontend route、tab、modal 或 component hierarchy 固化为 API identity；
- 不为了让原型成功而隐藏 content unavailable、conflict、offline 或 validation failure；
- 不在未经 owner 明确决定时，以前端需求为理由开始正式后端或部署工作。

## 8. 当前已冻结旅程

当前只有两条 canonical frontend narrative：

1. [`journeys/01-personal-semantic-world.md`](journeys/01-personal-semantic-world.md)：个人经验/熟悉表达
   形成 stable Sense–Expression connection；
2. [`journeys/02-independent-learning.md`](journeys/02-independent-learning.md)：独立 Learning Target
   完成首次学习并进入长期 Review/Relearning。

Home、Target 库、Policy 选择、Runtime 与 Summary 都是这两条旅程的页面或 projection，不自动构成
新的主旅程。顺序或边界如需改变，必须先由 owner 重新打开对应 frozen baseline。

## 9. 退出这一工作方式的条件

只有同时满足以下条件，才进入正式 API/后端集成阶段：

- 当前 V1 P0 旅程已经在 `web-next` 中逐条确认；
- 主状态、失败状态、离线状态和恢复语义稳定；
- 前端不再依靠未命名的 mock 副作用维持流程；
- 所需 Query、Command、Projection、错误和幂等契约已经明确；
- 旅程暴露的领域身份、生命周期与不变量已经回写 canonical documents；
- 后端可以仅依据领域文档和消费契约实现，而不需要猜测页面意图；
- Web 与未来 Flutter 可以共享业务契约，而不共享组件或 presentation state。

届时本文应标记为 `Superseded`，并链接新的 API/后端集成工作约定；不能把阶段性的 mock-first 方式
继续当作长期 production 架构。
