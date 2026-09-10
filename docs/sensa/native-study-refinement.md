# 原生“我的学习”优化

日期：2026-09-10。Owner 授权继续优化“我的学习”；参考正式
`apps/web/src/experience/components/StudyScreen.tsx`，范围为原生学习管理页和已有操作的接入。

## 体验与边界

- 独立 `lib/ui/study_screen.dart`：当前范围、每日计划、学习准备、签到日历与近期活动依次呈现。
- 桌面范围与计划并排，手机纵排；范围直接显示新学、到期复习、待继续和回想状态。
- 数量和默认学习方式使用既有编辑入口；来源、准备详情、完整学习历史仍可直接进入。
- 有任务时提供开始/只复习，已有 Activity 的继续操作保留原 mode。
- 日历直接展示签到及月份切换，已签到禁用重复点击；展示最近三次活动和本地化时间。
  “近期学习活动”不冒充逐目标学习历史，完整历史仍使用原查询页面。
- 保持中英文、大字号和窄屏可滚动布局。没有改动 Rust、SQLite、学习队列或调度合同。
  每日数量修改和签到不改写既有完成记录，签到不产生学习 Evidence。

## 验证

`test/study_screen_test.dart` 覆盖中英文 × 375×667 / 800×632 / 1280×800，
1.5 倍文字、管理入口、继续模式、签到禁用和月份操作；连同既有首页、壳层、用例 UX、
语言与采集接入共 43 项组件回归通过。

真实 Rust/SQLite `integration_test/product_journey_test.dart` 增加从本页修改数量到 10、
检查签到状态及完成数量保持不变；保留内容接纳、显式入学、轻量完成、详情操作、
语言切换和独立冷启动快照恢复。使用隔离 run ID 与 macOS Debug 身份，避免操作 owner Release 库。

验证结果：

- 43 项组件回归通过；`dart analyze lib test integration_test` 无问题。
- 根级 `npm run typecheck`、`npm run build`、`npm run lint` 全部通过。
- macOS `study-mac-02` 与 Android 模拟器 `study-android-02` 主流程、各自独立冷恢复全部通过。
- 首次 macOS 主流程在旧设置页点击已选数量的文字时出现命中失败；改为定位整个 ChoiceChip，
  保留原操作与断言，用全新隔离 ID 重跑两平台。新增的学习管理操作在首次运行中已通过。
- macOS 使用 `SensaUXAcceptance` Debug 身份，临时 AppInfo 已恢复。工具 foreground 命令失败
  但应用内测试通过，不作为前台视觉证据。

日志：`/tmp/sensa-study-final-widgets.log`、`/tmp/sensa-study-final-analyze.log`、
`/tmp/sensa-study-journey-{mac,mac-cold,android,android-cold}.log`、
`/tmp/sensa-study-{typecheck,build,lint}.log`。

本轮不做应用走查；程序回归不等同于 owner 视觉确认。OS 文件选择仍为替身，
Windows/iOS、在线 Provider 和真实 OS 选择器不在本轮证据中。无付费调用、推送或部署。
