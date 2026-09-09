# 原生语言老师与内容 Agent 协作交付

2026-09-09。范围见 [本组合同](native-agent-group-plan.md)。本轮交付的是两条本机持久化的
模型工具循环及图文/provider 接线；不把整个资源发布治理或完整原生迁移标记为完成。

## 用户可见行为

- 在图文材料编辑页进入“和语言老师聊一聊”。材料先保存，点击发送才调用所选服务；可以明确
  选择只讨论文字。支持 PNG/JPEG/WebP 的实际图片字节，不能把图片摘要当作模型已经看到图片。
- 老师以理解场景、找到自然表达为目标，必要时问一个实际问题；等待回答时循环停止。用户用
  自然语言补充或更正建议，不填写内部 semanticSpec，不要求 Focus，也不穷举细微语义边界。
- 本机已确认意思查询只返回抽象意思、表达及可复用版本信息，不附带其他私人上下文。复用相同
  semanticSpec/Expression 时沿用既有语义身份；库中已有意思的直接选择入口继续保留。
- 候选必须点击“就是这个意思，保存”，才通过 Rust 事务写入完整 Context/Sense/Expression；
  不自动加入学习。生成任务仍需另行显式入学并固定 Profile/目标。
- 学习准备页可启动或恢复资源循环：读固定需求、查询可用参考事实、生成候选、独立审核、拒绝后
  修正、审核通过后本机冻结材料。复用原有 Material/目标/Profile 接口，不写学习 Evidence、结果
  或调度，也不直接创建 Run。过期任务需显式开始新的 attempt，不复用失效响应。
- 对话与资源准备历史可以重开；退出/重启不自动调用模型。已保存候选可在没有凭据时离线确认。
  暂停与失败保留记录，迟到结果不能覆盖新材料、新任务或已撤销的原文授权。

## 原实现依据与实现接缝

| 源依据 | 本轮迁移 |
| --- | --- |
| `apps/web/src/experience/personalMeaningJourney/semanticAgent.ts`、`semanticAgentSession.ts`、`realSemanticAgent.ts` | 原 chat/consolidate 协作扩展为语言老师工具循环；用户确认边界由本机 Rust 保持 |
| `apps/web/src/experience/learningRuntime/contentAgentProvisioning.ts` | model → 白名单 tool → observation → 下一回合，终结调用互斥、调用 identity、次数和取消边界 |
| `apps/web/src/experience/learningRuntime/lightweightAgenticProvisioning.ts` | 固定轻量目标、按需候选、参考事实缺失时明确空结果、系统拥有目标表达和固定需求；独立校验仍独立执行 |
| 原生 `semantic`、`world`、`provisioning` | 保留旧 TS/Hono 协作回归；新会话通过相同语义身份、World 接受与 provisioning Finish 进入已有本机学习路径 |

`crates/sensa-library/src/agent.rs` 拥有会话状态、固定输入、工具权限、候选和接受事务。
schema15 新增 `agent_sessions`；升级保留旧快照和操作回执。Agent/World 命令在正式 Activity
刷新/结算前独立分流，共用 library CAS 与幂等回执，不让一次聊天推进正式学习。

每个会话最多 24 次模型请求、40 次工具执行；每工具最多 12 次，每回合至多 4 个工具调用。
Dart 单次明确继续最多自动推进 8 个请求，HTTP 45 秒超时，Rust 请求租约 60 秒，资源 attempt
保留 10 分钟；原有每目标 3 次 attempt 和本机每日准备预算继续有效。重启不重置会话预算。

内容候选和独立审核分别使用不同请求 identity；审核请求只包含固定目标、来源、需求和候选，
不复用生成对话、工具或自评。Rust 校验精确输入、候选摘要、实际已保存审核、目标和任务有效性，
再进入既有材料化；一个自称 ready 的外部 JSON 不能替代本机会话和审核状态。

## Provider 与数据边界

- 支持 OpenAI-compatible 自带 Key 和 Sensa 服务两种 transport。配置保存为本机库旁的
  `.agent-providers.json`，不属于个人事实数据库；模型 Key/访问令牌只在本次进程内存中，
  重启需重新填写；更改服务地址或服务类型会清除旧凭据。**操作系统安全凭据持久化仍未交付**，不声称完整 Provider 管理已完成。
- HTTPS 默认，开发验收只放行本机 HTTP；拒绝 URL 内凭据、query、fragment 和 HTTP redirect。
  图片经本机媒体摘要校验后编码，单次原图总量最多 6 MiB，请求最多 12 MiB，响应最多 256 KiB。
