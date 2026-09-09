# 个人学习库事实模型与分层验收

2026-09-09，Owner 已确认方向并授权推进。架构决定见 [ADR 0003](../adr/0003-three-client-local-facts.md)。本文是架构施工蓝图；七份领域文档继续裁决身份、合法接受、学习证据和调度资格。本轮没有冻结生产 wire schema、合并评分规则或加密套件。

## 1. 已确定的事实边界

Learner 是离线可存在的事实所有者；个人学习库是资料与历史的逻辑容器；Device/Replica 是其副本。绑定账号不重建 Learner。两个独立创建的库不能仅凭相同邮箱自动合并；加入现有库、显式导入另一库、账号绑定是不同操作。

| 类别 | 内容 | 所有权与变更 |
| --- | --- | --- |
| 固定内容版本 | Context/Occurrence、Sense/Binding Version、Materialization、必要资源/附件 | 修改产生新版本；历史引用仍可解析；附件传输可延后但不能假装可用 |
| 决定与生命周期 | Semantic Acceptance、Alignment 修订、入学/来源、Policy Assignment、移除/恢复、授权/撤销 | 保存来源与因果依据；不通过更新页面字段伪造领域决定 |
| 学习历史与结算 | Run pins、Attempt、Observation、Evidence、Transition、Completion、Handoff、Memory Outcome、Scheduling Decision | 保存当时固定规则和审计依据；新算法不覆盖旧评价 |
| 当前投影 | 当前 Alignment、有效成员、计划/readiness、Checkpoint/FSRS 状态、统计 | 从有效事实解析；允许缓存与带依据的快照，不独立同步覆盖成为权威 |

派生不等于可以丢弃。一次 Scheduling Decision 是当时结算历史；当前 FSRS 状态是解析历史后的投影。重算当前状态不重新请求 LLM grader，也不悄悄替换历史 Observation。

Personal Meaning 必须引用完整 Context–Expression occurrence–Sense Version/Binding 和有效 Acceptance，Focus 可选；不完整内容留在 Intake。后续语义纠正保留分支与原始来源，不能替换已开始学习的目标/材料。已有公开包直接入学不需要伪造个人经历。

Retention Target 按领域模型采用 learner × stable Sense × stable target Binding，只有显式独立 retention scope 才扩展身份。设备、入口、内容版本、题型、普通 Profile 变更都不是新调度身份。不同表达或尚未证明等价的 Sense 不按字符串/模型相似度自动合并。

## 2. 共同记录的最低要求（生产形状待用例细化）

每条记录需要库/对象/事实身份、来源设备、逻辑操作及输出身份、因果父引用、对象版本引用、记录合同版本、相关 Profile/Protocol/evaluator/scheduler 版本、必要发生时间/时区/计时依据，以及内容摘要/附件引用。事实 ID 在重传时稳定；同 ID 不同内容必须隔离，不能任选一个。逻辑操作输出身份还需防止同一次行为被换 ID 重复导入。

因果引用说明“基于什么状态”，不能用本机 revision、服务器到达序号或设备钟替代。时间仍参与记忆间隔计算，但不单独裁决版本胜负。未知合同、缺失依赖、内容不匹配、跨库引用都不能进入可执行投影；可恢复缺失与损坏/身份冲突必须可区分。父引用和语义资源引用必须闭合，处理原子领域事实组时不能只导入一半 Acceptance/Completion。

生产导入要验证库与设备授权、来源权限、事实结构、依赖、不可变版本和领域不变量，再原子保存事实及投影。传输服务不替用户接受意义、结算学习或重新执行生成。仅加密传输不等于事实已经合法。

局部快照可用于启动加速，但必须固定覆盖的事实集合、投影/算法版本，缺失依赖或冲突时不能凭缓存继续错误调度。事实压缩、归档、彻底删除与旧设备回归需另设规则，不能以“永久追加”取消 Data Control。

## 3. 冲突原则

- 独立新增内容保留；相同事实重传只生效一次。
- 并发 Alignment 修订保留分支；解决记录引用已看到的冲突版本。之后又收到未被解决记录观察到的分支，不能默默丢弃它。
- 移除不被普通编辑复活；恢复必须明确知道并处理相应移除。移除个人意义不删除独立学习历史。彻底删除是单独的数据控制用例。
- 普通显示偏好可用简单确定性规则；Preference 不得修改已固定 Run 的 Policy。两端离线首次 Run 各自固定不同 Policy 的冲突仍需专项设计。
- 同一 due 机会的并发评价保留两次行为与本地决定，经 Learning Reconciliation Decision 决定其有效调度贡献；不能把两份候选按接收顺序重复应用。
- 原文撤销在被设备知道后约束后续接纳，不能承诺瞬间阻止尚未收到撤销的离线设备调用模型；迟到结果与历史保留按领域规则处理。

