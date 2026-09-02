# Personal Meaning → confirmed Sense：API consumer demand

> 这是 `web-next` journey consumer 对未来 API / sync adapter 的需求清单，
> 不是 HTTP、数据库或服务端实现设计。Personal Meaning、Anchor、Focus、Construction、
> Proposal 与 learner confirmation 的权威事实必须由服务端拥有；本机 v2 gateway 只是
> 当前离线 mock 的同形 seam。

## 页面状态矩阵

| 页面投影 phase | 事实依据 | 页面允许的动作 | 不应发生的事实 |
| --- | --- | --- | --- |
| `unclarified` | PM revision/Anchors，无 Focus | 生成 Focus 建议、编辑 Anchors | 不创建 Focus、Sense 或学习事实 |
| `focus_suggested` | mock/adapter 有建议，无 Focus | 将某个建议加入为待确认 Focus，或自定义 Focus | 建议本身不是 Focus fact |
| `focus_pending_acceptance` | Focus current revision 存在，`acceptedRevision` 为空或落后 | 编辑、拆分、接受当前 revision | 不得启动 Construction |
| `focus_accepted` | `acceptedRevision === currentRevision` | 启动 Construction、编辑、拆分 | 编辑后不得暗中接受新 revision |
| `constructing` | active/paused Construction、Construction turns | 回答、暂停/恢复、继续澄清、生成 Proposal | 不产生 Sense |
| `proposal_ready` | 同一 Proposal identity 的 current open version | 查看、继续澄清、拒绝、确认 Proposal | Proposal 不是 Sense |
| `sense_confirmed_expression_pending` | Alignment active，无该 SenseVersion 的 binding confirmation | 编辑候选表达/type/relation/coverage、确认或暂缓 Binding | Confirm Sense 不得静默创建 Binding |
| `aligned` | Alignment active，至少一个 binding confirmation | 查看/新增独立 Binding | 不创建 LearningTarget、FSRS 或 mastery |

List 与 Detail 必须从同一套事实构建 phase；phase 不作为可写 domain 字段传输或存储。

### Personal Semantic World 的双轴 projection

世界页的 graph、expanded、list 必须消费同一个 `JourneyWorldItemView`，不能各自按 detail phase
重算状态。每个 world item 暴露两条 UI-only 轴：

| 轴 | 投影值 | 聚合规则（多 Focus） |
| --- | --- | --- |
| Sense Formation | `focus_missing`（尚未形成 Focus）、`focus_pending_acceptance`（Focus 待确认）、`clarifying`（澄清中）、`proposal_pending`（Proposal 待确认）、`sense_confirmed`（Sense 已确认） | 无 Focus → `focus_missing`；否则 Proposal 待确认 > 澄清中 > Focus 待确认；只有所有 Focus 都有 active Alignment 才是 `sense_confirmed`。投影同时返回 Focus 总数、各阶段计数与可继续工作的 `nextFocusId`。 |
| Expression Binding | `not_ready`（尚不可开始）、`pending`（待绑定）、`partial`（部分已绑定）、`bound`（已绑定） | 只统计有 active Alignment 的 Focus；没有 confirmed Sense → `not_ready`；有 Sense 且全部无 Binding → `pending`；部分有 Binding → `partial`；所有已确认 Sense 都至少一个 Binding → `bound`。未确认 Focus 不会被当成 Binding 或阻塞已确认 Sense。 |

因此，Sense 已确认但没有 Binding 必须是 `sense_confirmed` + `pending`，不能被压成“待确认”或
“已连接”。图谱节点和位置只表示事实关系，不是第三条状态轴。Detail 仍可保留更细的
`PersonalMeaningJourneyPhase`（如 `sense_confirmed_expression_pending` / `aligned`），但它不能替代
world 的双轴 projection。Detail 中尚有 Focus suggestion 而没有 Focus fact 时，世界轴仍显示
`focus_missing`（尚未形成 Focus），而不是把 suggestion 伪造成 Focus 待确认。

## 查询需求

### GetPersonalSemanticWorld

**输入**：当前 learner scope、可选分页/更新时间游标。

**最小输出**：每项至少包含精确 `personalMeaningId`、显示标签、熟悉表达 Anchor 当前 revision、
经验 Anchor 当前 revision、`updatedAt`、Sense Formation 双轴投影和 Expression Binding 双轴投影；
可选 `shortId`、Focus/Alignment/Binding 计数。为保证图谱、展开和清单视图读取同一批事实，world query 同时返回每项的当前 Detail
projection：全部 active Focus/current revision、open Proposal current version、active Alignment、
以及每个 Binding identity 的 current Binding edge（只有 `currentBindingVersionId` 且有对应 confirmation
的版本才进入当前投影；历史 BindingVersion 另作审计读取）；页面不得为每个节点再发 Detail 请求（避免 N+1）。不得要求 legacy
region、source→domain mapping、learned/mastery/FSRS 字段。

### GetPersonalMeaningDetail

