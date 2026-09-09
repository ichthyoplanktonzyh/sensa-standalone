# 原生在线解析、澄清与本地接受交付

2026-09-09。施工范围与已确认体验依据见 [本轮蓝图](native-semantic-resolution-plan.md)。这是完整迁移的一条用例，不关闭 LF-1b、完整迁移或 M3。

## 已实现

Flutter 捕获编辑器可以请求在线解释；收件箱可以恢复固定输入和候选。初次请求不需要 Focus；补充关注点创建有来源链的 Focus 并替代旧解释。失败保留输入，重新请求是用户明确操作；不自动重复模型调用。返回原页面后任务仍在本机，重启后 running 显示中断，可主动重新请求；ready 候选在 24 小时内可离线接受。

Rust schema v9 保存任务、候选、稳定 Sense/Binding 身份和接受记录。请求/候选摘要、结构、精确表达和生成来源均需通过校验；迟到旧结果、过期候选、已移除材料、状态冲突与非法结果不能被接受。接受原子建立 Personal Meaning、Context/Expression Anchor、Alignment 和 Acceptance，关闭原 Intake，保留原始来源快照；同语义规格/表达复用稳定身份。操作重放不重复建立事实，不生成学习记录或调度。

Hono `/sensa/native/semantic/resolve` 复用既有 Semantic Resolver、Provider 配置和账户授权，原 Web 路径保留。原生路径不写服务器个人 lookup/meaning 表，不保存 Context、Focus、候选或接受。迁移 `0022` 只记录服务使用的账户、request id、输入摘要和时间：账户事务锁保证并发去重，30 次/滚动 24 小时预算，已消费 request id 不再次调用模型，模型返回后再次检查权限。调用失败也消耗该次预约；用户明确重新请求才创建新 id。

原生地址/访问令牌只保存在当前应用会话内；只允许 HTTPS 或回环 HTTP，不跟随重定向。这里使用现有 Sensa 会话权限，不把 Provider API Key 写入 SQLite 或原生配置。正式原生账号、Provider 设置、安全凭据存储与自动续期仍需对应产品用例迁移。

## 验证

全部使用合成材料与无成本模型替身，无付费调用、Owner 数据迁移或部署。

- `sensaNativeSemanticSmoke.mts`：17 组真实 TS schema/Rust 候选对照；Hono HTTP 验证鉴权、请求摘要、返回来源、去重。旧 Capture 对照的 45 组也通过。
- Rust `tests/semantic.rs`：4 条事务集成覆盖缺省 Focus、澄清链、迟到结果、表达/摘要/来源拒绝、原子回滚、接受重放、跨 Context 稳定语义身份、过期、移除/恢复、关闭原 Context-only Intake，以及 v8→v9 升级。原 library 集成回归通过，旧版本模拟升级脚本已包含新表移除。
- `sensaNativeSemanticDatabaseSmoke.mts`：真实隔离 Postgres（仅复制既有测试库 schema）应用 0022；并发同请求只调用一次、id 重用拒绝、30 次预算/跨日、调用中撤权；native usage 仅四列元数据、服务器 semantic_lookups 无新增个人内容。
- macOS `mac-semantic-04`：Flutter → HTTP → Hono 无成本解析 → Rust → SQLite，直接接受、歧义澄清、模拟 Provider 失败恢复通过；独立进程冷启动完全一致，清空在线凭据后离线接受候选通过。
- Android `android-semantic-01`：同一 UI/HTTP/本地事务主流程通过；飞行模式开启、Wi-Fi 关闭，只有 adb 回环转发到本机无成本服务。独立进程冷恢复快照完全一致，缺少服务凭据时本地接受候选通过。
- 原有 `personal_world_test.dart` macOS 回归（`mac-semantic-regression-01`）：本机已知义项、收件箱补表达、接受、移除恢复及显式学习流程通过。
- 根级 typecheck/build/lint、Rust workspace clippy、原生 bridge locked check 通过。Flutter 静态分析无问题；Android 冷恢复通过。

## 边界与下一项

新构造的 Sense 尚无学习材料，界面明确显示“学习材料尚未准备”，不伪造 Material/Target/ready。既有本机材料义项仍可显式加入学习。下一纵切为个人意义显式入学 → 固定内容需求/任务 → Hono 生成和独立校验 → Rust 冻结材料化与 readiness → 现有 Profile/学习执行器；继续分离语义接受、学习意图、资源准备和正式学习。

Web 流式解释预览尚未接入原生；本轮采用完整候选返回。完整原生 IA、图片/音频等采集、草稿、图谱/表达分支、Anchor Use 任务协作、浏览器/Agent transport、完整发布包治理、备份同步仍在清单。本轮未验证真实模型质量或云端部署；正式在线服务启用前须由 CI/CD 应用 0022。本机仍有 500 次解析记录的有界投影容量，完整任务归档/分页后续处理。
