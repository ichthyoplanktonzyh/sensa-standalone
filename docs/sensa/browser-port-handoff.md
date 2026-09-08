# 浏览器端口第一批实现

2026-09-08。状态：本地代码、隔离环境与 owner 普通 Chrome 的真实 YouTube/DeepSeek 链路验证；尚未完整对齐陪读蛙全部浏览器能力。
Owner 已确认浏览器端口包含 YouTube，并要求以陪读蛙源码为参考、独立实现闭源产品。
后续实测结果、字幕断行修复及本地服务恢复见[真实浏览器验证记录](browser-live-check.md)。
快轨补充验收：普通 Chrome 的 YouTube 字幕选中 `multiply` → 正式解释 → 原位「加入 Sensa」→ 服务端完整意义；无关注点、无新增 Inbox、无自动加入学习。语义策略已校准为 v4，详见同一记录中的快轨章节。
日常阅读流畅度补充：视口优先的长页翻译、原位重试、字幕时间分段与过期队列隔离已完成；普通 Chrome 验证上下句及原生播放恢复跟随，见[本轮验收](browser-reading-continuity-handoff.md)。

## 已实现的纵切

| 用户结果 | 实现与边界 |
| --- | --- |
| 配置自己的模型连接 | 独立设置页，名称、兼容服务地址、模型、密钥、启用/移除、temperature；获取模型列表、显式测试、修订冲突提示 |
| 为不同功能选择模型 | 划词翻译、网页翻译、字幕、自定义阅读动作、正式句中解释分别选择连接；默认沿用已有服务器配置 |
| 凭据与阅读请求有明确归属 | 按账号 AES-GCM 加密保存；插件只持有连接元数据与功能选择，密钥不进入 storage；模型请求在服务端执行 |
| 原位理解后继续阅读 | 保留既有工具栏/解释/保存链，新增翻译及可配置阅读指令；结果以文本展示，不把阅读动作输出当成正式意义接受 |
| 翻译网页并恢复 | 逐可见段落、双语/仅译文、Alt + T 悬停段落、同会话成功缓存、动态文本变更检查；恢复时移除自有节点/标记，保留宿主节点与事件 |
| 视频中的表达进入原采集链 | 当前视频英文字幕获取入口、JSON3 与自有 VTT/SRT 输入、播放时间跟随、选择固定/暂停、继续/上下句/重听、按需或自动字幕翻译 |
| 保存后回到视频对应位置 | CaptureSnapshot.source 增加可选 youtube videoId/startMs/endMs；毫秒整数进入既有 canonical digest；API/Postgres/Sync 保留，Web 收件箱和意义详情提供来源回访 |

请求 ID 固定原输入；同 ID 重复访问不再次调用模型，不同载荷拒绝。读请求每日每账号最多
300 次、同时最多 3 次；单次模型请求 35 秒，超过 45 秒的结果不进入 ready。过期响应内容
在后续访问时清除，保留请求 ID 防止旧重试再次收费。账号授权在结果返回前再次检查。
网页随滚动登记视口附近的标准/叶子文本块，不再截断到前 150 段；最多两个翻译任务并发，
相同文本共享在途请求，成功缓存滚动保留 150 条。不包含所有网站专用规则和复杂虚拟段落策略。

## 实际源码参考

上游固定提交：`e3cbe2b7c669c875dbf1b050254da9b628daefe1`，版本 1.46.8。
本轮阅读了这些模块的实现，采用行为和状态要求；没有引入上游源码、提示词、测试或素材。

| 上游模块（仓库相对路径） | 实际采用的依据 | Sensa 的调整 |
| --- | --- | --- |
| `src/entrypoints/options/pages/api-providers/feature-providers/index.tsx`、`src/utils/constants/feature-providers.ts` | 连接与按功能分配分开 | 功能映射按 Sensa 解释/采集链定义 |
| `src/types/config/provider/schemas.ts`、Provider 编辑表单及连接测试/模型选择组件 | 自定义兼容地址、手填/获取模型、测试反馈、高级设置 | 服务端凭据库；不把扩展本地密钥方案照搬过来 |
| `src/utils/request/`、官方 request-control 文档 | 控制请求、去重、失败处理 | 服务端幂等账本与限额；网页按需、限并发，不照搬上游批处理参数 |
| `src/entrypoints/selection.content/selection-toolbar/use-selection-popover-snapshot.ts`、`custom-action-button/use-custom-action-execution.ts` | 固定选区、隔离旧结果、显式动作 | 保留 Sensa 原快照/lookup/accept 边界 |
| `src/utils/host/translate/dom/paragraph-segmentation.ts`、`translation-cleanup.ts` | 文本块边界、宿主动态更新、恢复时不能覆盖宿主新状态 | 先实现标准与叶子文本块；通过自有标记切换原文可见性，保留宿主事件与 inline style |
| `src/utils/subtitles/fetchers/youtube/index.ts`、`pot-token.ts`、`url-builder.ts`、`src/entrypoints/interceptor.content/inject-player-api.ts`、`utils.ts` | 当前视频/轨道校验、播放器字幕来源、原生请求回退、空响应不能当成功 | activeTab 授权后在 MAIN world 读取数据；保留选中轨道地址，补入当前播放器提供的字幕令牌、客户端与设备参数；不记录签名地址/令牌，字幕数据与模型凭据隔离 |
| `src/entrypoints/subtitles.content/platforms/youtube/config.ts`、`universal-adapter.ts`、`ui/subtitles-view.tsx` | 广告状态、SPA 切换、可选择字幕、全屏环境 | 原视频定位进入 Sensa 快照，后续共用原保存/意义链 |