**输入**：精确 `personalMeaningId`，可选读取版本/游标。

**最小输出**：

- PM snapshot + current immutable PM revision；
- 当前 active/deleted Anchor snapshot 与 immutable revision（含 provenance）；
- Focus snapshot、current Focus revision、accepted revision 和 acceptance facts；
- Construction snapshot/turns；同一 `senseProposalId` 的 Proposal current version 与历史只读版本；
- Sense confirmation、exact Sense/SenseVersion、Alignment/event；
- Expression candidate 与独立 Binding confirmation 的 exact SenseVersion/ExpressionVersion/BindingVersion 引用；当前详情只返回每个
  Binding identity 的 current BindingVersion，历史引用另作审计读取；
- 由以上事实推导的 Detail phase。

`GetPersonalMeaningDetail` 还必须能支撑独立的 `ConfirmedSenseDetailScreen`：给定精确
`personalMeaningId + meaningFocusId`，返回该 Focus 的 active Alignment、Sense/SenseVersion semantic
spec（core meaning、prototype scene、include/exclude、neighbor contrasts、open questions）、proposal
expression candidates 与 confirmed bindings。若 required fact 缺失，consumer 应收到可显示的
unavailable 状态，而不是一个猜测的 Sense 或表达。

所有返回的 identity 都必须在服务端稳定；Detail 不应返回第二套 source/domain identity mapping。

## Command demand

下表中每个 command 都要求 UUID `operationId`。服务端应保存 receipt 或等价幂等记录：同一
`operationId` 重放返回完全相同的 stable IDs / result，不产生平行 revision 或 fact。版本冲突
应返回可区分的 conflict；offline、storage unavailable、mock scenario unavailable 也应是可显示
的错误，而不是静默成功或 generic placeholder。

对会修改当前 revision 的 command，consumer 也会提交它刚刚读取的 expected revision（Anchor
revision、Focus current revision、Proposal current version 或 exact Sense/Expression/Binding
version，按 command 而定）。服务端若发现 revision 已变化，应返回 conflict，并保留原有 immutable
facts；客户端不得用旧输入覆盖新事实。

| Command | 最小输入 | 最小输出/事实 |
| --- | --- | --- |
| `CreatePersonalMeaning` | `operationId`；typed familiar expression（`surfaceForm`、`expressionType`、`zh-CN`）和/或 experience，至少一项 | 一个裸 UUID `personalMeaningId`；PM revision 与初始 Anchor snapshot/revision 都引用它；replay 返回同一 ID |
| `CreateMeaningFocus` | `operationId`、`personalMeaningId`；建议 `suggestionId` 或 learner statement/notes | Focus snapshot + revision 1，`acceptedRevision=null`；不写 acceptance fact |
| `EditMeaningFocus` | `operationId`、PM、Focus、statement/notes | 保留 Focus ID，追加 immutable current revision；新 current revision 等待显式接受 |
| `SplitMeaningFocus` | `operationId`、PM、来源 Focus、statement/notes | sibling Focus + revision，`splitFromMeaningFocusId` 指向来源；复用 PM/Anchors，初始未接受 |
| `AcceptMeaningFocusRevision` | `operationId`、PM、Focus、当前 `meaningFocusRevisionId` | 一个 acceptance fact，并设置 `acceptedRevision`；只接受提交的 current revision |
| `AddAnchor` | `operationId`、PM、kind、typed form/body | 新 Anchor + revision 1，PM revision 更新；不改变 PM ID |
| `EditAnchor` | `operationId`、PM、Anchor、kind、typed form/body | 保留 Anchor ID，追加 revision；不得确认 Focus/Sense |
| `RemoveAnchor` | `operationId`、PM、Anchor、kind | `deleted` + `deletedAt` revision/fact；不物理伪造成功 |
| `StartSenseConstruction` | `operationId`、PM、Focus、exact accepted `meaningFocusRevisionId` | Construction 固定 exact PM revision + Focus revision；未接受时 conflict |
| `PauseSenseConstruction` / `ResumeSenseConstruction` | `operationId`、PM、Focus | 同一 Construction 生命周期 revision 更新 |
| `AnswerSenseConstruction` | `operationId`、PM、Focus、learner answer | learner/semantic turns，更新 Construction revision |
| `GenerateSenseProposal` | `operationId`、PM、Focus | 同一 Construction 下 Proposal identity + immutable version；只允许基于当前 accepted Focus |
| `ContinueSenseClarification` | `operationId`、PM、Focus | 旧 Proposal version immutable；继续后同一 `senseProposalId` 的新 version |
| `RejectSenseProposal` | `operationId`、PM、Focus | Proposal rejected；不创建 Sense/SenseVersion/Alignment，Construction 可继续 |
| `ConfirmSenseProposal` | `operationId`、PM、Focus、current Proposal version | Proposal confirmed，Construction completed；创建/复用 exact Sense + SenseVersion、confirmation fact、Alignment/event；replay 返回完全相同 IDs |
| `ConfirmExpressionBinding` | `operationId`、PM、Focus、exact `senseVersionId`、candidateId、languageTag、surfaceForm、expressionType、relation、semanticCoverage | 独立 binding confirmation，引用 exact ExpressionVersion/BindingVersion/AnchorRevision；relation/coverage 必须由 learner 明确提供 |

