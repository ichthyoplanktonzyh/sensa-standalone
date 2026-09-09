# 正式原生产品界面交付与验收

2026-09-09，本轮已有能力的第 6 组原生产品界面收口。本记录区分正式产品入口、历史迁移测试壳和平台体验。

## 产品入口

`NativeApp` 默认进入正式 `NativeShell`。桌面侧栏和窄屏底部导航连接首页、我的内容、学习、练习、设置。
首次确认每日数量，使用自己的本机库，不需要账号；正式入口不提供载入验收材料。
生产库位于系统应用支持目录下的 `libraries/main.sqlite`；历史 `local-acceptance` 库仅用于回归。
没有迁移 owner 数据，也没有双写。`MigrationApp` 只保留在 integration_test/support 中。
正式 UI 的学习计划、执行、结果、历史和到期信息仍由 Rust 返回；没有 Dart 调度实现。

## 可重复的自动化

在 apps/sensa_native 中执行：

```sh
flutter test test/product_shell_test.dart test/intake_setup_test.dart
flutter test integration_test/product_journey_test.dart -d macos --no-uninstall --dart-define=SENSA_NATIVE_RUN=<unique-run>
flutter test integration_test/product_journey_test.dart -d macos --no-uninstall --dart-define=SENSA_NATIVE_RUN=<same-run> --dart-define=SENSA_NATIVE_RECOVERY=true
```

Android 用 `-d emulator-5554`，飞行模式与保留安装数据分别验证。
macOS 验收使用独立 Debug bundle ID，不触碰 owner 的 Release 应用/资料。
高保证复用 assurance_learning_test，增加 `SENSA_FORMAL_UI=true` 和 `SENSA_NATIVE_ACTIVITY=true`。
artifact、历史到期 fixture 和 recovery 前置沿用 native-assurance-integration-handoff.md；沙盒内文件路径必须受控，不能借关掉沙盒读取 /tmp。

## 当前实际证据

- 组件层：375×812、390×844、800×1024、1280×800 与 1.5 倍文字，4 个正式壳测试通过；导航、搜索保留、入口可达与 Flutter 异常检查。
- 正式基础旅程：macOS ui-product-02、Android ui-product-android-01，首次运行与独立进程冷恢复均通过；Focus 为空仍接纳，入学独立，Completion/Handoff 各一次。
- macOS 正常应用：真实文件选择器导入仓库合成文字包；内容明确入学、回想、揭示、完成，显示本机下次复习。未调用模型/云服务。
- macOS 连接向导：系统选择专用测试目录，生成固定当前库的 Agent 工具；复制工具真实 hello 成功，匹配 libraryId/clientId；随后提交合成收件箱请求并重放，返回同一持久化回执。可执行文件权限 0700，连接配置 0600。

## 最终程序回归记录

以下主流程与 cold 均为独立 Flutter 进程；没有以 Widget 重建替代进程恢复。所有运行均为本轮工作树版本，最终提交覆盖这些文件。日志位于 `/tmp/sensa-ui-*.log`，可用下列 run ID 与上述命令重新执行（主流程需要新 ID）。

| 路径 | macOS run / 主流程 / cold | Android run / 主流程 / cold | 关键断言 |
| --- | --- | --- | --- |
| 正式导航与轻量首学 | ui-product-full-03 / 通过 / 通过 | ui-product-full-android-01 / 通过 / 通过 | 导入取消/错误无写入；明确入学；Again 不结算、Good 仅一次；Focus 空仍接纳；语义保存不自动入学；来源、历史、设置和练习退出 |
| 高保证 Activity 首学 | ui-high-02 / 通过 / 通过 | ui-high-android-01 / 通过 / 通过 | 正式设置选择高保证 Profile；辅助回想、独立检验、暂停恢复与一次 Handoff |
| 高保证 Review-only | ui-review-01 / 通过 / 通过 | ui-review-android-01 / 通过 / 通过 | 历史到期 fixture；正式只复习入口；失败后修复/重测不重复改写评分 |
| 正式材料入口的轻量复习/再学习 | ui-retention-mac-01 / 通过 / 通过 | ui-retention-android-01 / 通过 / 通过 | 暂停不换 Run；等待阻止过早执行；显式提前回想；再学习保持原复习时间与评分 |
| 采集预览与准入 | ui-intake-mac-01 / 通过 / 未重跑 | ui-intake-android-01 / 通过 / 未重跑 | 正式主题下错误库、取消、直接接受、重复无双写；历史 cold 证据保留在原采集组 |
| 来源、模型与资源 | ui-resources-mac-02 / 通过 / 通过 | ui-resources-android-02 / 通过 / 通过 | 本机合成 HTTP；独立拒绝/修正、五份可选资源、静态 MP3、授权撤回后旧 Run 不受破坏 |

