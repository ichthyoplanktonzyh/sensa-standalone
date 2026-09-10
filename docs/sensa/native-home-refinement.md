# 原生首页优化

日期：2026-09-10。Owner 确认按原生与正式 Web 首页的差距分析实施，可采用更合适的原生设计。
范围限首页呈现、首页入口及关联导航，不进行应用走查，不扩展其他页面设计。

## 体验与代码

首页使用独立 `lib/ui/home_screen.dart`，壳层继续负责导航和打开学习。
参考正式 `apps/web/src/experience/components/HomeScreen.tsx` 与 `account/SensaApp.tsx`。

- 标题和日期在宽窗口横排；手机纵排。今日学习采用有明确标题和管理入口的面板。
- 新学、到期复习使用两列大数字；继续学习用条件提示，不再作为第三列竞争注意力。
- 桌面开始/只复习并排，两个添加入口也并排；手机单列。标准 375×667 手机中英文主按钮
  均在首屏可见；手机将补充状态说明放在主按钮下方，大字号保持正常滚动。
- 按当前 Rust 投影区分：可继续、新学/复习、等待回想、准备尚未就绪、额度用完、
  已有学习但当前范围无可用任务、首次添加。准备中/受阻引导查看准备；额度或范围问题
  引导管理学习，不一律要求添加内容。进行中的 Activity 恢复仍使用原 mode。
- “记录自己的情境”直接打开原采集编辑器；取消返回首页。保存未确认内容进入收件箱，
  确认意义进入已保存列表。复制、确认和离开保护复用既有编辑器。
- 重新进入首页回到顶部，取消覆盖在首页上的采集页则保留原滚动位置。

首页只映射 `learning.counts`、Activity availability、每日已开始/预留数量和准备状态，
没有在 Flutter 构造队列、计算调度、写结果或改变 Rust/SQLite 合同。所有新文案均提供中英文。

## 验证

`test/home_screen_test.dart`：中英文 × 375×667 / 800×632 / 1280×800、1.5 倍文字，
逐项检查九种状态的主操作；另检查忙碌禁用、标准手机首屏按钮、直接打开采集与取消返回。
数据为测试投影，不能用来宣称真实本地结算验收。

`integration_test/product_journey_test.dart` 改为从首页直接记录情境，并检查保存后收件箱已选中。
保留真实 Rust/SQLite 的显式入学、轻量完成、语义接纳、详情/复制/移除/恢复、语言切换与冷恢复。
OS 文件选择仍为替身；不调用付费模型或 TTS。

验证结果：

- 首页专项 9 项，连同 shell、用例 UX、语言、采集接入共 37 项组件回归通过。
- `dart analyze lib test integration_test` 无问题；根级 typecheck、build、lint 通过。
- macOS `home-mac-02`、Android 模拟器 `home-android-02` 主流程与各自独立冷恢复全部通过。
- 首次 macOS 运行捕获返回首页保留旧滚动位置的问题；修复后用全新隔离 ID 重跑，
  并增加“其他页面返回首页从顶部开始”的组件断言，未删除或放宽原旅程的首页检查。
- macOS 使用独立 `SensaUXAcceptance` Debug 身份；工具 foreground 命令失败但应用内测试通过，
  不作为前台视觉证据。所有数据使用隔离 run ID，没有操作 owner Release 库，临时 AppInfo 配置已恢复。

日志：`/tmp/sensa-home-final-widgets.log`、`/tmp/sensa-home-focused-final.log`、
`/tmp/sensa-home-final-analyze.log`、`/tmp/sensa-home-journey-{mac,mac-cold,android,android-cold}.log`
与 `/tmp/sensa-home-{typecheck,build,lint}.log`。

不将程序验收等同于 owner 视觉确认；Windows/iOS、真实 OS 选择器与在线 Provider 不在本轮证据中。
没有应用走查、付费调用、推送或部署。
