# Sensa Chrome 采集插件

M2-A 本地开发版：主动划选 → 保存待处理 → 同账号 Web 收件箱。
句中解释与直接语义接受尚待 M2-B，当前不显示可用的确认按钮。

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

支持范围当前仅本地 Chrome for Testing 149 的普通文字 HTML 实测。
内置 PDF、受限页、跨域 iframe、文件页和无痕不作支持承诺。
`npm run sensa:extension-browser-smoke` 使用隔离 profile、实际扩展与本地 fixture。
它为 fixture origin 附加测试 host 权限，因此不能替代 activeTab 原生工具栏授权实测。
