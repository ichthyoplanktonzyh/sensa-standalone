# 云端与 Chrome 商店交付授权

2026-09-11：本次范围为少量外部真实用户的 Web＋浏览器插件，本地优先＋普通账号云同步。
隔离 Supabase 项目 `kwwmukqzlxxsnviyhwmr` 已存在并用于 owner 试用；旧“没有项目”判断失效。
Owner 已授权推送固定 SHA 并在该隔离项目执行 0028/0029，执行与只读复核均已成功；该授权不删除
或迁移 owner 数据。Owner 随后授权通过已连接的 Cloudflare 插件完成试用 Web 配置与部署，并要求
遇到产品决策再联系。Chrome 商店上传、提交审核与发布仍按本页独立授权边界执行。

## 云端

授权应指向一份固定发布单：Git commit、目标 repository/branch、测试或受邀环境、Supabase
project ref、Cloudflare 项目/域名，以及实际待执行的数据库迁移、API/Web 和媒体清单。
推送/触发 CI、执行清单内迁移、发布应用和发布媒体的权限都应包含在该发布单中。生产开放、
新建付费资源、套餐升级和持续模型调用预算应明确列出，不能从有限测试授权推导。

需要在对应平台已有账号/项目访问：

- GitHub repository 的代码推送及 Actions 运行权限；环境级 Secrets 的配置途径。
- Supabase 的目标项目与部署凭据、受限应用数据库连接、Auth/Storage 配置途径。
- Cloudflare 指定项目的部署权限；只有确需改 DNS 时才包含指定域名的 DNS 修改。
- Resend 的已验证发件域名和 SMTP 配置；生产 DeepSeek 额度/限流配置。

密钥通过平台 Secrets/已有凭据管理配置，不写入聊天、代码、生成包或日志。M2 本地 MP3 不会
自动变成线上静态对象。发布通过 CI/CD 执行，不从本地 shell 直接部署。

现有 no-cost 检查、Web＋插件候选、部署与监控流水线仍需在目标环境实测。
2026-09-11 真实迁移账本已包含 0028/0029，云同步表与受限运行角色权限已复核。
Cloudflare 试用 Worker 为 `sensa-standalone`，Web origin 为
`https://sensa-standalone.ichthyoplanktonzyh.workers.dev`；生产监听专用
`codex/cloudflare-trial` 分支。应用发布仍需以实际构建与公网 smoke 为证据。
候选环境 `web-candidate`、部署环境 `web-production`、监控环境 `web-monitor` 及配置仍需接通。
平台账号登录、项目创建或手动配置由 owner 协助，不擅自接管外部平台浏览器。

正式新用户验收必须覆盖 Web 和插件、真实邮件/独立账号删除、两个浏览器恢复、离线补传、
冲突保留、学习包/图片/音频公网读取及通知接收。图片音频嵌入同步块的本地通过不等于 Storage
发布；旧 `noteService` 笔记尚未绑定账号，不属于正式库同步，不自动认领或迁移。

## Chrome Web Store

需要已有开发者账号/发布者访问；若没有，注册、开发者验证、接受条款及费用由 owner 完成。
提交前准备带固定版本和 SHA-256 的 ZIP、最终扩展 ID/生产 API 权限、商店文案/截图、权限
用途与实际数据处理说明、隐私政策/支持链接和审核所需测试账号。

授权分清三个动作：上传指定包、提交审核、审核通过后发布。可以只授权上传与送审，保留
最终发布确认。另需确认具体发布者/item ID 和可见范围。已讨论 Unlisted，但它仅不列入搜索，
知道商店链接的人仍可安装；Sensa 自身受邀准入负责访问控制。不能把 Unlisted 当成私有安装。

真实商店热更新/权限升级验收需要商店中的固定扩展 ID、已发布旧版和新版升级路径；解包
扩展的版本替换/浏览器重启证据不能替代它。当前构建默认 loopback 配置，不是可提交生产包。

参考：[Chrome 分发设置](https://developer.chrome.com/docs/webstore/cws-dashboard-distribution)、
[Supabase GitHub Actions](https://supabase.com/docs/guides/functions/examples/github-actions)。
