# 本地文本包与多目标首学交付记录

2026-09-08，LF-1b 增量。本轮实现范围以 `native-pack-import-contract.md` 为准；不宣称完整发布包、媒体或复习界面迁移完成。

## 实现结果

- Flutter 系统文件选择 → Rust 整包验证 → SQLite 固定材料和包版本 → 本地内容选择 → 逐目标显式入学 → 首学 → 切换/暂停恢复 → 独立进程重开。
- 新增 `pack.rs` 的有界文本包合同和 schema v2 的增量升级；原初学 Run/Completion/Handoff/Memory 不重写。
- 同一版本不可覆盖、重复导入不重复事实、后一项失败整包回滚；当前一个连接只接受一份材料，不将新材料悄悄替换进已经开始的 Run。
- 新学按当前设备日期/时区偏移检查每日数量，继续既有 Run 不消耗名额。完整统一 Planner、持久计划时区及跨 DST/旅行口径仍待后续迁移。
- 内容选择使用独立可滚动面板，保留当前材料详情和独立入学操作；修复 ListTile 被背景遮挡的点击反馈。
- 新增 `file_selector` 官方 Flutter 插件；macOS 只增加用户所选文件只读权限。读取按流限制 2 MB，不因文件读取中增长而无界分配。文件不上传。

本轮只接受有界 `sensa-local-text-pack-v1`，并非导入任意旧生产数据库或全部已有 Published Package。源格式与未迁移边界已记录，不会通过丢弃音频/可选角色/未知字段来伪装兼容。

## 已验证

- `npm run sensa:native-core-smoke`：7,297 组 TS/Rust 核心对照，以及原 SQLite 回归和四条新增包集成场景，通过。
- 包集成覆盖重复、独立入学、两个目标各自完成、切换保留原 Run/步骤、材料冲突全回滚、未知格式/协议、重复 ID、NFKC 前揭示泄露、v1 形状升级保留完成历史、每日上限与 +08 跨日恢复资格。
- Flutter analyze 无问题；原 `local_learning_test.dart` 在 macOS（`macos-legacy-pack-20260908-a`）重跑 `+1`、exit 0，原合成材料入口仍可完成。
- 根级 `npm run typecheck`、`npm run build`、`npm run lint` 通过；Rust clippy 通过。Web 仍有原有 chunk 大小提示，不是新性能达标证据。
- macOS `pack_import_test.dart`：`macos-pack-20260908-c` 初次流程与独立进程恢复分别 `+1`、exit 0。
- Android API 36 / emulator-5554：`android-pack-20260908-a` 初次流程与独立进程恢复分别 `+1`、exit 0；两次均 `--no-uninstall`，飞行模式开启。首次新增插件构建需要下载依赖，运行流程没有模型或网络依赖。

```sh
cd apps/sensa_native
flutter test integration_test/pack_import_test.dart -d macos --dart-define=SENSA_NATIVE_RUN=macos-pack-20260908-c
flutter test integration_test/pack_import_test.dart -d macos --dart-define=SENSA_NATIVE_RUN=macos-pack-20260908-c --dart-define=SENSA_NATIVE_RECOVERY=true
# Android 的两次对应命令：使用 -v --no-uninstall，设备 emulator-5554，run 名 android-pack-20260908-a。
```

集成测试只注入文件选择结果，Flutter/Rust/SQLite 为真实实现。另已通过 CUA 实际操作 macOS release 构建：系统文件选择器选中仓库合成 JSON → 本地内容从原有 1 项变为 3 项 → 新导入的 tactful/borrow 均显示“尚未加入学习” → 单独选择 borrow 并点击“加入学习”后才出现“开始学习”。使用的是原本的合成验收库，没有读取或迁移 owner 业务资料。

`flutter build macos --release` 通过，产物 52.5 MB；构建保留 objective_c framework 命名提示，不宣称 iOS/Windows/Linux 平台已验收。macOS 首轮遇到 ListTile 背景层断言与滚动后点击未命中，修复组件 Material 层、选择面板与测试滚动等待后通过；未屏蔽断言。Flutter 仍输出既有前置窗口和 bridge Swift Package Manager 提示。

## 下一步

继续迁入原生 Review Run、Memory Outcome、Relearning Need 事务及 Flutter 复习/重学状态；完整角色材料/发布包、媒体、策略注册与其他 Web 特性继续保留在迁移清单。没有迁移 owner 业务数据，没有双写、付费模型调用、推送或部署。
