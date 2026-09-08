# M2：Web 澄清与可恢复移除

> 2026-09-08；接续 `4eabe28e`，本地验证。

Web 收件箱允许 learner 在固定原文/occurrence 下补充关注点。新请求引用原 lookup，创建独立
Focus/Construction identity；无关注点的直接解析仍不伪造这些对象。关注点留在私有 lookup/Meaning，
不写公共 Sense。新候选生成后仍须直接接受；原候选标为 superseded，不能被旧界面确认。
请求 id/输入保持幂等；刷新后查询该 Intake 最近的有效解释，不因页面重载自动再次调用模型。
本轮没有实现一般聊天或插件语境编辑，也没有修改已接受的 Sense identity。

未确认 Intake 和已确认 Meaning 均可显式移出个人列表，并在“已移除的内容”恢复。此操作是
可恢复的 membership 变化，不是永久删除；原文仍由原账号保存。revision CAS、操作账本、
bootstrap/feed 和本机 outbox 保证并发、断网、丢失响应可恢复。旧保存/接受/入学请求不能复活
被移除内容。已有学习 Target、准备任务、Runtime 与历史独立保留。

验证：0019 在隔离 Postgres 增量迁移；Node/Deno 的 Semantic + Intake + Provisioning 集成通过，
覆盖私人 Focus、幂等/旧候选拒绝、上下文/账号隔离、移除/恢复版本冲突、事务回滚、旧保存
防复活及 Target 保留。Edge check、根级 typecheck/build/lint 通过。
实际 Chromium 手动文字捕获、歧义补充、刷新复用查询、接受/入学、移除响应丢失与恢复通过。
截图 `/tmp/sensa-m2-clarification.png`、`/tmp/sensa-m2-restored-meaning.png`；恢复页已视觉检查。
常规测试均为无成本 adapter；本轮无额外真实 provider 调用。

剩余：已接受意义的重新对齐/版本迁移与永久删除属于后续明确生命周期；M2 的授权 Anchor、
按需音频、真实质量抽查及完整插件权限/版本/更新/账号矩阵仍继续，不能据此宣布 M2 完成。