资源首次重跑缺少 4326 静态音频 fixture，出现 pronunciation 为空；补齐服务后用新库完整重跑通过。它是验收前置遗漏，不是通过关闭音频断言来放行。
组件的四种窗口/大字体/系统返回测试通过；根级 typecheck/build/lint 和测试目录工具 smoke 通过。真实邮件、真实 LLM、商店/公证和 Windows/iOS 未验证，不计为本表通过。

单项高保证正式入口额外使用 `ui-high-single-mac-01` / `ui-high-single-android-01`，双平台通过：输入后不等 300 ms 自动保存便返回，重新进入仍保留回答；完成后返回真正的首页。没有在 UI 中补算学习结果。

## 追加的回归入口

`product_retention_test.dart` 使用历史毕业 fixture，随后全部通过正式材料入口执行到期复习、暂停、等待、明确提前回想和独立进程恢复；这不把 fixture 毕业记为 UI 证据。
资源页面的边界回归仍由 `resource_group_test.dart` 承担，与正式导航测试互补：

```sh
# 仓库根目录，保持运行；仅本机合成 OpenAI-compatible 响应
node --import tsx scripts/sensaNativeAgentSmoke.mts --serve
# 另一个终端；返回静态验收音频，不调用 TTS
node --import tsx scripts/sensaNativePronunciationSmoke.mts --serve-only
# Android 仅定向接通本机 fixture；无需打开 Wi-Fi
adb -s emulator-5554 reverse tcp:4331 tcp:4331
adb -s emulator-5554 reverse tcp:4326 tcp:4326
# apps/sensa_native 内
flutter test integration_test/resource_group_test.dart -d <device> --no-uninstall --dart-define=SENSA_NATIVE_RUN=<unique-run>
```

资源回归调用实际页面、Rust、SQLite、系统凭据与本机 HTTP；前置和页面挂载仍由测试安排，不记作从正式首页导航完成所有资源流程。执行后移除本次 adb reverse、结束本次 fixture。

## 正常应用与平台走查

- 正常 main（非 integration_test）在 macOS 独立启动，恢复先前合成包的本机完成记录；全屏桌面侧栏与窄窗口底栏均实际查看。
- 系统文件选择器导入合成学习包、明确入学、回想/揭示/完成已实际点击；独立工具提交的合成材料在重启后的收件箱中可见。
- 连接向导实际选择系统目录并生成 Agent-only 和 browser 连接。浏览器变体使用合成扩展 ID 与 `/tmp` 下的隔离 NativeMessagingHosts；生成的 manifest 通过检查，所指工具通过真实长度前缀 Native Messaging hello，目标库一致。没有替换 owner 的 Chrome 登记，也没有声称这次是在 owner Chrome 中完成重新配对。
- 走查发现浏览器已勾选而 ID 为空时曾静默降为 Agent-only，现已在 Dart/Swift 两端拒绝；专项组件回归通过，正常程序重建后创建 browser 连接并显示插件确认指引。
- Android 为 headless 模拟器，保持飞行模式、Wi-Fi 关闭。正常 main 经 Flutter inspector 确认进入正式首次使用页，运行时无异常；界面操作与持久化由上述 integration_test 验证。没有将其写成手持真机/Computer Use 触摸体验验收。
- CUA 对部分 Flutter 文本框的 setValue/paste 未实际写入；实测使用原生按键完成输入。系统文件选择器和常规按键经过实际操作，不能据此声称所有 IME/剪贴板/无障碍组合已验收。
- owner 的 Release 进程未停止；临时 Debug 名称/签名已恢复，测试服务与本组 adb reverse 已移除。没有迁移 owner 库、付费 LLM/TTS、推送或部署。

## 平台边界

macOS 包含与应用一起构建签名的独立 intake CLI。系统目录选择只授权所选位置，保持 App Sandbox；配置固定本机库。
安装向导拒绝覆盖既有浏览器连接，失败清理本次新建内容。独立工具不继承应用凭据，不提供学习/调度命令。
浏览器注册、Windows/iOS 实况、商店签名公证仍须分别记证据，不能从 Agent hello 或构建推断完成。
四阶段正式 UI 按 owner 指示延期；Web 本地执行、G1–G3 加密同步、备份恢复、M3 与生产发布均不由本组替代。
