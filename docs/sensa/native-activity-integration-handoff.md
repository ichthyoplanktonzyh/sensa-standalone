# 原生学习活动、每日组织与签到迁移

日期：2026-09-09。属于 LF-1b 增量；完整产品迁移与 M3 仍保留。

## 原实现与本轮边界

参考现有 `apps/api/src/sensa/runtime/initial.ts` / `retention.ts` 的 Mixed、Review-only、运行优先级和目标集合汇总，
`apps/api/src/sensa/activity/checkin.ts` 与 Web replica 的独立签到命令，以及 `apps/web/src/experience/planning/dailyInitialPlanner.ts`。
领域裁决依据是 `learning-runtime-model.md` 的 Study Scope、每日 Introduction、正式 Activity 与 CheckIn 边界。
Flutter 沿用已确认首页开始、运行、暂停/恢复、总结与日历体验，适配本机库；不引入在线账号前置。

## 本地实现

- schema v7：Activity 固定启动时的已入学 Target/Material 范围；空范围同样固定。
  Mixed 和 Review-only 各自可恢复，只有一个前台 Activity。模式切换暂停执行器，保留已有 Run/队列。
- Planner 优先继续已有工作，再安排 ready Relearning、due Review 和额度内新目标；waiting 只能显式提前进入。
  Review-only 不选择或推进 initial-learning。高保证复用现有已固定策略、材料、评价与队列，不新增独立判题实现。
- 每日 Introduction 账本与 Run 预留分开。轻量 Reveal、高保证 instruction Continue 经本地权威接受后才记录 Introduction；
  Run 创建只预留准入名额，展示“已引入”不把预留算作已学。跨日按本机发生时间/偏移计算，重试返回原回执。
  旧版 Run 准入事实标明 `legacy_run_admission_v6`；不伪造旧版 Introduction action，也不改写旧学习历史。
- 活动只收集本命令新提交、属于所连接执行器的 completion。同一结果只归属一次活动；Initial/Review/Restored 分类别存 Target 集合，
  总数取并集。离开 Activity 走材料入口的结果不在恢复时倒灌旧总结。
- CheckIn 是单独事务：手动签到，或 Flutter 实际显示正式学习界面后，引用活动/执行器/进入操作签到。
  按本机日期去重、保留第一来源；不生成 Evidence、Completion 或 schedule。失败提示及重试独立于学习命令。
- 首页显示当日数量和待办；活动显示结束/暂停/无可执行任务/等待状态；日历展示最近 366 个有签到的日期，学习记录展示最近 30 次活动。
  底层记录不删除；更长历史的分页/检索留在完整产品界面迁移中。
- 首页进入刷新时钟投影；冷启动跨日刷新当日信息，同日读取维持已提交快照。数据全部在 Rust/SQLite，本地学习无需 Hono。

## 验证

核心回归覆盖固定空范围、混合/只复习恢复、非法 next 回滚、签到第一来源与跨日重放、复习/修复去重、
Introduction 预留/接受/跨日、材料入口结果隔离；高保证真实任务测试同时验证四目标首学、复习及修复的活动归属。

验收结果：

| 验收 | 结果 |
| --- | --- |
| Rust library 34 项集成回归（含 5 项活动/额度/隔离测试） | 通过 |
| 高保证四目标真实任务、首学/复习/修复与活动集合汇总 | 通过；额外 readiness 准入收紧后再跑通过 |
| macOS 日常活动与独立进程恢复 | 通过，`mac-activity-03` |
| Android 日常活动与独立进程恢复 | 通过，`android-activity-02`；飞行模式 |
| macOS 高保证活动入口、暂停恢复、提示/作答/音频/总结与独立进程恢复 | 通过，`mac-activity-high-01` |
| Android 高保证同链路与独立进程恢复 | 通过，`android-activity-high-01`；飞行模式 |
| Flutter analyze、Rust workspace Clippy（all targets/features，warnings as errors） | 通过 |
| 根级 npm run typecheck / build / lint | 通过 |

平台测试沿用真实 Rust FFI、SQLite 和独立验收库；未调用付费 LLM/TTS、未运行 Hono、未迁移 Owner 数据。
冷启动重新启动测试进程并比较已保存完整快照；不是只在同一 ViewModel 中重新读取。
Android 使用 `--no-uninstall` 保留库，避免测试工具卸载应用擦除验收数据。

复现日常活动：在 `apps/sensa_native` 下运行 `flutter test integration_test/activity_test.dart -d <device> --no-uninstall --dart-define=SENSA_NATIVE_RUN=<fresh-run>`；
同名 run 追加 `--dart-define=SENSA_NATIVE_RECOVERY=true` 验证恢复。
高保证沿用 `assurance_learning_test.dart`，追加 `--dart-define=SENSA_NATIVE_ACTIVITY=true`，并按上一轮交付记录将本地验收 artifact 放入独立 run 的应用沙盒。
本轮高保证平台新增证据覆盖首学活动；高保证复习/修复活动的新归属由真实 Rust 任务回归验证，已有复习 UI 平台证据仍见上一轮交付记录。

## 仍未完成的迁移范围

本轮没有迁移完整 Curriculum lifecycle/Book Range 与来源选择、Policy Migration、个人语义世界/快慢轨、在线 LLM 任务、
浏览器/Agent 到本地库的交接、完整原生 IA、备份/同步与发布。四阶段继续只保留内核扩展性验证。
不能把这条活动纵切称为完整 Web 功能迁移或 M3 完成。
