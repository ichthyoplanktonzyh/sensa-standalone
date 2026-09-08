# Sensa Chrome 采集插件

M2-A/B 本地开发版：主动划选 → 句中解释 → 原位确认或保存待处理 → 同账号 Web。
真实解释需服务端显式配置 Semantic provider；无 provider 时仍可保存 Inbox。

根目录 `npm run build` 构建插件，默认只连接 loopback Web 3001/API 4319。
CI/正式打包需明确设置 `SENSA_EXTENSION_WEB_URL` 和 `SENSA_EXTENSION_API_URL`；
除 loopback 外必须 HTTPS。模型密钥不进入扩展。`dist/` 不入 Git。

本机开发通过 Chrome 扩展开发者模式加载 `apps/browser-extension/dist`。
这不是已确认的受邀用户分发方式；正式 Unlisted 商店安装、审核与支持版本待 M4 验收，
不提供虚构商店链接，也未提交商店发布。

首次点图标，连接 Sensa 账号，在 Web 确认当前账号，然后开启阅读模式。
选择表达自动截取所在句子。原位可保存待处理，图标中检查同步结果及打开原记录。
关闭阅读模式恢复普通选择；浏览器重启默认关闭阅读模式，本机保存队列继续保留。
跨站重新点图标授予 activeTab 后继续；同源导航尝试复用临时授权。

普通文字 HTML 已在 Chrome for Testing 151.0.7922.138 / 152.0.7977.82 验证自动插件链及原生 activeTab 同源/跨源矩阵；149 保留历史证据。真实商店热更新尚未验收。
内置 PDF、受限页、跨域 iframe、文件页和无痕不作支持承诺。
`npm run sensa:extension-browser-smoke` 使用隔离 profile、实际扩展与本地 fixture。
它为 fixture origin 附加测试 host 权限，因此不能替代 activeTab 原生工具栏授权实测。

`node --import tsx scripts/sensaExtensionDismissSmoke.mts` 检查原位浮层的关闭行为，
可用 `SENSA_CHROMIUM_PATH` 指定 Chrome。使用实际 content bundle、closed Shadow DOM
和鼠标点击，runtime 消息为本地 stub，网络全部拦截，不调用模型。
2026-09-08 修复关闭点击被延迟划词监听重新捕获的问题；覆盖成功/失败/等待结果时关闭、
迟到结果、Esc、外部点击、重新划选及保存按钮不触发重复捕获。

`node --import tsx scripts/sensaExtensionPopupSmoke.mts` 用本地 runtime stub 检查
工具栏按钮的等待、成功、失败、防连点与恢复状态，不调用模型或账号服务。