“同一 due”必须有来自共同调度依据的身份；每端随意生成不同 due UUID 或仅按日期分组都不足。具体跨分支机会身份、并发首次 Handoff、不同 grader/Policy、重复 Run 分叉、后继 Review/Relearning、时钟偏差、历史更正和显式裁决冲突是 G1 前必须补齐的向量。尚未选择最低评分/最高评分或其他调度裁决。

设备运行句柄、HTTP 请求、锁、播放位置、下载缓存不作为可跨端续跑的领域事实。生成目标、授权和已接纳材料可以同步，执行租约不能复制后冒充新设备进程。Provider Key 默认设备保管；是否迁移凭据是单独授权与安全设计。

## 4. 现有实现差距

- `crates/sensa-library/src/schema.sql` 的 library revision 是本机 CAS，operations 是本机命令回执；不能用作跨端因果时钟或跨库重放 API。
- 现有目标表依赖 Sense/Binding Version 唯一约束，单设备切片有意固定材料；同步接入前需补齐稳定 Retention Target 与版本 provenance 的关系，保留旧历史，不能直接改唯一键迁移 Owner 数据。
- 当前 Web `data/replica/initialRuntime.ts` 仍要求联网开始学习；outbox 传意图，Hono 结算。完整浏览器领域事务/调度/持久化和本地库身份尚未完成。
- 既有 `packages/contracts/src/sensa/sync.ts` 与 API sync 是旧服务器权威合同，继续作回归依据；不将其重命名为 E2EE 事实同步。
- 原生/TS 已有单端行为、协议与结算差分可复用，但不能代替新跨端因果与冲突证据。

## 5. 开发顺序与验收门

| 阶段 | 执行内容 | 通过才可声称 |
| --- | --- | --- |
| G0：现在 | 固定事实边界；独立模型副本验证去重、乱序、依赖、冲突及重开 | 有早期模型证据，不是生产同步；本轮只完成下述有界子集 |
| G1：原生迁移过程中 | 原生迁移继续以 Anchor Use 为下一用例；先落实身份/固定版本，配套真实 Rust/SQLite 事实导出/导入与事务验收；完成学习分支裁决向量 | 已覆盖用例的本地多副本可解释收敛；不要求等整站 UI 完成 |
| G2：原生主迁移后 | React/TS 本地领域应用层、浏览器数据库/离线资源；同一组事实向量验证 TS/Rust 投影与调度一致 | Web 可脱机执行已验收用例；不同语言不会分歧 |
| G3：端到端 | Web/桌面/移动断网操作与重启，真实 E2EE 同步、断点、密钥恢复/撤销、附件、备份恢复、账号生命周期 | 三端产品及同步链路完成验收 |

模型验证持续伴随每个阶段。实际跨端 UI 验收依赖客户端、事实适配器与传输完成；纯身份/因果规则现在即可验。G0 未覆盖问题继续设计，不因此中断所有原生迁移；依赖未定裁决的能力保持隔离。以上不是把 G0 实验代码直接复制进生产，也不自动宣布 M3 完成或云端开放。

## 6. 本轮可执行模型与证据

入口：`node --import tsx scripts/sensaFactModelSmoke.mts`。实现：`scripts/models/personalLibraryFacts.ts`。无网络、无模型调用、无账号凭据；仅创建随机临时目录内的合成 JSON 副本，运行后清理。

输入假设是已经经过领域合法性验证的事实。模型只实现有界因果/冲突分类；`meaning.accepted` 中用 Alignment 版本标识代表已验证关系，不重新实现完整 Context/Expression/Sense 接受验证。`review.completed` 代表保存下来的本地学习分支，不直接被认作唯一的全局有效 Memory Outcome。

本轮验证：六条事实的 720 种投递排列及每种重复重放；因果父缺失后补齐；未知格式及后继阻塞；同 ID 异内容隔离及后继阻塞；跨库隔离；并发语义修订与明确解决；编辑不复活、明确恢复及未观察移除；同目标/共同 Handoff 两次 Review 被识别为待裁决；错误目标依据拒绝；因果环阻塞；改变设备钟不改变冲突选择。两个合成持久化副本重开、分批交换中断、继续交换后投影一致。

这里的 due 分组只覆盖共同 Handoff 后首个复习机会，不构成完整 Review lineage 算法。身份摘要不是签名；没有校验 Device/Agent 权限。未执行真实 SQLite 合并、FSRS 分支裁决、Rust/TS 差分、真实浏览器/Flutter UI 或加密传输。不得把 720 种排列表述为完整模型/同步已验收。

本轮验证命令：上述 smoke、对两个实验文件的独立 strict TypeScript 检查，以及根级 `npm run typecheck`、`npm run build`、`npm run lint` 均通过。生产客户端、数据库迁移和线上接口未改动；未迁移用户数据、推送或部署。
