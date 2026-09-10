# 云端与 Chrome 商店交付授权

2026-09-10：Owner 明确目前没有 Web 域名/Supabase 项目，线上环境配置与部署验收先暂缓。
本地账号/插件代码及无付费 CI 检查可以继续；不以此推导 push、部署或真实用户开放授权。

2026-09-08。Owner 已授权本地施工、浏览器测试、checkpoint commits、有限真实 DeepSeek/TTS
试验；尚未授权 Git push、云端部署或商店上传/提交/发布。服务商选型确认不是部署授权。

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

当前有 no-cost 检查流水线及只产出制品的 Web candidate 流水线，已增加手动部署已验收候选的流水线，尚未执行；尚未选定本次目标项目、域名和发布 SHA。
因此现在不是最终部署审批点。先补齐流水线、环境配置/迁移/回滚方案与目标清单，再审批
具体动作。首次云端验收和向真实受邀用户开放应明确区分；首发按 owner 新确认的 Web-only 门执行，暂缓自动跨设备同步与原生联合验收。

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