上游研究与网页来源参见[产品参考报告](../reference/read-frog/product-review.md)。
源码揭示的完整能力大于本批范围；这里不把已阅读的模块数量当作实现覆盖率。

## 验证证据

- 新隔离 Postgres 数据库顺序应用 0001–0021；以继承 backend_app 的测试登录角色验证真实表权限。
- `sensaBrowserReadingApiSmoke.mts`：配置密文持久化/不回传密钥、账号隔离、修订冲突、允许的 origin、模型列表、显式请求/重复请求/失败不泄漏、并发重放、超时迟到结果和撤销后隔离。
- 同一 API 脚本：配置的模型用于正式 lookup；字幕毫秒定位经 intake.save → Postgres → 读取/重放 → semantic.accept 保留，其他账号不可读取。
- `--browser`：实际加载临时 Chrome 扩展，用实际 options/background/content，通过 HTTP/API 到隔离 Postgres，验证设置刷新与真实保存；模型完成使用固定替身，插件 storage 不含密钥。
- `sensaBrowserPortSmoke.mts`：通过。实际 content/options 构建，网页原节点与事件保留、缓存、编辑区排除、关闭后旧译文不回插、pagehide/pageshow 恢复、字幕选择保存/时间定位/跳句/SPA 清理；验证所选轨道地址与播放器令牌组合，以及空字幕响应清除旧内容；配置页保存/重载/模型列表/测试/冲突反馈。
- `sensaExtensionReadingSmoke.mts`、`sensaExtensionDismissSmoke.mts`、`sensaExtensionPopupSmoke.mts`：通过。
- 根级 `npm run typecheck`、`VITE_SENSA_MODE=production npm run build`、`npm run lint`、`npm run sensa:edge-check`：通过。build 保留已有大 bundle 提示；lint 仍调用 typecheck，不冒充独立 lint 规则扫描。

测试未调用付费模型/TTS。截图位于 `/tmp/sensa-browser-native-saved.png`、
`/tmp/sensa-browser-settings.png`、`/tmp/sensa-browser-video.png`，内容为合成夹具。
临时插件只为测试页面附加 host 权限，不能代替原生 activeTab 跨站权限或商店发布验收。

## 剩余范围与真实网站限制

首轮自动化会话真实访问了 Stanford 的 YouTube 视频 `UF8uR6Z6KLc`，能读取播放器元数据与英文轨道，
但该自动化会话中的字幕请求返回空正文，尚未获得真实字幕全文的成功证据。不能把固定
JSON3 夹具通过写成真实 YouTube 字幕兼容已完成。播放器请求时机、轨道切换和更多
实际视频仍需继续验证；无字幕时显示失败/备用输入，不能显示加载成功。已按源码核对并补齐
轨道地址、播放器令牌和客户端参数，复测结果仍为空。不会把页面当前显示的其他语言字幕
直接标记为英文回退保存。

随后在 owner 已打开的普通 Chrome 中，视频 `NfNHImQPHJc` 成功读取 272 条真实英文字幕，
经上下文合并后形成 59 段。真实模型翻译、阅读动作、保存、澄清/确认和视频回访通过。
这补上一个真实网站成功案例，不代表所有视频/浏览器兼容，也未确定首轮空响应的根因。
后续日常阅读轮采用源时间片段分句，同一视频实测加载 112 段；未增加真实模型调用。

尚未完成：无字幕视频的云端 AI 转录；Shorts/跨域嵌入和直播的完整兼容验收；独立电子书
阅读器接入；上游全部站点规则/长文虚拟分段/流式结果/批量翻译；完整非兼容协议 Provider
目录、推理参数和跨端设置同步体验。VTT/SRT 输入只是一种备用字幕来源，不替代 AI 转录。

## 安装与现有体验环境

扩展构建在 `apps/browser-extension/dist`，使用方式见[插件 README](../../apps/browser-extension/README.md)。
新增接口需要先应用 0021，再配置 `SENSA_PROVIDER_VAULT_KEY` 并重启 API；云端仍走 CI/CD。
第一批数据库验证使用新隔离库，没有将迁移应用到 owner 正在使用的体验数据库，也没有重启
其旧认证服务或清理浏览器账号、队列和学习记录。旧体验服务尚不提供新的配置接口，
不能直接把该旧服务当作本批新功能演示环境。后续在 owner 要求直接浏览器验证后，已恢复
支持新接口的本地服务，操作与数据保留范围见真实浏览器验证记录。未推送、未部署、未提交商店。
