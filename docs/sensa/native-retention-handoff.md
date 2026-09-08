# 原生到期复习与再学习纵切

2026-09-08。延续 owner 已确认的 Web 复习/再学习体验与完整迁移范围，主代理直接实现，无委派。
本轮接入有界轻量文本材料的本地复习事务及 Flutter 状态，不代表全部学习 Runtime 或正式产品 UI 已迁移。

## 实施合同

依据 `learning-connection-model.md` 的 Review/Outcome/Relearning 不变量、
`m1-d-retention-handoff.md` 及实际 `apps/api/src/sensa/runtime/retention.ts`，
使用已通过 TS 差分的 `sensa-core/settlement.rs`，不重新实现调度算法。

- `next_retention` 对应“只复习”：先恢复已有复习，再选择可进行的再学习/到期项；只有等待项时展示等待。
  不恢复未完成首学，不消耗每日新学额度。选择其他材料时暂停已有 Run。
- `start_retention {early}` 针对当前目标；只允许在已完成首学后进入到期复习。early 仅放宽再学习等待，不允许提前评分未到期 Review。
- Reveal 后的 again/hard/good 形成原始自报 Memory Outcome，与 Completion、SchedulingDecision、Memory revision、Need 及 operation receipt 同事务提交。
- again 建立 10 分钟后的 Need。等待中不可提交答案；须到时继续或主动提前，恢复同一个再学习 Run。
  再次 again 从这次回答时刻重排 10 分钟。完成再学习不产生新的 FSRS 调度，也不修改原 Review 评分。
- Query 不修改进度、等待时间或库 revision。时间来自 Rust 主机依赖；Flutter 没有生产时钟覆盖入口。
- 所有操作沿用库身份隔离、expected revision、operation payload 一致性、幂等 receipt 和时钟回退拒绝。
  重试返回原 receipt 后，Flutter 再读最新 Projection。

## 持久化与接口

SQLite v3 是 v1/v2 的增量迁移，保留首学表、原身份和 receipt。
新的 `retention_runs` 固定 purpose protocol、材料内容/digest 与原材料来源、due revision/时间；
`retention_attempts`、`retention_completions`、`memory_outcomes`、`scheduling_decisions`、
`relearning_needs` 分别记录事实。唯一约束防止同一 due 重复评分、Outcome 重复调度及同目标多个 active retention run。
入口还要求已有首学 Completion，因此不能与未完成首学并存。既有首学记录不能被改个 protocol 名就获得复习权限。

此增量选择隔离旧首学账本，避免为本轮重建它及引用外键；是有界 consumer adapter，
通用 Protocol registry / Progression 迁移仍需统一抽象，不能将两套表扩展成按每种学习模式复制存储。

Snapshot 保留原字段含义：completionCount/handoffCount 仍为首学数量；新增 retention 的累计复习次数、
累计再学习完成次数、待恢复目标数及当前目标 nextEligibleAtMs。RunView 新增 protocolVersion，
旧 receipt 默认 initial，旧快照新增字段默认空值。不把累计数量伪装成本次 Activity 的去重汇总。

Flutter 的等待、结束、切换、提前、恢复、完成与错误重读通过现有 Repository/ViewModel 分层调用 Rust。
错误与重试/重读操作固定在页面底部，避免新增入口后错误落到长页面下方而不可见。
只复习无到期项是正常空状态。当前仍是本地验收壳，正式 Mixed Activity、去重汇总/归属、统一每日计划和完整 UI 待后续迁移。

## 验收

- Rust `tests/retention.rs`：到期前拒绝（含 early）、原评分保留、10 分钟/4 分钟、主动提前、再次等待、到时同 Run 恢复、重学不调度、下次到期独立评分；故障全回滚及并发幂等；只复习与首学隔离、暂停恢复、purpose 材料固定。
- 旧首学/导入回归继续运行，v1 升级测试还原真正 v1 结构后验证所有旧事实不变。
- Flutter `integration_test/retention_test.dart` 使用单独合成库。测试 fixture 由 `crates/sensa-library/examples/retention_fixture.rs` 经公开命令创建（2020 首学，已到期），gzip/base64 仅存在 integration_test，不进入产品资源。
  不修改 owner 数据，不注入生产时钟，不调用模型或 TTS。

实际平台结果：

| 环境 | 场景 | 结果 |
| --- | --- | --- |
| macOS | `macos-retention-20260908-c` 首次运行，复习/暂停/等待/提前/再次等待 | +1，exit 0 |
| macOS | 同名 `SENSA_NATIVE_RECOVERY=true` 独立启动，完整快照一致、同 Run 恢复、完成不改调度 | +1，exit 0 |
| Android API 36，emulator-5554，飞行模式=1 | `android-retention-20260908-b` 首次运行（最终界面） | +1，exit 0 |
| Android，同名且两次均 `--no-uninstall` | 独立启动恢复与完成 | +1，exit 0 |

Android 测试后停止模拟器，保留隔离测试数据。macOS 初次 a 测试未滚动到惰性列表下方错误提示而失败；
b 补上定位后通过。旧导入回归随后确认这也是可见性问题，因此将错误操作固定到页面底部，
最终另用新库重跑受影响的 UI；未删除状态断言或修改等待规则。

`npm run sensa:native-core-smoke` 通过 7297 个精确 TS/Rust 对照及既有存储回归；
最终 `cargo test -p sensa-library --features acceptance-fixture` 通过 4 首学 + 4 导入 + 4 复习测试。
Clippy workspace/all-targets/locked/-D warnings、Flutter analyze、根级 typecheck/build/lint 通过。
macOS 旧导入/多目标首学回归 `macos-pack-retention-20260908-b` +1 exit 0。
`flutter build macos --release` 成功（52.7 MB）。保留已有 SPM 和 objective_c framework 命名警告，
不据此宣称 iOS/Windows/Linux 验收或完整性能达标。


## 后续

通用策略组合、Progression Kernel、完整角色材料/媒体、正式 Activity/Mixed 计划及汇总、个人语义世界/采集、在线任务、备份与 E2EE 同步继续按迁移清单推进。
