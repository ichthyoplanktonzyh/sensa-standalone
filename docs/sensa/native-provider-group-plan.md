# 原生 Provider 与安全凭据组

2026-09-09 owner 确认整组推进：安全保存、更新/删除/失效恢复；澄清、生成、独立审核分别选择
服务；既有入口共用配置。主代理直接实施，完成双端验收后 checkpoint，不部署、不调用付费模型。

依据：浏览器 options.ts 的连接与用途选择、留空保留 Key、移除连接；Hono reading/service.ts
的安全凭据视图与角色连接；上一组 native-agent-group-handoff.md 的内存凭据和两套设置缺口。

本机 AgentProviders 统一公开配置和用途绑定；ProviderCredentials 单独使用操作系统安全存储。
不把 Key 放入 SQLite、公开 JSON、模型请求正文或日志。库旁配置保留原路径；旧配置可读，首次
填写新凭据后进入新格式；不自动读取或迁移 owner 资料库。配置/凭据按库路径与连接身份隔离。
macOS 使用系统登录钥匙串，Android 使用 Keystore 保护的加密存储。凭据不参加个人数据同步。

服务地址/类型更改需重新输入凭据；删除连接不自动改用其他服务；401/403 标为失效，旧请求的
失败不能清除刚更新的凭据。系统存储不可用时明确停止，不退回明文。各用途选择在每次请求
前固定，并进入现有 Rust request lease；授权原文的 origin 限制继续约束生成和独立审核。

旧 Capture 解释入口接到同一语言老师循环，保留 Capture/source/目标 occurrence/intake；模型
不能换掉捕获的目标表达，最终使用现有本机 semantic 接受事务。已有旧候选仍能查看和确认。
学习准备 UI 合并为一个模型入口；旧 wire adapter 留作回归和 Sensa 在线资源访问，共用设置。

验收：真实系统安全存储写入/重新读取/独立进程恢复、更新/删除/服务变化/失效/迟到拒绝隔离；
配置中无 Key；用途绑定实际出现在 teacher/generator/reviewer 请求；Sensa 与兼容服务、旧 Capture
入口、材料准备、图文能力拒绝、模型失败不改写学习事实；macOS/Android 主链与冷恢复。
原生账户登录、可选资源角色/治理、系统分发签名与 iOS/Windows/Linux 真机验收仍独立记录。
