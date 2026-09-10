# 原生详情、编辑与学习体验第二轮

日期：2026-09-10。承接 [主导航调整](native-navigation-refinement.md)，在原工作树由主代理直接实施。
Owner 授权系统优化原生体验，不要求像素复刻 Web；本轮明确停止应用走查，以代码审查和程序回归推进。
参考正式 `apps/web/src/experience/components/PersonalMeaningDetailScreen.tsx`、
`learning/RuntimeFrame.tsx` 与 PRD；没有使用 `apps/web-next` 作为 UI 来源。

## 这一组解决的问题

- 已保存意义从堆满操作和来源的列表卡改成可扫描的摘要，点击进入既有完整意义详情。
  同一详情支持来源、上下文、表达关系、显式入学、准备入口、复制编辑、移除和恢复。
  确认过的上下文仍通过复制创建新内容，不覆盖原语义事实；版本审计放在详情末尾。
- 采集编辑离开时提示未保存修改，可继续编辑或放弃；成功保存、确认仍直接返回。
  中英文提示齐全，仍以 Context–Expression–Sense 的既有准入规则确认，Focus 不强制填写。
- 学习题面扩展桌面可读宽度，减少手机双层留白和段间空白；换 Run/phase 或高保证 Action
  重建滚动容器，新的题面从顶部开始，同题草稿/保存刷新保持阅读位置。删除重复暂停操作。
  高保证回忆输入后立即更新提交可用性，不必等待草稿防抖写入；空白答案保持禁用。
- 图文关系页的工具头可随内容滚动，不再挤占短窗口；手机关系视图以完整可读的
  上下文、意思、表达列表呈现，并可点击详情。宽窗口保留拖动/缩放图谱。
- 准备页先显示目标和当前准备状态，上下文授权及参考资料进入可展开区域；已有授权与撤销行为保留。
  模型设置先提供添加服务，配置服务后再展示用途分配和凭据重载，避免空下拉框占满首屏。

本轮只改变 Flutter 呈现与导航，不改 Rust 学习结算、SQLite schema、调度、Profile 或历史。
未迁移 owner 数据，未引入同步、Web 本地化或发布工作。

## 验证与边界

新增 `test/native_use_case_ux_test.dart` 覆盖中英文、375×667 / 800×632、1.5 倍文字的
关系导航和采集离开保护，以及准备状态/参考资料展开、服务配置分层、换题滚动与即时提交可用性。
这些是组件测试，数据为内存投影，不能单独证明 SQLite 或 OS 集成。

`integration_test/product_journey_test.dart` 增加：从个人意义摘要进入真实 World 投影详情，
复制上下文后返回、移除和恢复、入学数量不变。原有导入取消/错误、显式入学、轻量学习完成、
语义接纳、语言切换与独立冷恢复保持。平台文件选择仍为替身；不声称完整 OS/视觉验收。

验证结果：

- 新增 10 项用例组件测试与既有 shell/locale/intake 回归，共 28 项通过。
- `dart analyze lib test integration_test` 无问题；根级 `npm run typecheck`、`npm run build`、
  `npm run lint` 均通过。
- macOS `ux-mac-01`、Android 模拟器 `ux-android-01` 主流程及各自独立冷恢复全部通过。
  macOS 使用独立 `app.sensa.sensaNative.uxAcceptance` / `SensaUXAcceptance` Debug 身份；
  临时 AppInfo 配置已恢复。Owner Release 应用与真实库未操作。
- macOS 工具输出 foreground 失败，但应用内测试完成并全部通过；这不是前台体验验收。
- 本轮没有重跑高保证完整平台链路；其改动由即时提交/空白禁用组件测试和静态分析覆盖。
  Windows/iOS、OS 文件选择器和真实 Provider 仍不在本轮证据中。

临时日志为 `/tmp/sensa-ux-final-widgets.log`、`/tmp/sensa-ux-final-analyze.log`、
`/tmp/sensa-ux-journey-{mac,mac-cold,android,android-cold}.log` 与
`/tmp/sensa-ux-{typecheck,build,lint}.log`。

未调用付费模型/TTS，未进行截图或 Computer Use 走查；不将程序通过标为 owner 已确认整体 UX。
提交不包含 push 或部署。后续体验优化应继续基于具体用例与实际问题，不把本组视为所有原生页面的最终验收。
