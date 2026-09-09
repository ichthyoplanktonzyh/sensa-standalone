# 原生模型配置与安全凭据交付

2026-09-09。本组接续语言老师/内容 Agent 协作，范围依据
[native-provider-group-plan.md](native-provider-group-plan.md)。只修改原生本地实现与合成验收；
不迁移 owner 库、不访问真实 Key、不调用付费模型、不部署 Hono。

## 使用行为

模型设置现在是同一个入口。用户添加 OpenAI 兼容连接或 Sensa 服务，配置模型及图片能力；
澄清与解释、学习材料生成、独立审核分别选择连接。可以共用连接，审核仍是独立请求；
每次 lease 根据实际阶段固定接收方。Sensa 在线资源单独选择 Sensa 连接，保留既有资源协议。
未配置、失效或能力不匹配时停止，不自动改用另一个服务。

凭据使用 flutter_secure_storage 10.3.1（兼容现有 Android SDK 36），macOS 为系统登录钥匙串，
Android 为 Keystore 保护的加密存储。公共 JSON 只存连接、用途和随机凭据引用；SQLite、
请求正文和日志不存 Key。重启读取安全存储，不自动发起模型请求。留空保留同一连接凭据；
改变服务地址/类型需重填；更新和删除均作用于单个已知引用，不枚举或清空用户安全存储。

配置写入串行执行，安全存储写入并读回验证后才提交公开配置。401/403 使使用中的凭据失效，
持久保留失效状态；旧请求的迟到拒绝不会删除新 Key。安全存储不可用时显示状态并停止模型
调用，不退回明文。凭据与库配置路径、连接 ID、地址和类型绑定；复制配置到另一库不能
解锁原凭据。当前移动库路径需重新输入 Key；凭据不随个人库同步。

旧“在线解释这个表达”入口进入语言老师循环，保留 Capture、来源、目标 occurrence 与 intake。
老师可以追问和澄清意思，不能把已捕获的表达换成另一表达。明确确认后，在同一本机事务中
使用既有 semantic 接受路径建立 Context–Expression–Sense，Focus 可空；不自动入学或结算。
旧已保存候选仍能查看和确认。学习准备页面合并为一个模型入口；此前的 Sensa wire adapter
继续作为回归依据，发音等既有在线资源共用统一凭据。

原文授权依然固定 recipient origin。生成与审核选择不同 origin 时，不会将获授权原文自动
转发给另一个接收方；需调整连接或撤销原文授权后明确继续。图文原文用于老师理解，资源
生成使用已确认目标；图文原文的专门资源授权仍是下一资源组范围。

## 验收记录

- Rust Agent Capture 测试：保留源/occurrence/intake，拒绝替换表达，候选阶段无 Meaning，
  明确接受且无入学/学习副作用。现有 Agent 预算、lease、原文撤销及独立审核测试继续通过。
- `provider_storage_test.dart`：真实 OS 存储写入、跨进程读取、用途绑定、复制配置隔离、
  地址修改与改回、替换/迟到拒绝/失效跨重开、删除；注入安全存储不可用，验证公开配置不变。
- `agent_test.dart`：设置 UI 选择实际生成器/审核器，HTTP fixture 验证模型分工；图文老师
  提问/更正/确认、显式入学、审核拒绝再修正、材料冻结；Sensa/兼容服务与冷恢复本地接受。
- `provider_capture_test.dart`：原采集解释入口进入同一老师页面，HTTP 401 停止、更新后继续，
  确认保存后源/表达/intake 保留，Focus 空，未入学、未生成正式学习事实。
- `legacy_wire_fixture.dart` 保留旧 wire 的直接回归调用，已删除的配置/请求按钮不再冒充
  当前 UI 验收。此前 semantic/provisioning/anchor/pronunciation 测试继续使用本机既有候选、
  入学、授权、取消和播放器 UI；新的模型入口由本组 Agent/Capture 测试覆盖。

平台结果：macOS `provider-mac-b`、Android `provider-android-a` Agent 主链及同名冷恢复通过；
macOS `secure-mac-e`、Android `secure-android-b` 安全存储主链及同名冷恢复通过。Capture
最新策略来源记录由 `provider-final-mac` / `provider-final-android` 验证。原生旧 wire 的
semantic/provisioning/anchor/pronunciation 主链已在 macOS 用独立合成库回归；发音测试包含
故意不可播放的媒体和文字回退，不使用 TTS。

Rust workspace all-features、7 项 Agent 测试、Clippy all-targets、bridge locked check、
Flutter analyze、根级 typecheck/build/lint 通过；TS/Rust semantic、provisioning、anchor
真实装配与 Hono Agent 无成本检查通过。FRB 的公开接口仍是既有 JSON 命令，无绑定签名变化。

复现：根目录运行 `node --import tsx scripts/sensaNativeAgentSmoke.mts --serve`，Android
增加 `adb reverse tcp:4331 tcp:4331`。在 `apps/sensa_native` 执行
`flutter test integration_test/<agent_test|provider_storage_test|provider_capture_test>.dart -d <device> --dart-define=SENSA_NATIVE_RUN=<unique>`；
Android 加 `--no-uninstall`。前两项成功后以同名追加 `--dart-define=SENSA_NATIVE_RECOVERY=true`
在独立进程恢复。HTTP fixture 验收串行运行；禁止使用 owner 库名。

macOS 验收使用临时独立 Debug bundle ID 和本机已有开发签名；临时签名配置不提交。
临时 ad-hoc 签名的二进制重新构建后可能需要 Keychain 再授权，不能据此声称稳定更新恢复；
本组的恢复证据来自一致开发签名。原 Release 进程保持运行，未读取或迁移 owner 数据。
Android 保持飞行模式开启、Wi-Fi 关闭；测试结束移除本组 loopback 转发。
Android 自动备份关闭，以免系统还原无法解开的凭据存储；个人库备份/同步另行建设。
真实模型质量、系统分发签名与 iOS/Windows/Linux 真机验收不由上述合成测试推导。

## 后续范围

下一组为可选学习资源与内容治理：先确认正式 Web 已有用例、可选角色与表达关系/coverage
对准备合同的要求，再迁移本机准入、失效/替换和 UI。账户登录/令牌自动刷新、流式展示、
采集端交接、正式原生 IA/视觉、三端同步与 Web 本地执行继续单列。本组不代表完整迁移
或 M3 已完成。