- 已授权原文的接收 origin 必须与准备时和每次请求所选服务一致。授权变更结束旧 attempt，后续
  结果不再接纳。图文 World 材料目前用于老师理解，进入生成器的是已确认抽象目标；图文原文
  对资源生成的单独授权 UI 仍属于后续资源工作，不绕过原有 Anchor Use 边界。
- `apps/api/src/sensa/agent/native.ts` 是无个人会话存储的模型代理；鉴权后固定 request ID/digest、
  日预算预留、调用后再次鉴权，仅存使用量元数据。使用已有服务器 meaning provider 设置；返回
  实际响应 model，客户端将所选连接和实际模型分别记录。新路由未部署。
- 官方 DeepSeek 地址显式关闭 thinking，以使用标准 tool history。它仍是多轮工具调用，
  不保存或声称输出思维链。依据：[thinking 模式](https://api-docs.deepseek.com/guides/thinking_mode/)、
  [Chat Completion](https://api-docs.deepseek.com/api/create-chat-completion/)。默认模型为
  `deepseek-v4-flash`；图片能力需按用户实际选择的模型明确配置。未做付费模型质量验收。

## 验收

- `crates/sensa-library/tests/agent.rs`：提问等待、自然语言纠正、非法候选反馈、明确接受、学习
  不变、未授权/重复/迟到/跨库/超时调用、暂停、原文 origin 匹配和撤销、预算跨重开保留、
  独立审核拒绝修正、固定材料提交及幂等、schema14 → 15。
- `scripts/sensaNativeAgentSmoke.mts`：无成本 Hono 鉴权、digest、重放、工具隔离、inline image
  限制；`--serve` 提供真实 HTTP 的兼容接口及 Sensa 封装 fixture，不读取真实凭据或连接模型。
- `integration_test/agent_test.dart`：真实 Flutter/FFI/SQLite、模型配置 UI、图片实际网络载荷、
  提问/更正/确认/显式入学、审核拒绝和修正、图文发送 opt-out、自带 Key 与 Sensa 两种 transport、
  凭据未落文件、独立进程恢复后离线接受且 HTTP 计数不增长。
- macOS `agent-mac-0909d`、Android `agent-android-0909b` 主链及同名独立进程恢复通过。macOS Debug 使用临时独立 bundle ID，
  测试后恢复；原 Release 进程保持运行。Android 不卸载应用，用 adb reverse 访问本机 fixture，
  不改变原飞行模式/关闭 Wi-Fi 状态。全部使用独立命名的合成库，未读取或迁移 owner 库。
- Rust workspace all-features、Clippy all-targets、bridge locked check、Flutter analyze、根级
  typecheck/build/lint；既有 TS/Rust proposal 与 provisioning 真实装配回归继续通过。

复现：先在仓库根目录启动 `node --import tsx scripts/sensaNativeAgentSmoke.mts --serve`，
Android 执行 `adb reverse tcp:4331 tcp:4331`。在 `apps/sensa_native` 运行
`flutter test integration_test/agent_test.dart -d <device> --dart-define=SENSA_NATIVE_RUN=<unique>`；
Android 加 `--no-uninstall`。成功后同名追加 `--dart-define=SENSA_NATIVE_RECOVERY=true`，在独立
进程验证恢复。fixture 的网络计数验收应串行运行。不要使用 owner 库名。

## 仍保留的范围

此 adapter 只供给已支持的 lightweight 必需文本材料。可选参考事实目前明确为空；外部词典/
语料接入、可选材料角色与发布治理、安全凭据保存、原生账户、流式说明和更广的表达关系/coverage
准备不在本轮完成声明中。已发布高保证材料及其既有执行器继续保留，不降级为轻量。

下一步资源组仍需收口这些已有 Web 用例与原生入口的映射，再推进采集交接和正式原生 IA/视觉。
浏览器/Agent 端口、三端事实同步、Web 本地执行和 M3 均未因本组而完成。

2026-09-09 后续更新：本记录中的“内存凭据”属于上一组交付边界；系统安全持久化、用途选择、统一入口与 Capture 接线已由 [Provider 组](native-provider-group-handoff.md) 接续。原生账户、发布治理和可选资源边界仍保留。

后续更新（2026-09-09）：本文所列资源供给、图文授权、关系准备、流式与原生在线账户事项，已由 [资源整组交付](native-resource-group-handoff.md) 接续；本文保留原轮次验收记录，当前状态以迁移清单为准。
