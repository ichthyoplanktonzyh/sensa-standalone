# 浏览器阅读体验第二轮

2026-09-08。Owner 确认优化等待、上下文捕获、浮层干扰、常见站点兼容及 YouTube 连续观看。
本轮在原工作树独立实现，不新增领域对象；完整意义仍是 Context / Sense / Expression，Focus 可选。

## 交付行为与边界

| 用户结果 | 实现 |
| --- | --- |
| 解释和翻译尽早可读 | 服务端读取 Provider 实际 SSE，扩展后台通过 Port 传递文本分片；划词、网页、字幕、自定义阅读动作均接入。正式解释只预览 JSON 中的解释文字，明确标记未完成，完整 Proposal 通过原校验后才提供「加入 Sensa」 |
| 失败能原位恢复 | 半截、超长、异常结束的流不能进入 ready；失败清除临时文字。连接中断可检查原请求，已知失败的正式解释可显式重新解释；running 自动检查同 ID，不自动发起新的收费请求 |
| 保留准确上下文和目标表达 | 支持链接/加粗等内联节点、换行、跨句和跨段选区；不再因跨句把 Expression 置空。排除隐藏、编辑、按钮和 Sensa 自有内容，以源文本计算 Unicode 字符位置 |
| 不用重新划词即可调整上下文 | 浮层提供「扩展上下文／使用原上下文」，在冻结的句子范围与所在文本块之间切换；调整后旧解释作废，新请求使用新 ID，需要重新解释。不是任意改写来源文本的编辑器 |
| 看完回到阅读 | 展开结果可收起为原工具栏，再展开保留结果；点击按钮保持选区，拖动、键盘移动和视口约束继续有效 |
| 常见文档段落不漏掉 | 含内联 code 的正文可翻译，独立 code/pre 与编辑区域仍排除。原 DOM 保留；文章动态改写、长页滚动继续沿用上一轮处理 |
| 视频切换衔接 | 固定后拖动原生进度条，seeked 定位新字幕，保持用户暂停状态。YouTube 导航开始清理旧内容，结束后重建；同一阅读会话曾加载字幕，后续视频继续读取英文字幕，关闭阅读或更换账号重置此意图 |

字幕轨道仍以当前播放器提供的英文来源为准，可显式重新加载；本轮不声称自动监听全部轨道切换、
无时间戳分句、所有滚动 ASR、Shorts/直播/嵌入均已覆盖。页面也不承诺全部 Shadow DOM、虚拟列表
与站点专有组件。支持非流式 JSON 响应的 Provider 回退为最终结果展示，不伪造逐字动画。

## 调用与数据边界

- 新增 `/sensa/reading/stream`、`/sensa/semantic/lookups/stream`，使用 NDJSON 文本分片/最终结果/错误帧。
- 复用原 Reading Request、Semantic Lookup 的输入、ID、限额及账本；不增加表、迁移、持久化临时预览或客户端派生状态。
- 每次发出预览前检查服务端账号授权，最终提交仍重新检查；扩展后台按账号、token、阅读模式和来源验证，页面拿不到密钥。Port 断开结束客户端接收，并中断该 HTTP 请求。
- 界面取消不承诺撤回已发送 Provider 请求或免除费用。语义预览是未校验文字，不提供接受权限；模型原始 JSON 不进入页面。
- 已知 failed 的「重新解释」是新的显式模型请求。网络未知结果的检查复用原 ID，避免自动重复收费。

## 实际源码参考

上游固定为 Read Frog v1.46.8、`e3cbe2b7c669c875dbf1b050254da9b628daefe1`：

- `src/utils/content-script/port-streaming.ts`：端口承载分片、断线清理、保活和终态区分。
- `src/entrypoints/selection.content/selection-toolbar/use-selection-popover-snapshot.ts`：开启浮层时固定选区与上下文，不追随全局选区变化。
- `src/entrypoints/subtitles.content/platforms/youtube/config.ts`、`universal-adapter.ts` 的导航处理：开始清理、结束重建以及不同播放器状态。

采用行为约束，未复制、转译或引入上游实现、提示词、测试或素材。Sensa 的服务端凭据、
临时语义预览与正式接受隔离是本项目自己的实现边界。

## 验证证据

- `sensaProviderStreamSmoke.mts`：实际 SSE 分片/跨字节 Unicode、转义后的解释预览、结束标记、截断、长度上限、错误和回调中断；实际 Provider HTTP 适配器由固定 fetch 替身验证，无外部请求。
- `sensaBrowserReadingApiSmoke.mts --browser`：分片在完成前到达，期间账本仍 running；最终才 ready、同 ID 不重算、设置密文/账号隔离、撤销后不回传最终文本、原快轨/保存/Postgres 回归；真实安装的测试扩展经后台 Port/HTTP 到隔离 API。
- `sensaExtensionReadingSmoke.mts`：跨节点/跨段采集、Unicode schema、隐藏内容排除、上下文切换使迟到解释作废、收起/恢复、流式失败清除临时内容、关闭后隔离、未完成/未确定不可接受、显式失败重试的新 ID；保留既有鼠标/键盘/保存/拖动/视口检查。
- `sensaReadingContinuitySmoke.mts`、`sensaBrowserPortSmoke.mts`：长页调度、宿主恢复、字幕时间/保存、进度定位、导航期间不提前重建、导航结束继续字幕读取等。
- `sensaReadingSitesSmoke.mts --live-sites`：实际访问 MDN CSS display 页面和 Wikipedia Language acquisition 页面，各 4 处当前公开 DOM 的上下文/表达采集通过 schema。是公开页面的只读采集抽查，不是这些站点全部页面的翻译或账号验收。
- 根级 typecheck、production build、lint 和 `sensa:edge-check`；lint 实际仍调用 typecheck，build 仍有原有 bundle 大小提示。

常规验证均用固定模型替身；本轮新增真实 DeepSeek/TTS 请求 0 次，既有预算 15/15 不变。
本地 4319 API 已重启以提供新增流式路由，复用原签名密钥、凭据库和数据库；未清理账号、队列或学习记录。
Owner 已重新加载本轮构建，普通 Chrome 实测完成：

1. MDN 当前 CSS display 页面，双击 `participation` →「保存…」打开预览（未提交保存）。
   起初展示所在句；「扩展上下文」补入同段前后句，目标表达不变；收起再展开仍保留扩展范围。
2. 原有 YouTube 视频 `NfNHImQPHJc` 刷新并开启阅读后，真实英文字幕加载 112 段。
   固定后通过原生进度条键盘操作从约 13.756 秒前移到 28.756 秒，`paused` 保持 true，
   当前字幕切换到食品安全语境，面板显示「已定位到新位置，播放后恢复字幕跟随。」。
3. 未点击模型动作或提交记录，API 状态仍为累计 used 15 / limit 15 / remaining 0。

真实模型的流式延迟和服务商差异仍未重新付费抽查；本轮流式证据来自实际协议适配器的固定
SSE 和已安装测试扩展的 HTTP/API 集成，不冒充真实 DeepSeek 生成质量验收。
没有推送、部署或提交扩展商店。
