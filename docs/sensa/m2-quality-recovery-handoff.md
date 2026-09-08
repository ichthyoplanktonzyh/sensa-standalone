# M2 质量、实际进程恢复与 Chrome 兼容

2026-09-08。沿用 owner 的直接施工、浏览器和有限 DeepSeek 试验授权；没有 push、部署、商店
上传/送审/发布。本记录补齐本地证据，不能代表真实托管或商店验收。

## 真实个人场景质量

Owner 明确纠正匿名化要求：私人材料保留获授权的人名、关系与真实事件；公共 Sense 保持
抽象。早先把 `Maya` 判作泄漏的测试结论撤回。当前语义策略 `consumer-semantic-v3` 区分
真正多义与单一含义的细微语气差异；缺少消歧依据时保留 unresolved。

`consumer-content v3` 为私人经历使用忠实中文转述指令。Provider 只接收固定目标、已确认
含义及来源文本的投影；完整 task/request/grant/digest 仍保留供审计。私人句子采用 sourceText
字段，避免模型把输入 scene 当作输出模板。独立校验要求逐项核对来源中的地点、引语、人物
和动作；短而忠实的线索可以合格，不要求为“生动”而编造经历。

本次试验共 27 次调用，全部实际返回 `deepseek-v4-flash`：

| 批次 | 调用 | 输入 tokens | 输出 tokens | 结论 |
| --- | ---: | ---: | ---: | --- |
| 6 类样本 + 2 个反向校验 | 18 | 33,515 | 2,388 | 自动结果均通过；人工读原文发现私人样本新增会议室/引语，不能算忠实性通过 |
| 忠实性 rubric 复测 | 5 | 11,085 | 521 | 新增细节被独立 reviewer 拒绝，未冻结；同人物编造细节与目标泄漏反例被拒绝 |
| 精简输入/转述试验 | 2 | 812 | 94 | 模型复制英文原句，reviewer 漏判；确定性中文/目标隐藏检查拒绝，未冻结 |
| sourceText 投影定向复测 | 2 | 536 | 81 | 保留 Maya 与原事件，无新增地点/引语，独立校验和确定性组装通过 |

合计输入 45,948、输出 3,084，共 49,032 tokens。无自动付费重试，批次由主代理逐项检查后
显式触发。请求别名为 deepseek-chat；费用未从 tokens 估算成未经核实的实际账单。

最终私人样本：原文 `Maya gave tactful feedback on the proposal.` →
“**Maya对提案给出了巧妙且不冒犯的反馈。**” 正确保留人物，没有会议室、评审会、引语、
动作顺序或他人反应。其余有限抽查覆盖短语/Unicode occurrence、light 重量义、charged 收费义、
bank 歧义、嵌入指令文本；反向校验覆盖替换人物/事件、同人物编造细节、目标表达泄漏。

样本是合成案例，正式模型质量不能由这几个例子外推。最终私人投影改动仅进行了上述定向
真实复测；通用场景此前的成功记录不等同于最终版本的大样本回归。独立模型仍可能漏判，
确定性角色/语言/目标隐藏检查继续必要；不声称自动评审能证明所有事实忠实。

脚本 `scripts/sensaRealProviderTrial.mts`：默认拒绝付费；`--validate` 无网络；`--allow-live`
每次至多 18 调用，支持按 case 选择和复用同一原句/表达的已保存语义结果，不覆盖旧审计文件。
产物均在 `/tmp/sensa-m2-quality-*`；常规 CI 只运行无成本输入检查。

## 实际 API 进程终止

`--crash` 启动使用真实生产 API routes 和同一 Postgres 的独立本地 HTTP 服务进程。三组分别
在 generating、validating、已 ready 但 HTTP 响应未发送时发送 SIGKILL，再用全新进程恢复。
前两组保留原 task/Target，经 75 秒 lease 到期后明确阻塞，只有用户 retry 才生成第 2 attempt；
最后一组直接读取原 materialization，次数仍为 1。重启后的首次检查不调用生成器/校验器。

进程确实被结束；仅测试时钟推进 76 秒代替墙钟等待，不修改已持久 lease。所有模型为 mock。
`consumerCrashFixture.mts` 只绑定 loopback，公开验证 key/测试凭据通过 IPC/环境传入，子进程
收到的环境不包含真实模型凭据。已加入 no-cost CI；不使用 Deno 模拟 Node 子进程。

## Chrome 151 / 152

使用 Google 官方 Chrome for Testing 下载：151.0.7922.138、152.0.7977.82，macOS arm64。
两个版本均通过实际 MV3 插件完整自动链：PKCE、Web 原位/慢轨、离线队列、账号切换、恢复、
版本保护、准备、M1 首学结算。自动 fixture 单独提供测试站点权限，不冒充原生授予。

另起未改 host_permissions 的可见浏览器，通过原生扩展菜单手动式 UI 操作验证：

| 步骤 | 151 | 152 |
| --- | --- | --- |
| 点击前无注入权限 | false | false |
| 主动点击 Sensa 后 | true | true |
| 同源导航后 | true | true |
| 跨源导航后 | false | false |
| 在新来源再次点击 | true | true |

Read-only audit 使用无数据内容的 permission-probe.js；原生菜单显示申请访问与恢复状态。
新矩阵验证的是临时权限；登录后真实划词浮层已有 149 原生记录和 151/152 自动完整链记录。
测试 fixture 与可见浏览器均已关闭，未改日常 Chrome profile。audit JSON 位于
`/tmp/sensa-native151-*.json` 与 `/tmp/sensa-native152-*.json`。

真实商店热更新和权限升级仍待商店环境。解包 ZIP 替换/重启不能替代商店升级。

## 交付与外部验收

Node/Deno consumer checks、实际 crash smoke、typecheck/build/lint/edge check 无成本验证。
静态 TTS 本次未新增调用。云端目标项目、CI 部署流水线、生产配置和商店提交包尚未完成，
见[具体授权和前置产物](release-authorization.md)。M3 数据控制和 M4 受邀发布门继续有效。

官方来源：[Chrome for Testing](https://googlechromelabs.github.io/chrome-for-testing/)、
[版本 manifest](https://googlechromelabs.github.io/chrome-for-testing/latest-versions-per-milestone-with-downloads.json)。
