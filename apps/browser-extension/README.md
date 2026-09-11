# Sensa Chrome 采集插件

浏览器阅读、字幕与采集行为见 [阅读与采集合同](../../docs/sensa/browser-port-contract.md)。
模型设置、页面翻译、保存与时间定位复用既有链路；参考来源、测试入口和未覆盖范围也在该文说明。


新服务需要应用 `0021_sensa_browser_reading.sql`。服务端设置
`SENSA_PROVIDER_VAULT_KEY` 为独立的 32 字节随机密钥（64 位十六进制），保存于部署密钥管理中；
不要提交到 Git，不要在普通日志或配置导出中输出。遗失或随意更换该密钥会导致已存连接无法解密。
默认支持 DeepSeek、OpenAI、OpenRouter 的 HTTPS origin；自定义兼容服务需部署明确加入
`SENSA_READING_ALLOWED_ORIGINS`（逗号分隔）。密钥不持久化到插件 storage。
OpenAI 等兼容服务的 Base URL 应包括其 API 前缀，例如 `/v1`。

设置页可新增/编辑/移除连接、获取已保存连接的模型列表、主动测试，分别指定各阅读功能的连接。
新连接须先保存再测试；密钥留空表示保留，改变地址需重新填写密钥。设置为“Sensa 默认”沿用
服务器已显式配置的默认 DeepSeek；没有配置时会提示，不自动调用其他服务商。
页面翻译按可见段落执行，单页最多 150 段，成功结果在当前阅读会话内复用；Alt + T 翻译悬停段落。
关闭模式清除临时译文和缓存，保留原宿主节点。普通页面适配不等于任意站点排版均已兼容。

YouTube 点击“加载英文字幕”读取当前视频轨道；无法获取全文时会提示，不能将空响应当作成功。
已有英文字幕的展示/选词/保存有固定浏览器证据；owner 普通 Chrome 的一个真实 YouTube 视频已走通
字幕获取、真实 DeepSeek、保存、澄清/确认和回访，详见[实测范围](../../docs/sensa/browser-port-contract.md)。
字幕按相邻断行合并为有界上下文，视频回访目前定位到上下文起点；更多视频及复杂字幕格式仍待兼容验收。
无字幕 AI 转录尚未接入；用户提供的英文 VTT/SRT 是独立备用输入。

无付费验证入口：

```sh
node --import tsx scripts/sensaBrowserPortSmoke.mts
node --import tsx scripts/sensaBrowserReadingApiSmoke.mts --browser
```

后者要求 `SENSA_TEST_DATABASE_URL` 指向名称以 `sensa_m1a_browser_` 开头的隔离 loopback
Postgres，以及测试专用 vault key。模型完成与模型列表使用替身，扩展后台、HTTP、API、
加密存储及采集数据库使用实际实现。测试为临时插件附加 fixture origin 权限，不替代商店验收。

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
最近保存记录放在独立区域内滚动，显示当前记录数；检查覆盖 20 条记录、长文本、
键盘滚动、空状态和切换账号后的列表清空，避免记录增长撑长整个弹窗。

正式 Web 已登录时，刷新该页面可自动连接已加载的插件；尚未登录时，点击插件的“登录 Sensa”，
在现有 Web 登录页完成登录后自动连接。当前默认本机 Web 为 3001、API 为 8081；其他环境必须
在构建时设置 `SENSA_EXTENSION_WEB_URL` 与 `SENSA_EXTENSION_API_URL`。重新构建后需要在浏览器扩展
管理页重新加载插件，并刷新已打开的 Sensa 标签页，使新的 Web bridge 生效。

插件显示“暂存于插件”表示仍待接收，“已保存到我的内容”表示接收端已返回持久化回执。
本机接收目标保留在高级连接设置；云端加密采集交付仍在开发，不把本机队列称为云端备份。
