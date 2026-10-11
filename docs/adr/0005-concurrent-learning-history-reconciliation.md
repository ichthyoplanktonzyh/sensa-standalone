---
status: accepted
---

# 并发学习历史的确定性合并

普通内容记录继续使用逐记录三方合并；不能自动合并的普通内容冲突可以要求 learner 选择保留本机或
云端版本。Learning Run、Learning Event 与排程投影不能使用这个选择器，因为覆盖任一端都会丢失
学习历史，把两端 Outcome 依次再次结算又会让同一次到期 Review 对排程贡献两次。

当两个设备从同一已确认基线出发，为同一 Learning Target 分别产生互不重叠且都已完成的 Run 时，
同步执行以下确定性规则：

分叉由双方新增的互不重叠学习事实识别；两端 Target 投影恰好相等也必须显式记录决定，不能把两个
并行 Review 当作先后发生的学习。history-only 只排除调度贡献，完整备份和同步准入仍校验每个
Action 的材料与个人场景版本引用，以及 Protocol、Evaluation、Completion 和排程转移；不能只保存落选正文而跳过其验证。个人 Scene 裁决保留原 timeline、revision identity、pin 与接受关系，无法解释原 pin 的内容选择仍拒绝，并保留两端原资料。

- 两端原始 Run 与 Learning Event 全部保留，仍是不可改写的 Personal Library Fact；
- 以最后完成 Run 的 `(completedAt, runId)` 全序选择负责当前 Target、Memory 与 Schedule 投影的分支；
- 另一分支标记为 history-only，不再次参与当前投影重放，也不产生第二份 Scheduling contribution；
- 合并结果写入不可改写的 Learning Reconciliation Decision，记录候选、采用和 history-only 的
  Event/Run identity、算法版本与决定时间，以及本次取代的既有 Decision identity；
- 只有结构、内容和策略边界一致的已完成分支可以自动合并。共享 Run、未完成 Run、结构变化或无法
  验证的历史继续作为冲突停止，不猜测 learner outcome。

新 Decision 明确取代同 Target 的现有裁决前沿，旧 Decision 原样保留；第三个客户端基于旧业务基线的已完成分支按同一规则重新收敛。所有裁决（包括已取代的裁决）的采用 Run 都必须形成完整、连续的原始分支；并行 cohort Run 当前停止自动 reconciliation，不按逐 Target 裁决分割一个共同 Run；这不阻止无分叉的 cohort 历史保存与恢复。

每个 Run participant 固定精确的起始 retentionBaseline（Memory、revision、初学起止与 Relearning 状态）。全量准入按“完整基线与 Policy commitment”依赖重放所有可达分支，不按墙上时钟猜测因果；同 revision 的 Relearning 变化也必须匹配原始完整基线。只有前沿裁决允许的分支进入当前连续投影，缺少裁决的并行分支不得覆盖排程。

该规则只决定已有事实如何贡献当前投影，不通过合并执行新的 Protocol、重新评分或生成新的 Outcome，
也不把同步本身制造成学习事实。服务端只保护 Learning Event 与 Learning Reconciliation Decision 的
追加性；验证和投影重放仍由本机领域层完成。

本地命令、Cloud Checkpoint 和手动备份不得各自实现一套学习完整性规则。它们共用 Learning System
authority：本地提交只读取当前事务改变的 Target、Run、Event、active Run / Study Plan 以及直接依赖，
独立重放新 Event 并核对 Run 与 Memory/Schedule 投影后才允许写入 SQLite；同步和备份则对完整历史执行
全量 replay。Run/Event/Reconciliation 不允许用物理缺行表达删除，Event 只能追加，普通本地命令也不能
直接制造 progress、Completion、Memory 或 due 投影。并发 Reconciliation Decision 只允许由 replica merge
产生，不能伪装成本地学习命令。

当前统一 Checkpoint 格式为 7，完整 replica 准入版本为 7；不维护旧格式转换。缓存缺失的 Structured Run 仍保留明确受限的冻结材料准入，不宣称已完整执行其外部 runtime replay；这类分支若需 reconciliation 则停止，待精确资源恢复后核验。
