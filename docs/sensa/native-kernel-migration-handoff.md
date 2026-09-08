# 原生学习内核迁移：协议、结算与可配置调度

日期：2026-09-08。LF-1b 的内核基础增量，非完整学习包/复习产品交付。

## 本轮结果与职责

原 Rust 验收实现仅有首学 Recall/Reveal 和固定两天初始化。现在将 Sensa 自有 TS 规则迁入三个无 IO 模块：

- `crates/sensa-core/src/protocol.rs`：固定版本的 consumer 初学、复习、重学推进。未知版本明确拒绝，不能默认为轻量协议。
- `crates/sensa-core/src/settlement.rs`：purpose 专属结果资格。初学完成产生非证据性 Completion 与首次调度；一次有效 due 复习产生 learner_rated/self_report 结果与更新；again 安排十分钟后重学；重学成功仅完成，不再次评价原复习或初始化 FSRS。
- `crates/sensa-core/src/scheduling.rs`：可配置 FSRS-6，支持四档评分、目标保留率、学习/重学步长、最大间隔、确定性 fuzz、跨 UTC 日计算、持久状态检查及有序历史重建。`cardId` 仅保留既有调度输入形状，不新增 Cards 产品身份。

协议推进不直接访问调度或数据库；结算决定资格；调度接收显式 Memory/config/time；SQLite 应用层仍拥有操作幂等、版本、材料检查和原子提交。`initial_schedule` 保留兼容入口，已改用同一调度实现，不再维护第二份初始化公式。

现有 `sensa-library` 首学事务已消费 `StudyCompletion` 决策。它仍只允许 initial Run，新增纯核心 Review 支持不会让 schema v1 错把 Review 当作首次 Handoff。新增存储边界回归模拟协议被更换，验证拒绝且无新事实。

## 一致性与验收

`npm run sensa:native-core-smoke` 现在同时运行：

1. 原六个固定 TS 首学向量，检查 TS 基线未被无意改动。
2. `scripts/sensaNativeSchedulingParity.mts`：调用当前 TS 源码计算预期，再将同一输入发送给独立 Rust example。7,297 组精确字段对照通过，只有时间字符串统一到毫秒格式，没有放宽数值误差。覆盖五组设置、两种跨日/闰年起点、连续历史及所有四档评分、三个 purpose、非法版本/步骤、陈旧 due/目标错误、提前评价和历史重建。
3. Rust 边界检查和 SQLite 集成：非法/损坏记忆、时间倒退、计数溢出、重复/并发操作、跨库隔离、材料损坏、未知 schema、注入 Handoff 故障整体回滚与重开恢复。

根级 `npm run typecheck`、`npm run build`、`npm run lint` 通过；`cargo clippy --workspace --all-targets --locked --features sensa-library/acceptance-fixture -- -D warnings` 通过。Web build 保留已有大 chunk 提示，不是本轮新增性能验收。

本轮 macOS 真实 Flutter → Rust → SQLite 首学和独立进程恢复均通过（各 `+1`、进程 exit 0）：

```sh
cd apps/sensa_native
flutter test integration_test/local_learning_test.dart -d macos --dart-define=SENSA_NATIVE_RUN=macos-kernel-20260908-e
flutter test integration_test/local_learning_test.dart -d macos --dart-define=SENSA_NATIVE_RUN=macos-kernel-20260908-e --dart-define=SENSA_NATIVE_RECOVERY=true
```

首学仍验证 Recall 隐藏表达、Again 不结算、暂停恢复、一次 Completion/Handoff；恢复对比前一进程保存的完整快照。早先 c 运行未完成，d 运行在调用 CUA 无障碍检查后触发未释放 SemanticsHandle；最终 e 两次运行均不同时操作窗口并通过。Flutter 的 `open returned 1` 前置提示仍出现，但未阻止最终测试执行；不据此宣称启动兼容性问题已修复。已有 bridge 的 Swift Package Manager 提示也未处理。

Android 本轮未重跑；此前的验收证据仍见 `native-local-learning-handoff.md`。复习/重学的纯决策对照不等于它们的移动端界面验收。

## 保留的迁移工作

本轮支持三种 consumer 协议的纯决策，不声称完成通用策略注册、Progression Kernel、全部 Profile/编排与 renderer。实际文件和对应边界已登记在 `native-migration-checklist.md`；尤其不能将 structured/high-assurance 的 Observation/Evidence/Checkpoint 规则替换为自评轻量流程。

下一用例继续一般学习包校验/导入、版本与多目标、显式入学，以及 Review Run/Memory Outcome/Relearning Need 的 SQLite 事务和正式 Flutter 状态。当前验收应用仍是单合成材料的初学界面；完整 LF-1b 和全量迁移均未完成。

没有更改旧用户数据、没有双写、没有付费模型调用、推送或部署。所有新增测试使用隔离的合成数据。
