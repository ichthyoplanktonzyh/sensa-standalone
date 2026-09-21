---
status: accepted
---

# 并发学习历史的确定性合并

普通内容记录继续使用逐记录三方合并；不能自动合并的普通内容冲突可以要求 learner 选择保留本机或
云端版本。Learning Run、Learning Event 与排程投影不能使用这个选择器，因为覆盖任一端都会丢失
学习历史，把两端 Outcome 依次再次结算又会让同一次到期 Review 对排程贡献两次。

当两个设备从同一已确认基线出发，为同一 Learning Target 分别产生互不重叠且都已完成的 Run 时，
同步执行以下确定性规则：

- 两端原始 Run 与 Learning Event 全部保留，仍是不可改写的 Personal Library Fact；
- 以最后完成 Run 的 `(completedAt, runId)` 全序选择负责当前 Target、Memory 与 Schedule 投影的分支；
- 另一分支标记为 history-only，不再次参与当前投影重放，也不产生第二份 Scheduling contribution；
- 合并结果写入不可改写的 Learning Reconciliation Decision，记录候选、采用和 history-only 的
  Event/Run identity、算法版本与决定时间；
- 只有结构、内容和策略边界一致的已完成分支可以自动合并。共享 Run、未完成 Run、结构变化或无法
  验证的历史继续作为冲突停止，不猜测 learner outcome。

该规则只决定已有事实如何贡献当前投影，不重新执行 Protocol、不重新评分、不重算任一原始 Outcome，
也不把同步本身制造成学习事实。服务端只保护 Learning Event 与 Learning Reconciliation Decision 的
追加性；验证和投影重放仍由本机领域层完成。
