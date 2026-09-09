# 原生在线解析与本地语义接受

2026-09-09。延续 Owner 已确认的 Web 快慢轨、Focus 可选、原生完整迁移体验；不重复要求确认。

用户从捕获编辑器选择 occurrence 后可以请求解释，也可从收件箱继续。开始前先把固定输入存到本地；请求中可以离开，返回显示本地任务。候选展示 Context、Expression、解释及意义边界，明确接受才建立 Personal Meaning。补充关注点只在用户澄清时创建；重试不凭空增加 Focus。失败/中断需要明确重新请求，不后台重复调用模型。已得到的有效候选可断网接受。

- `sensa-library/semantic.rs`、`semantic.sql`：schema v9 本地任务、候选、稳定 Sense/Binding 身份、CAS/幂等接受。接入同一 Library command；个人投影增加 lookups。
- contracts `consumer/nativeSemantic.ts`：版本化请求及结果；固定 request id、输入 digest、proposal 与生成来源。复用既有 semanticProposal 合同。
- API `personal/nativeSemantic.ts`：无个人内容持久化的解析服务；consumer 路由接入原有认证和 Provider 配置，读取账户/配置，只持久化不含个人内容的服务使用记录。保留 Web 原路径。
- Flutter `semantic_service.dart` / `semantic_resolution_screen.dart`：HTTP 传输与候选/澄清页面；服务地址和访问令牌仅内存保存，本轮不是原生账号设置完整迁移。只允许 HTTPS 或回环 HTTP；令牌不写入本地库。个人世界/捕获编辑器提供入口。

请求 `sensa-native-semantic-v1` 固定 id、snapshot、focus（nullable）与 inputDigest；digest 对前三项及版本的 canonical JSON SHA-256。结果原样回显 id/inputDigest，ready 必须有经校验 proposal/provenance，unresolved 不可接受。服务不裁决个人接受、不写个人资料、不创建学习材料。请求大小/超时/结果大小有界，不自动重试。

本地 Begin 保存 running；Finish 校验绑定、规范、表达和来源后变 ready/unresolved；Fail 只保存白名单原因。重新解析/澄清创建新任务并 supersede 旧任务，迟到旧结果拒绝。候选 24 小时有效；接受原子写意义、稳定语义身份、关闭对应收件箱、标记任务 accepted。重复操作由既有操作账本重放；修改或已移除的来源不能绕过校验。

新构造 Sense 没有学习材料；本轮明确显示材料尚未准备，不伪造 Material/Target/readiness。后续按需材料生成纵切负责显式入学与供给。已有本地材料义项的入学功能保持可用。

验收：TS/Rust 规范对照，真实 Hono mock resolver 无付费 HTTP，缺省 Focus、澄清继承、非法候选、过期/移除/迟到/重复、离线接受、macOS/Android UI 与冷启动恢复，根级 typecheck/build/lint。

实施细化：Postgres 0022 只存账户、请求编号、输入摘要、预约时间，执行滚动 24 小时 30 次预算与重复请求保护；不存解析输入/输出。返回前重新鉴权。请求进行时暂时串行化本机操作，避免网络完成与本地 CAS 提交相互覆盖。
