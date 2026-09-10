# 原生自由练习界面优化

2026-09-10。Owner 确认按正式 Web 优化，并明确允许保留说、读、写占位。
该确认适用于本轮占位显示，三者仍标记“尚未开放”，没有可执行入口、Session 或完成状态。
参考 `SensaFreePracticeScreen.tsx`、`PracticeScopeScreen.tsx`、`YouGlishListeningScreen.tsx`，
均位于正式 `apps/web/src/experience/components`。

## 体验

- 范围摘要与四类活动卡片：宽窗口两列、手机一列；不再在首页展开全部目标。
  练习目标为可展开的可选编辑项，空范围给出选择范围提示。
- 独立范围页展示表达、词义和情境；使用原生下拉控件切换来源，个人意义可多选/全选。
  草稿只在“使用此范围”后提交，空来源或未选个人目标不能确认。
- 未结束练习独立显示固定表达范围和继续操作；新的范围选择只作用于下一次练习。
  保留放弃、保存退出、结束和本地恢复，不用当前范围覆盖已固定的 Session。
- 自适应 16:9 视频，连接状态/重试在播放器上方；字幕集中显示并高亮 provider 标注的表达。
  播放/暂停由真实 provider observation 切换，保留上一段/下一段、重听、口音、倍速、片段及来源标识。
  本轮不扩展新的跳秒控制命令。
- 首页展示最近三条练习记录，更多记录进入完整列表。数量只表示目标、表达或交互事实，
  不显示能力得分或学习完成率。

`practice_home.dart` 与 `practice_scope_screen.dart` 负责呈现与选择，原 `practice_screen.dart`
继续负责播放器生命周期和命令协调；没有改动 Rust/SQLite 或练习命令合同。
练习不写正式学习 Evidence、签到、每日额度、结果或调度。

## 验证

`test/practice_ui_test.dart`：中英文 × 375×667 / 800×632 / 1280×800、1.5 倍文字，
检查三类占位、开始/继续、空范围禁用、固定范围提示；另检查范围草稿确认和字幕高亮。
8 项专项加壳层 12 项共 20 项组件回归通过。

真实 Rust/SQLite 与平台 WebView 的既有 `integration_test/practice_test.dart` 接入独立范围页。
使用隔离库与确定性媒体回调，检查失败不创建 Session、个人来源选择、播放控制、口音/倍速、
保存、冷恢复后结束，以及全过程正式学习 snapshot 不变。没有调用在线视频或付费服务。

验证结果：

- 20 项组件回归通过，Dart 静态分析无问题；根级 typecheck、build、lint 通过。
- macOS `practice-ui-mac-03` 主流程与独立冷恢复通过；Android 模拟器
  `practice-ui-android-03` 主流程与独立冷恢复通过。
- macOS 使用独立 `SensaUXAcceptance` Debug 身份；工具 foreground 命令失败但应用内测试通过，
  不作为前台视觉证据。临时 AppInfo 已恢复，owner Release 库未被操作。

日志：`/tmp/sensa-practice-ui-final-widgets.log`、`/tmp/sensa-practice-ui-final-analyze.log`、
`/tmp/sensa-practice-ui-journey-{mac,mac-cold,android,android-cold}.log`、
`/tmp/sensa-practice-ui-{typecheck,build,lint}.log`。

调试中将连接状态移到视频上方，给视频外层稳定 Key，避免提示增减引起 WebView 重建；
回归等待状态时先滚动到该状态。冷恢复保留已选口音，测试滚动后重新定位整个 ChoiceChip，
避免已选标签的文字命中失败；未删除或放宽原来的状态、练习账本与正式快照断言。

没有应用走查，不将自动化等同于 owner 视觉确认。实际在线视频可用性、其他平台不在本轮验收中。
