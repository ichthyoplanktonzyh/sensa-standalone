# 原生文案与国际化补齐

2026-09-09，owner 在原生六组迁移后要求先精简文案、补齐国际化，再推进 Web 本地化。
上一轮正式 UI 的中英文支持存在遗漏；本记录补充验收范围，不把导航接通等同于界面国际化完成。

## 用户行为与边界

- 沿用正式 Web 的简体中文／English，默认简体中文。首次设置每日数量之前和后续设置页均可切换。
- Flutter 使用 `flutter_localizations`、`intl`、ARB 与 `gen-l10n`；导航、学习、采集、图文、练习、模型设置、错误与状态提示统一接入。
- 界面偏好保存在系统应用支持目录的 `interface-preferences.json`，与 SQLite 学习事实分开。写入失败显示错误；重新打开保留已保存语言。无账号要求，不涉及同步。
- 切换语言保留导航、搜索输入和学习事实。用户保存的上下文、表达、词义、学习材料、模型返回内容和自定义服务名保留原文，不按界面语言改写。界面语言也不自动修改学习目标的语言合同。
- 内置 Profile 的显示名由稳定 Profile ID 映射。图文列表／图谱选择使用稳定状态值，不拿翻译后的标签当标识。
- macOS 文件夹选择器接收当前语言的提示；安装错误返回稳定原因，由 Dart 显示本地化文案。

## 文案处理

首页、我的内容、学习和设置页删除重复解释；学习结束、再学习等待、材料保存与模型准备使用简短状态与下一步操作。
不在用户主流程反复讲解结算、去重和内部存储机制。保留原文／图片发送的接收方、授权与撤销后果、在线依赖、失败重试及数据冲突说明。

## 验证记录

- 组件与目录：14 项通过，包括中英四种窗口尺寸（375、390、800、1280）及 1.5 倍文字、首次使用前切换、语言目录与参数齐全、持久化/损坏/写入失败、现有提示即时更新、搜索和学习快照保留、双语连接向导与系统提示参数。
- macOS `l10n-mac-02`、Android `l10n-android-02`：英文正式旅程及各自独立冷进程恢复通过。包含导入取消/错误、显式入学、Again/Good、一次 Completion/Handoff、Focus 为空的语义接纳、所有主入口、设置中英往返及事实不变。语言偏好单独写入各自的隔离验收文件。
- macOS `l10n-high-mac-01`：英文高保证正式材料入口通过，包含辅助/独立检查、即时返回后草稿保留、最终结算与回首页。使用上一组保留的合成本机 artifact，不调用在线模型。
- 正常 macOS main：实际点击切到 English，查看模型设置；完整退出后重启仍为英文首页，日期按英文显示。随后切回简体中文。另修复英文大字体侧栏溢出、模型用途选择框之间缺少间隔的问题。
- 首次英文旅程在文本标签点击 Inbox 时未命中控件；改用实际 ChoiceChip 的中心点击，保留 hit-test 失败门，使用全新库重跑通过。没有关闭断言来放行。
- Dart analyze、根级 typecheck/build/lint 通过。最终整数复数格式与间距调整另经组件测试和正常应用构建/走查验证。
- Android 为模拟器程序验收；Windows/iOS、真实模型、完整无障碍与输入法组合不包含在本轮证据中。CUA 对个别无标签按钮/菜单的 AX 操作需要坐标或键盘补充，不能据此声称所有辅助功能组合已完成验收。

复现（`apps/sensa_native`）：

```sh
flutter pub get
flutter gen-l10n
flutter test test/product_shell_test.dart test/intake_setup_test.dart test/interface_locale_test.dart
flutter test integration_test/product_journey_test.dart -d macos --no-uninstall --dart-define=SENSA_NATIVE_RUN=<new-id>
flutter test integration_test/product_journey_test.dart -d macos --no-uninstall --dart-define=SENSA_NATIVE_RUN=<same-id> --dart-define=SENSA_NATIVE_RECOVERY=true
```

Android 替换设备 ID。高保证沿用既有 artifact 前置，加 `SENSA_FORMAL_UI=true` 与 `SENSA_UI_LANGUAGE=en`。
ARB 是维护入口，生成的 Dart 文件不入 Git。此组没有修改 owner 的 Release 数据库、迁移数据、运行付费调用、推送或部署。临时 Debug 签名与名称在提交前恢复。
