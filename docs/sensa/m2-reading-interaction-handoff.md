# 浏览器阅读交互更新

日期：2026-09-08。状态：本地实现和检查完成；owner 继续体验验收。

Owner 在本轮确认参考 Read Frog 的浏览器行为，采用「划选表达 → 轻量工具栏 →
按需解释／朗读 → 可选保存 → 回到原文」，随后明确 Sensa 最终闭源，不复刻源码。
本轮只参考公开产品行为，以 Sensa 现有捕获和消息链实现交互。探查时临时放入、
尚未提交的上游文件已全部移除；交付不包含 Read Frog 源码、资产、依赖或其翻写版本。

## 已实现体验

- 划词只显示「句中解释／朗读／保存…／关闭」工具栏，不自动发起模型请求。
- 点击句中解释后展开原句、当前 occurrence 高亮、来源链接和解释；详细意思默认折叠。
- 保存入口先展开原句／来源供确认，可以直接保存待处理而不请求解释。
  解释就绪后可明确加入 Sensa；两条路径均不自动加入学习。
- 浮层就近显示，按实际高度避开窗口边缘；展开后可以拖动标题，也能聚焦标题后用方向键移动。
  调整窗口后仍在视口内，长内容在浮层内滚动，紧凑工具栏随原文滚动并在选区离屏后关闭。
  长解释到达后同步重新定位，避免先超出屏幕再由 ResizeObserver 修正的位置闪动。
- Esc、外部点击、关闭按钮、阅读停止和账号切换关闭浮层；迟到响应不能打开新浮层或混入新账号。
- 请求中禁连点；保存／确认重试保持同一个 operation ID。
  请求解释期间先保存后，迟到解释不会再展示第二个保存／确认入口。
- 朗读使用浏览器已安装的本机英语语音；关闭浮层会停止本轮朗读。
  没有可用语音或朗读出错时明确提示，仍可解释与保存。

本轮确认替代旧规格中划选后立即自动解释的触发方式。账号、队列、API 和语义接受规则不变。

## 实现边界

| 模块 | 职责 |
| --- | --- |
| `apps/browser-extension/src/content.ts` | activeTab 后的阅读启停、选区事件、关闭与账号归属 |
| `apps/browser-extension/src/selection.ts` | 所选局部文本块的句子提取、精确 Unicode occurrence、来源快照 |
| `apps/browser-extension/src/readingPanel.ts` | 工具栏、预览、解释／保存状态、定位／拖动、本机朗读和清理 |
| 原有 `background.ts` | 原账号权限校验、lookup 请求、幂等本地 outbox 和同步 |

维持现有 `CaptureSnapshot` 和 lookup/save/accept 消息合同；没有新增服务端状态、模型凭据、
权限或第三方依赖。上下文仍来自选中的局部文本块，不上传整页内容。跨句选区保留待处理路径。
解释接口当前返回完整结果，本轮没有伪造流式输出。

## 验证与使用

通过根级 `npm run typecheck`、`npm run build`、`npm run lint`。

专项脚本使用实际生产构建、Chrome for Testing 152 和本地 runtime 替身，阻断网络：

```sh
SENSA_CHROMIUM_PATH='/tmp/sensa-chrome-152/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing' node --import tsx scripts/sensaExtensionReadingSmoke.mts
SENSA_CHROMIUM_PATH='/tmp/sensa-chrome-152/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing' node --import tsx scripts/sensaExtensionDismissSmoke.mts
```

新脚本覆盖显式请求、嵌套元素／Unicode／局部块提取、来源、保存预览、直接确认、失败重试／
running／unresolved、迟到结果、保存中防重入、账号隔离、本机语音替身、拖动／键盘／窄窗口／
页边／容器滚动、长解释的内部滚动与编辑区域排除。原有 dismiss smoke 已更新为先点解释，继续覆盖关闭回归；
popup smoke 也已通过，保留账号按钮反馈、防重入和最近保存的长列表检查。
原有全链 `sensaExtensionBrowserSmoke.mts` 的操作入口已同步更新；本轮未重跑该 API/Web 全链脚本，
不能把本地 runtime 替身验证说成新一轮 Postgres/API 集成验收。

截图：`/tmp/sensa-reading-toolbar.png`、`/tmp/sensa-reading-explanation.png`、
`/tmp/sensa-reading-narrow.png`。截图来自合成测试数据。

用户原有 Chrome 152 窗口中的 unpacked 插件已重新加载；原生鼠标双击 took 显示新工具栏，
「保存…」正确展开原句与来源。原账号仍连接、0 项待同步，that/which 两条原记录保留。
原生走查没有请求真实模型或提交新材料；真实 DeepSeek 体验服务与账号未重启或清理。

## 后续能力边界

Read Frog 官方资料和源码探查确认其支持 YouTube 双语字幕与字幕划词。
Sensa 本轮未增加 YouTube 字幕获取、字幕覆盖层、时间定位或视频采集合同，不能宣称已支持。
未来如确认该场景，应按字幕来源／时间点和显式采集体验独立设计实现，仍不复制 Read Frog 源码。
云部署和商店发布继续暂缓；本轮只创建本地 checkpoint，不推送。