Expression identity 至少按 `languageTag + expressionType + normalizedForm` 区分；只有完全相同
triple 才可复用 Expression。Binding confirmation 的幂等键必须覆盖 exact SenseVersion、
ExpressionVersion、BindingVersion。受当前 contracts 的 binding-level `relation` 约束：同一
Sense + Expression 只有 relation 相同才复用 Binding；relation 改变必须创建新的
`SenseExpressionBinding` identity 及其初始 BindingVersion，Expression identity 仍可按相同 triple
复用。relation 相同但 coverage 改变时，复用 Binding 并追加 immutable BindingVersion。当前
world/detail 只投影每个 Binding identity 的 `currentBindingVersionId`，并且该 current version
必须有对应的 Binding confirmation；coverage 变更后旧 BindingVersion 不再作为当前连接重复显示。
历史 confirmation 与 BindingVersion 仍保留在事实存储中，另作审计读取，不能原位改写 relation。

## 输入、建议、确认与投影的边界

| 来源 | 可写入 authoritative facts | 说明 |
| --- | --- | --- |
| learner input | PM/Anchor/Focus revision、Construction answer、各类 confirmation | 必须带 operationId；原始经验保持 learner-private |
| LLM suggestion | adapter/mock suggestion、candidate provenance、Construction/Proposal draft | 建议不能直接成为 Focus、Sense、Binding 或 acceptance |
| learner confirmation | Focus acceptance、Sense confirmation、Expression Binding confirmation | 每种确认是独立 fact，可单独 replay |
| derived projection | List/Detail phase、counts、candidate confirmed marker | 不回写 store；禁止 learned/mastery/FSRS 语义 |

Focus suggestions、boundary options、sense reuse key 等 mock-only recoverable state 应与 domain
facts 分区；`focusAspectLabels`、`constructionHints`、`proposalSenseKeys`、
UI-only candidate link 不能冒充服务器事实模型。候选 provenance 应由现有 facts/sourceReferenceIds
推导：未改候选为 `llm_suggested + learner_confirmed`，改 form/type 为 `learner_authored +
learner_confirmed`。

## 错误、冲突与离线需求

- `replay`：同 operationId 返回原 result；不可用同 ID 执行另一 command。
- `conflict`：提交的 current revision、accepted revision、SenseVersion 或 BindingVersion 已过期时，
  返回结构化冲突并让页面 reload；不自动接受或覆盖。
- `unavailable`：服务、持久化或 mock scenario 不可用时，页面显示失败；未匹配 scenario 不得产生
  generic Sense/Proposal。
- `offline`：web 先本地写入 outbox，push → pull；冲突要保留本地待处理意图，不伪造 server ack。
- `storage_error` / `corrupt`：明确显示并提供重新读取入口；不要读取旧 v1 双 identity blob，
  也不要 silent fallback 到 legacy PersonalContentService。

## 隐私需求

Personal Meaning、Anchor 原文、媒体和 learner 叙述属于 learner-private scope。服务端返回给语义
生成器的内容应遵守最小化与脱敏边界；可复用 Sense/SenseVersion 只保留抽象语义 spec 和必要的
provenance，不复制私人原文或身份信息。所有 query/command 都必须在 learner scope 内授权。

## 仍未解决的问题

1. 现有 contracts 对 server-side outbox receipt、conflict envelope、offline sync cursor、
   unavailable/error 分类没有统一输入输出；需要 API/contract owner 定义语言无关的 envelope。
2. `GetPersonalSemanticWorld` 的分页、排序和更新时间游标尚未进入 contracts；本地 projection 目前
   可使用完整 v2 store，生产 API 需要明确增量语义。
3. Proposal 被 reject 后继续澄清在本地保持同一 Proposal identity；若服务端业务决定 reject 后必须
   新 identity，需要新增明确的 domain rule，而不是让客户端猜测。
4. Expression candidate 的 candidate identity/provenance contract 尚未定义为可服务端持久化的资源；
   当前需求只要求确认时引用 candidateId，并由 facts 推导 provenance。
5. Anchor 删除对已存在 Alignment/SenseVersion 的可见性和后续重建规则需要服务端明确；本地只做
   soft delete，不改写已确认 SenseVersion。
6. 生产语义生成器的 privacy budget、模型 provenance、重试与费用策略不属于本地 mock gateway，
   需要在 API/operations 设计阶段确定。
7. 若未来需要让 relation 自身版本化，而不是在 relation 改变时创建新的 Binding identity，必须由
   contract owner 设计并批准新的 contract 语义；客户端不能自行假定 relation 可版本化。
