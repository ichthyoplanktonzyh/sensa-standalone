# 原生 Protocol 进度账本与恢复

日期：2026-09-08。LF-1b 增量。沿用已确认的轻量首学、复习、再学习体验；本轮没有开放新的学习模式。

## 本轮结果

通用 Progression Kernel 已有真实 SQLite 消费者。原生三 purpose 的 Run 创建时固定协议定义、
Progression Policy、评价合同版本、计划引用和材料摘要。每次作答仍由 Rust 校验当前 Action，
再生成非证据性 Observation，调用固定的 Progression Policy，并将不可变 Decision 与状态一起写入。
只有推进结果与 consumer 完成语义一致时才允许提交已有 Completion/Outcome/调度事务。

Flutter 继续提交原始操作，不接受 UI 传入的 Observation、Decision、Checkpoint credit 或调度结果。
轻量协议保持零 Checkpoint，不为接入通用账本添加空 Gate。现有 FSRS 规则不变。

## 源码依据与实现边界

对照 `apps/web/src/experience/learningRuntime/lightweightInitialProtocol.ts` 的
Attempt → Observation → decide/apply、完成结果一致性检查；并对照
`interleavedFourStageProtocol.ts` 的失败重置、repair feedback 与 reassessment 分离。
已有 `protocolProgression.ts` 的 Rust 差分继续运行。

`crates/sensa-library/src/progress.rs` 是依赖事务的通用存储接口：

- 固定 `Pin`，相同 Run 的不同定义/版本/材料/计划拒绝覆盖。
- 只接收可信 Rust evaluator 产出的 Observation 和版本化 Policy 行为，Effects 由 Kernel 决策。
- 记录 Observation、Decision、时间、来源与连续修订号；同身份同事实重放不重复写入，不同事实冲突。
- 从保存的 Decision 重建 progress epoch、credit、repair、reassessment、completion 与已应用决策，
  与缓存状态逐项核对；不使用当前 evaluator 重新评分旧行为。
- 新动作检查修订号；重复操作先于 revision/completed 检查，可在重启和完成后安全重试。

`consumer_progress.rs` 是当前实际 consumer 的评价及存储接入点。非完成动作形成 practice_completed，
完成动作形成 protocol_completed；这只是当前版本的诚实协议完成语义，没有声称产生独立学习 Evidence。
通用存储不按 Profile 名称分支。多 Checkpoint 用例在独立合成 Journal 上验证，尚未开放四阶段 Flutter renderer。
原生操作账本仍是外层命令权威；Journal 要求调用方传播错误并回滚外层事务，不能捕获写入失败后继续提交。

## SQLite v5 与旧库

新增 protocol_journals、protocol_transitions、consumer_progress_links。
已支持的 v1–v4 原生库在同一迁移事务中补建账本：引用真实原 Attempt 身份和时间，
按旧 consumer 合同验证动作与 next_phase，再生成标记 `legacy_attempt_v4` 的派生 Observation/Decision。
原 Attempt、Run、Completion、Outcome、Memory、operation receipt、Policy commitment 及库修订不改写。

恢复通过重放全部已存 Decision 核对缓存；当前实现成本随本 Run 的历史长度增长。
后续高频/长期多阶段 Runtime 可加入有版本的快照索引，但不能省略历史验证或改变重放语义。
本轮不是 Web/API 数据导入，也不是同步。

## 验收依据

`progress_journal.rs` 使用磁盘库，每次交互都重新打开连接：

- 两个 Checkpoint 的 credit → 整轮 reset → repair → reassessment → 同 epoch 完成，历史全部保留。
- 完成后重放、不可变身份冲突、跨 Run 身份、旧修订、策略版本与 Pin 冲突拒绝。
- 保存状态与历史不一致时拒绝恢复。
- 在 progress UPDATE 注入故障，验证 Attempt/Observation/Decision/Completion/Memory 全部随外层事务回滚；原操作可重试一次成功。
- v4 升级保留全部旧投影及策略身份，补建 Observation 确实引用旧 Attempt；遇到非法旧 transition 时，新增 schema 和回填一并回滚。

既有 v1/v2/v3 升级、三 purpose、并发操作/调度回滚回归继续运行；新增元数据单独断言。
平台验收（均使用隔离合成库）：

| 平台 | 首学/策略固定与独立恢复 | 旧库复习/再学习与独立恢复 |
| --- | --- | --- |
| macOS | `journal-mac-0908a`，两次 +1 通过 | `journal-retention-mac-0908a`，两次 +1 通过 |
| Android API 36 arm64，飞行模式=1 | `journal-android-0908a`，两次 +1 通过 | `journal-retention-android-0908a`，两次 +1 通过 |

Android 全部使用 `--no-uninstall`，跨进程比较完整 Snapshot，验收后停止模拟器。
再学习测试额外断言持久化 progress 的 Run 身份、修订/尝试数量与完成状态；已有等待、提前、
原评分及 schedule 不变断言继续保留。不是四阶段 UI 已验收的证据。

根级 `npm run typecheck`、`npm run build`、`npm run lint` 通过。
`sensa:native-core-smoke`（7,297 + 1,490 + 651 个源对照与 workspace tests）、
原生桥 `cargo check --locked`、Clippy `-D warnings` 通过；新增存储/故障测试全部通过。
Flutter analyze 无问题，macOS release 构建通过（55.1 MB）。保留已有 SPM / objective_c framework 命名警告；本轮不声称其他平台或性能验收。
没有调用付费模型/TTS，没有迁移 owner Web/API 数据、推送或部署。

## 后续

通用账本不是完整 Runtime 编排已迁移。下一条接入已有多阶段模式的 Action/材料绑定、
评价与 repair/reassessment 编排，再由 Flutter 消费可恢复状态。Scope 准入、正式 Activity/Mixed、
完整材料与媒体、完整界面等仍依迁移清单推进。
