# M2-B：固定候选与直接语义接受

> 2026-09-08；本地纵切，前序 checkpoint `80b4aab1`。

真实插件选区自动请求句中解释，附近浮层呈现候选；“加入 Sensa”原位确认、
“保存待处理”独立保留 Inbox。Web 可从 Inbox 查看解释并接受，已确认意义与待处理分开。
两端引用固定 lookup/revision，经相同 Sync v3 authority 写入，不自动加入学习。

0017 保存短期 lookup、Meaning、Context/Expression Anchor identity、Alignment/Acceptance、
原 Session/installation/operation。稳定 Sense/Version/Expression/Binding 复用 0008 registry，
全部为 learner_confirmed，未冒充 reviewed 或 published。相同规范 semantic spec + typed expression
复用稳定身份；不同来源保留不同个人 Context。完整事务失败不留下半个意义或公开 registry。

模型调用在 DB 事务外，adapter 无 SQL/进度权限。输入固定，单次 35 秒，迟到结果 45 秒后
拒绝；每账号滚动 24 小时最多 30 个新请求。同 id 原载荷检查不重新调用模型，变更拒绝。
ready 候选 24 小时内可接受；未确认的过期预览在该账号后续 lookup 时清除全文，保留防重放摘要。
未保存 lookup 不进入个人库存。模型歧义或失败保留 Inbox，不伪造 Focus/Acceptance。

## 验证

- 全新隔离 PostgreSQL `sensa_m1a_m2_b`，0001–0017 事务迁移、确定性 fixture。
- Node 全部 M1 A–E + Intake + Semantic；Deno Intake/Semantic + 基础目标回归、Edge check。
  覆盖候选不建库存、固定 id、非法 occurrence、原子回滚、重复接受、稳定身份复用、
  不同 Anchor、未闭合拒绝、跨账号拒绝，以及不创建 Curriculum/Run/签到。
- 实际 MV3 扩展/Chromium：Web 授权与 PKCE、选区捕获、Inbox→Web 接受、原位快轨接受、
  同账号 Meaning 深链、另一 occurrence 离线保存→重启恢复。fixture 采用无成本 Semantic adapter。
- 截图 `/tmp/sensa-m2-meaning.png` 已视觉检查。环境沿用 A，Chrome for Testing 149。
- 根级 typecheck、合成认证 production build、lint 通过。

## 尚待完成

这条切片交付固定候选的直接接受。Web 中针对歧义的进一步澄清/重新解释、误收移除、
完整权限撤销/更新矩阵仍须随后完善；本轮不把这些边界写成完成。
真实 DeepSeek 语义质量、延迟和隐私抽查尚未执行；API 仅在显式配置
`SENSA_SEMANTIC_PROVIDER=deepseek` 后读取服务端 DEEPSEEK_API_KEY。
本轮没有新增付费调用，schema 与 mock 不能证明真实语义质量。

M2-C 接显式入学、durable Content Task/Attempt、独立验证与冻结材料。M2-D 和 M4 继续
activeTab 原生授权、跨站/版本兼容、真实托管及商店分发。CSS/离线壳/快照上限缺口沿用 A。
