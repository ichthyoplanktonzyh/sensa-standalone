# 原生 Runtime scope 与自由练习交付记录

2026-09-09。延续 owner 确认的 Web 行为，按整组完成 Runtime scope 与自由练习；四阶段正式 UI
仍按既有决定暂停。本轮合同见 [范围计划](native-runtime-scope-plan.md)。

## 源码与规则

- `apps/web/src/experience/learningRuntime/retentionScopes.ts`：Registry、独立目标的四项准入、
  显式选择、一级 prerequisite 与稳定身份。Rust 对真实 TS 实现做 11 组差分，含中文/标点编码和
  版本变化。TS 对不完整 admission 的运行时检查有宽松缺口；Rust 按领域合同要求四项全部存在且为真。
- `practiceScope.ts` / `usePracticeScope.ts`：当前学习/个人语义世界两个来源；个人目标来自已接受的
  Alignment + Binding，无需入学。选择去重，过滤失效目标；全部失效时持久回退 current_study。
  Web 当前学习默认仍取演示数据；原生读取真实 Curriculum scope，绝不将演示词表写入用户库。
- `practiceInventory.ts`、`components/YouGlishListeningScreen.tsx`、`useYouglishWidget.ts`：
  已交付执行活动仅有真实语流泛化。说、读、写三个 Activity 是未来能力声明，不伪造执行器或完成状态。
  老的 `RealWorldListeningScreen.tsx` 演示片段不作为真实声音来源。

## 实现与事实边界

`crates/sensa-core/src/retention_scopes.rs` 迁移准入和解析，现有 composition 入口验证已注册 Scope。
当前 Web 与原生均只有默认 semantic_connection 正式 Scope；不会为普通题型创建独立调度目标。
新 Registry 的稳定 ID 工具不替换已有 SQLite Target UUID，也不更改旧 Memory、Run 或回执。
新增真正的独立 Scope 仍须注册完整能力、资源和执行器；仅通过 Registry 不代表新产品能力已交付。

SQLite v13 增加独立 practice selection/session/turn/operation 账本。Practice Command 不经过正式
Activity 的刷新、每日 Introduction、证据/Outcome、签到、FSRS 或结算入口。命令校验库身份、
practice revision、操作幂等与 Turn ordinal；选择修复仅写 practice_state。Session 固定 Brief、
Scope、Profile/Activity/Inventory 版本与 provider；原范围移除、课程变化均不能重绑进行中的 Session。
Context、Sense/Binding 版本与可用的接受、原文、来源信息保留在 Scope 快照；不会推导缺失的历史身份。

Flutter 从独立 repository/model 调用这条事务链。练习记录和范围本地可用；媒体能力依赖 YouGlish。
Widget 成功返回结果后才创建 Session；错误/空结果不伪造练习完成或播放。支持表达、口音、倍速、
上一段/下一段、重听、播放/暂停、字幕、错误重试、保存退出、继续与明确结束。播放状态取 provider
回调，按钮意图不等于真实播放证据。滚动保留 WebView；退出/后台暂停，切换表达或口音隔离旧回调。

YouGlish 是 form-level 来源，UI 明示可能包含其他 Sense。已知英语同形异音词保守排除，规则版本
随快照保留；这份有限排除表不是完整发音词典，也不能声称其余片段已做发音/词义审核。完整的
Pronunciation Variant 约束仍需未来 occurrence 级资源能力，不能用任意检索结果代替。

原生依赖固定 `flutter_inappwebview 6.2.0-beta.3`，因为稳定版 6.1.5 的 Android 插件使用已被 AGP 9
移除的 ProGuard 默认文件。采用上游修复，不修改 pub cache 或降级整个 Android 工具链。
依据：[上游问题](https://github.com/pichillilorenzo/flutter_inappwebview/issues/2852)、
[上游构建配置](https://github.com/pichillilorenzo/flutter_inappwebview/blob/master/flutter_inappwebview_android/android/build.gradle)。
该 beta 的 macOS SPM 最低版本声明与认证协议实现冲突，实际编译失败。项目级暂用 CocoaPods，
沿用现有 macOS 10.15 部署目标；不修改全局 Flutter 设置。此兼容项在上游修复后复查，采用
[Flutter 官方项目级配置](https://flutter.dev/blog/saying-goodbye-to-cocoapods-swift-package-manager-is-soon-the-default-in-flutter)。
正式发布前仍须复核该依赖稳定版与所有目标平台；本轮不代表 iOS/Windows/Linux 商店验收。

## 验收记录

- `scripts/sensaNativeRetentionScopeParity.mts`：真实 TS/Rust 11 组差分，加不完整 admission 严格拒绝。
- `crates/sensa-library/tests/practice.rs`：个人未入学、选择去重/失效回退、固定 Session、跨库与乱序
  拒绝、操作重放、同形异音阻塞。正式 Activity 运行期间，练习全过程前后比较所有非 practice 表，
  逐表逐行不变；v12 升级保留全部原表和回执。高保证 Mastery 声明前后练习范围保持一致，
  不因正式学习掌握状态阻断自由练习。
- `integration_test/practice_test.dart` 使用独立合成库及真实平台 WebView，fixture 在 WebView 中
  提供确定性回调，不访问网络、不冒充 YouTube 实际播放。验证失败无 Session、播放控制、口音/倍速、
  固定 Session、保存/结束、进程恢复及完整正式 snapshot 不变。另有 opt-in 真实 provider 探测。

- 最终 Android `group13android-final` 主流程 46 秒、冷启动 30 秒通过；airplane_mode=1、wifi=0。
  最终 macOS `group13mac-final` 主流程 36 秒、冷启动 22 秒通过。个人范围选择通过实际下拉框与
  Checkbox 完成。测试 fixture 只在合成库入口注入；正式入口固定使用真实 provider。
- workspace Rust 全功能测试、定向 practice/Mastery 回归、clippy（all targets/features、warnings denied）、
  bridge locked check、Dart analyze、根级 `npm run typecheck/build/lint` 通过。旧 v1–v12 升级回归保留；
  历史模拟降级 fixture 同步移除 v13 practice 表，不删改既有事实。失败的初始构建和调试运行不算通过证据。

- macOS opt-in 真实 YouGlish：合成表达 tactful 返回 197 段结果，收到 `playing=true` 与连续更新的
  字幕/视频来源；保存退出后完整正式 snapshot 不变。该运行 57 秒通过，见 `live.log`。此证据是
  当前 macOS 网络下的真实播放，不代表所有地区/平台的 provider 永久可用；Android 本轮为离线 fixture 验收。
- 最终日志：`mac-final2.log`、`mac-cold-final.log`、`android-final.log`、`android-cold.log`、
  `live.log`、`parity.log`、`tests.log`、`mastery.log`、`all-rust-final.log`、`clippy-final.log`、
  `bridge.log`、`analyze-final.log`、`typecheck.log`、`build.log`、`lint.log`。
  均位于 `/tmp/sensa-practice-*`，不入 Git。

本轮没有迁移 owner 数据、双写学习历史、上传、推送、部署或调用付费 LLM/TTS。Debug 测试使用
独立 bundle 和合成库，交付时恢复 override，owner 已运行的 Release 应用保持原样。

第 1 组既有 Runtime 规则与自由练习迁移收口；第 2 组已在上一轮完成。后续还有第 3 组个人语义世界、
第 4 组资源/provider 协作、第 5 组采集交接、第 6 组正式原生产品界面。建议下一组推进个人语义世界。
完整原生迁移、Web 本地执行、备份/E2EE 同步及 M3 仍未完成。
